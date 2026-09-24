/**
 * Comp Finder — the storefront: the binder, on a stranger's phone.
 *
 * The binder (binder.js) is the show stock laid out nine to a page for a
 * customer, and it works — but only while the tablet is in their hands. A
 * table has room for one conversation at a time and a box of cards nobody can
 * see. This is the same binder behind a QR on the table: somebody waiting, or
 * browsing the next table along, flips through the box on their own phone and
 * points at what they want.
 *
 * **This is the app's first anonymous surface**, and that is what shapes the
 * file. On the Show Desk the allow-list runs in a browser that is already
 * logged in and already holds every checkout row, SKUs and all — the pocket is
 * an allow-list so the SCREEN cannot show a private field. Here the rows never
 * reach the browser at all. The server builds the binder, projects it through
 * `storefrontCard()`, and ships that and nothing else, so a private field is
 * not hidden from a stranger, it is absent from anything they could download.
 *
 * Three things the desk's pocket carries that a stranger's does not:
 *
 * - **Copy ids.** A box copy's id is its `stock_checkouts` uuid, useless to a
 *   visitor. A listed copy's id is its eBay ITEM ID, and `ebay.co.uk/itm/<id>`
 *   is the listing — the same "buy it online instead of from the table you are
 *   standing at" that showcounter.js keeps the listing URL off the counter for.
 * - **The group key.** An unnameable row is keyed `#<id>`, which is the same
 *   leak one field over. A storefront card is keyed by source and position.
 * - **Anything the desk resolves on a tap.** Where a copy is (placeOf(),
 *   locationsBySku()) is ours; there is no tap here that could ask for it.
 *
 * `binderView()` is still what builds the pockets, rather than a second
 * grouping here. Two definitions of "the same card" would eventually disagree,
 * and it shows up as a stranger being told we have one of something we have
 * four of.
 *
 * Framework-free and app-import-free on purpose, so scripts/check-storefront.mjs
 * can load it under bare node.
 */
import { normalise } from "./showfilter.js";
import { counterPrice } from "./showcounter.js";
import { binderView, binderPages, binderKey, BOX, ONLINE, SECTION_LABELS, ASK_TEXT } from "./binder.js";

export { BOX, ONLINE, SECTION_LABELS, ASK_TEXT };

/**
 * Every key a storefront card may carry, and every key one of its copies may
 * carry. check-storefront.mjs asserts the projection produces exactly these,
 * so adding one is a deliberate act with a test behind it.
 */
export const STOREFRONT_FIELDS = [
  "key", "source", "name", "set", "condition", "pricePence", "priceText", "priceFrom",
  "image", "imageLarge", "count", "copies"
];
export const STOREFRONT_COPY_FIELDS = ["condition", "pricePence", "priceText"];

/**
 * How a visitor can order the binder.
 *
 * binder.js's list minus "Order packed", which is how WE packed the box — it
 * means nothing to a stranger, and the server has already put everything in
 * A–Z before it leaves.
 */
export const STOREFRONT_SORTS = [
  { key: "name", label: "A–Z" },
  { key: "name-desc", label: "Z–A" },
  { key: "value-desc", label: "Dearest first" },
  { key: "value-asc", label: "Cheapest first" }
];
export const DEFAULT_STOREFRONT_SORT = "name";

/**
 * The price filter, in a visitor's words: bands a pocket's CHEAPEST copy falls
 * in, plus the cards with no price at all. A band is judged on the headline
 * figure because that is the number on the pocket — filtering "under £5" and
 * showing a pocket reading "from £4" is right; showing one reading "£6" is not.
 */
export const STOREFRONT_PRICE_FILTERS = [
  { key: "any", label: "Any price" },
  { key: "u5", label: "Under £5", min: 0, max: 499 },
  { key: "5-20", label: "£5–£20", min: 500, max: 2000 },
  { key: "20-50", label: "£20–£50", min: 2001, max: 5000 },
  { key: "50-100", label: "£50–£100", min: 5001, max: 10000 },
  { key: "100+", label: "£100+", min: 10001, max: Infinity },
  { key: "priced", label: "With a price on" },
  { key: "ask", label: "Ask at the table" }
];

/** Does a card pass the price filter? */
export function priceMatches(card, key = "any") {
  const p = card?.pricePence ?? null;
  if (!key || key === "any") return true;
  if (key === "priced") return p != null;
  if (key === "ask") return p == null;
  const band = STOREFRONT_PRICE_FILTERS.find((f) => f.key === key);
  if (!band || band.min == null) return true;
  return p != null && p >= band.min && p <= band.max;
}

