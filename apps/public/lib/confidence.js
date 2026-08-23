import CompFinderPricing from "@compfinder/core/pricing.js";

/**
 * How much to trust the number, said in a sentence rather than a badge.
 *
 * The engine already grades a price High/Medium/Low from how many comps
 * survived. What it doesn't do is explain itself, and on this page the
 * explanation is the point: the same "Medium" means something different when
 * it comes from six tight sales than from six that ran ten to one.
 *
 * So the prose is generated from the sample rather than written: how many
 * sales, what range they covered, and — when one comp is dragging an end of
 * that range around — which one and why. A static string here would be a
 * confident-sounding sentence that stops being true on the next card.
 */
const LEVELS = { High: "high", Medium: "medium", Low: "low" };
const SEGMENTS = { High: 3, Medium: 2, Low: 1 };

const gbp = (p) => CompFinderPricing.toPoundsStr(p);

/** Words a seller uses about a card that explain a price at the bottom. */
const DAMAGE = /\b(damag|crease|bent|creased|water|torn|tear|played|poor|scratch|whiten)/i;

export function assessConfidence({ rec, comps = [], windowDays = 90, market = "UK" }) {
  const tier = (rec && rec.confidence) || "Low";
  const level = LEVELS[tier] || "low";
  const filled = SEGMENTS[tier] || 1;

  const used = (rec && rec.included) || [];
  const prices = used
    .map((c) => c.totalPence ?? c.itemPricePence)
    .filter((p) => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);

  if (!prices.length) {
    return { tier, level, filled, prose: `No ${market} sales in the last ${windowDays} days matched this card.` };
  }

  const lo = prices[0];
  const hi = prices[prices.length - 1];
  const n = prices.length;
  const spread = lo > 0 ? hi / lo : 1;

  const sentences = [];
  sentences.push(
    n < 6
      ? `${n === 1 ? "One" : n} ${market} sale${n === 1 ? "" : "s"} in ${windowDays} days is thin.`
      : n < 12
        ? `${n} ${market} sales in ${windowDays} days is a modest sample.`
        : `${n} ${market} sales in ${windowDays} days.`
  );

  if (n > 1) sentences.push(`Prices ran ${gbp(lo)}–${gbp(hi)}`);

  // Name the comp pulling an end of the range around, when there is one. This
  // is the sentence that turns a range into an explanation.
  const cheapest = used.find((c) => (c.totalPence ?? c.itemPricePence) === lo);
  const outlier = cheapest && DAMAGE.test(cheapest.title || "") ? "the bottom one was damaged" : null;
  if (outlier && n > 1) sentences[sentences.length - 1] += ` and ${outlier}`;
  if (n > 1) sentences[sentences.length - 1] += ".";

  // Only claim agreement when the ENGINE agrees. It caps confidence at Low
  // when eBay's own catalogue data says the comps are more than one product,
  // and a page that answers that with "they agree closely, so £84.84 is a fair
  // read" is contradicting itself in the same panel — which is exactly what
  // the first cut of this did on a Charizard ex.
  const price = rec && rec.rawPence;
  if (price != null) {
    sentences.push(
      tier === "High" && spread < 3
        ? `They agree closely, so ${gbp(price)} is a fair read.`
        : `Treat ${gbp(price)} as a ballpark, not a fixed price.`
    );
  }

  return { tier, level, filled, prose: sentences.join(" ") };
}

export default { assessConfidence };
