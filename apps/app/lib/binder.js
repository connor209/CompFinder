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
 * **The eBay stock is a SECOND SECTION, and a page is never half of each.**
 * The counter list keeps online stock under its own heading and never merges
 * it, because a card that might be at home is not a card you can put in
 * somebody's hand — and the top list is the only one anybody can act on. A
 * binder has no headings to hang that on, so the rule is carried by the PAGE:
 * the box fills whole pages first, the last one padded, and the online stock
 * starts on a fresh page. Each section is paginated on its own, which is what
 * makes a mixed page unrepresentable rather than merely avoided. The page
 * header names which one you are on, and an online pocket carries the mark as
 * well, because one pocket photographed on its own has no header.
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
import { counterName, conditionOf, counterPrice, counterImage, imageAt, inBoxSkus, ASK_TEXT } from "./showcounter.js";
import { isListingAvailable } from "./stockcheck.js";

/**
 * Where a pocket's card can be got from, and the two answers are not
 * interchangeable: one is in the box on the table, the other is a listing that
 * may be at home. See the file header — they never share a page.
 */
export const BOX = "box";
export const ONLINE = "online";

/**
 * What each section says for itself.
 *
 * The online wording says "ask", never "not here", and that is load-bearing
 * rather than polite: not everything that travels to a show gets checked out,
 * so a card can be in the box AND absent from the box section — and telling a
 * customer we haven't got it, while it sits in the box, loses a sale already
 * made. What we know is that we own one; whether it is in the room is a
 * question for the person at the table.
 */
export const SECTION_LABELS = {
  [BOX]: { title: "In the box", note: "Here at the table — ask and it's yours." },
  [ONLINE]: { title: "Also in our stock", note: "Some travel with us, some are at home. Ask and we'll check." }
};

/** Which stock the binder is showing. */
export const BINDER_SCOPES = [
  { key: "all", label: "Everything we have" },
  { key: BOX, label: "Only what's in the box" },
  { key: ONLINE, label: "Only what's listed online" }
];
/**
 * Both, box first. The binder exists because table space is the cap on what
 * anybody can see, and half our stock being at home is the bigger half of that
 * cap — a binder that stopped at the box would be a prettier version of the
 * list it replaces.
 */
export const DEFAULT_SCOPE = "all";

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
  "key", "source", "name", "condition", "pricePence", "priceText", "priceFrom",
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

/**
 * One thing that can go in a pocket, from either source, in one shape.
 *
 * Everything below this point works on ITEMS rather than on checkout rows or
 * eBay listings, and these two functions are the only place the difference
 * exists. That is deliberate: a second grouping path for the online stock
 * would eventually disagree with this one about what counts as the same card,
 * and the disagreement shows up as a customer being told we have one of
 * something we have four of.
 *
 * They are also the allow-list. A field that is not read here cannot reach a
 * pocket, whatever gets added to `stock_checkouts` or `ebay_listings` later.
 */
export function boxItem(co, images) {
  const pence = hasSticker(co) ? Math.round(Number(co.sticker_pence)) : null;
  return {
    id: co?.id ?? null,
    source: BOX,
    title: co?.title ?? "",
    condition: conditionOf(co),
    pence: pence != null && pence > 0 ? pence : null,
    art: counterImage(co, images)
  };
}

/**
 * A live listing as a pocket item.
 *
 * The price is eBay's, unconverted, which is the right number for a card that
 * would be POSTED — the fees and the postage baked into it are costs a posted
 * sale really does pay — and the section this lands in says as much.
 *
 * The id is the eBay item id, the same handle the counter list's online rows
 * carry, and the SKU is deliberately not read: that is our shelf address, and
 * the desk looks it up on a tap out of state it already holds.
 *
 * One item per LISTING. A quantity-3 listing is three physical cards (see
 * copyqueue.js) and shows here as one — which is honest enough in a section
 * whose whole promise is "ask and we'll check", and better than a count this
 * file would have to guess at.
 */
export function onlineItem(l) {
  const pounds = Number(l?.price_value);
  const pence = Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null;
  return {
    id: l?.ebay_item_id || l?.id || null,
    source: ONLINE,
    title: l?.title ?? "",
    condition: conditionOf(l),
    pence,
    art: l?.image_url || null
  };
}

/**
 * The listings a binder may show: still sellable, and not already in the box.
 *
 * Both halves cost cards if you get them wrong. **A sold card is still a row
 * in `ebay_listings`** — eBay's out-of-stock control leaves a sold fixed-price
 * listing in the ActiveList with the quantity zeroed — so `isListingAvailable()`
 * is the one definition of whether there is anything left to sell, and a
 * MISSING quantity is silence rather than a zero, or real stock disappears.
 * And a card checked out with its listing left live is in both sets: shown in
 * both sections it reads as two copies, so the box wins, because the box is
 * the one you can act on.
 *
 * Returns the listing rows rather than items, so the search can still read the
 * SKU off them — you type what you know, and what you type is not what a
 * customer reads.
 */
