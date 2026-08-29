/**
 * Comp Finder — finding one card in the box you took to the show.
 *
 * The Show Desk's "Away at the show" list IS the show stock list (see
 * showstock.js — the open `stock_checkouts` rows need no table of their own).
 * It rendered as one flat list in checkout order, which is fine for a dozen
 * cards and useless for two hundred: a customer holds a card up at the table
 * and the row you need to mark SOLD is somewhere in a page of scrolling,
 * ordered by the one thing you know nothing about — when you happened to pack
 * it.
 *
 * This file is the search box, the sort order and the filters behind that
 * list. It is separate from showstock.js because it answers a different
 * question — that file decides what a card is WORTH, this one decides which
 * rows you are looking at — and it is framework-free and app-import-free on
 * purpose, so scripts/check-showfilter.mjs can load it under bare node.
 *
 * **A bulk action applies to what you can SEE, and that is the rule this file
 * exists to hold.** The desk's convention is that ticking nothing means "all
 * of them", which was unambiguous while the list showed everything. With a
 * filter on it stops being: search "sunday", press ↩ Return to spots, and the
 * two hundred cards from Saturday's show get filed too — silently, because the
 * rows that moved were never on screen. `selectionFor()` is the one definition
 * of what a bulk action acts on, and every count on the screen comes from it.
 */

/**
 * Search text, flattened: lower case, accents off, everything that isn't a
 * letter or a digit turned into a space.
 *
 * Both sides go through this, which is what makes the awkward cases work
 * rather than needing rules of their own: "pokemon" finds "Pokémon", and
 * "215/203" finds a title carrying "215/203" because both collapse to the same
 * two tokens.
 */
