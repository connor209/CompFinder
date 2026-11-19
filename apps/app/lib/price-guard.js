/**
 * The guard between a computed price and a listing.
 *
 * Every rule before this one asks "which comps are this card?". This asks a
 * different question — "is there any evidence this card is worth much more
 * than we are about to ask?" — because the failure that costs real money is
 * one-sided: a £40 card listed at £2.49 sells in minutes and cannot be got
 * back, while a card listed too high just sits until somebody looks at it.
 *
 * That shipped: Riolu BW33 Cosmos Holo, a ~£50 card, went out at £2.49. The
 * file described the plain promo, the comps for the plain promo were honest,
 * and nothing anywhere compared the answer with anything else.
 *
 * So a price is checked against evidence that does NOT come from the comps it
 * was built from:
 *
 * - Cardmarket's own price for the matched catalogue product (the nightly
 *   price guide, cm_price_latest) — a second market, free, no request;
 * - the card's OTHER printings in the catalogue — Cosmos, a stamp, a Ditto —
 *   which is exactly how a variant goes out at the base card's price;
 * - the variant sales our own filter threw out of this search;
 * - non-UK sales, live asking prices and the engine's own figure.
 *
 * Three verdicts, and the asymmetry is deliberate:
 *   ok      list it.
 *   review  priced, listable, but a person (or Claude) reads the reason first.
 *   hold    the evidence says this is materially underpriced. No listable
 *           price: the CSV writes 0.00 (the app's zero-price rule), eBay
 *           refuses it, and somebody has to type a number.
 *
 * Only an INDEPENDENT reference can hold a card. Everything read off our own
 * search is "review", because a review that turns out fine costs a minute and
 * a hold that turns out fine costs a card that never got listed.
 *
 * Pure, no imports, loadable under bare node.
 */

export const GUARD_RULES = {
  // Cardmarket publishes euros. A setting, not a constant: the rate drifts,
  // and the API reports the one it used.
  eurToGbp: 0.85,
  // A reference only counts once it says the card is worth this much — below
  // it, the floor IS the right answer and a ratio is noise.
  minReferenceGbp: 5,
  // Our price under this share of the reference → hold; under the review
  // share → review. 0.4 of £45 is £18: a £2.49 Riolu holds, a £30 one is fine.
  holdBelowRatio: 0.4,
  reviewBelowRatio: 0.6,
  // A sibling printing, or a variant thrown out of our own search, worth this
  // many times ours means "make sure yours isn't that one".
  siblingRatio: 3,
  // Other evidence from our own search that reads as "dearer than this".
  worldwideRatio: 2.5,
  askingRatio: 3,
  engineRatio: 2,
  // Two to three comps: the house rule takes the lowest, so a lowest under
  // this share of the next one is a single cheap stray deciding the price.
  strayRatio: 0.5,
  thinComps: 4
};

