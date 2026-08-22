import CompFinderPricing from "@compfinder/core/pricing.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;

/**
 * The words a comp title must contain to count.
 *
 * These are NOT the same thing as the search query, and conflating them was a
 * real fault: the query carries a set code ("LOR", "EVS", "SV2a") because that
 * helps SoldComps find the right listings, but eBay sellers write "Lost
 * Origin", never "LOR". Deriving the required tokens from the whole query made
 * the set code mandatory, and since nameTokensMatch requires EVERY token, a
 * search for "Giratina V 186/196 LOR" rejected all forty comps it fetched.
 *
 * So: tokens come from the card NAME, plus the bare collector number when we
 * know it. The number is what separates 186/196 from 130/196 — dropping the
 * set code without adding the number back would swing the fault the other way
 * and pool every print of the card together.
 *
 * @param {object} card  { name, number } — number may be "186/196" or "186"
 * @param {string} fallbackQuery  used when no catalogue card was matched
 */
/**
 * A printed LEVEL ("Lv.12"), which the catalogue keeps in the name and eBay
 * sellers almost never type. It was the last unpriceable card in the 294-card
 * audit: "Flying Pikachu Lv.12" made "Lv.12" a required token, and since every
 * token must be present, all 40 comps were rejected as a name mismatch even
 * though they were the right card.
 *
 * "Lv.X" is deliberately NOT stripped. That is a rarity, not a level — sellers
 * do write "Charizard LV.X" — and Charizard LV.X 143 Supreme Victors prices
 * correctly with it required.
 */
const PRINTED_LEVEL = /\s*\bLv\.?\s*\d+\b/gi;

export function buildCompTokens(card, fallbackQuery) {
  const nameSource = String((card && card.name) || fallbackQuery || "").replace(PRINTED_LEVEL, "");
  const tokens = CompFinderPricing.extractNameTokens(
    CompFinderPricing.simplifyTitle(nameSource, settings.stripWords)
  );

  const bare = bareNumber(card && card.number);
  // \b186\b still matches inside "186/196", so the numerator alone is enough
  // and is more forgiving of sellers who write the denominator differently.
  return bare ? [...tokens, bare] : tokens;
}

/**
 * The collector number as a matchable token — kept EXACTLY as printed,
 * leading zeros and all.
 *
 * Stripping them looked tidy and silently broke every secret rare. The match
 * is a word-boundary regex, and in the title "Slowbro 090/084" the token "90"
 * has no boundary before it (the preceding "0" is a word character), so it
 * never matches. Against the PulseTCG best-seller list that was the whole
 * difference: all 19 cards that returned no price had a leading zero, all 11
 * that priced correctly did not.
 *
 * The residual risk is the mirror image — a seller who writes "90/84" when the
 * card prints "090/084". That's much rarer than sellers copying the number as
 * printed, so this is the right side to err on, but it is a real gap rather
 * than a solved problem.
 */
export function bareNumber(number) {
  if (!number) return null;
  const first = String(number).split("/")[0].trim();
  return /^\d{1,4}$/.test(first) ? first : null;
}

export default { buildCompTokens, bareNumber };

/**
 * Excludes comps whose title carries an explicit collector number with a
 * DIFFERENT numerator from the one being searched for.
 *
 * The mirror image of dropWrongSetTotal below, and the one that actually
 * fires here. That function needs the searched-for number to carry its own
 * denominator, and the catalogue gives bare numerators — so on this page it
 * returns early and does nothing.
 *
 * The case that needs it: "Mew ex 151 WCD 2025" priced nine comps spanning
 * £5.13 to £38.73, and they were three different cards. The set is CALLED
 * 151, so "Pokemon TCG - S&V 151 - 205/165 Mew ex" contains the digits 151
 * and satisfies the number token — which was matching the set name, not the
 * collector number. Mew ex 151/165 (~£5-£20), 205/165 (~£20-£38) and 193/165
 * were all being pooled into one figure that is right for none of them.
 *
 * Only an EXPLICIT differing numerator excludes. A title that writes the card
 * number with no denominator at all stays in, exactly as dropWrongSetTotal
 * treats a missing set total: the honest majority is not worth discarding to
 * catch the ambiguous few. And if the guard would leave too little to price
 * from, it stands down entirely — a catalogue number that is simply wrong
 * should fall through to the existing name-only fallback, not produce a
 * confident price off two survivors.
 */
export function dropWrongNumerator(comps, number, minKept = 3) {
  const bare = bareNumber(number);
  if (!bare) return comps;
  const want = bare.replace(/^0+(?=\d)/, "");

  const kept = comps.filter((c) => {
    const found = [...String(c.title || "").matchAll(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g)];
    if (!found.length) return true;            // no explicit number — can't rule it out
    // Keep it if ANY explicit number in the title is ours. Titles that repeat
    // the number, or add the set total a second time, must not be punished.
    return found.some((m) => m[1].replace(/^0+(?=\d)/, "") === want);
  });
  return kept.length >= minKept ? kept : comps;
}

/**
 * Excludes comps whose collector number shares our numerator but names a
 * different set total.
 *
 * People type "Charizard ex 223", not "Charizard ex 223/165 151" — measured on
 * 30 cards, the short form prices 28 of them and agrees with the full query on
 * 22. Nearly every disagreement is this collision: 223/165 is a 151 Charizard
 * at ~£259 and 223/197 is an Obsidian Flames one at ~£96, and matching on the
 * numerator alone pools them into a number that is right for neither.
 *
 * MEASURED: across 26 real searches this drops nothing at all (1034/1034 comps
 * kept), because when we hold a denominator the upstream search already used
 * it. It earns its place only in the name-fallback path, where a number that
 * matched nothing is abandoned and a wrong-set print could otherwise be pooled
 * in. Precautionary, verified harmless — not a measured improvement.
 *
 * The denominator is the disambiguator, and it is already in the titles. Only
 * an explicit, differing one excludes: plenty of sellers write "223" with no
 * set total at all, and those stay in, since the alternative is discarding the
 * honest majority to catch the ambiguous few.
 */
export function dropWrongSetTotal(comps, number) {
  const parts = String(number || "").split("/");
  if (parts.length !== 2) return comps;
  const want = parts[1].replace(/^0+(?=\d)/, "").trim();
  const num = parts[0].trim();
  if (!/^\d{1,4}$/.test(want) || !/^\d{1,4}$/.test(num)) return comps;

  const pattern = new RegExp(`\\b0*${num.replace(/^0+(?=\d)/, "")}\\s*/\\s*(\\d{1,4})\\b|\\b${num}\\s*/\\s*(\\d{1,4})\\b`);
  return comps.filter((c) => {
    const m = pattern.exec(c.title || "");
    if (!m) return true; // no explicit denominator — can't rule it out, so keep it
    const seen = (m[1] || m[2] || "").replace(/^0+(?=\d)/, "");
    return seen === want;
  });
}
