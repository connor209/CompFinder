/**
 * A price change sent to eBay: when it is too big to send without asking
 * again, and the row it leaves in the change log.
 *
 * One rule for every screen that revises a live price. My listings (through
 * the revise-price route) and the lab's Inventory (its setPrices action) used
 * to disagree: the first refused a drastic change without a second
 * confirm and logged every change to `ebay_price_changes`, which is what the
 * eBay activity screen reads to show and revert it; the second did neither,
 * so a lab price change could not be seen or undone from there.
 *
 * Pure: no I/O. scripts/check-pricechange.mjs pins it.
 */

/** Below a fifth or above five times the current price is drastic. */
export const DRASTIC_LOW = 0.2;
export const DRASTIC_HIGH = 5;

/**
 * Whether going from `from` to `to` is a big enough jump to ask again —
 * the guard against a bad comp match nuking a live price. Units don't matter
 * (pence or pounds), only the ratio. No current price means nothing to
 * compare against, so nothing is drastic.
 */
export function isDrasticChange(from, to) {
  const a = Number(from), b = Number(to);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return false;
  return b < a * DRASTIC_LOW || b > a * DRASTIC_HIGH;
}

/**
 * The `ebay_price_changes` row for an applied change. Prices are in POUNDS,
 * as the table and EbayActivity's revert have always read them. `source`
 * says which screen sent it ("market-update" for My listings, "lab").
 */
export function priceChangeRow({ userId, itemId, title, fromPence, toPence, currency = "GBP", source }) {
  return {
    user_id: userId,
    ebay_item_id: String(itemId),
    title: title || null,
    old_price: fromPence != null ? Number(fromPence) / 100 : null,
    new_price: Number(toPence) / 100,
    currency,
    source
  };
}
