/**
 * Catalog helpers shared by client and server. Pure functions only (no DB) so
 * they can be imported anywhere.
 *
 * Language is inferred from the CardMarket expansion NAME. Chinese/Korean/
 * Indonesian/Thai/European sets label their language in the name; English sets
 * don't (so English is the default). Japanese sets mostly don't name the
 * language either, so they fall through to English here — the manual language
 * toggle stays the safety net for those.
 */
const LANGUAGE_RULES = [
  [/simplified chinese|traditional chinese|\bchinese\b/i, "Chinese"],
  [/\bkorean\b/i, "Korean"],
  [/\bindonesian\b/i, "Indonesian"],
  [/\bthai\b/i, "Thai"],
  [/\bgerman\b/i, "German"],
  [/\bfrench\b/i, "French"],
  [/\bitalian\b/i, "Italian"],
  [/\bspanish\b/i, "Spanish"],
  [/\bportuguese\b/i, "Portuguese"],
  [/\bjapanese\b/i, "Japanese"]
];

export function detectLanguage(expansion) {
  const e = expansion || "";
  for (const [re, lang] of LANGUAGE_RULES) if (re.test(e)) return lang;
  return "English";
}

const CatalogHelpers = { detectLanguage };
export default CatalogHelpers;
