/**
 * Promo cards, as the app reads them.
 *
 * A Black Star promo is numbered with its set's prefix — BW33, SM42, SWSH123,
 * SVP 045, XY42 — and never has a set total. The catalogue sometimes carries
 * one anyway ("BW33/101"), and a search for "Riolu BW33/101" finds no sales at
 * all, UK or worldwide, because nobody titles a promo that way. So a promo's
 * number is cut back to its code before it reaches a query.
 *
 * And a promo's sold listings say "promo" — "Black Star Promo" is how every
 * honest seller describes one — while the engine's default exclusions drop any
 * comp whose title says "promo", which is right for a main-set card and drops
 * EVERY comp of a promo. That is how Riolu BW33 Cosmos Holo showed eleven UK
 * sales under Recent sales and priced off one. Last Comp has stood the keyword
 * down for promos since August (apps/public/lib/settings.js); the app never
 * did.
 *
 * App-side on purpose, like everything in matching.js: packages/core is
 * untouched, and the public page keeps its own reading.
 */

// Prefixes that ARE a promo number. "SV" alone is deliberately absent: Hidden
// Fates' Shiny Vault is SV1–SV94 and Shining Fates' is SV001–SV122, both main
// sets. Scarlet & Violet promos are SVP.
const PROMO_PREFIXES = ["SWSH", "SVP", "MEP", "HGSS", "BW", "XY", "SM", "DP", "NP"];
const PREFIX_ALT = PROMO_PREFIXES.join("|");

/** A promo number on its own: "BW33", "SVP 045", "SWSH123". */
const PROMO_NUMBER = new RegExp(`^(${PREFIX_ALT})\\s*-?\\s*(\\d{1,3})$`, "i");
/** The same, with a set total someone bolted on: "BW33/101". */
const PROMO_WITH_TOTAL = new RegExp(`^(${PREFIX_ALT})\\s*-?\\s*(\\d{1,3})\\s*/\\s*[A-Z]{0,4}\\d{1,4}$`, "i");
/** A promo code inside free text, not followed by a set total. */
const PROMO_IN_TEXT = new RegExp(`\\b(${PREFIX_ALT})\\s?(\\d{1,3})\\b(?!\\s*/)`, "i");

/**
 * A promo's number as a seller writes it: prefix and digits, upper-cased, no
 * space, no denominator. Anything that isn't promo-shaped comes back trimmed
 * and otherwise untouched — a main-set "013/078" keeps its total, which is
 * what the collector-number guards need.
 */
export function promoNumber(number) {
  const n = String(number || "").trim();
  const m = n.match(PROMO_WITH_TOTAL) || n.match(PROMO_NUMBER);
  if (!m) return n;
  return `${m[1].toUpperCase()}${m[2]}`;
}

/** { prefix, digits } for a promo number, or null. */
export function parsePromoNumber(number) {
  const m = promoNumber(number).match(PROMO_NUMBER);
  return m ? { prefix: m[1].toUpperCase(), digits: m[2].replace(/^0+(?=\d)/, "") } : null;
}

/** Is this card a promo printing — by its number, its set or its rarity. */
export function isPromoCard({ number, set, rarity } = {}) {
  if (/\bpromo/i.test(set || "") || /\bpromo/i.test(rarity || "")) return true;
  const n = String(number || "").trim();
  return PROMO_NUMBER.test(n) || PROMO_WITH_TOTAL.test(n);
}

/**
 * Does a free-text title describe a promo — a promo code in it, or the word.
 * Used where the app has only a title (Quick Search, a batch row's query).
 */
export function textLooksPromo(text) {
  const t = String(text || "");
  return PROMO_IN_TEXT.test(t) || /\bblack\s*star\b/i.test(t) || /\bpromo\b/i.test(t);
}

/** The promo code inside free text ("Riolu BW33 Cosmos Holo" → "BW33"), or null. */
export function promoCodeIn(text) {
  const m = String(text || "").match(PROMO_IN_TEXT);
  return m ? { code: `${m[1].toUpperCase()}${m[2]}`, index: m.index, length: m[0].length } : null;
}

/**
 * A pattern matching OUR promo number in a comp title, however the seller
 * spaced or padded it: "BW33", "BW 33", "BW033", "#BW33".
 */
export function promoNumberPattern(number) {
  const p = parsePromoNumber(number);
  if (!p) return null;
  return new RegExp(`\\b${p.prefix}\\s?-?\\s?0*${p.digits}\\b`, "i");
}

/** Any promo code with this prefix in a title, for "a different promo". */
export function anyPromoOfPrefix(number) {
  const p = parsePromoNumber(number);
  if (!p) return null;
  return new RegExp(`\\b${p.prefix}\\s?-?\\s?(\\d{1,3})\\b`, "gi");
}
