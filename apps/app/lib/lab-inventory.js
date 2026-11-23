/**
 * The lab's inventory view (docs/LISTING_STUDIO.md, part C): one row per
 * listing — a card in a condition — with its copies underneath. Pure; the
 * screen is app/panel/lab/inventory.
 *
 * Built off the same rows the lab already reads, through the same queue and
 * pile rules (lab-copies.js), so this view and the lab page can never
 * disagree about which copy is on show or where a card is.
 */
import { queueOf, displayOrder, pilePositions, pileOf } from "./lab-copies.js";

export const PAGE_SIZE = 50;

export const STATUSES = [
  ["live", "Live"],
  ["soldout", "Sold out"],
  ["ended", "Ended"]
];

export const SORTS = [
  ["added-desc", "Newest first"],
  ["added-asc", "Oldest first"],
  ["price-desc", "Price, high to low"],
  ["price-asc", "Price, low to high"],
  ["name-asc", "Name A–Z"],
  ["forsale-desc", "Most copies for sale"]
];

/** Lowercased, accents off, punctuation to spaces — how both sides of a search are read. */
export function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
}

/** A listing's status: ended (by us), sold out (live on eBay at quantity 0), or live. */
export function statusOf(listing, forSale) {
  if (listing?.ended_at) return "ended";
  return forSale > 0 ? "live" : "soldout";
}

/**
 * One row per listing. Counts:
 *   forSale   copies in the queue (not sold, not picked)
 *   waiting   sold to an order, still on the shelf — these are on the Pick list
 *   picked    gone
 */
export function inventoryRows(listings, copies) {
  const pos = pilePositions(copies);
  const byListing = new Map();
  for (const c of copies || []) {
    const k = String(c.listing_id);
    if (!byListing.has(k)) byListing.set(k, []);
    byListing.get(k).push(c);
  }
  return (listings || []).map((l) => {
    const mine = byListing.get(String(l.id)) || [];
    const queue = queueOf(l.id, copies);
    const head = queue[0] || null;
    const waiting = mine.filter((c) => c.reserved_line && !c.pulled_at).length;
    const picked = mine.filter((c) => c.pulled_at).length;
    const card = l.card || {};
    const piles = [...new Set(mine.map((c) => pileOf(c.sku).pile))].sort();
    const showing = mine.find((c) => String(c.id) === String(l.pictured_copy_id)) || null;
    return {
      id: l.id,
      listing: l,
      title: l.title,
      name: card.name || "",
      number: card.number || "",
      set: card.set || "",
      language: card.language || "",
      condition: String(l.condition || "").toUpperCase(),
      subtype: l.subtype || "",
      status: statusOf(l, queue.length),
      forSale: queue.length,
      waiting,
      picked,
      total: mine.length,
      pricePence: l.price_pence ?? null,
      marketPence: l.market_pence ?? null,
      marketAt: l.market_at || null,
      itemId: l.ebay_item_id || null,
      addedAt: l.created_at || null,
      // Card-level picture: the database image when there is one, else the
      // scan of the copy on show. A row never stands for one copy, so the
      // stock image is honest HERE — and only here.
      picture: l.db_image_url || (showing || head)?.scan_urls?.[0] || mine[0]?.scan_urls?.[0] || null,
      pictureIsDb: Boolean(l.db_image_url),
      piles,
      copies: displayOrder(l.id, copies).map((c) => ({
        ...c,
        pile: pos.get(String(c.id))?.pile || pileOf(c.sku).pile,
        position: pos.get(String(c.id))?.position || null,
        state: c.pulled_at ? "picked" : c.reserved_line ? "sold" : head && String(head.id) === String(c.id) ? "next" : "queued",
        onShow: String(l.pictured_copy_id || "") === String(c.id) && !l.ended_at
      })),
      search: norm([l.title, card.name, card.number, card.set, card.setCode, card.rarity, l.subtype, l.ebay_item_id, ...mine.map((c) => c.sku)].join(" "))
    };
  });
}

/**
 * Does a row match the search? Every word typed has to be in it, any order.
 * A word that is an exact SKU of one of its copies always matches, so
 * "TEST2-14" finds its card even though the hyphen is read as a space.
 */
export function matchesSearch(row, q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const skus = new Set(row.copies.map((c) => String(c.sku).toLowerCase()));
  if (skus.has(String(q).trim().toLowerCase())) return true;
  return words.every((w) => row.search.includes(w));
}

export const EMPTY_FILTERS = { q: "", status: "", condition: "", pile: "", language: "", subtype: "", waiting: false };

export function filterRows(rows, f = EMPTY_FILTERS) {
  return (rows || []).filter((r) =>
    matchesSearch(r, f.q) &&
    (!f.status || r.status === f.status) &&
    (!f.condition || r.condition === f.condition) &&
    (!f.pile || r.piles.includes(f.pile)) &&
    (!f.language || r.language === f.language) &&
    (!f.subtype || r.subtype === f.subtype) &&
    (!f.waiting || r.waiting > 0)
  );
}

/** Sort. A row with no price sorts LAST in both price directions — never as £0. */
export function sortRows(rows, key = "added-desc") {
  const [field, dir] = String(key).split("-");
  const sign = dir === "asc" ? 1 : -1;
  const val = (r) => (field === "price" ? r.pricePence : field === "added" ? r.addedAt : field === "name" ? r.title : field === "forsale" ? r.forSale : null);
  return (rows || []).slice().sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va == null && vb == null) return String(a.id).localeCompare(String(b.id));
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    return c ? c * sign : String(a.id).localeCompare(String(b.id));
  });
}

export function pageOf(rows, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil((rows || []).length / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Filter options built from the rows themselves, so an option that finds nothing is never offered. */
export function facets(rows) {
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  return {
    conditions: uniq(rows.map((r) => r.condition)),
    piles: uniq(rows.flatMap((r) => r.piles)),
    languages: uniq(rows.map((r) => r.language)),
    subtypes: uniq(rows.map((r) => r.subtype))
  };
}

/**
 * The rows a bulk action may touch: ticked AND on screen now. A tick the
 * search or page has hidden is not acted on — the app's standing rule — and
 * ticking nothing means nothing, never everything.
 */
export function actionable(ticked, visibleRows) {
  const on = new Set([...(ticked || [])].map(String));
  return (visibleRows || []).filter((r) => on.has(String(r.id)));
}

/** Pence from what was typed in a price box, or null. */
export function parsePence(v) {
  const s = String(v ?? "").replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 ? p : null;
}

/**
 * The price change a bulk "set price" would make on each row, or why not.
 * `mode` is "exact" (one figure for all) or "market" (each row's own
 * sold-comps figure). Only live listings; a row with no market figure is
 * skipped in market mode and says so; unchanged rows are left alone.
 */
export function pricePlan(rows, { mode = "exact", pence = null } = {}) {
  return (rows || []).map((r) => {
    if (r.status === "ended") return { row: r, skip: "ended" };
    const to = mode === "market" ? r.marketPence : pence;
    if (to == null || !(to >= 99)) return { row: r, skip: mode === "market" ? "no sold-comps price" : "no price" };
    if (to === r.pricePence) return { row: r, skip: "already that price" };
    return { row: r, from: r.pricePence, to };
  });
}
