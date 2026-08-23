/**
 * Why a sale you can see on eBay isn't in the price.
 *
 * The workings screen is the trust screen, so these strings have to describe
 * what the pipeline ACTUALLY did. They are keyed on the engine's own reason
 * codes (`exclusionReason`, set in packages/core/pricing.js) rather than
 * re-derived from the titles, so a rule change can't leave the copy behind
 * describing a filter that no longer exists.
 *
 * A code with no entry here still shows — as its raw code — because a silent
 * drop would make the counted and excluded totals disagree with each other on
 * the one screen where the arithmetic is the product.
 */
export const EXCLUSION_LABELS = {
  nameMismatch: "Different card",
  variantMismatch: "Reverse holo, not the plain print",
  graded: "Graded slabs (PSA, ACE, CGC)",
  multiCardLot: "Sold as part of a bundle or lot",
  bundle: "Sold as part of a bundle or lot",
  pickYourOwn: "“Choose your card” pick-list",
  notACard: "Not a card — custom, proxy or sealed",
  proxy: "Proxy or custom-made",
  nonUkLocation: "Seller outside the UK",
  foreignPrint: "Japanese or other non-English print",
  setMismatch: "A different set",
  catalogMismatch: "Different product",
  catalogSignal: "Different product",
  promoVariant: "A promo printing, not this one",
  priceOutlier: "Price far above the rest",
  priceOutlierLow: "Price far below the rest",
  postageOutlier: "Postage out of line with the item",
  damaged: "Described as damaged or fake"
};

export function labelFor(reason) {
  return EXCLUSION_LABELS[reason] || reason;
}

/**
 * Excluded comps → one row per rule that actually fired, biggest first.
 *
 * Rules that share a label are merged, because "bundle" and "multiCardLot" are
 * one idea to a reader and two codes to the engine — listing them twice reads
 * like a bug rather than a distinction.
 */
export function groupExclusions(excluded = []) {
  const byLabel = new Map();
  for (const comp of excluded) {
    const label = labelFor(comp.exclusionReason || "other");
    byLabel.set(label, (byLabel.get(label) || 0) + 1);
  }
  return [...byLabel.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
}

export default { EXCLUSION_LABELS, labelFor, groupExclusions };
