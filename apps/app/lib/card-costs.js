/**
 * What a card cost us, so a sale can say what it MADE (2026-11-24).
 *
 * Profit was only ever worked out over sales with a cost, and the only cost
 * the app kept was one per eBay listing (listing_costs, keyed by item id),
 * typed by hand in My listings. A lab listing is several physical copies
 * bought at different times for different money, so a cost per LISTING is
 * the wrong grain: the cost belongs to the copy (stack_cards.cost_pence,
 * migration 044), set when the batch is loaded and editable in Inventory.
 *
 * A sale line's cost is its reserved copies' costs — the lab knows which copy
 * each sold unit took (reserved_line = "<line item id>#<unit>") — and failing
 * that the listing's cost per unit, as before. A unit with neither is UNKNOWN,
 * and so is the line: a cost of £0 would book the whole price as profit, the
 * flattering direction (the rule Show history and Sales already keep).
 *
 * Pure. The lab's store writes the column; screens read through this.
 */

/** A typed cost: pounds or pence-free text ("1.20", "£0.35", "35p"). Null when it isn't one. Zero is a cost (a pulled card). */
export function parseCostPence(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/[£,\s]/g, "");
  if (!s) return null;
  const p = s.match(/^(\d+(?:\.\d+)?)p$/);
  if (p) return Math.round(Number(p[1]));
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * A lot bought for one sum, split over the cards in it. Each item is
 * { id, copies, weight } — weight is what the card is worth (its price), so a
 * £40 card carries more of the lot than a £2 one. With no weights at all the
 * split is even. Returns Map(id → cost PER COPY, pence), and the shares sum
 * to exactly the lot: the last card takes the rounding, once per copy.
 */
export function splitLotCost(items, totalPence) {
  const list = (items || []).filter((x) => x && (Number(x.copies) || 0) > 0);
  const out = new Map();
  const total = Math.round(Number(totalPence));
  if (!list.length || !Number.isFinite(total) || total < 0) return out;
  const weightOf = (x) => Math.max(0, Number(x.weight) || 0) * Number(x.copies);
  const sum = list.reduce((t, x) => t + weightOf(x), 0);
  const copies = list.reduce((t, x) => t + Number(x.copies), 0);
  let given = 0;
  list.forEach((x, i) => {
    const n = Number(x.copies);
    let each;
    if (i === list.length - 1) {
      each = Math.max(0, Math.round((total - given) / n));
    } else {
      const share = sum > 0 ? (total * weightOf(x)) / sum : (total * n) / copies;
      each = Math.round(share / n);
    }
    given += each * n;
    out.set(String(x.id), each);
  });
  return out;
}

/**
 * The index a sale is costed from. `listingCosts` are listing_costs rows
 * ({ ebay_item_id, cost_pence }); `cards` are stack cards carrying
 * reserved_line and cost_pence (a lab copy that sold).
 */
export function costIndex({ listingCosts = [], cards = [] } = {}) {
  const byItem = new Map();
  for (const r of listingCosts || []) if (r && r.cost_pence != null) byItem.set(String(r.ebay_item_id), Number(r.cost_pence));
  const byUnit = new Map();
  for (const c of cards || []) if (c && c.reserved_line && c.cost_pence != null) byUnit.set(String(c.reserved_line), Number(c.cost_pence));
  return { byItem, byUnit };
}

/**
 * What one eBay sale line cost: { pence, source } — source "copy" (every unit
 * a costed copy), "listing" (the listing's cost per unit), "mixed", or null
 * with pence null when any unit is unknown.
 */
export function saleCost(sale, index) {
  const n = Math.max(1, Number(sale?.quantity) || 1);
  const item = index?.byItem?.get(String(sale?.ebay_item_id ?? ""));
  let total = 0;
  const sources = new Set();
  for (let u = 1; u <= n; u++) {
    const copy = index?.byUnit?.get(`${sale?.line_item_id}#${u}`);
    if (copy != null) { total += copy; sources.add("copy"); continue; }
    if (item != null) { total += item; sources.add("listing"); continue; }
    return { pence: null, source: null };
  }
  return { pence: total, source: sources.size > 1 ? "mixed" : [...sources][0] };
}

/** Totals for a set of copies: what they cost, what they are listed at, and how many have no cost. */
export function costTotals(copies, priceOf = () => null) {
  let cost = 0, value = 0, costed = 0, uncosted = 0, valueOfCosted = 0;
  for (const c of copies || []) {
    const p = priceOf(c);
    if (p != null) value += p;
    if (c.cost_pence == null) { uncosted += 1; continue; }
    costed += 1;
    cost += Number(c.cost_pence);
    if (p != null) valueOfCosted += p;
  }
  // Margin only over the copies that HAVE a cost — never an uncosted card at £0.
  return { cost, value, costed, uncosted, margin: costed ? valueOfCosted - cost : null };
}
