/**
 * Comp Finder — fold single listings of the same card into one listing.
 *
 * The method (copyqueue.js) is one eBay listing at quantity N backed by N
 * stack rows. Everything already on eBay is the other shape: one listing per
 * copy. This decides, for a set of stack cards you name, whether they may be
 * pooled and how. scripts/copyqueue-pool.mjs does the I/O.
 *
 * WHAT A POOL DOES
 *
 *   - one listing is KEPT; every other copy's listing is ENDED
 *   - every copy's stack row points at the kept listing (`ebay_item_id`),
 *     with a `copy_seq` (the kept listing's own card first, so its photo is
 *     already the right one) and its own scans (`scan_urls`, from the import)
 *   - the kept listing goes to quantity N, showing copy 1's photos
 *
 * **Each copy keeps its own SKU**, so a label on a sleeve stays true. The
 * pool is tied together by item id, which is what allocateUnits() and the
 * copy sync read first.
 *
 * WHAT IT REFUSES, and why each one costs money if it doesn't
 *
 *   - **copies that are not the same card**: a different collector number or
 *     name, printing (reverse holo, stamped), grade, edition (1st, Shadowless),
 *     language (Japanese) or condition. A pooled listing ships whichever copy
 *     is next; pooling a 1st Edition with an Unlimited ships the wrong card.
 *     Edition and language are read here as well as through `duplicateKey()`
 *     because `printingOf()` doesn't read them yet — 98 of the 948 would-be
 *     pools in the 2026-11-07 export mixed them.
 *   - **a copy eBay has already sold**: owed to an unshipped order, or on a
 *     listing at quantity 0. It is somebody's card.
 *   - **a copy that is away** (checked out) or pulled.
 *   - **a copy already in another pool**: two pools claiming one card.
 *   - **a SKU that names more than one stack row**: no way to tell which
 *     physical card is meant.
 *
 * Different asking prices are a WARNING, not a refusal: the kept listing's
 * price stands for every copy, and you should know that before you run it.
 */
import { duplicateKey } from "./streamstock.js";
import { printingOf } from "./stockcheck.js";
import { conditionOf } from "./showcounter.js";

const lower = (v) => (v == null ? "" : String(v).trim().toLowerCase());

/** The parts of a title that make two copies different cards, beyond duplicateKey(). */
export function editionOf(title) {
  const t = String(title || "");
  return [
    /\b1st\b|first edition/i.test(t) ? "1st Edition" : "",
    /shadowless/i.test(t) ? "Shadowless" : "",
    /japanese|\bjpn?\b/i.test(t) ? "Japanese" : ""
  ].filter(Boolean).join(" ");
}

/** Everything that must match for two copies to share a listing. */
export function poolKey(title) {
  const p = printingOf(title);
  return [
    duplicateKey(title),
    p.graded ? `g${p.grade ?? "?"}` : "",
    editionOf(title),
    conditionOf({ title }) || "?"
  ].join("|");
}

/**
 * Decide a pool. Pure.
 *
 *   skus        the copies, as the SKUs on their sleeves, in the order wanted
 *   keepItemId  the listing to keep (default: the first copy's listing)
 *   cards       stack_cards rows (all of them — "already pooled" needs them)
 *   listings    Map<itemId, ebay_listings row>
 *   lines       unshipped order lines (fetchPendingOrders) — required
 *   scans       Map<lowercased sku, string[]> from the imports
 *
 * Returns { ok, keep, copies: [{ card, sku, itemId, seq, scans, title }],
 *           end: [itemId], errors: [..], warnings: [..] }.
 */
