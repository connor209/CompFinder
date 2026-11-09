/**
 * Which picture goes beside a card on the pull sheet.
 *
 * An eBay order carries no image, so every picture here is one we already
 * hold, and none costs an API call. Narrowest first — a photograph of THIS
 * copy beats a photograph of the listing:
 *
 *   1. `stack_cards.scan_url` — the copy's own scan (migration 027). On a
 *      multi-quantity listing it is the only one that tells copy 1 from 2.
 *   2. The listing's gallery shot, by the item id the order sold from.
 *   3. The newest CardUploader import scan for the SKU — a photo of the copy
 *      that survives the listing: a single card's listing ENDS when it sells,
 *      and the next sync sweeps its row and its picture with it.
 *   4. The gallery shot of whichever listing carries the SKU.
 *
 * **A variation pick never gets a listing's picture.** A "choose your card"
 * listing has one gallery shot for every card in it, so drawing it beside the
 * card the buyer chose is a picture of the wrong card with total confidence —
 * worse than a gap, on the one screen whose job is finding the right card.
 * A copy-specific scan (1 and 3) is still fine, because it is keyed on the
 * copy rather than the listing.
 *
 * No catalogue art, ever: the rule counter mode settled — publisher artwork
 * shows a mint card where a played one is.
 *
 * Pure, no imports, so `scripts/check-pullimages.mjs` loads it under node.
 */

const clean = (u) => {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : null;
};
const skuKey = (s) => String(s || "").trim().toLowerCase() || null;

/**
 * Index the rows the sheet read. `listings` are `ebay_listings` rows
 * (`ebay_item_id`, `sku`, `image_url`); `importScans` is the Map
 * importScansBySku() returns, keyed by lowercased SKU.
 */
export function pullImageIndex({ listings = [], importScans = null } = {}) {
  const byItem = new Map();
  const bySku = new Map();
  for (const l of listings || []) {
    const url = clean(l?.image_url);
    if (!url) continue;
    if (l.ebay_item_id != null) byItem.set(String(l.ebay_item_id), url);
    const k = skuKey(l.sku);
    if (k && !bySku.has(k)) bySku.set(k, url);
  }
  const scans = new Map();
  for (const [k, u] of importScans || []) {
    const url = clean(u);
    if (skuKey(k) && url) scans.set(skuKey(k), url);
  }
  return { byItem, bySku, scans };
}

/**
 * The picture for one unit on the sheet, or null — and a null draws nothing.
 * `card` is the matched stack card if there is one; `itemId`, `sku` and
 * `variation` come off the order line.
 */
export function pullImageFor({ card = null, itemId = null, sku = null, variation = null } = {}, index) {
  const own = clean(card?.scan_url);
  if (own) return own;
  const k = skuKey(sku);
  const isVariation = !!String(variation || "").trim();
  if (!isVariation && itemId != null) {
    const hit = index?.byItem?.get(String(itemId));
    if (hit) return hit;
  }
  if (k && index?.scans?.get(k)) return index.scans.get(k);
  if (!isVariation && k && index?.bySku?.get(k)) return index.bySku.get(k);
  return null;
}