export function resolveGuardRules(o = {}) {
  const out = { ...GUARD_RULES };
  for (const [k, v] of Object.entries(o || {})) {
    if (k in out && Number.isFinite(Number(v)) && Number(v) >= 0) out[k] = Number(v);
  }
  return out;
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const gbp = (p) => `£${Number(p).toFixed(2)}`;

/**
 * A Cardmarket price row → pounds, for the printing we are holding. A reverse
 * holo reads the premium column — but only where that premium is actually
 * listed (`p_low` > 0): an Ultra Rare's reverse figure is residue from
 * mislabelled listings, measured in catalog/cards/route.js.
 */
export function referenceGbp(priceRow, { reverse = false } = {}, rules = GUARD_RULES) {
  if (!priceRow) return null;
  const pick = (...vals) => {
    for (const v of vals) if (v != null && Number(v) > 0) return Number(v);
    return null;
  };
  const premiumListed = Number(priceRow.p_low) > 0;
  const eur = reverse && premiumListed
    ? pick(priceRow.p_trend, priceRow.p_avg7, priceRow.p_avg30)
    : pick(priceRow.trend, priceRow.avg7, priceRow.avg30, priceRow.avg);
  return eur == null ? null : Math.round(eur * rules.eurToGbp * 100) / 100;
}

/**
 * The verdict for one priced card.
 *
 * `result` is evaluateCard()'s output. `evidence`:
 *   reference  { gbp, product, asOf } — Cardmarket, for the matched product
 *   siblings   [{ name, gbp }]        — the card's other printings
 *   asking     { medianGbp, n }       — live UK listings, when they were asked
 */
export function guardVerdict(result, evidence = {}, rulesIn) {
  const rules = resolveGuardRules(rulesIn);
  const ours = result.suggested_price;
  const reasons = [];
  let verdict = "ok";
  const raise = (to, why) => {
    reasons.push({ level: to, why });
    if (to === "hold" || (to === "review" && verdict === "ok")) verdict = to;
  };

  if (ours == null) {
    raise("hold", result.flags?.price_held ? "No price: too few sales of this exact copy." : "No price: no sales matched this card.");
    return { verdict, reasons };
  }

  // --- the independent reference: the only evidence allowed to hold a card --
  const ref = evidence.reference;
  if (ref && ref.gbp != null && ref.gbp >= rules.minReferenceGbp) {
    if (ours < ref.gbp * rules.holdBelowRatio) {
      raise("hold", `Cardmarket prices ${ref.product || "this card"} at ~${gbp(ref.gbp)}; we'd list at ${gbp(ours)}.`);
    } else if (ours < ref.gbp * rules.reviewBelowRatio) {
      raise("review", `Cardmarket prices ${ref.product || "this card"} at ~${gbp(ref.gbp)}, well above our ${gbp(ours)}.`);
    }
  }

  // --- another printing of this card is worth far more ----------------------
  for (const s of evidence.siblings || []) {
    if (s.gbp != null && s.gbp >= rules.minReferenceGbp && s.gbp >= ours * rules.siblingRatio) {
      raise("review", `Cardmarket also lists ${s.name} at ~${gbp(s.gbp)}. Check yours isn't that printing.`);
    }
  }

  // --- what our own search threw out says the same thing --------------------
  const byReason = (r) => (result.excluded || []).filter((e) => e.reason === r);
  const variantSales = byReason("wrongVariant");
  if (variantSales.length) {
    const m = median(variantSales.map((e) => e.total));
    if (m != null && m >= rules.minReferenceGbp && m >= ours * rules.siblingRatio) {
      const names = [...new Set(variantSales.map((e) => e.detail).filter(Boolean))].join(", ");
      raise("review", `${variantSales.length} sale(s) of a variant (${names}) went for ~${gbp(m)}. Check yours isn't one.`);
    }
  }

  const n = result.n_comps || 0;
  if (n < rules.thinComps) {
    raise("review", `Only ${n} UK sale(s) to price from.`);
    const totals = (result.sales || []).map((s) => s.total).sort((a, b) => a - b);
    if (totals.length >= 2 && totals[0] < totals[1] * rules.strayRatio) {
      raise("review", `The price is the lowest sale (${gbp(totals[0])}), under half the next (${gbp(totals[1])}).`);
    }
    const ww = median(byReason("nonUkLocation").map((e) => e.total));
    if (ww != null && ww >= rules.minReferenceGbp && ww >= ours * rules.worldwideRatio) {
      raise("review", `Non-UK sales of this card run ~${gbp(ww)}.`);
    }
  }

  const asking = evidence.asking;
  if (asking && asking.medianGbp != null && asking.medianGbp >= rules.minReferenceGbp && asking.medianGbp >= ours * rules.askingRatio) {
    raise("review", `It's listed in the UK at a median ~${gbp(asking.medianGbp)} right now (${asking.n} listing(s)).`);
  }

  if (result.engine_price != null && result.engine_price >= ours * rules.engineRatio && result.engine_price >= rules.minReferenceGbp) {
    raise("review", `The comp engine's own figure is ${gbp(result.engine_price)}.`);
  }
  if (result.flags?.wide_spread) raise("review", "The sales span a wide price range.");
  if (result.flags?.variant_uncertain) raise("review", "Which printing this is wasn't certain.");

  return { verdict, reasons };
}

// ---------------------------------------------------------------------------
// Finding the card in the catalogue
// ---------------------------------------------------------------------------

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

// CardUploader writes "Black and White Promos"; Cardmarket "BW Black Star
// Promos". Era names fold to their code and the filler words go, so the two
// compare as sets of the words that actually identify the set.
const ERA = [
  [/\bblack and white\b/g, "bw"], [/\bsun and moon\b/g, "sm"], [/\bsword and shield\b/g, "swsh"],
  [/\bscarlet and violet\b/g, "sv"], [/\bx and y\b/g, "xy"], [/\bdiamond and pearl\b/g, "dp"],
  [/\bheartgold soulsilver\b/g, "hgss"], [/\bmega evolution\b/g, "me"]
];
const SET_FILLER = new Set(["pokemon", "promos", "promo", "black", "star", "set", "the", "and", "series", "collection", "cards", "tcg", "wizards"]);
function setWords(name) {
  let f = fold(name);
  for (const [re, code] of ERA) f = f.replace(re, code);
  return new Set(f.split(" ").filter((w) => w && !SET_FILLER.has(w)));
}

/**
 * Do two spellings name the same set? Strict on purpose — a wrong match can
 * hand a card another card's reference, and a reference can HOLD a card. One
 * side's identifying words must all appear in the other's, and a promo set
 * only ever matches a promo set (a promo's code — BW33 — is what pins it).
 */
export function setsAgree(ours, theirs, { promo = false } = {}) {
  if (!ours || !theirs) return false;
  const a = fold(ours), b = fold(theirs);
  if (a === b) return true;
  const isPromo = (x) => /\bpromo/.test(x);
  if (promo || isPromo(a) || isPromo(b)) {
    if (!(isPromo(a) && isPromo(b))) return false;
  }
  const wa = setWords(ours), wb = setWords(theirs);
  if (!wa.size || !wb.size) return false;
  const sub = (x, y) => [...x].every((w) => y.has(w));
  // Main sets need the SAME identifying words: a subset rule makes Base Set
  // Base Set 2 and Team Rocket Team Rocket Returns. Promo sets may differ by a
  // word ("BW Black Star Promos" / "Black and White Promos") because the
  // promo code on the card has already pinned which one it is.
  const bothPromo = isPromo(a) && isPromo(b);
  return bothPromo ? sub(wa, wb) || sub(wb, wa) : sub(wa, wb) && sub(wb, wa);
}

/** The collector-number spellings a catalogue row might carry for one card. */
export function numberForms(number) {
  const n = String(number || "").trim();
  if (!n) return [];
  const head = n.split("/")[0].trim();
  const out = new Set([n, head]);
  const m = head.match(/^([A-Za-z]*)0*(\d+)$/);
  if (m) {
    out.add(`${m[1]}${m[2]}`);
    out.add(`${m[1]}${m[2].padStart(2, "0")}`);
    out.add(`${m[1]}${m[2].padStart(3, "0")}`);
    out.add(`${m[1].toUpperCase()}${m[2]}`);
  }
  return [...out].filter(Boolean);
}

/**
 * Which catalogue rows are this card, and which are its other printings.
 *
 * Rows are already narrowed by collector number. The SET has to agree (a
 * number is shared across every set ever printed), and the NAME has to start
 * with ours; then the printing that matches our variant keys is the card and
 * the rest are siblings. `variantsOf(name)` is variants.js's detectVariants,
 * passed in so this file stays import-free.
 *
 * With no set to check against, nothing is matched: a reference for the wrong
 * card is worse than none, because it can HOLD a card.
 */
export function matchCatalog(plan, rows, variantsOf) {
  const set = fold(plan.card.set);
  const base = fold(plan.baseName);
  if (!set || !base) return { product: null, siblings: [] };
  const sameSet = (rows || []).filter((r) => setsAgree(plan.card.set, r.expansion, { promo: plan.promo }));
  const named = sameSet.filter((r) => fold(r.name).startsWith(base.split(" ")[0]));
  const want = [...(plan.variantKeys || [])].filter((k) => k !== "reverse" && k !== "stamped").sort().join(",");
  const keyOf = (r) => variantsOf(r.name).filter((k) => k !== "reverse" && k !== "stamped").sort().join(",");
  const product = named.find((r) => keyOf(r) === want && fold(r.name).startsWith(base)) || null;
  const siblings = named.filter((r) => r !== product && keyOf(r) !== want);
  return { product, siblings };
}
