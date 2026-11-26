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

/** Our grade → eBay's descriptor 40001 value. */
export const CONDITION_DESCRIPTOR = { NM: "400010", LP: "400011", MP: "400012", HP: "400013" };

const DESCRIPTOR_VALUES = new Set(Object.values(CONDITION_DESCRIPTOR));

/** The value the old forms used for Damaged. eBay has no such grade. */
export const DAMAGED_VALUE = "400014";

/**
 * The XML for a listing's condition. Takes either a descriptor value
 * (400010…400013, what the forms hold) or a plain eBay ConditionID (a
 * category that is not trading cards). Empty for no condition. Throws, with
 * a sentence for the screen, on a damaged card.
 */
export function conditionXml(conditionId) {
  const id = String(conditionId ?? "").trim();
  if (!id) return "";
  if (id === DAMAGED_VALUE) throw new Error("eBay has no ungraded card grade below Heavily played, so a damaged card can't be listed under one. Describe it as Heavily played in the title and photos, or keep it off eBay.");
  if (DESCRIPTOR_VALUES.has(id)) {
    return `<ConditionID>4000</ConditionID><ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>${id}</Value></ConditionDescriptor></ConditionDescriptors>`;
  }
  if (!/^\d{4}$/.test(id)) throw new Error(`"${id}" isn't an eBay condition.`);
  return `<ConditionID>${id}</ConditionID>`;
}