export function normalise(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Everything on a row that a search should look at, as one string.
 *
 * Deliberately the four things the row actually SHOWS — SKU, card name, event,
 * the stack it left. Searching a field that isn't rendered gives you a hit you
 * can't explain, which on a screen you use standing up is worse than a miss.
 */
export function haystack(co) {
  return normalise([co?.sku, co?.title, co?.event, co?.stack_name].filter(Boolean).join(" "));
}

/**
 * Tokens are AND-ed and order-free, so "umbreon 215" and "215 umbreon" both
 * land on the same card. An empty query matches everything — a search box is
 * not a filter until something is typed into it.
 */
export function matchesQuery(co, query) {
  const tokens = normalise(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack(co);
  return tokens.every((t) => hay.includes(t));
}

/**
 * What is happening to the card's eBay listing while it is away, as one word.
 *
 * One definition, because the chip on the row and the filter that finds those
 * rows have to agree: a filter that says "3 still sellable online" over a list
 * of chips that say otherwise is the kind of disagreement nobody notices until
 * a card sells twice.
 *
 * `failed` outranks everything else deliberately. A hide that errored may well
 * have set a method on the way past, and the honest answer for that row is the
 * bad news, not the intent.
 */
export function listingState(co) {
  if (!co) return "none";
  if (co.hide_error) return "failed";
  if (co.hide_method === "quantity" || co.hide_method === "ended") return "hidden";
  if (co.ebay_item_id) return "live";
  return "none";
}

/** Does this card have a price stuck to it? */
export function hasSticker(co) {
  return co?.sticker_pence != null && Number.isFinite(Number(co.sticker_pence));
}

export const STICKER_FILTERS = [
  { key: "any", label: "Any sticker" },
  { key: "yes", label: "Stickered" },
  { key: "no", label: "No sticker yet" }
];

export const LISTING_FILTERS = [
  { key: "any", label: "Any listing" },
  // The one worth having: a listing that is still live, or one we tried and
  // failed to hide, can sell online while the card is in a box at a show.
  { key: "sellable", label: "Still sellable online" },
  { key: "hidden", label: "Hidden on eBay" },
  { key: "none", label: "No listing" }
];

/** Everything except the free-text query — the dropdowns. */
export function matchesFilters(co, { event = "", stack = "", sticker = "any", listing = "any" } = {}) {
  if (event && String(co?.event || "").trim() !== event) return false;
  if (stack && String(co?.stack_name || "").trim() !== stack) return false;
  if (sticker === "yes" && !hasSticker(co)) return false;
  if (sticker === "no" && hasSticker(co)) return false;
  if (listing !== "any") {
    const state = listingState(co);
    const want = listing === "sellable" ? state === "live" || state === "failed" : state === listing;
    if (!want) return false;
  }
  return true;
}

export const SHOW_SORTS = [
  { key: "out-asc", label: "Order packed" },
  { key: "out-desc", label: "Packed — newest first" },
  { key: "sku", label: "SKU" },
  { key: "name", label: "Card name A–Z" },
  { key: "sticker-desc", label: "Sticker — dearest first" },
  { key: "sticker-asc", label: "Sticker — cheapest first" },
  { key: "stack", label: "Stack it left" }
];

/** Checkout order, which is what the list has always been. */
export const DEFAULT_SORT = "out-asc";

const SKU_PARTS = /^([a-z]*)(\d*)(.*)$/;

/**
 * SKUs the way you'd read them off a box: AB2 before AB11.
 *
 * A SKU here is a stack letter and a number (see stackpos.js — a name, not an
 * address), and comparing the whole thing as text sorts 11 in front of 2. Get
 * that wrong and the column is no faster to scan than no order at all.
 */
export function compareSku(a, b) {
  const A = String(a || "").trim().toLowerCase();
  const B = String(b || "").trim().toLowerCase();
  if (!A || !B) return (A ? 0 : 1) - (B ? 0 : 1);
  const [, pa, na, ra] = A.match(SKU_PARTS);
  const [, pb, nb, rb] = B.match(SKU_PARTS);
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (na !== nb) {
    if (na === "" || nb === "") return na === "" ? 1 : -1;
    if (Number(na) !== Number(nb)) return Number(na) - Number(nb);
  }
  return ra < rb ? -1 : ra > rb ? 1 : 0;
}

/** Missing values sort last whichever way the column runs. */
function nullsLast(a, b, dir) {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
  return (a - b) * dir;
}

const stickerOf = (co) => (hasSticker(co) ? Number(co.sticker_pence) : null);
const packedAt = (co) => {
  const t = Date.parse(co?.checked_out_at || "");
  return Number.isFinite(t) ? t : null;
};
const nameOf = (co) => String(co?.title || "").trim().toLowerCase();

const COMPARATORS = {
  "out-asc": (a, b) => nullsLast(packedAt(a), packedAt(b), 1),
  "out-desc": (a, b) => nullsLast(packedAt(a), packedAt(b), -1),
  sku: (a, b) => compareSku(a?.sku, b?.sku),
  name: (a, b) => {
    const x = nameOf(a);
    const y = nameOf(b);
    // A row with no title is a SKU nobody has matched to a card yet. It sorts
    // last rather than first, where an empty string would put it.
    if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
    return x < y ? -1 : x > y ? 1 : 0;
  },
  "sticker-desc": (a, b) => nullsLast(stickerOf(a), stickerOf(b), -1),
  "sticker-asc": (a, b) => nullsLast(stickerOf(a), stickerOf(b), 1),
  stack: (a, b) => {
    const x = String(a?.stack_name || "").trim().toLowerCase();
    const y = String(b?.stack_name || "").trim().toLowerCase();
    if (x !== y) {
      if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
      return x < y ? -1 : 1;
    }
    return compareSku(a?.sku, b?.sku);
  }
};

/**
 * Sorted copy, never in place — the caller's list is the load from Supabase
 * and a sort that mutated it would reorder the thing every other count is
 * derived from.
 *
 * The original index is the final tie-break, so equal rows keep the order they
 * arrived in and the list never reshuffles under your thumb between renders on
 * the same data.
 */
export function sortCheckouts(rows, key = DEFAULT_SORT) {
  const cmp = COMPARATORS[key] || COMPARATORS[DEFAULT_SORT];
  return (rows || [])
    .map((row, i) => ({ row, i }))
    .sort((a, b) => cmp(a.row, b.row) || a.i - b.i)
    .map((d) => d.row);
}

/** Is anything actually narrowing the list? Drives the "showing x of y" line. */
export function isFiltering({ query = "", event = "", stack = "", sticker = "any", listing = "any" } = {}) {
  return Boolean(
    normalise(query) || event || stack || (sticker && sticker !== "any") || (listing && listing !== "any")
  );
}

/**
 * The list as it should appear, plus what it took to get there.
 *
 * `hidden` is handed back rather than left to be worked out, for the same
 * reason the pricing engine hands back its exclusion count: a row dropped
 * silently looks exactly like a row that was never there, and on this screen
 * that reads as a card missing from the box.
 */
export function showView(rows, criteria = {}) {
  const all = (rows || []).filter(Boolean);
  const matched = all.filter((co) => matchesQuery(co, criteria.query) && matchesFilters(co, criteria));
  return {
    rows: sortCheckouts(matched, criteria.sort),
    total: all.length,
    shown: matched.length,
    hidden: all.length - matched.length,
    filtering: isFiltering(criteria)
  };
}

/**
 * The distinct values of one column, commonest first, with counts — the events
 * and stacks the dropdowns offer.
 *
 * Built from the rows themselves rather than from a fixed list, so the only
 * events offered are ones you can actually reach: a dropdown with an option
 * that filters to nothing is a bug you have to try before you can see.
 */
export function facetsOf(rows, field) {
  const counts = new Map();
  for (const co of rows || []) {
    const v = String(co?.[field] || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

/**
 * What a bulk action acts on. THE rule of this file.
 *
 * Two halves, and both are about the same hazard — a card moving while it is
 * off screen:
 *
 * - Nothing ticked still means "all of them", but all of the ones you can see.
 *   Before there was a filter those were the same set. Now "All" over a search
 *   for "umbreon" has to mean the Umbreons, or the button is quietly a
 *   different button than the one it looks like.
 * - A ticked row that a filter has since hidden is NOT acted on. It stays
 *   ticked — clearing the search brings it back with its tick — because
 *   silently unticking is its own surprise. It simply isn't part of what the
 *   button in front of you does.
 */
export function selectionFor(visible, selectedIds) {
  const rows = (visible || []).filter(Boolean);
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  if (ids.size === 0) return rows;
  return rows.filter((co) => ids.has(co.id));
}
