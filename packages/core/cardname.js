// Clean a Cardmarket catalogue card name into text that matches how the card is
// actually listed on eBay. Cardmarket names carry noise that real eBay titles
// never have — a jammed-on Mega prefix, bracketed format tags ([D-Format]),
// and parenthetical variant/foil annotations ((Cold Foil), (V.1 - Feature
// Rare)). Stripping that noise lifts sold-comp match rates a lot, especially
// for the non-Pokémon games whose search is name-text only.
//
// Conservative by design: it only removes annotations that are unmistakably
// Cardmarket bookkeeping, and it never returns an empty string (falls back to
// the original name if a rule would erase everything).

// Bracketed tags: [D-Format], [G Format], [V Format], [Reprint] …
const BRACKET_TAG = /\s*\[[^\]]*\]/g;

// Parenthetical variant/foil/version annotations. Only strip a parenthetical
// when it reads as Cardmarket bookkeeping (matches one of these keywords), so
// genuinely-named parentheticals — e.g. Magic's "Erase (Not the Urza's Legacy
// One)" — are left intact.
const VARIANT_PAREN = /\s*\((?:[^()]*\b(?:regular|foil|holo|reprint|reprints|format|promo|stamped|signed|duplicate|parallel|version|ver|alternate|alt art|full art|cold|rainbow|prerelease|staff|misprint|v\.\d)\b[^()]*)\)/gi;

// A leading "(Duplicate) " that Cardmarket sometimes prepends.
const LEADING_DUP = /^\(duplicate\)\s*/i;

// Cardmarket jams the Mega prefix onto the name — "MRayquaza EX" — where eBay
// writes "M Rayquaza EX". Split a leading "M" that's followed by an uppercase
// letter (a Mega); "Mimikyu"/"Mewtwo" (M + lowercase) are left alone.
function splitMega(name) {
  return name.replace(/^M([A-Z])/, "M $1");
}

function tidy(s) {
  return s.replace(/\s{2,}/g, " ").replace(/\s+([,:])/g, "$1").trim();
}

/**
 * @param {string} name  raw catalogue name
 * @param {string} [gameMode]  "pokemon" | "mtg" | "other" — Mega split is
 *   Pokémon-only; the rest applies to every game.
 * @returns {string} cleaned search text (never empty)
 */
export function cleanSearchName(name, gameMode = "other") {
  const original = (name || "").trim();
  if (!original) return original;

  let out = original
    .replace(LEADING_DUP, "")
    .replace(BRACKET_TAG, "")
    .replace(VARIANT_PAREN, "");
  out = tidy(out);
  if (gameMode === "pokemon") out = tidy(splitMega(out));

  // Never let a rule erase the whole name.
  return out || original;
}

export default { cleanSearchName };
