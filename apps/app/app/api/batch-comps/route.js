import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSoldComps } from "@/lib/soldcomps-fetch";
import { readCache, writeCache } from "@/lib/comp-cache";
import { createGate, runPool, SOLDCOMPS_GAP_MS } from "@/lib/pace";
import { HOUSE_RULES, resolveRules } from "@/lib/house-pricing";
import { VARIANTS, detectVariants } from "@/lib/variants";
import { GUARD_RULES, guardVerdict, matchCatalog, numberForms, referenceGbp, resolveGuardRules } from "@/lib/price-guard";
import {
  BATCH_FETCH_OPTIONS, MAX_CARDS, askingEvidence, cardsFromCsv, evaluateCard, mergeComps, normaliseCard,
  planCard, priceDiffers, resultsCsv, unpricedSkus, wantsFallback
} from "@/lib/batch-comps";

/**
 * POST /api/batch-comps — price a whole batch in one call.
 *
 * Built for Claude driving the app from a signed-in tab: same-origin, so the
 * session cookie is the authentication and no key ever leaves the server. The
 * SoldComps key is the user's own, exactly as /api/soldcomps uses it.
 *
 * One request per card (two when the first search is thin and a set can be
 * dropped), paced at SoldComps' 60 a minute, several in flight, and anything
 * asked in the last 24 hours comes back from the app's comp cache for nothing.
 * Fifty uncached cards is about a minute; a re-run the same day is seconds.
 *
 * GET returns the contract, so a caller can read how to use it.
 */

// A cold 100-card batch at the supplier's rate is ~2 minutes, more with
// fallbacks. Well inside this; callers should still send ~50 at a time.
export const maxDuration = 300;

/** In flight at once. The gate binds before more would help — see lib/pace.js. */
const CONCURRENCY = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/batch-comps",
    auth: "the signed-in session cookie (call fetch() from a Comp Finder tab); the SoldComps key in Settings is used server-side",
    limits: { max_cards_per_request: MAX_CARDS, advice: "send ~50 cards per request, one request at a time — parallel requests share SoldComps' 60/min limit" },
    body: {
      cards: "[{ sku, name, number, set, variant, condition, language, current_price, variant_keys? }] — or `csv` instead",
      csv: "raw CardUploader CSV text (alternative to `cards`)",
      mode: "\"price\" (default) or \"check\": only cards whose suggestion differs from current_price by more than check.abs_pounds or check.pct",
      check: { abs_pounds: 1, pct: 30 },
      rules: HOUSE_RULES,
      guard: GUARD_RULES,
      check_asking: "true (default) asks what thin cards (<4 comps) are listed at now — one more request each, cached 2h",
      fresh: "true skips the 24h cache read (a sale from today may be missing from a cached answer)",
      depth: "1 = one search per card; 2 (default) = retry without the set when the first search finds fewer than minCompsForPercentile",
      format: "\"json\" (default) or \"csv\" for sku,suggested_price"
    },
    variant_keys: VARIANTS.map((v) => ({ key: v.key, label: v.label })),
    verdicts: "ok = list it; review = listable, read `reasons` first; hold = evidence says it's worth much more — no listable price, written 0.00 in the CSV",
    output: "results[]: verdict, reasons, listable_price, reference (Cardmarket), siblings, sku, query, matched, n_comps, last_sold, sales[], excluded[] (with reason), p40, suggested_price, confidence, flags{few_comps, variant_uncertain, wide_spread, no_uk_comps, price_held}; plus csv and summary"
  });
}

