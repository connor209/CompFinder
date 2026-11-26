/**
 * How an ungraded trading card's condition is told to eBay. One table for
 * every path that lists a card.
 *
 * eBay's trading-card categories take `ConditionID 4000` (ungraded) with the
 * grade as condition descriptor 40001. The lab has always sent it that way.
 * The older Quick Search / Batch listing forms (ListForm, BulkListModal) put
 * the DESCRIPTOR value — 400010 for near mint — in the ConditionID itself,
 * which is not a condition eBay knows for the category (found in the platform
 * review, 2026-11-26). Both now go through `conditionXml()`.
 *
 * DMG has no eBay grade below "heavily played", so it is refused rather than
 * listed under a better one — the lab's rule, now everyone's.
 *
 * Pure: scripts/check-ebaycondition.mjs pins it.
 */

/**
 * Our grade → eBay's descriptor 40001 value, for CCG Individual Cards
 * (category 183454, the one every listing here goes in).
 *
 * eBay's table has TWO ladders under 40001 and they are not interchangeable:
 * 400011 Excellent / 400012 Very Good / 400013 Poor are the SPORTS and
 * non-sport card values (183050, 261328), and 183454 refuses them —
 * "Condition descriptor value 400011 is not valid for condition descriptor
 * 40001". Its own are 400015 Lightly Played (Excellent), 400016 Moderately
 * Played (Very Good) and 400017 Heavily Played (Poor); only 400010 Near Mint
 * or Better is shared. Found listing TEST10 (2026-11-26): every NM card
 * listed and every LP, MP and HP card failed. Source:
 * developer.ebay.com → MIP user guide → condition descriptor IDs for
 * trading cards.
 */
export const CONDITION_DESCRIPTOR = { NM: "400010", LP: "400015", MP: "400016", HP: "400017" };

/**
 * The sports-card values a saved listing default may still hold (the old
 * ListForm offered them), read as the CCG grade they were meant to be.
 */
const LEGACY_VALUE = { "400011": "400015", "400012": "400016", "400013": "400017" };

const DESCRIPTOR_VALUES = new Set(Object.values(CONDITION_DESCRIPTOR));

/** The value the old forms used for Damaged. eBay has no such grade. */
export const DAMAGED_VALUE = "400014";

/**
 * The XML for a listing's condition. Takes either a descriptor value
 * (400010, 400015–400017, what the forms hold; a legacy 400011–400013 is read as its CCG grade) or a plain eBay ConditionID (a
 * category that is not trading cards). Empty for no condition. Throws, with
 * a sentence for the screen, on a damaged card.
 */
export function conditionXml(conditionId) {
  const raw = String(conditionId ?? "").trim();
  const id = LEGACY_VALUE[raw] || raw;
  if (!id) return "";
  if (id === DAMAGED_VALUE) throw new Error("eBay has no ungraded card grade below Heavily played, so a damaged card can't be listed under one. Describe it as Heavily played in the title and photos, or keep it off eBay.");
  if (DESCRIPTOR_VALUES.has(id)) {
    return `<ConditionID>4000</ConditionID><ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>${id}</Value></ConditionDescriptor></ConditionDescriptors>`;
  }
  if (!/^\d{4}$/.test(id)) throw new Error(`"${id}" isn't an eBay condition.`);
  return `<ConditionID>${id}</ConditionID>`;
}
