/**
 * Comp Finder — the digital binder.
 *
 * Counter mode (showcounter.js) turns the show stock round to face a customer
 * as a LIST: a row each, name and price, read at arm's length. That is the
 * right shape for answering "have you got any gengars" and the wrong shape for
 * the thing people actually do at a table, which is flip through a binder and
 * point at what they like. This file is the other one — the same stock, laid
 * out nine to a page in card pockets, turned with a button or a thumb.
 *
 * Three rules hold it together, and only the first is about looks.
 *
 * **A page is nine pockets, always.** A real binder page is 3x3, and a fixed
 * count is what makes a page NUMBER mean something: "it's on page four" has to
 * be true on the phone in your pocket and the tablet on the table, or it is
 * not worth saying. The last page is padded with empty pockets rather than
 * reflowing, for the same reason a real one is.
 *
 * **One card, one pocket.** Four copies of the same Gengar are four rows on
 * the desk — they are four different physical cards in four different stack
 * positions, and the desk is right to list them. In a binder they are one
 * pocket: a customer flipping past the same card four times is reading a
 * duplicate, not four choices. The copies are not thrown away, they are folded
 * into the pocket and listed in the preview, and the count of what got folded
 * is handed back so the screen can say so. Nothing is dropped quietly here
 * either.
 *
 * **The pocket is an ALLOW-LIST, exactly like counterRow().** Same reasoning,
 * same failure mode: the leak worth designing against is the column added to
 * `stock_checkouts` a year from now for an unrelated reason, appearing on a
 * tablet somebody is holding. So a pocket is built key by key and this file
 * never names `sku`, `stack_name` or `event` at all — the location the preview
 * shows is resolved by the DESK, out of state it already holds, on a tap. See
 * copyLocations() at the bottom, which takes those maps as arguments rather
 * than reaching for them.
 *
 * Framework-free and app-import-free on purpose, so scripts/check-binder.mjs
 * can load it under bare node.
 */
import { matchesQuery, normalise, hasSticker } from "./showfilter.js";
import { counterName, conditionOf, counterPrice, counterImage, imageAt, ASK_TEXT } from "./showcounter.js";

/** A binder page: three across, three down. See the file header. */
export const BINDER_COLS = 3;
export const BINDER_ROWS = 3;
export const BINDER_PAGE = BINDER_COLS * BINDER_ROWS;

/**
 * The two sizes the eBay CDN is asked for.
 *
 * `ebay_listings.image_url` is the GalleryURL, which eBay serves at `s-l140` —
 * right for a 44px row on the counter list and visibly soft in a pocket four
 * times that wide. Both sizes are the same picture asked for differently (see
 * imageAt() in showcounter.js — one definition of that filename rule), so a
 * binder page still costs no API call and nothing is fetched until the page is
 * on screen.
 */
export const POCKET_PX = 500;
export const PREVIEW_PX = 1600;

/**
 * Every key a pocket may carry, and every key one of its copies may carry.
 * check-binder.mjs asserts the projection produces exactly these and no
 * others, so adding one is a deliberate act with a test behind it.
 */
export const BINDER_FIELDS = [
  "key", "name", "condition", "pricePence", "priceText", "priceFrom",
  "image", "imageLarge", "count", "copies"
];
export const BINDER_COPY_FIELDS = ["id", "condition", "pricePence", "priceText"];

/**
 * How the binder can be ordered.
 *
 * Deliberately NOT showfilter.js's SHOW_SORTS, and the difference is real
 * rather than cosmetic: those sort checkout rows, and by the time anything is
 * ordered here the copies have been folded into pockets, so "cheapest first"
 * has to mean the cheapest COPY of each card rather than every copy in its own
 * right. Sorting the rows and then folding would put a card's position at the
 * mercy of which copy happened to survive.
 *
 * A–Z is the default because a binder is a thing you browse rather than
 * search, and the alphabet is the order everybody already knows how to use.
 */
export const BINDER_SORTS = [
  { key: "name", label: "A–Z" },
  { key: "name-desc", label: "Z–A" },
  { key: "value-desc", label: "Value — dearest first" },
  { key: "value-asc", label: "Value — cheapest first" },
  { key: "packed", label: "Order packed" }
];
export const DEFAULT_BINDER_SORT = "name";

/**
 * The one filter offered beside the search box.
 *
 * The desk's sticker and listing dropdowns are not here: "still sellable
 * online" says out loud that the card is on eBay, which invites a price-check
 * against the sticker in front of you, and "no sticker yet" is our word for a
 * job we have not done. This asks the same question in the customer's terms.
 */
export const BINDER_PRICE_FILTERS = [
  { key: "any", label: "Every card" },
  { key: "priced", label: "With a price on" },
  { key: "ask", label: "Ask at the table" }
];

/** How far a thumb must travel across before it counts as a page turn. */
export const SWIPE_MIN_PX = 48;