/** Which stock is on screen. Only offered when the link carries both. */
export const STOREFRONT_SCOPES = [
  { key: "all", label: "Everything" },
  { key: BOX, label: "At the table" },
  { key: ONLINE, label: "Also in stock" }
];

/** A price that is really a price, or null. */
function pence(n) {
  const v = n == null ? NaN : Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** One copy, as a stranger may see it: its condition and its price. */
export function storefrontCopy(copy) {
  const p = pence(copy?.pricePence);
  return {
    condition: copy?.condition ?? null,
    pricePence: p,
    priceText: counterPrice(p)
  };
}

/**
 * One binder pocket, as a stranger may see it.
 *
 * Built key by key from the pocket rather than spread from it — the pocket is
 * already an allow-list, but it is an allow-list for a screen WE hold, and it
 * carries ids that are fine there and not here. See the file header.
 */
export function storefrontCard(pocket, index, set = null) {
  const source = pocket?.source === ONLINE ? ONLINE : BOX;
  const copies = Array.isArray(pocket?.copies) ? pocket.copies.map(storefrontCopy) : [];
  const p = pence(pocket?.pricePence);
  return {
    key: `${source}-${Number.isInteger(index) ? index : 0}`,
    source,
    name: String(pocket?.name || "Card"),
    set: set ? String(set) : null,
    condition: pocket?.condition ?? null,
    pricePence: p,
    priceText: counterPrice(p),
    priceFrom: Boolean(pocket?.priceFrom),
    image: pocket?.image || null,
    imageLarge: pocket?.imageLarge || null,
    count: copies.length || 1,
    copies
  };
}

/**
 * sku -> the eBay photo of THAT copy.
 *
 * The same map the Show Desk builds in load(), and for the same reason: a
 * checkout row has no picture of its own, and the listing it was checked out
 * of does. Catalogue art is deliberately never the fallback — it would show a
 * mint scan of a played card to the person about to buy it.
 */
export function imagesBySku(listings) {
  const map = new Map();
  for (const l of listings || []) {
    if (l?.sku && l?.image_url) map.set(String(l.sku).toLowerCase(), l.image_url);
  }
  return map;
}

/**
 * The whole storefront, built on the SERVER from rows a stranger never sees.
 *
 * Returns projected cards only. Everything that crosses to the browser comes
 * out of this function, which is why check-storefront.mjs stuffs the rows it
 * is handed with every private value the app knows and searches the result.
 */
export function storefrontStock(checkouts, listings, { includeOnline = true, setOf = null } = {}) {
  const sets = setsByKey(checkouts, includeOnline ? listings : [], listings, setOf);
  const view = binderView(
    checkouts || [],
    { sort: DEFAULT_STOREFRONT_SORT, scope: includeOnline ? "all" : BOX },
    { images: imagesBySku(listings), listings: includeOnline ? listings || [] : [] }
  );
  const cards = view.cards.map((pocket, i) => storefrontCard(pocket, i, sets.get(`${pocket.source}|${pocket.key}`) || null));
  return {
    cards,
    box: cards.filter((c) => c.source === BOX).length,
    online: cards.filter((c) => c.source === ONLINE).length
  };
}

/**
 * Which set each pocket is in, read off the titles on the SERVER.
 *
 * The set is the part of a title counterName() cuts away — "Gengar VMAX
 * 020/198 Chilling Reign" becomes "Gengar VMAX 020/198" — so it has to be read
 * before the projection, from the rows a stranger never sees, and handed over
 * as a plain name. Keyed the way binder.js groups (binderKey), so the pocket
 * and its set are the same card by construction.
 *
 * A checkout's own title often omits the set where its listing carries it, so
 * a box row falls back to the title on the listing it was checked out of. The
 * first copy that names a set answers for the pocket; a card nothing names
 * gets no set, and "All sets" still shows it.
 */
function setsByKey(checkouts, onlineListings, allListings, setOf) {
  const out = new Map();
  if (typeof setOf !== "function") return out;
  const listingTitle = new Map();
  for (const l of allListings || []) {
    if (l?.sku && l?.title) listingTitle.set(String(l.sku).toLowerCase(), l.title);
  }
  const note = (source, title, fallbackTitle) => {
    const key = binderKey({ title });
    if (!key) return;
    const id = `${source}|${key}`;
    if (out.has(id)) return;
    const hit = setOf(title) || (fallbackTitle ? setOf(fallbackTitle) : null);
    if (hit?.name) out.set(id, hit.name);
  };
  for (const co of checkouts || []) {
    note(BOX, co?.title, co?.sku ? listingTitle.get(String(co.sku).toLowerCase()) : null);
  }
  for (const l of onlineListings || []) note(ONLINE, l?.title, null);
  return out;
}

/**
 * The options a visitor can narrow by, built from the cards themselves so an
 * option that finds nothing is never offered — the same rule the desk's event
 * and stack dropdowns follow. Counted, and sorted A–Z.
 */
export function storefrontFacets(cards) {
  const sets = new Map();
  const conditions = new Map();
  for (const c of cards || []) {
    if (!c) continue;
    if (c.set) sets.set(c.set, (sets.get(c.set) || 0) + 1);
    const conds = new Set([c.condition, ...(c.copies || []).map((cp) => cp?.condition)].filter(Boolean));
    for (const k of conds) conditions.set(k, (conditions.get(k) || 0) + 1);
  }
  const list = (m) => [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  return { sets: list(sets), conditions: list(conditions) };
}

/** Does a card have a copy in this condition? A pocket can hold an NM and an LP. */
export function conditionMatches(card, condition) {
  if (!condition) return true;
  if (card?.condition === condition) return true;
  return (card?.copies || []).some((cp) => cp?.condition === condition);
}

const COMPARATORS = {
  name: (a, b) => (a._n < b._n ? -1 : a._n > b._n ? 1 : 0),
  "name-desc": (a, b) => (a._n < b._n ? 1 : a._n > b._n ? -1 : 0),
  // An unpriced card sorts last whichever way the column runs — the rule
  // binder.js and showfilter.js both follow. Treating it as £0 would open the
  // cheapest-first binder on the cards nobody has priced.
  "value-desc": (a, b) => {
    if (a.pricePence == null || b.pricePence == null) return (a.pricePence == null ? 1 : 0) - (b.pricePence == null ? 1 : 0);
    return b.pricePence - a.pricePence;
  },
  "value-asc": (a, b) => {
    if (a.pricePence == null || b.pricePence == null) return (a.pricePence == null ? 1 : 0) - (b.pricePence == null ? 1 : 0);
    return a.pricePence - b.pricePence;
  }
};

/**
 * Does this card match what the visitor typed?
 *
 * The name (which carries the collector number) and the set — both on the
 * card a visitor is looking at. The desk's search
 * also looks at the SKU, the event and the stack — none of which a stranger
 * has, and none of which is on the card any more, which is the point.
 */
export function cardMatches(card, query) {
  const tokens = normalise(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = normalise([card?.name, card?.set].filter(Boolean).join(" "));
  return tokens.every((t) => hay.includes(t));
}

/**
 * The storefront as it should appear, in the BROWSER, over projected cards.
 *
 * The same two rules as binderView(), because it is the same binder: each
 * section is sorted and paginated on its own and the pages concatenated, so a
 * page is never half box and half online; and a page is nine pockets, the last
 * one padded, so "it's on page four" means the same thing on every phone.
 */
export function storefrontView(cards, { query = "", sort = DEFAULT_STOREFRONT_SORT, price = "any", scope = "all", set = "", condition = "" } = {}) {
  const cmp = COMPARATORS[sort] || COMPARATORS[DEFAULT_STOREFRONT_SORT];
  const keep = (c) =>
    cardMatches(c, query) &&
    priceMatches(c, price) &&
    (!set || c.set === set) &&
    conditionMatches(c, condition);
  const section = (source) => {
    if (scope !== "all" && scope !== source) return [];
    return (cards || [])
      .filter((c) => c && c.source === source && keep(c))
      .map((c, i) => ({ c, i, _n: normalise(c.name), pricePence: c.pricePence }))
      .sort((a, b) => cmp(a, b) || a.i - b.i)
      .map((x) => x.c);
  };
  const box = section(BOX);
  const online = section(ONLINE);
  const boxPages = binderPages(box);
  const onlinePages = binderPages(online);
  const total = (cards || []).filter(Boolean).length;
  return {
    pages: [...boxPages, ...onlinePages],
    pageKinds: [...boxPages.map(() => BOX), ...onlinePages.map(() => ONLINE)],
    pageCount: boxPages.length + onlinePages.length,
    box: box.length,
    online: online.length,
    shown: box.length + online.length,
    total,
    filtering: Boolean(normalise(query) || (price && price !== "any") || (scope && scope !== "all") || set || condition)
  };
}
