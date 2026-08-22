import CompFinderPricing from "@compfinder/core/pricing.js";
import SoldCompsApi from "@compfinder/core/soldcomps.js";

/**
 * A separate price for Near Mint and for played copies — offered only where
 * the comps can actually support one.
 *
 * Measured across 11,534 sold titles from 294 cards. Two facts decide the
 * shape of this:
 *
 *   1. Condition is mostly unstated. 64% of titles say nothing at all, 31%
 *      say Near Mint, and only 4.4% name a played grade (LP 2.4%, MP 1.0%,
 *      HP 0.6%, DMG 0.4%). Just 47 of the 294 cards carry three or more comps
 *      in BOTH bands.
 *
 *   2. Where both bands exist, the gap depends almost entirely on age. On
 *      vintage the separation is large and real — Gyarados 123/123 HeartGold
 *      & SoulSilver 9.0x (£139 NM against £15 played), Celebi ex Unseen
 *      Forces 5.5x, Latios ex EX Dragon 5.4x, Mewtwo ex Ruby & Sapphire 4.2x,
 *      Shining Mewtwo Neo Destiny 3.4x. On modern cards it collapses to
 *      nothing and sometimes inverts: Metagross Temporal Forces 0.98x, Rapid
 *      Strike Urshifu VMAX 0.96x, Air Balloon 0.77x, Gholdengo ex 0.53x.
 *
 * So a full NM/LP/MP/HP ladder would be inventing precision the data does not
 * have, and a blanket "condition adjustment" would be actively wrong on the
 * modern cards that make up most searches. Two bands, shown only when both
 * are populated and actually separate, is what the evidence supports. An
 * inverted or flat ratio means the split is noise, and nothing is shown.
 *
 * That the vintage cards are exactly the ones left with wide price spans
 * after the exclusion work is not a coincidence — on those, the spread IS
 * the condition, and this is the honest way to report it.
 */

const PLAYED = new Set(["LP", "MP", "HP", "DMG"]);

/** Least separation worth showing as two numbers rather than one. */
export const MIN_RATIO = 1.5;
/** Fewest comps in a band before its figure means anything. */
export const MIN_PER_BAND = 3;

export function conditionOf(comp) {
  return SoldCompsApi.inferCondition(comp.title || "");
}

/**
 * `comps` should be the pool the headline price was built from, so both bands
 * inherit every exclusion already applied. Returns null when the split cannot
 * be made honestly.
 */
export function conditionBands(comps, settings, tokens, number, set) {
  const nm = [];
  const played = [];
  for (const c of comps || []) {
    const k = conditionOf(c);
    if (k === "NM") nm.push(c);
    else if (PLAYED.has(k)) played.push(c);
  }
  if (nm.length < MIN_PER_BAND || played.length < MIN_PER_BAND) return null;

  const price = (pool) => {
    const rec = CompFinderPricing.recommend(pool, settings, tokens, "sold", number, set);
    return rec.rawPence ?? null;
  };
  const nmPence = price(nm);
  const playedPence = price(played);
  if (!nmPence || !playedPence) return null;

  const ratio = nmPence / playedPence;
  // Below the threshold the two numbers say the same thing; inverted, the
  // split is measuring sample noise rather than condition.
  if (ratio < MIN_RATIO) return null;

  return {
    nmPence,
    playedPence,
    nmCount: nm.length,
    playedCount: played.length,
    ratio
  };
}

export default { conditionBands, conditionOf, MIN_RATIO, MIN_PER_BAND };