export function onlineStock(listings, { inBox } = {}) {
  const skip = inBox instanceof Set ? inBox : new Set(inBox || []);
  const seen = new Set();
  const out = [];
  for (const l of listings || []) {
    if (!isListingAvailable(l)) continue;
    const key = l?.sku ? String(l.sku).toLowerCase() : "";
    if (key && (skip.has(key) || seen.has(key))) continue;
    if (key) seen.add(key);
    out.push(l);
  }
  return out;
}

/** What one copy costs, in pence, or null. */
function penceOf(item) {
  const n = item?.pence;
  return n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n));
}

/**
 * One copy, as the preview may show it.
 *
 * The id is here so the desk can resolve this copy back to its own row on a
 * tap — see copyLocations(). It carries no picture: every copy of a card in
 * one pocket shares the pocket's, and a photo per copy would be four
 * near-identical thumbnails answering a question nobody asked.
 */
export function binderCopy(item) {
  const pence = penceOf(item);
  return {
    id: item?.id ?? null,
    condition: item?.condition ?? null,
    pricePence: pence,
    priceText: counterPrice(pence)
  };
}

/** Cheapest priced copy first, unpriced last, source order breaking ties. */
function byPrice(a, b) {
  const x = penceOf(a);
  const y = penceOf(b);
  if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
  return x - y;
}

/**
 * The items folded into pockets, still carrying the items themselves.
 *
 * Internal on purpose: the group knows the arrival order and its own items,
 * neither of which belongs on a projected pocket. Ordering happens on THESE,
 * and only what survives pocketOf() reaches a screen.
 */
