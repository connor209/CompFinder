/**
 * One way to price a card (decided 2026-11-24): a CardUploader card on the
 * Batch screen is priced by /api/batch-comps — the full search ladder and the
 * house rules, exactly what Add copies sends — rather than by the engine's
 * figure. Two screens pricing the same card two ways is a price that depends
 * on which screen you used, and the disagreement is invisible.
 *
 * Pure. This file only converts: a Batch row into the route's card, and the
 * route's answer back into the `rec` every Batch consumer already reads
 * (saved runs, overrides, stickers, the zero-price guard, the eBay export) —
 * so none of them had to change.
 *
 * The engine path stays for what the house route cannot price: pasted titles
 * and the show pool, which carry no card fields.
 */

/** About how many searches one card costs on the full ladder (exact … nolanguage, plus page 2). */
export const HOUSE_SEARCHES_PER_CARD = 8;

/** Cards per /api/batch-comps request: small, so rows fill in as the run goes. */
export const HOUSE_PER_REQUEST = 3;

/** Whether a Batch row can be priced the house way: it has to carry the card's fields. */
export function canPriceHouse(item) {
  return Boolean(item && item.source === "csv" && item.csvItem && item.csvItem.cardName);
}

/**
 * The /api/batch-comps card for a Batch row. The TITLE is the row's own (a
 * corrected title is the one priced), and the name, number and set are the
 * csvItem's, which CardFields edits. `overseas` is the Batch screen's
 * Worldwide seller location.
 */
export function houseCardFor(item, { overseas = false } = {}) {
  const c = item.csvItem || {};
  return {
    sku: item.sku || c.sku || "",
    name: c.cardName || "",
    number: c.cardNumber || "",
    set: c.set || "",
    title: item.title || c.title || "",
    condition: c.condition && c.condition !== "Unknown" ? c.condition : c.conditionLabel || "",
    language: c.language || "English",
    game: c.game || "",
    variant: c.finish || "",
    set_code: c.setCode || "",
    year: c.year || "",
    overseas: Boolean(overseas)
  };
}

const pence = (pounds) => (pounds == null || pounds === "" || !Number.isFinite(Number(pounds)) ? null : Math.round(Number(pounds) * 100));

function compOf(s, reason) {
  const itemPricePence = pence(s.price) ?? 0;
  const postagePence = pence(s.postage) ?? 0;
  const out = {
    title: s.title || "",
    itemPricePence,
    postagePence,
    totalPence: itemPricePence + postagePence,
    itemLocation: null,
    _source: { url: s.url || null, endedAt: s.date || null, itemId: s.item_id || null }
  };
  if (reason) out.exclusionReason = reason;
  if (s.put_back) out.putBack = s.put_back_reason || true;
  return out;
}

/**
 * The confidence a Batch row shows, from the house decision. A Terapeak
 * check is LOW — which is also what holds it back from a show sticker, the
 * right outcome for a price somebody is meant to check first. No price is
 * "None". Otherwise the engine's own read of the comps stands.
 */
export function houseConfidence(x) {
  if (!x || x.suggested_pence == null) return "None";
  if (x.decision === "terapeak" || x.decision === "hold") return "Low";
  return x.confidence || "Low";
}

/** A /api/batch-comps result as the Batch screen's `rec`. Null for a failed lookup. */
export function recFromHouse(x) {
  if (!x || x.error) return null;
  const method = x.pricing?.method || "none";
  const n = x.n_comps ?? (x.sales || []).length;
  const how = method === "none"
    ? "House rules: no sales to price from."
    : `House rules: ${method === "lowest" ? "the lowest" : "p40"} of ${n} UK sale(s), totals with postage capped${x.pricing?.condition ? `, ${x.pricing.condition}` : ""}.`;
  const decision = x.decision ? `Decision: ${x.decision}${x.decision_reason ? ` — ${x.decision_reason}` : ""}.` : "";
  const engine = x.engine_price != null ? `(The engine alone said £${Number(x.engine_price).toFixed(2)}.)` : "";
  return {
    rawPence: pence(x.pricing?.basis),
    finalPence: x.suggested_pence ?? null,
    confidence: houseConfidence(x),
    dataSource: "sold",
    note: [how, decision, ...(x.notes || []), engine].filter(Boolean).join(" "),
    included: (x.sales || []).map((s) => compOf(s, null)),
    excluded: (x.excluded || []).map((s) => compOf(s, s.reason || "excluded")),
    graded: [],
    house: {
      decision: x.decision || null,
      reason: x.decision_reason || "",
      method,
      n,
      enginePence: pence(x.engine_price),
      query: x.query || null,
      searches: Array.isArray(x.search) ? x.search.length : (x.queries_sent || []).length,
      flags: x.flags ? Object.keys(x.flags).filter((k) => x.flags[k]) : []
    }
  };
}