export function planPool({ skus, keepItemId = null, cards, listings, lines, scans = new Map() }) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(lines)) errors.push("unshipped orders were not read — a copy that has just sold can't be told from one that hasn't");
  const wanted = [...new Set((skus || []).map((s) => String(s).trim()).filter(Boolean))];
  if (wanted.length < 2) errors.push("a pool needs at least two copies");

  const rowsBySku = new Map();
  const rowsByItem = new Map();
  for (const c of cards || []) {
    const k = lower(c.sku);
    if (k) { if (!rowsBySku.has(k)) rowsBySku.set(k, []); rowsBySku.get(k).push(c); }
    const id = c.ebay_item_id ? String(c.ebay_item_id) : "";
    if (id) rowsByItem.set(id, (rowsByItem.get(id) || 0) + 1);
  }
  const owedItems = new Set();
  const owedSkus = new Set();
  for (const l of lines || []) {
    if (l?.itemId) owedItems.add(String(l.itemId));
    if (l?.sku) owedSkus.add(lower(l.sku));
  }

  const copies = [];
  for (const sku of wanted) {
    const rows = (rowsBySku.get(lower(sku)) || []).filter((c) => !c.pulled_at);
    if (!rows.length) { errors.push(`${sku}: no stack card with this SKU (or it has been pulled)`); continue; }
    if (rows.length > 1) { errors.push(`${sku}: ${rows.length} stack cards carry this SKU — can't tell which physical card is meant`); continue; }
    const card = rows[0];
    if (card.checked_out_at) { errors.push(`${sku}: checked out — it isn't in the box`); continue; }
    const itemId = card.ebay_item_id ? String(card.ebay_item_id) : "";
    if (!itemId) { errors.push(`${sku}: not tied to any eBay listing`); continue; }
    const listing = listings?.get(itemId) || null;
    if (!listing) { errors.push(`${sku}: its listing ${itemId} isn't in the synced listings (ended?)`); continue; }
    if (listing.quantity != null && Number(listing.quantity) <= 0) { errors.push(`${sku}: its listing is at quantity 0 — it has sold`); continue; }
    if (owedItems.has(itemId) || owedSkus.has(lower(sku))) { errors.push(`${sku}: owed to an unshipped order — it has sold`); continue; }
    if ((rowsByItem.get(itemId) || 0) > 1 && itemId !== String(keepItemId || "")) {
      errors.push(`${sku}: already in a pool (listing ${itemId} has ${rowsByItem.get(itemId)} copies)`);
      continue;
    }
    const title = card.title || listing.title || "";
    copies.push({ card, sku, itemId, title, price: listing.price_value ?? null, scans: scans.get(lower(sku)) || [] });
  }

  const keep = String(keepItemId || copies[0]?.itemId || "");
  if (keep && copies.length && !copies.some((c) => c.itemId === keep)) {
    errors.push(`the listing to keep (${keep}) isn't one of these copies' listings`);
  }
  // Adding to a listing that is ALREADY a pool: its other copies must be
  // named too, or the quantity set here would leave them out — on the shelf
  // and tied to the listing, but not on sale.
  const named = new Set(copies.map((c) => c.card.id));
  const unnamed = (cards || []).filter((c) => keep && String(c.ebay_item_id || "") === keep && !c.pulled_at && !c.checked_out_at && !named.has(c.id));
  if (unnamed.length) {
    errors.push(`listing ${keep} already holds ${unnamed.map((c) => c.sku || c.id).join(", ")} — name those too, so the quantity counts every copy`);
  }

  // The same card, printing, grade, edition, language and condition — or no pool.
  const keys = new Map();
  for (const c of copies) {
    const k = poolKey(c.title);
    if (!keys.has(k)) keys.set(k, []);
    keys.get(k).push(c.sku);
  }
  if (keys.size > 1) {
    errors.push(`these are not all the same card: ${[...keys.values()].map((s) => s.join(", ")).join(" | ")}`);
  }

  const prices = [...new Set(copies.map((c) => c.price).filter((p) => p != null).map(Number))];
  if (prices.length > 1) {
    const kept = copies.find((c) => c.itemId === keep)?.price;
    warnings.push(`asking prices differ (${prices.map((p) => `£${p.toFixed(2)}`).join(", ")}) — every copy will sell at the kept listing's ${kept != null ? `£${Number(kept).toFixed(2)}` : "price"}`);
  }
  const noScan = copies.filter((c) => !c.scans.length).map((c) => c.sku);
  if (noScan.length) warnings.push(`no scans found in the imports for ${noScan.join(", ")} — the listing keeps its current photo while those copies are at the front`);

  // The kept listing's own card first: its photo is already on the listing.
  copies.sort((a, b) => (a.itemId === keep ? -1 : b.itemId === keep ? 1 : 0));
  copies.forEach((c, i) => { c.seq = i + 1; });

  const end = copies.filter((c) => c.itemId !== keep).map((c) => c.itemId);
  return { ok: errors.length === 0, keep, copies, end, errors, warnings };
}
