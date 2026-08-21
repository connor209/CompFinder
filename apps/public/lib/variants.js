/**
 * Printing variants.
 *
 * The same card number can exist as several physically different objects that
 * trade at very different prices — a Reverse Holo Primarina is not the regular
 * Primarina, and on the movers list those two were 3.6x apart. The engine
 * already knows this: pricing.js excludes a reverse-holo comp from a plain
 * search, because pooling them was a real regression it was written to stop.
 *
 * What was missing is any way to ASK for one. The engine's rule keys off the
 * search tokens containing "reverse", so a variant has to reach two places to
 * work: the eBay query (or SoldComps returns the wrong listings in the first
 * place) and the comp-matching tokens (or the engine filters them back out).
 */

export const VARIANTS = [
  {
    key: "any",
    label: "Any",
    terms: [],
    // The engine drops reverse holo unless asked, so "Any" is really "the
    // standard printing" — named honestly rather than implying it spans them.
    hint: "Standard printing"
  },
  { key: "reverse", label: "Reverse Holo", terms: ["reverse holo"], hint: "Foil pattern across the card body" },
  { key: "cosmos", label: "Cosmos Holo", terms: ["cosmos holo"], hint: "Starry foil, mostly promos" },
  { key: "cracked", label: "Cracked Ice", terms: ["cracked ice"], hint: "Shattered-glass foil" },
  { key: "pokeball", label: "Poké Ball", terms: ["poke ball"], hint: "Ball-pattern foil" },
  { key: "masterball", label: "Master Ball", terms: ["master ball"], hint: "Master Ball pattern foil" },
  { key: "firsted", label: "1st Edition", terms: ["1st edition"], hint: "Vintage first print run" },
  { key: "shadowless", label: "Shadowless", terms: ["shadowless"], hint: "Early Base Set print" }
];

const BY_KEY = Object.fromEntries(VARIANTS.map((v) => [v.key, v]));

export function variantByKey(key) {
  return BY_KEY[key] || BY_KEY.any;
}

/** Extra words for the eBay search, so the right listings come back at all. */
export function variantQueryTerms(key) {
  return variantByKey(key).terms;
}

/**
 * Extra required tokens for comp matching.
 *
 * Multi-word terms are split, because nameTokensMatch tests each token with a
 * word-boundary regex — "reverse holo" as one token would only match that
 * exact spacing, while ["reverse","holo"] also catches "Reverse-Holo" and
 * "reverse foil holo", which is how sellers actually write it.
 */
export function variantTokens(key) {
  return variantByKey(key).terms.flatMap((t) => t.split(/\s+/));
}

/**
 * Which variants are actually worth offering for this card's comps. A card
 * with no reverse-holo listings shouldn't present the option — an empty result
 * behind a tempting button is worse than no button.
 */
export function variantsPresent(comps) {
  const counts = {};
  for (const v of VARIANTS) {
    if (v.key === "any") continue;
    const re = new RegExp(v.terms[0].split(/\s+/).join("[\\s-]*"), "i");
    const n = (comps || []).filter((c) => re.test(c.title || "")).length;
    if (n > 0) counts[v.key] = n;
  }
  return counts;
}

export default { VARIANTS, variantByKey, variantQueryTerms, variantTokens, variantsPresent };