export async function POST(request) {
  const started = Date.now();
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in.", isAuthError: true }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body wasn't valid JSON." }, { status: 400 });
  }

  let cards;
  if (typeof body.csv === "string" && body.csv.trim()) cards = cardsFromCsv(body.csv);
  else if (Array.isArray(body.cards)) cards = body.cards.map((c, i) => normaliseCard(c, i));
  else return NextResponse.json({ ok: false, error: "Send `cards` (an array) or `csv` (CardUploader CSV text). GET this URL for the contract." }, { status: 400 });

  cards = cards.filter((c) => c.name);
  if (!cards.length) return NextResponse.json({ ok: false, error: "No cards with a name in that request." }, { status: 400 });
  if (cards.length > MAX_CARDS) {
    return NextResponse.json({ ok: false, error: `${cards.length} cards is more than ${MAX_CARDS} per request — split the batch.` }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("soldcomps_api_key")
    .eq("id", user.id)
    .single();
  if (profileError || !profile?.soldcomps_api_key) {
    return NextResponse.json({ ok: false, error: "No SoldComps API key set — add one in Settings.", isAuthError: true }, { status: 400 });
  }

  const rules = resolveRules(body.rules);
  const guardRules = resolveGuardRules(body.guard);
  const checkAsking = body.check_asking !== false;
  const depth = Number(body.depth) === 1 ? 1 : 2;
  const fresh = !!body.fresh;
  const options = { ...BATCH_FETCH_OPTIONS };
  const gate = createGate(SOLDCOMPS_GAP_MS);
  const stats = { requests: 0, cacheHits: 0 };
  let fatal = null; // a refused key or a spent quota ends the batch, not just a card

  // One fetch per distinct query in this batch: two copies of a card in one
  // file are one search, not two.
  const inflight = new Map();
  const getComps = (query, opts = options) => {
    const key = `${opts.sold === false ? "active" : "sold"}|${query}`;
    if (!inflight.has(key)) inflight.set(key, fetchOne(query, opts));
    return inflight.get(key);
  };

  async function fetchOne(query, options) {
    if (!fresh) {
      const hit = await readCache(supabase, query, options);
      if (hit) {
        stats.cacheHits++;
        return { comps: hit.comps || [], pageFull: !!hit.hasNextPage, fetchedAt: hit.fetchedAt, cached: true };
      }
    }
    if (fatal) throw fatal;
    for (let attempt = 0; ; attempt++) {
      await gate();
      if (fatal) throw fatal;
      stats.requests++;
      try {
        const res = await fetchSoldComps(profile.soldcomps_api_key, query, options);
        if (res.comps.length > 0) await writeCache(supabase, query, options, res);
        return { comps: res.comps, pageFull: !!res.hasNextPage, fetchedAt: new Date().toISOString(), cached: false };
      } catch (err) {
        if (err.isAuthError || err.isQuotaExceeded) {
          fatal = err;
          throw err;
        }
        if (err.isRateLimited && attempt < 2) {
          await sleep(2500 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  }

  const plans = cards.map(planCard);
  const results = new Array(plans.length);

  await runPool(plans.length, CONCURRENCY, async (i) => {
    const plan = plans[i];
    const sent = [];
    const pages = [];
    let meta = {};
    try {
      const first = await getComps(plan.queries[0]);
      sent.push(plan.queries[0]);
      pages.push(first.comps);
      meta = first;
      let result = evaluateCard(plan, first.comps, { ...meta, queries: sent }, rules);
      if (depth > 1 && plan.queries[1] && wantsFallback(result, rules)) {
        const second = await getComps(plan.queries[1]);
        sent.push(plan.queries[1]);
        pages.push(second.comps);
        const merged = mergeComps(pages);
        // The older of the two fetch times: that is how stale the answer can be.
        const fetchedAt = [first.fetchedAt, second.fetchedAt].filter(Boolean).sort()[0] || null;
        result = evaluateCard(plan, merged, { queries: sent, fetchedAt, cached: first.cached && second.cached, pageFull: first.pageFull || second.pageFull }, rules);
      }
      results[i] = result;
    } catch (err) {
      results[i] = {
        index: plan.card.index,
        sku: plan.card.sku,
        query: plan.queries[0],
        queries_sent: sent,
        error: err.message || String(err),
        suggested_price: null,
        suggested_pence: null,
        flags: { error: true },
        current_price: plan.card.currentPence == null ? null : plan.card.currentPence / 100
      };
    }
  });

  // ---- The guard: is there evidence any card is worth far more? ----------
  // Cardmarket's price for the matched catalogue product, and the card's other
  // printings. Two reads for the whole batch; best effort, because the guard
  // must degrade to "no reference" rather than take the batch down.
  let referenceStatus = "ok";
  const catalogRows = new Map(); // plan index -> rows sharing its number
  const priceById = new Map();
  try {
    const forms = [...new Set(plans.flatMap((p) => (p.english ? numberForms(p.number) : [])))];
    const rows = [];
    for (let i = 0; i < forms.length; i += 150) {
      const { data, error } = await supabase
        .from("card_catalog")
        .select("cardmarket_id,name,collector_number,expansion")
        .eq("game", "pokemon")
        .in("collector_number", forms.slice(i, i + 150))
        .limit(5000);
      if (error) throw error;
      rows.push(...(data || []));
    }
    plans.forEach((p, i) => {
      const mine = new Set(numberForms(p.number));
      catalogRows.set(i, rows.filter((r) => mine.has(String(r.collector_number || "").trim())));
    });
    const ids = [...new Set(rows.map((r) => r.cardmarket_id))];
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await supabase
        .from("cm_price_latest")
        .select("cardmarket_id,as_of,trend,avg7,avg30,avg,low,p_trend,p_avg7,p_avg30,p_low")
        .in("cardmarket_id", ids.slice(i, i + 300));
      if (error) throw error;
      for (const r of data || []) priceById.set(r.cardmarket_id, r);
    }
    if (rows.length && !priceById.size) referenceStatus = "no Cardmarket prices loaded (migration 017 / nightly price sync)";
  } catch (err) {
    referenceStatus = `unavailable: ${err.message || err}`;
  }

  const variantsOf = (name) => detectVariants({ name }).keys;
  await runPool(plans.length, CONCURRENCY, async (i) => {
    const plan = plans[i];
    const r = results[i];
    if (!r || r.error) return;
    const { product, siblings } = matchCatalog(plan, catalogRows.get(i) || [], variantsOf);
    const reverse = !!plan.settings.subjectReverse;
    const reference = product
      ? {
          source: "cardmarket",
          product: product.name,
          cardmarket_id: product.cardmarket_id,
          gbp: referenceGbp(priceById.get(product.cardmarket_id), { reverse }, guardRules),
          as_of: priceById.get(product.cardmarket_id)?.as_of || null
        }
      : null;
    const sib = siblings
      .map((s) => ({ name: `${s.name} (${s.expansion})`, cardmarket_id: s.cardmarket_id, gbp: referenceGbp(priceById.get(s.cardmarket_id), {}, guardRules) }))
      .filter((s) => s.gbp != null);

    // Live asking prices, for the thin cards only: a card priced off one or two
    // sales is the one most likely to be wrong, and what it is listed at now
    // is the cheapest second opinion. Never for a card with no price at all —
    // that is already a hold.
    let asking = null;
    if (checkAsking && r.suggested_pence != null && r.n_comps < guardRules.thinComps && !fatal) {
      try {
        const act = await getComps(plan.queries[plan.queries.length - 1], { ...options, sold: false });
        asking = askingEvidence(plan, act.comps, rules);
      } catch {
        asking = null; // evidence, not a requirement
      }
    }

    const { verdict, reasons } = guardVerdict(r, { reference, siblings: sib, asking }, guardRules);
    Object.assign(r, {
      verdict,
      reasons,
      listable_pence: verdict === "hold" ? null : r.suggested_pence,
      listable_price: verdict === "hold" ? null : r.suggested_price,
      reference,
      siblings: sib,
      asking
    });
  });
  for (const r of results) {
    if (r && r.error) Object.assign(r, { verdict: "hold", reasons: [{ level: "hold", why: `Not priced: ${r.error}` }], listable_pence: null, listable_price: null });
  }

  let out = results;
  const mode = body.mode === "check" ? "check" : "price";
  if (mode === "check") {
    const thresholds = {
      absPounds: Number(body.check?.abs_pounds ?? 1),
      pct: Number(body.check?.pct ?? 30)
    };
    out = results
      .map((r) => ({ ...r, check: priceDiffers(r, thresholds) }))
      // A held card always needs a look, whatever it is listed at now.
      .filter((r) => r.check.differs || r.verdict === "hold");
  }

  const csv = resultsCsv(results);
  if (body.format === "csv") {
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }

  const priced = results.filter((r) => r.suggested_pence != null).length;
  const skusWith = (v) => results.filter((r) => r.verdict === v).map((r) => r.sku || `#${r.index + 1}`);
  return NextResponse.json({
    ok: !fatal,
    ...(fatal ? { error: fatal.message } : {}),
    as_of: new Date().toISOString(),
    mode,
    rules,
    guard: guardRules,
    reference_status: referenceStatus,
    window_days: options.soldAfterDays,
    summary: {
      cards: results.length,
      priced,
      unpriced: results.length - priced,
      unpriced_skus: unpricedSkus(results),
      ok: skusWith("ok").length,
      review_skus: skusWith("review"),
      hold_skus: skusWith("hold"),
      errors: results.filter((r) => r.error).length,
      flagged: results.filter((r) => r.flags && Object.values(r.flags).some(Boolean)).length,
      ...(mode === "check" ? { differing: out.length } : {}),
      soldcomps_requests: stats.requests,
      cache_hits: stats.cacheHits,
      ms: Date.now() - started
    },
    results: out,
    csv
  });
}
