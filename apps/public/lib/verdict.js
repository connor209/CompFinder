import CompFinderPricing from "@compfinder/core/pricing.js";

/**
 * "They're asking £40 — is that fair?"
 *
 * The tool answers "what is this worth"; standing at a table you are holding a
 * card with a price tag on it, and the question is whether to buy. That's a
 * different question and it needs three things the median alone can't give:
 *
 *   1. Position in the SOLD RANGE, not distance from the median. "12% below
 *      market" is meaningless when comps run £5 to £500 — what matters is how
 *      many real sales went for less than they're asking.
 *   2. Whether it actually SELLS. A bargain you can't shift isn't a bargain,
 *      so the liquidity read belongs in the same answer.
 *   3. What you'd NET reselling it. eBay takes its cut off the total including
 *      postage, and a £5 margin is not a £5 margin.
 */

// eBay UK final value fee for trading cards, plus the fixed per-order charge.
// Kept explicit and adjustable: it is the difference between a deal and a
// waste of an afternoon on cheap cards, and eBay changes it.
export const FEE_RATE = 0.1325;
export const FEE_FIXED_PENCE = 30;
export const DEFAULT_POSTAGE_PENCE = 135;

export function assessAsk({ askPence, comps = [], marketPence, liquidity = null, postagePence = DEFAULT_POSTAGE_PENCE }) {
  if (!askPence || askPence <= 0 || marketPence == null) return null;

  const sold = comps
    .map((c) => c.totalPence)
    .filter((p) => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);

  // Share of real sales that went for less than they're asking. This is the
  // honest version of "cheap" — it's a fact about completed sales rather than
  // an opinion about a central tendency.
  const below = sold.filter((p) => p < askPence).length;
  const percentile = sold.length ? below / sold.length : null;
  const vsMarket = askPence / marketPence - 1;

  const netIfResold = Math.round(
    (marketPence + postagePence) * (1 - FEE_RATE) - FEE_FIXED_PENCE - postagePence
  );
  const marginPence = netIfResold - askPence;

  let call, tone;
  if (vsMarket <= -0.2) { call = "Well under market"; tone = "good"; }
  else if (vsMarket <= -0.05) { call = "Below market"; tone = "good"; }
  else if (vsMarket < 0.1) { call = "About right"; tone = "fair"; }
  else if (vsMarket < 0.3) { call = "Above market"; tone = "warn"; }
  else { call = "Well above market"; tone = "bad"; }

  // A keen price on something that doesn't sell is still money parked, so the
  // headline gets qualified rather than the number quietly overriding it.
  const illiquid = liquidity && (liquidity.band === "illiquid" || liquidity.band === "unknown");
  if (tone === "good" && illiquid) tone = "fair";

  const notes = [];
  if (percentile != null) {
    // `below` counts sales CHEAPER than the asking price, so zero of them means
    // every recorded sale was dearer — good for the buyer. Stating it the other
    // way round, as the first draft did, reverses the advice at exactly the two
    // prices where it matters most.
    notes.push(
      below === 0
        ? `All ${sold.length} recent sales went for more than this.`
        : below === sold.length
          ? `All ${sold.length} recent sales went for less than this.`
          : `${below} of ${sold.length} recent sales went for less than this.`
    );
  }
  if (liquidity) notes.push(liquidity.reasons[0]);
  notes.push(
    marginPence > 0
      ? `Resold at ${CompFinderPricing.toPoundsStr(marketPence)} you'd net about ${CompFinderPricing.toPoundsStr(netIfResold)} after eBay fees and postage — roughly ${CompFinderPricing.toPoundsStr(marginPence)} up.`
      : `Resold at ${CompFinderPricing.toPoundsStr(marketPence)} you'd net about ${CompFinderPricing.toPoundsStr(netIfResold)} after fees and postage, which is ${CompFinderPricing.toPoundsStr(Math.abs(marginPence))} short of what they're asking.`
  );

  return { call, tone, vsMarket, percentile, below, of: sold.length, netIfResold, marginPence, notes };
}

export default { assessAsk, FEE_RATE, FEE_FIXED_PENCE, DEFAULT_POSTAGE_PENCE };
