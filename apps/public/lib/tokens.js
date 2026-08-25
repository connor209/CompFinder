import CompFinderPricing from "@compfinder/core/pricing.js";
import { bareNumber } from "@compfinder/core/cardnumber.js";

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

// bareNumber and the two number guards moved to @compfinder/core/cardnumber.js
// so the business app can use them too. Re-exported here rather than having
// eight callers change their imports for a move that changes no behaviour.
export { bareNumber, dropWrongNumerator, dropWrongSetTotal } from "@compfinder/core/cardnumber.js";

export default { buildCompTokens, bareNumber };