/**
 * Which card this row is a copy OF, or "" when we cannot say.
 *
 * The identity is the customer-facing name, which `counterName()` has already
 * cut to the card and its collector number — "Pokemon Card Gengar VMAX 020/198
 * Chilling Reign Ultra Rare NM" and "Gengar VMAX 020/198 (Chilling Reign)"
 * both come out as "gengar vmax 020 198", which is exactly the pair we want in
 * one pocket.
 *
 * **An unnameable row gets no identity, and that is the important half.** A
 * checkout with no title is a SKU nobody has matched to a card yet; there may
 * be several, they are certainly not the same card as each other, and merging
 * them would hide real stock behind a pocket labelled "Card". The grouper
 * gives each of those a key of its own.
 */
export function binderKey(co) {
  if (!normalise(co?.title)) return "";
  const key = normalise(counterName(co.title));
  // "card" is counterName()'s own fallback for a title it stripped to nothing,
  // so it is the absence of a name rather than a name.
  return key === "card" ? "" : key;
}

/** The sticker on one physical copy, in pence, or null. */
function penceOf(co) {
  if (!hasSticker(co)) return null;
  const n = Math.round(Number(co.sticker_pence));
  return n > 0 ? n : null;
}

/**
 * One physical copy, as the preview may show it.
 *
 * The id is here so the desk can resolve this copy back to its own row on a
 * tap — see copyLocations(). It carries no picture: every copy of a card in
 * one pocket shares the pocket's, and a listing photo per copy would be four
 * near-identical thumbnails answering a question nobody asked.
 */
export function binderCopy(co) {
  const pence = penceOf(co);
  return {
    id: co?.id ?? null,
    condition: conditionOf(co),
    pricePence: pence,
    priceText: counterPrice(pence)
  };
}

/** Cheapest priced copy first, unpriced last, packing order breaking ties. */
function byPrice(a, b) {
  const x = penceOf(a);
  const y = penceOf(b);
  if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
  return x - y;
}

/**
 * The rows folded into pockets, still carrying their checkouts.
 *
 * Internal on purpose: the group knows the packing order and the copies'
 * source rows, neither of which belongs on a projected pocket. Ordering
 * happens on THESE, and only what survives pocketOf() reaches a screen.
 */
