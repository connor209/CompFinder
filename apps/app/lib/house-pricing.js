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
  // Total = sold price + postage, postage capped. A seller charging £6.99 to
  // post a £3 card is not evidence the card is worth £9.99. £4.00 since
  // 2026-11-24, matching CardCropper's pricing standard (it was £1.50, which
  // read every tracked-postage sale as a cheaper card than it sold as).
  postageCapPence: 400,
  // Percentile of totals the price is set at. 40 sits a little under the
  // middle on purpose: priced to sell, not to sit.
  percentile: 40,
  // Below this many comps a percentile is noise, so take the lowest.
  minCompsForPercentile: 4,
  // Round UP onto the .49 / .99 ladder, never below the floor.
  floorPence: 249,
  // The floor for each game: a Yu-Gi-Oh common sells under a Pokémon one.
  // `floorPence` above is Pokémon's and the fallback for a game not named.
  floorsPence: { pokemon: 249, yugioh: 199, mtg: 99 },
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
    floorsPence: Object.fromEntries(Object.entries(HOUSE_RULES.floorsPence).map(([g, d]) =>
      [g, Math.round(num(o.floorsPence?.[g], d, { min: 0 }))])),
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

/** pokemon | yugioh | mtg from whatever a file or a caller wrote, or "" when it says nothing. */
export function gameCode(g) {
  const t = String(g || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return "";
  if (/pok/.test(t)) return "pokemon";
  if (/yugi|ygo/.test(t)) return "yugioh";
  if (/magic|mtg/.test(t)) return "mtg";
  return "";
}

/** The rules with the floor of the card's game in force. */
export function rulesForGame(rules = HOUSE_RULES, game) {
  const code = gameCode(game);
  const floor = code && rules.floorsPence ? rules.floorsPence[code] : null;
  return floor == null ? rules : { ...rules, floorPence: floor };
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

// ---------------------------------------------------------------------------
// The decision — CardCropper's ladder (cardcropper/pricing.py `decide`)
// ---------------------------------------------------------------------------

/**
 * Thresholds for the decision. A rise or a drop is "big" past these ratios AND
 * by at least `bigMovePence`, so a £2.49 card going to £4.99 is not a
 * headline. Wide spread is p90/p10 of the totals over 4+ sales.
 */
export const DECISION_RULES = Object.freeze({
  bigRise: 2.0,
  bigDrop: 0.5,
  bigMovePence: 200,
  wideSpread: 3.0,
  lowRiskPence: 100,
  inHandPence: 1500
});

/** p90/p10 of the totals over a wide spread, the same reading CardCropper makes. */
export function spreadTooWide(totals, ratio = DECISION_RULES.wideSpread) {
  const s = (totals || []).filter((v) => Number.isFinite(v));
  if (s.length < 4 || Math.min(...s) <= 0) return false;
  return percentileOf(s, 90) / Math.max(percentileOf(s, 10), 1) > ratio;
}

/**
 * What to do with a price, not just what it is:
 *
 *   apply     use the suggestion
 *   terapeak  a person checks before it is used — ALWAYS for a rise on fewer
 *             than minCompsForPercentile sales, and for a big rise or drop or
 *             a wide spread; also when nothing priced the card and it has no
 *             price to keep
 *   keep      no fresh sales, and the card already has a price: it stays
 *   hold      the lookup failed — run it again, decide nothing
 *
 * Flags ride along whatever the decision: few_sales, wide_spread, big_rise,
 * big_drop, in_hand_check (NM at £15+: look at the card before it goes up at
 * that), put_back (a sale counted that the engine had left out).
 */
export function decide({ status = "ok", nSales = 0, totals = [], suggestedPence = null, currentPence = null, condition = "NM", putBack = 0, unrecognised = [], numberless = false }, rules = HOUSE_RULES, d = DECISION_RULES) {
  if (status === "error" || status === "timeout") return { decision: "hold", reason: `comp lookup ${status === "timeout" ? "timed out" : "failed"}`, flags: ["lookup_failed"] };
  const flags = [];
  const cur = Number.isFinite(currentPence) && currentPence > 0 ? currentPence : null;
  if (nSales < rules.minCompsForPercentile) flags.push("few_sales");
  if (spreadTooWide(totals, d.wideSpread)) flags.push("wide_spread");
  if (suggestedPence != null && cur) {
    if (suggestedPence > cur * d.bigRise && suggestedPence - cur >= d.bigMovePence) flags.push("big_rise");
    if (suggestedPence < cur * d.bigDrop && cur - suggestedPence >= d.bigMovePence) flags.push("big_drop");
  }
  if (conditionCode(condition) === "NM" && suggestedPence != null && suggestedPence >= d.inHandPence) flags.push("in_hand_check");
  if (putBack > 0) flags.push("put_back");

  if (suggestedPence == null) {
    return cur
      ? { decision: "keep", reason: "no fresh sales — the current price stays; check Terapeak", flags }
      : { decision: "terapeak", reason: "no sales of this printing", flags };
  }
  // Two things the sales cannot settle, whatever they say: a printing the app
  // does not recognise (it may be pooling two products), and a card with no
  // collector number (name and set are all that tie a sale to it).
  if (unrecognised && unrecognised.length) {
    flags.push("printing_unrecognised");
    return { decision: "terapeak", reason: `printing not recognised: ${unrecognised.join(", ")}`, flags };
  }
  if (numberless) {
    flags.push("no_number");
    return { decision: "terapeak", reason: "no collector number — check the sales before listing", flags };
  }
  const rise = cur != null && suggestedPence > cur;
  const loud = flags.filter((f) => f === "big_rise" || f === "big_drop" || f === "wide_spread");
  if (nSales < rules.minCompsForPercentile && rise) return { decision: "terapeak", reason: `a rise on ${nSales} sale${nSales === 1 ? "" : "s"}`, flags };
  if (loud.length) return { decision: "terapeak", reason: loud.join(", ").replace(/_/g, " "), flags };
  if (nSales < rules.minCompsForPercentile) return { decision: "apply", reason: `${nSales} sale${nSales === 1 ? "" : "s"}, not a rise`, flags };
  const low = (cur != null && Math.abs(suggestedPence - cur) <= d.lowRiskPence) || suggestedPence === rules.floorPence;
  return { decision: "apply", reason: low ? "low risk" : `${nSales >= 10 ? "10+" : "4-9"} sales`, flags };
}
