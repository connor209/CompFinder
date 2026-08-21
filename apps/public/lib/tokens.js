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
export function buildCompTokens(card, fallbackQuery) {
  const nameSource = (card && card.name) || fallbackQuery || "";
  const tokens = CompFinderPricing.extractNameTokens(
    CompFinderPricing.simplifyTitle(nameSource, settings.stripWords)
  );

  const bare = bareNumber(card && card.number);
  // \b186\b still matches inside "186/196", so the numerator alone is enough
  // and is more forgiving of sellers who write the denominator differently.
  return bare ? [...tokens, bare] : tokens;
}

export function bareNumber(number) {
  if (!number) return null;
  const first = String(number).split("/")[0].replace(/^0+(?=\d)/, "").trim();
  return /^\d{1,4}$/.test(first) ? first : null;
}

export default { buildCompTokens, bareNumber };