function groupCopies(rows) {
  const groups = new Map();
  const order = [];
  (rows || []).filter(Boolean).forEach((co, i) => {
    const key = binderKey(co) || `#${co?.id ?? i}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: counterName(co?.title), order: i, rows: [] };
      groups.set(key, g);
      order.push(g);
    }
    g.rows.push(co);
  });
  for (const g of order) {
    g.rows = g.rows.slice().sort((a, b) => byPrice(a, b) || 0);
    g.minPence = penceOf(g.rows[0]);
    g.sortName = normalise(g.name);
  }
  return order;
}

/**
 * One pocket. Built key by key — do not be tempted to spread the checkout and
 * delete the private parts; see the file header for why that direction fails
 * silently.
 *
 * The headline price is the CHEAPEST copy, because that is the number a
 * customer can actually have the card for, and `priceFrom` says when there is
 * a dearer one behind it so the screen can write "from £40" rather than
 * quoting one copy's price for all of them.
 */
export function pocketOf(group, { images } = {}) {
  const rows = group?.rows || [];
  const lead = rows[0];
  const priced = rows.map(penceOf).filter((p) => p != null);
  const art = counterImage(lead, images) || rows.map((co) => counterImage(co, images)).find(Boolean) || null;
  const pence = priced.length > 0 ? priced[0] : null;
  return {
    key: group?.key ?? null,
    name: group?.name || counterName(lead?.title),
    condition: conditionOf(lead),
    pricePence: pence,
    priceText: counterPrice(pence),
    // True whenever the headline does not cover every copy: a dearer one
    // behind it, or one with no price at all.
    priceFrom: rows.length > 1 && priced.length > 0 && (priced[priced.length - 1] !== pence || priced.length < rows.length),
    image: imageAt(art, POCKET_PX),
    imageLarge: imageAt(art, PREVIEW_PX),
    count: rows.length,
    copies: rows.map(binderCopy)
  };
}

const BINDER_COMPARATORS = {
  name: (a, b) => (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0),
  "name-desc": (a, b) => (a.sortName < b.sortName ? 1 : a.sortName > b.sortName ? -1 : 0),
  // A card with no price sorts last whichever way the column runs — the same
  // rule showfilter.js uses for stickers. Treating it as £0 would head the
  // cheapest-first binder with the cards nobody has priced, which is the
  // opposite of what that order is for.
  "value-desc": (a, b) => {
    if (a.minPence == null || b.minPence == null) return (a.minPence == null ? 1 : 0) - (b.minPence == null ? 1 : 0);
    return b.minPence - a.minPence;
  },
  "value-asc": (a, b) => {
    if (a.minPence == null || b.minPence == null) return (a.minPence == null ? 1 : 0) - (b.minPence == null ? 1 : 0);
    return a.minPence - b.minPence;
  },
  packed: () => 0
};

/** Does this pocket pass the price filter? */
function matchesPrice(group, price = "any") {
  if (!price || price === "any") return true;
  const has = group.minPence != null;
  return price === "priced" ? has : !has;
}

/** Is anything actually narrowing the binder? Drives the "showing x of y" line. */
export function isFiltering({ query = "", price = "any" } = {}) {
  return Boolean(normalise(query) || (price && price !== "any"));
}

/**
 * The binder as it should appear, plus what it took to get there.
 *
 * `folded` is the number of extra copies that went into pockets behind the one
 * on the front. Handed back rather than left to be worked out, for the same
 * reason showView() hands back `hidden` and the pricing engine hands back its
 * exclusion count: a card folded away silently looks exactly like a card that
 * was never packed.
 */
export function binderView(rows, criteria = {}, { images } = {}) {
  const all = (rows || []).filter(Boolean);
  const matched = all.filter((co) => matchesQuery(co, criteria.query));
  const groups = groupCopies(matched).filter((g) => matchesPrice(g, criteria.price));
  const cmp = BINDER_COMPARATORS[criteria.sort] || BINDER_COMPARATORS[DEFAULT_BINDER_SORT];
  // The packing order is the final tie-break, so equal pockets keep the order
  // they arrived in and the binder never reshuffles under a thumb between
  // renders on the same data.
  const sorted = groups.slice().sort((a, b) => cmp(a, b) || a.order - b.order);
  const cards = sorted.map((g) => pocketOf(g, { images }));
  const copies = sorted.reduce((n, g) => n + g.rows.length, 0);
  return {
    cards,
    pages: binderPages(cards),
    pageCount: Math.ceil(cards.length / BINDER_PAGE),
    cardCount: cards.length,
    folded: copies - cards.length,
    total: all.length,
    shown: copies,
    hidden: all.length - copies,
    filtering: isFiltering(criteria)
  };
}

/**
 * The pockets cut into pages, the last one padded with empties.
 *
 * The padding is not decoration. A last page that reflowed to fit three cards
 * would resize every pocket on it, so the card you were about to point at
 * jumps as you turn onto it — and an empty pocket is what a real binder shows
 * anyway.
 */
export function binderPages(cards, size = BINDER_PAGE) {
  const list = (cards || []).filter(Boolean);
  const pages = [];
  for (let i = 0; i < list.length; i += size) {
    const page = list.slice(i, i + size);
    while (page.length < size) page.push(null);
    pages.push(page);
  }
  return pages;
}

/** A page index that exists, however the binder just changed under it. */
export function clampPage(page, pageCount) {
  const last = Math.max(0, (Number(pageCount) || 0) - 1);
  const n = Number.isFinite(Number(page)) ? Math.trunc(Number(page)) : 0;
  return Math.min(Math.max(0, n), last);
}

/** Turning a page. A binder does not wrap: the last page is the last page. */
export function turnPage(page, dir, pageCount) {
  return clampPage(clampPage(page, pageCount) + (dir === "next" ? 1 : dir === "prev" ? -1 : 0), pageCount);
}

/**
 * What a drag across the binder meant, if anything.
 *
 * **The vertical test is the one that matters.** The binder sits in a page you
 * scroll, so a thumb moving mostly down is scrolling and must never turn a
 * page — the cost of getting that wrong is a customer who cannot read past the
 * first page without the binder flipping under them. A drag has to be mostly
 * horizontal AND far enough to be deliberate.
 *
 * Swipe left for the next page, the direction the paper goes.
 */
export function swipeDirection(dx, dy, { threshold = SWIPE_MIN_PX } = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (Math.abs(x) < threshold) return null;
  if (Math.abs(x) <= Math.abs(y)) return null;
  return x < 0 ? "next" : "prev";
}

/**
 * Where each copy in a pocket physically is — asked for, never volunteered.
 *
 * **A card in the binder is a card in the BOX.** It has been checked out, so
 * it has no live position in a stack: stackpos.js gives it none on purpose,
 * and quoting the position it USED to hold would send somebody counting to the
 * wrong card on a shelf it isn't on. This is a different question from the one
 * the online rows ask, not a second answer to it. What actually finds a card
 * in a box at a show is the SKU written on its sleeve, and the stack it left
 * says which box it was packed out of.
 *
 * `rowsById` is the DESK's own map of its own checkout rows. The pocket
 * carries an id and nothing else — putting the SKU on it to make this lookup
 * easier is exactly the shortcut the allow-list exists to refuse — so the desk
 * resolves the id back to the row it already holds, on a tap.
 *
 * A copy we cannot place gets `null` rather than a guess: "not somewhere I can
 * send you" is a different statement from "we have not got one", and at a
 * table the difference is a sale.
 */
export function placeOf(co) {
  const sku = String(co?.sku || "").trim();
  const stack = String(co?.stack_name || "").trim();
  if (!sku) return stack ? `from ${stack}` : null;
  return stack ? `${sku} · from ${stack}` : sku;
}

export function copyLocations(card, { rowsById } = {}) {
  const rows = rowsById instanceof Map ? rowsById : new Map(Object.entries(rowsById || {}));
  return (card?.copies || []).map((c) => ({
    id: c?.id ?? null,
    location: c?.id == null ? null : placeOf(rows.get(String(c.id)))
  }));
}

export { ASK_TEXT };
