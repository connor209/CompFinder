/**
 * URLs for set pages: /set/<name>
 *
 * A slug is a permanent commitment. Changing one later doesn't just move a
 * page, it throws away whatever ranking that page earned and leaves whoever
 * linked to it on a 404 — so the rules here are deliberately dull and the
 * manifest build fails loudly on a collision rather than letting two cards
 * quietly share a URL.
 *
 * Card URLs are the query string itself (/card/<query>), so only sets need
 * slugs. The symbol map is kept anyway: set names carry é (Pokémon GO) and a
 * curly apostrophe (Champion's Path), and the general rule — spell out what
 * carries meaning before stripping the rest — is the same one that stopped the
 * card-art matcher merging Nidoran♂ with Nidoran♀.
 */

/**
 * Symbols that carry meaning in a card name. Mapped to words before the
 * general strip, because losing them merges cards that are genuinely
 * different products at genuinely different prices.
 */
const MEANINGFUL = [
  [/♂/g, " m"],       // Nidoran♂ — must not collide with...
  [/♀/g, " f"],       // ...Nidoran♀
  [/☆/g, " star"],    // Espeon ☆ (Gold Star) is not Espeon
  [/δ/gi, " delta"],  // Delta Species
  [/&/g, " and "]     // "Latias & Latios GX"
];

/**
 * Apostrophes close up rather than becoming separators: "Champion's Path" is
 * champions-path, not champion-s-path. Both the straight and curly forms —
 * the catalogue uses the curly one.
 */
const APOSTROPHE = /['’`]/g;

export function slugify(text) {
  let out = String(text || "");
  for (const [pattern, replacement] of MEANINGFUL) out = out.replace(pattern, replacement);
  out = out
    // é in "Pokémon" becomes e rather than being dropped, which would give
    // "pokmon". Decompose, then discard the combining marks.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(APOSTROPHE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out;
}

/** The set segment: the expansion name, readable, because that's what people search. */
export function setSlug(card) {
  return slugify(card.set || card.expansion || "");
}

export default { slugify, setSlug };
