import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGate, runPool, SOLDCOMPS_GAP_MS } from "@/lib/pace";
import { HOUSE_RULES, resolveRules } from "@/lib/house-pricing";
import { VARIANTS } from "@/lib/variants";
import {
  BATCH_FETCH_OPTIONS, MAX_CARDS, cardsFromCsv, compKey, evaluateCard, mergeComps, normaliseCard,
  planCard, priceDiffers, resultsCsv, unpricedSkus, wantsFallback
} from "@/lib/batch-comps";
import { REASON_CODES, TITLE_MAX_CARDS, isTitleRequest, planTitleCard, titleCardResult, titleKey } from "@/lib/title-comps";
import { createCompsFetcher, priceFieldCards } from "@/lib/batch-price-core";

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
 * Two forms, told apart by the cards themselves:
 *
 * - FIELDS — { sku, name, number, set, … }: the house-rule price per card.
 * - TITLES — { id, title } and no name: the evidence, no price. Every sold
 *   listing fetched with the reason it would be excluded, exactly one
 *   SoldComps search per distinct title, and a failed lookup is status
 *   "timeout" for that card — never a fall back to active listings.
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
      cards: "[{ sku, name, number, set, variant, condition, language, any_language?, game?, current_price, variant_keys? }] — or `csv` instead. any_language: true counts sales in every language; game (pokemon | yugioh | mtg) sets the floor",
      csv: "raw CardUploader CSV text (alternative to `cards`)",
      mode: "\"price\" (default) or \"check\": only cards whose suggestion differs from current_price by more than check.abs_pounds or check.pct",
      check: { abs_pounds: 1, pct: 30 },
      rules: HOUSE_RULES,
      fresh: "true skips the 24h cache read (a sale from today may be missing from a cached answer)",
      depth: "1 = one search per card; 2 (default) = retry without the set when the first search finds fewer than minCompsForPercentile; 3 = the full ladder — every rung (exact, no set, no printing words, unpadded number, numerator only, set code, no language word) run and merged, each sale once; results carry search[] with what each rung fetched and added",
      format: "\"json\" (default) or \"csv\" for sku,suggested_price"
    },
    variant_keys: VARIANTS.map((v) => ({ key: v.key, label: v.label })),
    title_form: {
      body: "{ cards: [{ id, title }] } — every card a title and no `name`; up to " + TITLE_MAX_CARDS + " per request (~35 is the intended size)",
      options: "fresh: true skips the 24h cache read",
      output: "results[]: id, title, query, parsed{name,number,set,language,condition,variant,promo}, status (ok | no_sales | timeout | error), error?, n_sold, n_kept, sold[]: { price, postage, date, title, itemId, url, location, excluded_reason, excluded_detail }",
      excluded_reasons: [...new Set(Object.values(REASON_CODES))],
      notes: "One SoldComps search per distinct title (identical titles share it; 429s are retried). No price is worked out and active listings are never used. excluded_detail is the engine's own reason, unmapped. condition_mismatch is never emitted: no rule excludes a sale on condition."
    },
    output: "results[]: sku, query, matched, n_comps, last_sold, sales[], excluded[] (with reason), p40, suggested_price, confidence, flags{few_comps, few_sales, variant_uncertain, wide_spread, no_uk_comps, price_held, big_rise, big_drop, in_hand_check, put_back}, decision (apply | terapeak | keep | hold) and decision_reason; plus csv and summary"
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

  const titleForm = isTitleRequest(body);
  let cards;
  if (titleForm) cards = body.cards;
  else if (typeof body.csv === "string" && body.csv.trim()) cards = cardsFromCsv(body.csv);
  else if (Array.isArray(body.cards)) cards = body.cards.map((c, i) => normaliseCard(c, i));
  else return NextResponse.json({ ok: false, error: "Send `cards` (an array) or `csv` (CardUploader CSV text). GET this URL for the contract." }, { status: 400 });

  if (!titleForm) cards = cards.filter((c) => c.name);
  if (!cards.length) return NextResponse.json({ ok: false, error: "No cards with a name in that request." }, { status: 400 });
  const max = titleForm ? TITLE_MAX_CARDS : MAX_CARDS;
  if (cards.length > max) {
    return NextResponse.json({ ok: false, error: `${cards.length} cards is more than ${max} per request — split the batch.` }, { status: 400 });
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
  // 1 = one search; 2 = retry without the set when thin; 3 = the full ladder,
  // every rung run and merged (planCard's `ladder`, see searchLadder()).
  const depth = [1, 2, 3].includes(Number(body.depth)) ? Number(body.depth) : 2;
  const fresh = !!body.fresh;
  const options = { ...BATCH_FETCH_OPTIONS };
  const gate = createGate(SOLDCOMPS_GAP_MS);
  const engine = createCompsFetcher({ supabase, apiKey: profile.soldcomps_api_key, options, fresh, gate });
  const { getComps, stats } = engine;

  if (titleForm) return titleResponse(cards, { getComps, stats, started, options, fatalNow: engine.fatalNow });

  const results = await priceFieldCards(cards, { getComps, fatalNow: engine.fatalNow, depth, rules, concurrency: CONCURRENCY });
  const fatal = engine.fatalNow();

  let out = results;
  const mode = body.mode === "check" ? "check" : "price";
  if (mode === "check") {
    const thresholds = {
      absPounds: Number(body.check?.abs_pounds ?? 1),
      pct: Number(body.check?.pct ?? 30)
    };
    out = results
      .map((r) => ({ ...r, check: priceDiffers(r, thresholds) }))
      .filter((r) => r.check.differs);
  }

  const csv = resultsCsv(results);
  if (body.format === "csv") {
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }

  const priced = results.filter((r) => r.suggested_pence != null).length;
  return NextResponse.json({
    ok: !fatal,
    ...(fatal ? { error: fatal.message } : {}),
    as_of: new Date().toISOString(),
    mode,
    rules,
    window_days: options.soldAfterDays,
    summary: {
      cards: results.length,
      priced,
      unpriced: results.length - priced,
      unpriced_skus: unpricedSkus(results),
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

/**
 * The title form: the evidence per card, no price.
 *
 * Cards are grouped by title first, so a title sent twice is one plan and one
 * search; every id still gets its own row, in the order it was sent. A lookup
 * that fails is "timeout" for the cards on it and the batch carries on. A key
 * SoldComps refused, or a spent quota, is "error" for every card not yet
 * fetched — there is nothing to carry on to.
 */
async function titleResponse(cards, { getComps, stats, started, options, fatalNow }) {
  const groups = new Map();
  cards.forEach((raw, i) => {
    const title = String(raw?.title ?? "").trim();
    const id = raw?.id ?? raw?.sku ?? null;
    const key = titleKey(title);
    if (!groups.has(key)) groups.set(key, { title, members: [] });
    groups.get(key).members.push({ i, id: id == null ? null : String(id), title });
  });
  const list = [...groups.values()];
  const outcomes = new Array(list.length);

  await runPool(list.length, CONCURRENCY, async (g) => {
    const group = list[g];
    if (!group.title) {
      outcomes[g] = { status: "error", error: "No title." };
      return;
    }
    const planned = planTitleCard({ title: group.title }, g);
    group.planned = planned;
    if (!planned.plan.queries[0]) {
      outcomes[g] = { status: "error", error: "Nothing searchable in that title." };
      return;
    }
    try {
      outcomes[g] = { status: "ok", ...(await getComps(planned.plan.queries[0])) };
    } catch (err) {
      const fatal = err.isAuthError || err.isQuotaExceeded || err === fatalNow();
      outcomes[g] = { status: fatal ? "error" : "timeout", error: err.message || String(err) };
    }
  });

  const results = new Array(cards.length);
  list.forEach((group, g) => {
    const p = group.planned || {};
    for (const m of group.members) {
      results[m.i] = titleCardResult({ id: m.id, title: m.title, plan: p.plan, parsed: p.parsed }, outcomes[g]);
    }
  });

  const fatal = fatalNow();
  const count = (st) => results.filter((r) => r.status === st).length;
  return NextResponse.json({
    ok: !fatal,
    ...(fatal ? { error: fatal.message } : {}),
    form: "titles",
    as_of: new Date().toISOString(),
    window_days: options.soldAfterDays,
    summary: {
      cards: results.length,
      distinct_titles: list.length,
      ok: count("ok"),
      no_sales: count("no_sales"),
      timeout: count("timeout"),
      error: count("error"),
      soldcomps_requests: stats.requests,
      cache_hits: stats.cacheHits,
      ms: Date.now() - started
    },
    results
  });
}
