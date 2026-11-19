/**
 * The house pricing rules — how WE turn a clean set of UK sold comps into the
 * price a card goes up at.
 *
 * Deliberately not the engine's own figure. `recommend()` in packages/core
 * produces a recency-weighted mean on a 50p ladder, which is what Last Comp
 * quotes a stranger and what the Batch screen shows. This is a different
 * question — a listing price for stock we hold, set to sell — and it is a
 * policy, so every number in it is a setting and the API hands back the
 * settings it ran with.
 *
 * The engine still does the hard part: deciding which comps are the card. The
 * rules here only ever see comps the engine (and variants.js) kept.
 *
 * Pure, no imports, so scripts/check-batchcomps.mjs runs it under bare node.
 */

export const HOUSE_RULES = {
  // Total = sold price + postage, postage capped. A seller charging £4.99 to
  // post a £3 card is not evidence the card is worth £7.99.
  postageCapPence: 150,
  // Percentile of totals the price is set at. 40 sits a little under the
  // middle on purpose: priced to sell, not to sit.
  percentile: 40,
  // Below this many comps a percentile is noise, so take the lowest.
  minCompsForPercentile: 4,
  // Round UP onto the .49 / .99 ladder, never below the floor.
  floorPence: 249,
  ladderStepPence: 50,
  // NM is priced as LP. MP only takes its cut once the LP price is worth it.
  conditionMultipliers: { NM: 1, LP: 1, MP: 0.85, HP: 0.6, DMG: 0.4 },
  mpMinLpPence: 500
};

/** Merge caller overrides onto the defaults, rejecting nonsense rather than using it. */
export function resolveRules(overrides = {}) {
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const num = (v, d, { min = -Infinity, max = Infinity } = {}) => {
    const n = Number(v);
    return v == null || v === "" || !Number.isFinite(n) || n < min || n > max ? d : n;
  };
  const cm = { ...HOUSE_RULES.conditionMultipliers };
  for (const [k, v] of Object.entries(o.conditionMultipliers || {})) {
    const key = String(k).toUpperCase();
    if (key in cm) cm[key] = num(v, cm[key], { min: 0, max: 5 });
  }
  return {
    postageCapPence: num(o.postageCapPence, HOUSE_RULES.postageCapPence, { min: 0 }),
    percentile: num(o.percentile, HOUSE_RULES.percentile, { min: 0, max: 100 }),
    minCompsForPercentile: Math.round(num(o.minCompsForPercentile, HOUSE_RULES.minCompsForPercentile, { min: 1 })),
    floorPence: Math.round(num(o.floorPence, HOUSE_RULES.floorPence, { min: 0 })),
    ladderStepPence: Math.round(num(o.ladderStepPence, HOUSE_RULES.ladderStepPence, { min: 1 })),
    conditionMultipliers: cm,
    mpMinLpPence: Math.round(num(o.mpMinLpPence, HOUSE_RULES.mpMinLpPence, { min: 0 }))
  };
}

/** A comp's total under the house rules. */
export function houseTotal(comp, rules = HOUSE_RULES) {
  const item = Number(comp.itemPricePence) || 0;
  const post = Math.max(0, Number(comp.postagePence) || 0);
  return item + Math.min(post, rules.postageCapPence);
}

/** Linear-interpolated percentile (the spreadsheet PERCENTILE.INC). */
export function percentileOf(values, p) {
  const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  if (s.length === 1) return s[0];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

/**
 * Up onto the ladder: floor, floor+step, … — with the defaults £2.49, £2.99,
 * £3.49. Strictly up: £12.50 becomes £12.99, £12.49 stays.
 */
export function roundUpToLadder(pence, rules = HOUSE_RULES) {
  if (pence == null || !Number.isFinite(pence)) return null;
  const p = Math.ceil(pence - 1e-9);
  if (p <= rules.floorPence) return rules.floorPence;
  return rules.floorPence + Math.ceil((p - rules.floorPence) / rules.ladderStepPence) * rules.ladderStepPence;
}

/** Condition code, tolerant of the labels CardUploader and people write. */
export function conditionCode(c) {
  const t = String(c || "").trim().toLowerCase();
  if (!t) return "NM";
  if (/^nm\b|near\s*mint|^m$|^mint$/.test(t)) return "NM";
  if (/^lp\b|lightly|^ex\b|excellent/.test(t)) return "LP";
  if (/^mp\b|moderately|^gd\b|good/.test(t)) return "MP";
  if (/^hp\b|heavily/.test(t)) return "HP";
  if (/^dmg\b|damaged|^po\b|poor/.test(t)) return "DMG";
  return "NM";
}

/**
 * The house price for a set of comps the engine already judged to be the card.
 *
 * Returns the working as well as the answer — every figure on the way — so a
 * caller auditing a price can redo it by hand.
 */
export function housePrice(comps, condition = "NM", rules = HOUSE_RULES) {
  const totals = (comps || []).map((c) => houseTotal(c, rules)).sort((a, b) => a - b);
  const cond = conditionCode(condition);
  if (!totals.length) {
    return { method: "none", totals, basisPence: null, lpPence: null, multiplier: null, condition: cond, suggestedPence: null };
  }
  const usePercentile = totals.length >= rules.minCompsForPercentile;
  const basis = usePercentile ? percentileOf(totals, rules.percentile) : totals[0];
  const lpPence = roundUpToLadder(basis, rules);

  let multiplier = rules.conditionMultipliers[cond] ?? 1;
  // MP's cut only once the LP price is worth cutting; below it MP sells as LP.
  if (cond === "MP" && lpPence < rules.mpMinLpPence) multiplier = 1;
  // Applied to the LP PRICE, the figure the rule is written against, then put
  // back on the ladder — so MP off an LP £12.49 is £10.62, listed at £10.99.
  const suggestedPence = multiplier === 1 ? lpPence : roundUpToLadder(lpPence * multiplier, rules);

  return {
    method: usePercentile ? `p${rules.percentile}` : "lowest",
    totals,
    basisPence: Math.round(basis),
    lpPence,
    multiplier,
    condition: cond,
    suggestedPence
  };
}
