import CompFinderPricing from "@compfinder/core/pricing.js";

const gbp = (p) => CompFinderPricing.toPoundsStr(p);

/**
 * Everything the page must say out loud before the visitor trusts the number.
 *
 * The engine already works most of this out and writes it into `rec.note` —
 * an unresolved catalogue split, a bimodal price spread, comps dropped for
 * being outside the UK. The first cut of the redesign rendered none of it,
 * which is how a Charizard ex ended up showing a LOW confidence pill above a
 * sentence saying the comps "agree closely". They did not: eBay's own catalogue
 * data said the 19 sales were two different products.
 *
 * So the engine's warnings are lifted straight out of its note rather than
 * re-derived here — it knows things this layer can't see — and the page adds
 * only the caveats that come from how the PAGE searched, not how the engine
 * priced.
 */

/** The engine writes its warnings into one prose string, each led by "⚠". */
export function engineWarnings(rec) {
  const note = (rec && rec.note) || "";
  return note
    .split("⚠")
    .slice(1)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * @returns {Array<{ tone: "warn"|"info", text: string }>}
 */
export function caveatsFor({ rec, derived, card }) {
  const out = [];
  const used = (rec && rec.included) || [];

  for (const w of engineWarnings(rec)) out.push({ tone: "warn", text: w });

  // How the page searched, which the engine can't know about.
  if (derived.viaName) {
    out.push({
      tone: "warn",
      text: `No sale matched collector number ${card.number}, so this is priced on the card name alone — check you have the right number.`
    });
  }

  if (used.length === 1) {
    out.push({
      tone: "warn",
      text: "One sale is not a market. Treat this as a rough indication rather than a price."
    });
  }

  if (derived.lo != null && derived.hi != null && derived.lo > 0 && derived.hi / derived.lo >= 4 && used.length > 1) {
    out.push({
      tone: "warn",
      text: `The sales counted run ${gbp(derived.lo)} to ${gbp(derived.hi)} — wide enough that the middle is a guide, not a going rate.`
    });
  }

  if (derived.marketUsed === 0 && used.length > 0) {
    out.push({
      tone: "info",
      text: "No UK-seller sales in the window, so this is priced from the wider market."
    });
  } else if (derived.marketUsed > 0 && derived.marketUsed < 3 && used.length > derived.marketUsed) {
    out.push({
      tone: "info",
      text: `Only ${derived.marketUsed} of these ${used.length} sales came from UK sellers.`
    });
  }

  if (derived.gradedTiers > 0 && used.length === 0) {
    out.push({
      tone: "info",
      text: "Every sale found was a graded slab. Those are a different market from a raw card."
    });
  }

  return out;
}

export default { caveatsFor, engineWarnings };
