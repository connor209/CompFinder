/**
 * Which market a sold comp belongs to.
 *
 * SoldComps reports itemLocation as null for a UK-domestic seller and as
 * "from <Country>" for a cross-border one (see soldcomps.js). Across the
 * 100-card audit only 32% of eBay UK sold listings were UK-domestic, so
 * treating "not UK" as a single bucket to be discarded threw away two thirds
 * of the evidence. It's a marketplace split, not noise.
 */

export const UK = "UK";

/** "from United States" -> "United States"; null -> "UK". */
export function marketOf(comp) {
  const raw = comp && (comp._displayLocation || comp.itemLocation);
  if (!raw) return UK;
  return String(raw).replace(/^from\s+/i, "").trim() || "Elsewhere";
}

/**
 * Markets present in this card's comps, commonest first, with UK pinned to the
 * front so the default never moves around under the visitor.
 */
export function marketsIn(comps) {
  const counts = new Map();
  for (const c of comps || []) {
    const m = marketOf(c);
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const uk = entries.find(([m]) => m === UK);
  return [
    ...(uk ? [{ market: UK, count: uk[1] }] : [{ market: UK, count: 0 }]),
    ...entries.filter(([m]) => m !== UK).map(([market, count]) => ({ market, count }))
  ];
}

/**
 * Splits comps into the chosen market and everything else.
 *
 * The engine excludes cross-border comps on sight, which is right when it is
 * pricing "the UK market" but wrong when we have deliberately selected another
 * one. So the location the engine reads is cleared on both sides, and the real
 * one preserved as _displayLocation for the rows — the split has already been
 * made by then, and re-applying it inside recommend would empty whichever side
 * isn't the UK.
 */
export function splitByMarket(comps, market) {
  const chosen = [];
  const rest = [];
  for (const c of comps || []) {
    const neutral = c.itemLocation ? { ...c, itemLocation: null, _displayLocation: c.itemLocation } : c;
    (marketOf(c) === market ? chosen : rest).push(neutral);
  }
  return { chosen, rest };
}

export default { UK, marketOf, marketsIn, splitByMarket };
