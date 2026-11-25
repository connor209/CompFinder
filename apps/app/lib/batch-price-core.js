/**
 * The fields-form pricing behind POST /api/batch-comps, as two functions so
 * the pricing queue's worker (lib/pricing-queue.js, /api/pricing-queue) prices
 * a card EXACTLY as the route does — one way to price a card, two callers.
 *
 * createCompsFetcher() is the SoldComps side: the 24h cache, one fetch per
 * distinct query, the gate the caller hands in (which is what sets the RATE),
 * 429 back-off, and a refused key or spent quota ending the run.
 * priceFieldCards() is the ladder and the house rules over it.
 *
 * Server-only: it is handed a Supabase client and the user's SoldComps key.
 */
import { fetchSoldComps } from "./soldcomps-fetch.js";
import { readCache, writeCache } from "./comp-cache.js";
import { runPool } from "./pace.js";
import { compKey, evaluateCard, mergeComps, planCard, wantsFallback } from "./batch-comps.js";
import { ruleKeyFor } from "./price-rules.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createCompsFetcher({ supabase, apiKey, options, fresh = false, gate }) {
  const stats = { requests: 0, cacheHits: 0 };
  let fatal = null; // a refused key or a spent quota ends the batch, not just a card

  // One fetch per distinct query in this batch: two copies of a card in one
  // file are one search, not two.
  const inflight = new Map();
  const getComps = (query, page = 1) => {
    const k = `${page}|${query}`;
    if (!inflight.has(k)) inflight.set(k, fetchOne(query, page));
    return inflight.get(k);
  };

  // The cache key has no page in it, so a later page is cached under its own
  // query string — never over page 1.
  const cacheQuery = (query, page) => (page > 1 ? `${query} ::page${page}` : query);

  async function fetchOne(query, page = 1) {
    if (!fresh) {
      const hit = await readCache(supabase, cacheQuery(query, page), options);
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
        const res = await fetchSoldComps(apiKey, query, { ...options, page });
        if (res.comps.length > 0) await writeCache(supabase, cacheQuery(query, page), options, res);
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


  return { getComps, stats, fatalNow: () => fatal };
}

/** House-rule prices for normalised cards (normaliseCard), in order. */
export async function priceFieldCards(cards, { getComps, fatalNow, depth = 3, rules, concurrency = 4, userRules = null }) {
  const plans = cards.map(planCard);
  // Your rules for these cards (lib/price-rules.js), keyed the way a card is read.
  if (userRules && userRules.size) for (const p of plans) p.userRule = userRules.get(ruleKeyFor(p.card)) || null;
  const results = new Array(plans.length);

  await runPool(plans.length, concurrency, async (i) => {
    const plan = plans[i];
    const sent = [];
    const pages = [];
    let meta = {};
    try {
      if (depth === 3) {
        // Every rung at once (the gate still paces them); a failed rung costs
        // that rung, never the card, unless every rung failed.
        const rungs = [...plan.ladder];
        const got = await Promise.all(rungs.map((r) => getComps(r.query).then((x) => ({ ok: true, ...x }), (err) => ({ ok: false, err }))));
        if (fatalNow() && got.every((g) => !g.ok)) throw fatalNow();
        // A full first page on the exact search means older sales are waiting
        // behind it: read page 2 once, so a fast card's 90 days are not cut short.
        if (got[0]?.ok && got[0].pageFull) {
          try {
            const p2 = await getComps(rungs[0].query, 2);
            rungs.push({ rung: "exact p2", query: rungs[0].query });
            got.push({ ok: true, ...p2 });
          } catch (err) {
            if (fatalNow()) throw fatalNow();
          }
        }
        const okOnes = got.filter((g) => g.ok);
        if (!okOnes.length) throw got[0].err;
        const seen = new Set();
        const search = rungs.map((r, i) => {
          const g = got[i];
          if (!g.ok) return { rung: r.rung, query: r.query, error: g.err?.message || "failed" };
          let added = 0;
          for (const c of g.comps) { const k = compKey(c); if (!seen.has(k)) { seen.add(k); added++; } }
          return { rung: r.rung, query: r.query, fetched: g.comps.length, added, cached: !!g.cached, page_full: !!g.pageFull };
        });
        const merged = mergeComps(okOnes.map((g) => g.comps));
        const fetchedAt = okOnes.map((g) => g.fetchedAt).filter(Boolean).sort()[0] || null;
        const result = evaluateCard(plan, merged, {
          queries: rungs.filter((_, i) => got[i].ok).map((r) => r.query), fetchedAt,
          cached: okOnes.every((g) => g.cached), pageFull: okOnes.some((g) => g.pageFull)
        }, rules);
        results[i] = { ...result, search };
        return;
      }
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
        decision: "hold",
        decision_reason: "comp lookup failed — run it again",
        flags: { error: true, lookup_failed: true },
        current_price: plan.card.currentPence == null ? null : plan.card.currentPence / 100
      };
    }
  });
  return results;
}