function groupItems(items) {
  const groups = new Map();
  const order = [];
  (items || []).filter(Boolean).forEach((item, i) => {
    const key = binderKey(item) || `#${item?.id ?? i}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, source: item.source, name: counterName(item?.title), order: i, items: [] };
      groups.set(key, g);
      order.push(g);
    }
    g.items.push(item);
  });
  for (const g of order) {
    g.items = g.items.slice().sort((a, b) => byPrice(a, b) || 0);
    g.minPence = penceOf(g.items[0]);
    g.sortName = normalise(g.name);
  }
  return order;
}

/**
 * One pocket. Built key by key — do not be tempted to spread the source row
 * and delete the private parts; see the file header for why that direction
 * fails silently.
 *
 * The headline price is the CHEAPEST copy, because that is the number a
 * customer can actually have the card for, and `priceFrom` says when there is
 * a dearer one behind it so the screen can write "from £40" rather than
 * quoting one copy's price for all of them.
 */
export function pocketOf(group) {
  const items = group?.items || [];
  const lead = items[0];
  const priced = items.map(penceOf).filter((p) => p != null);
  const art = items.map((i) => i?.art).find(Boolean) || null;
  const pence = priced.length > 0 ? priced[0] : null;
  return {
    key: group?.key ?? null,
    source: group?.source ?? BOX,
    name: group?.name || counterName(lead?.title),
    condition: lead?.condition ?? null,
    pricePence: pence,
    priceText: counterPrice(pence),
    // True whenever the headline does not cover every copy: a dearer one
    // behind it, or one with no price at all.
    priceFrom: items.length > 1 && priced.length > 0 && (priced[priced.length - 1] !== pence || priced.length < items.length),
    image: imageAt(art, POCKET_PX),
    imageLarge: imageAt(art, PREVIEW_PX),
    count: items.length,
    copies: items.map(binderCopy)
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

/**
 * One section of the binder: its items grouped into pockets and ordered.
 *
 * Each section is built and sorted on its own, which is what stops "cheapest
 * first" interleaving a card at home with a card on the table.
 */
function sectionOf(items, criteria = {}) {
  const groups = groupItems(items).filter((g) => matchesPrice(g, criteria.price));
  const cmp = BINDER_COMPARATORS[criteria.sort] || BINDER_COMPARATORS[DEFAULT_BINDER_SORT];
  // The arrival order is the final tie-break, so equal pockets keep the order
  // they came in and the binder never reshuffles under a thumb between renders
  // on the same data.
  const sorted = groups.slice().sort((a, b) => cmp(a, b) || a.order - b.order);
  const copies = sorted.reduce((n, g) => n + g.items.length, 0);
  return { cards: sorted.map(pocketOf), copies, folded: copies - sorted.length };
}

/** Is anything actually narrowing the binder? Drives the "showing x of y" line. */
export function isFiltering({ query = "", price = "any", scope = DEFAULT_SCOPE } = {}) {
  return Boolean(normalise(query) || (price && price !== "any") || (scope && scope !== DEFAULT_SCOPE));
}

/**
 * The binder as it should appear, plus what it took to get there.
 *
 * `folded` is the number of extra copies that went into pockets behind the one
 * on the front. Handed back rather than left to be worked out, for the same
 * reason showView() hands back `hidden` and the pricing engine hands back its
 * exclusion count: a card folded away silently looks exactly like a card that
 * was never packed.
 *
 * **The two sections are paginated separately and then concatenated**, which
 * is the whole of the never-merged rule: a page belongs to one section or the
 * other because the pages were cut that way, not because something remembered
 * to check. `pageKinds` says which, parallel to `pages`.
 */
export function binderView(checkouts, criteria = {}, { images, listings } = {}) {
  const scope = criteria.scope || DEFAULT_SCOPE;
  const boxRows = (checkouts || []).filter(Boolean);
  const onlineRows = onlineStock(listings, { inBox: inBoxSkus(boxRows) });

  const matchedBox = scope === ONLINE ? [] : boxRows.filter((co) => matchesQuery(co, criteria.query));
  const matchedOnline = scope === BOX ? [] : onlineRows.filter((l) => matchesQuery(l, criteria.query));

  const box = sectionOf(matchedBox.map((co) => boxItem(co, images)), criteria);
  const online = sectionOf(matchedOnline.map(onlineItem), criteria);

  const boxPages = binderPages(box.cards);
  const onlinePages = binderPages(online.cards);
  const shown = box.copies + online.copies;
  const total = boxRows.length + onlineRows.length;
  return {
    cards: [...box.cards, ...online.cards],
    pages: [...boxPages, ...onlinePages],
    pageKinds: [...boxPages.map(() => BOX), ...onlinePages.map(() => ONLINE)],
    pageCount: boxPages.length + onlinePages.length,
    cardCount: box.cards.length + online.cards.length,
    folded: box.folded + online.folded,
    box: { cardCount: box.cards.length, copies: box.copies, folded: box.folded, pages: boxPages.length },
    online: { cardCount: online.cards.length, copies: online.copies, folded: online.folded, pages: onlinePages.length },
    total,
    shown,
    hidden: total - shown,
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

/** Nine empty pockets — the facing page at the end of a section. */
export const BLANK_PAGE = Object.freeze(new Array(BINDER_PAGE).fill(null));

/**
 * Pages paired the way an open binder shows them, and NEVER across a section
 * boundary.
 *
 * A desk has room for both halves of an open binder; a phone does not. What
 * must not change between the two is the page NUMBER — "it's on page four" is
 * the whole reason a page is a fixed nine — so the pairing is a way of
 * DISPLAYING pages, never a second way of cutting them. Pages 3 and 4 are the
 * same nine cards each on every device; a wide screen just shows them at once.
 *
 * The section rule survives the same way. An open binder showing a box page
 * facing an online page is exactly the merge this design exists to prevent,
 * and worse than the list version because the reader cannot tell which side
 * the header is talking about. So a section's last spread is allowed to sit
 * on its own with a blank facing page — which is what a real binder does at
 * the end of a run, and cheaper than padding the pagination, since padding
 * would shift every later page number on wide screens only.
 */
export function binderSpreads(pageKinds) {
  const kinds = pageKinds || [];
  const out = [];
  let i = 0;
  while (i < kinds.length) {
    const pairs = i + 1 < kinds.length && kinds[i + 1] === kinds[i];
    out.push(pairs ? [i, i + 1] : [i]);
    i += pairs ? 2 : 1;
  }
  return out;
}

/** Which spread a page falls in, or 0 when there are none. */
export function spreadIndexOf(spreads, page) {
  const list = spreads || [];
  const at = list.findIndex((s) => s.includes(page));
  return at < 0 ? 0 : at;
}

/** Turning a spread. Lands on the left-hand page of the next one along. */
export function turnSpread(spreads, page, dir) {
  const list = spreads || [];
  if (list.length === 0) return 0;
  const at = spreadIndexOf(list, page);
  const next = Math.min(Math.max(0, at + (dir === "next" ? 1 : dir === "prev" ? -1 : 0)), list.length - 1);
  return list[next][0];
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
 * **The two sections are asked different questions, and that is the point.**
 *
 * A card in the BOX has been checked out, so it has no live position in a
 * stack: stackpos.js gives it none on purpose, and quoting the position it
 * used to hold would send somebody counting to the wrong card on a shelf it
 * isn't on. What finds it is the SKU written on its sleeve, and the stack it
 * left says which box it was packed out of.
 *
 * A card that is only LISTED is still in its stack, so it has a real live
 * position and that is the useful answer — the same one the counter list's
 * online rows give. Note it is where the card lives at HOME, which is only
 * where you can walk to it if that stack travelled.
 *
 * Every map here is the DESK's, of its own rows. The pocket carries an id and
 * nothing else — putting the SKU on it to make this lookup easier is exactly
 * the shortcut the allow-list exists to refuse.
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

export function copyLocations(card, { rowsById, skuByListing, locations } = {}) {
  const asMap = (m) => (m instanceof Map ? m : new Map(Object.entries(m || {})));
  const rows = asMap(rowsById);
  const skus = asMap(skuByListing);
  const where = asMap(locations);
  const online = card?.source === ONLINE;
  return (card?.copies || []).map((c) => {
    if (c?.id == null) return { id: null, location: null };
    if (online) {
      const sku = skus.get(String(c.id));
      return { id: c.id, location: (sku && where.get(String(sku).toLowerCase())) || null };
    }
    return { id: c.id, location: placeOf(rows.get(String(c.id))) };
  });
}

export { ASK_TEXT };
