/**
 * How an Add copies row is priced, and what an answer does to the row — one
 * definition for the two places that price: the tab (no batches yet) and the
 * pricing queue's worker (lib/pricing-worker.js). Two copies of either would
 * disagree about which fields go to /api/batch-comps' logic, and the
 * disagreement would read as the queue pricing a different card.
 *
 * Pure and framework-free, so scripts/check-pricequeue.mjs loads it.
 */
import { priceFromComps } from "./lab-copies.js";
import { evidenceFrom } from "./lab-evidence.js";

/** The card a row is priced as: the fields-form body /api/batch-comps reads. */
export function labCardFor(r) {
  return {
    sku: r.copies?.[0]?.sku || "", name: r.cardName, number: r.cardNumber, set: r.set, title: r.title, condition: r.condition,
    language: r.language || "English", any_language: Boolean(r.anyLanguage), overseas: Boolean(r.overseas), game: r.card?.game || "", variant: r.card?.finish || "",
    set_code: r.card?.setCode || "", year: r.card?.year || ""
  };
}

/** What a row keeps from one card's answer (`x`, a /api/batch-comps result). */
export function compsFromResult(x, r, extra = {}) {
  return {
    pence: priceFromComps(x), confidence: x?.confidence || null, n: x?.n_comps ?? null,
    flags: x?.flags ? Object.keys(x.flags).filter((k) => x.flags[k]) : [],
    decision: x?.decision || (x?.error ? "hold" : null), reason: x?.decision_reason || x?.error || "",
    searches: Array.isArray(x?.search) ? x.search.length : null,
    fetched: Array.isArray(x?.search) ? x.search.reduce((t, s) => t + (s.added || 0), 0) : null,
    // Every sale fetched, counted or not and why — the Sales found table.
    evidence: evidenceFrom(x), setCode: x?.set_code || null,
    search: Array.isArray(x?.search) ? x.search.map((s) => ({ rung: s.rung, query: s.query, fetched: s.fetched ?? null, added: s.added ?? null, error: s.error || null })) : [],
    condition: r?.condition, game: r?.card?.game || "",
    ...(x?.error ? { error: x.error } : {}),
    // When this answer was worked out: a later answer replaces an earlier one,
    // never the other way round (applyJobs in pricing-queue.js).
    pricedAt: new Date().toISOString(),
    ...extra
  };
}

/**
 * Put answers on rows. A price already typed is never overwritten; new sales
 * drop any old picks. `byId` is Map|object rowId → comps.
 */
export function applyComps(rows, byId) {
  const get = (id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);
  return (rows || []).map((r) => {
    const c = get(r.id);
    if (!c) return r;
    return { ...r, comps: c, picks: null, pricePence: r.pricePence != null ? r.pricePence : c.pence };
  });
}
