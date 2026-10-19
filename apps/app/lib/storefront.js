/**
 * Comp Finder — the storefront: our stock, on a stranger's phone.
 *
 * Somebody scans the QR on the table (or on a business card), sees our
 * dearest cards, and types what they are after. It used to be the Show
 * Desk's binder, nine to a page — and to page through a binder the browser
 * needs every card, so the first load shipped the WHOLE inventory, thousands
 * of cards with two picture URLs each, inline in the HTML, over venue wifi.
 * That was the slow part. Now the page opens on storefrontLanding() — a few
 * dozen cards and the filter options — and the search box asks the server for
 * storefrontSearch(), a page at a time.
 *
 * **This is the app's first anonymous surface**, and that is what shapes the
 * file. On the Show Desk the allow-list runs in a browser that is already
 * logged in and already holds every checkout row, SKUs and all — the pocket is
 * an allow-list so the SCREEN cannot show a private field. Here the rows never
 * reach the browser at all. The server builds the pockets, projects them
 * through `storefrontCard()`, and ships slices of that and nothing else, so a private field is
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
import { counterPrice, imageAt } from "./showcounter.js";
import { binderView, binderKey, BOX, ONLINE, SECTION_LABELS, ASK_TEXT } from "./binder.js";
import { gameOf, gameFacets, UNKNOWN_GAME } from "./games.js";
import { eraPlace, eraRank, eraLabel, isEra, setSearchWords, norm as setNorm, OTHER_ERA } from "./pokemon-eras.js";

/** The one game whose sets are grouped into eras. */
export const ERA_GAME = "pokemon";

export { BOX, ONLINE, SECTION_LABELS, ASK_TEXT };

/**
 * Every key a storefront card may carry, and every key one of its copies may
 * carry. check-storefront.mjs asserts the projection produces exactly these,
 * so adding one is a deliberate act with a test behind it.
 */
export const STOREFRONT_FIELDS = [
  "key", "source", "name", "set", "game", "condition", "pricePence", "priceText", "priceFrom",
  "image", "imageLarge", "count", "copies"
];
export const STOREFRONT_COPY_FIELDS = ["condition", "pricePence", "priceText"];

/**
 * How a visitor can order a search.
 *
 * binder.js's list minus "Order packed", which is how WE packed the box and
 * means nothing to a stranger. Dearest first by default, because the page
 * opens on our best cards and a search should read the same way.
 */
export const STOREFRONT_SORTS = [
  { key: "value-desc", label: "Dearest first" },
  { key: "value-asc", label: "Cheapest first" },
  { key: "name", label: "A–Z" },
  { key: "name-desc", label: "Z–A" }
];
export const DEFAULT_STOREFRONT_SORT = "value-desc";

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

/**
 * A shop link's wording. Same two sections — the never-merge rule holds,
 * since a card at a show this weekend is not one we can post today — but
 * named for somebody who is NOT standing at our table, and with the stock
 * that is at home first, because for them that is the stock.
 */
export const SHOP_SECTION_LABELS = {
  [BOX]: { title: "Out at a show", note: "On our table at a show right now — back in stock after." },
  [ONLINE]: { title: "In stock", note: "Ask us about any card and we'll check it for you." }
};
/**
 * The picture size a storefront pocket asks eBay for. A pocket is ~110px wide
 * on a phone, so 300 covers a 3x screen; the desk binder's 500 is nearly three
 * times the bytes, eighteen times over on the first screen, on venue wifi.
 * The 1600 one still opens on a tap.
 */
export const STOREFRONT_POCKET_PX = 300;

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
export function storefrontCard(pocket, index, set = null, game = null) {
  const source = pocket?.source === ONLINE ? ONLINE : BOX;
  const copies = Array.isArray(pocket?.copies) ? pocket.copies.map(storefrontCopy) : [];
  const p = pence(pocket?.pricePence);
  return {
    key: `${source}-${Number.isInteger(index) ? index : 0}`,
    source,
    name: String(pocket?.name || "Card"),
    set: set ? String(set) : null,
    game: game ? String(game) : UNKNOWN_GAME,
    condition: pocket?.condition ?? null,
    pricePence: p,
    priceText: counterPrice(p),
    priceFrom: Boolean(pocket?.priceFrom),
    image: imageAt(pocket?.image, STOREFRONT_POCKET_PX) || null,
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
 * Returns projected cards only. Nothing here goes to the browser whole any
 * more — storefrontLanding() and storefrontSearch() hand over a slice — but
 * every slice is cut from THIS, which is why check-storefront.mjs stuffs the
 * rows it is handed with every private value the app knows and searches the
 * result.
 *
 * `gameIndex` is buildSetGameIndex()'s, from the same catalogue read as the
 * set matcher. Without it a card is still read by its eBay category and its
 * title; what it loses is the set-name fallback.
 */
export function storefrontStock(checkouts, listings, { includeOnline = true, setOf = null, gameIndex = null, isPokemonSet = null } = {}) {
  const tags = tagsByKey(checkouts, includeOnline ? listings : [], listings, setOf, gameIndex, isPokemonSet);
  const view = binderView(
    checkouts || [],
    { sort: "name", scope: includeOnline ? "all" : BOX },
    { images: imagesBySku(listings), listings: includeOnline ? listings || [] : [] }
  );
  const cards = view.cards.map((pocket, i) => {
    const t = tags.get(`${pocket.source}|${pocket.key}`) || {};
    return storefrontCard(pocket, i, t.set || null, t.game || null);
  });
  return {
    cards,
    box: cards.filter((c) => c.source === BOX).length,
    online: cards.filter((c) => c.source === ONLINE).length
  };
}

/**
 * Which set and which GAME each pocket is, read off the titles on the SERVER.
 *
 * The set is the part of a title counterName() cuts away — "Gengar VMAX
 * 020/198 Chilling Reign" becomes "Gengar VMAX 020/198" — so it has to be read
 * before the projection, from the rows a stranger never sees, and handed over
 * as a plain name. Keyed the way binder.js groups (binderKey), so the pocket
 * and its tags are the same card by construction.
 *
 * The game is games.js's gameOf(), the reading the Show Desk's chips use, so a
 * stranger's "Pokémon" and ours are the same set of cards. A box row borrows
 * the eBay category of the listing it came out of, since a checkout has none.
 *
 * A checkout's own title often omits the set where its listing carries it, so
 * a box row falls back to the title on the listing it was checked out of. The
 * first copy that names a set answers for the pocket; a card nothing names
 * gets no set, and "All sets" still shows it.
 */
function tagsByKey(checkouts, onlineListings, allListings, setOf, gameIndex, isPokemonSet) {
  const out = new Map();
  const listingBySku = new Map();
  for (const l of allListings || []) {
    if (l?.sku) listingBySku.set(String(l.sku).toLowerCase(), l);
  }
  const note = (source, title, listing) => {
    const key = binderKey({ title });
    if (!key) return;
    const id = `${source}|${key}`;
    const cur = out.get(id) || {};
    if (!cur.game || cur.game === UNKNOWN_GAME) {
      const g = gameOf({ category: listing?.category, title }, gameIndex);
      cur.game = g !== UNKNOWN_GAME || !listing?.title ? g : gameOf({ category: listing.category, title: listing.title }, gameIndex);
    }
    if (!cur.set && typeof setOf === "function") {
      // Inside the card's own game when we know it — see matchCanonical().
      const g = cur.game && cur.game !== UNKNOWN_GAME ? cur.game : "";
      const hit = setOf(title, g) || (listing?.title && listing.title !== title ? setOf(listing.title, g) : null);
      if (hit?.name) cur.set = hit.name;
    }
    // A Wizards-era title rarely says "Pokémon", and its set says nothing to
    // gameOf(): "Jungle" is one word and "Base Set" is a name other games
    // use too. So those cards read as unidentified and their sets never
    // reached the Pokémon picker. A set the catalogue holds for Pokémon AND
    // that the era table places is enough — asked only of a card nothing else
    // identified, so a title that names its game is never overruled.
    if (cur.game === UNKNOWN_GAME && cur.set && typeof isPokemonSet === "function" &&
        isPokemonSet(cur.set) && eraPlace(cur.set).era !== OTHER_ERA) {
      cur.game = ERA_GAME;
    }
    out.set(id, cur);
  };
  for (const co of checkouts || []) {
    note(BOX, co?.title, co?.sku ? listingBySku.get(String(co.sku).toLowerCase()) : null);
  }
  for (const l of onlineListings || []) note(ONLINE, l?.title, l);
  return out;
}

/**
 * The options a visitor can narrow by, built from the cards themselves so an
 * option that finds nothing is never offered — the same rule the desk's event
 * and stack dropdowns follow. Counted, and sorted A–Z.
 *
 * Sets are listed PER GAME: the set dropdown only exists once a game is
 * chosen, and then offers that game's sets alone — a Pokémon shopper should
 * not scroll past forty Magic sets to reach Evolving Skies.
 */
export function storefrontFacets(cards) {
  const setsByGame = new Map();
  const conditions = new Map();
  for (const c of cards || []) {
    if (!c) continue;
    if (c.set) {
      const g = c.game || UNKNOWN_GAME;
      if (!setsByGame.has(g)) setsByGame.set(g, new Map());
      const m = setsByGame.get(g);
      m.set(c.set, (m.get(c.set) || 0) + 1);
    }
    const conds = new Set([c.condition, ...(c.copies || []).map((cp) => cp?.condition)].filter(Boolean));
    for (const k of conds) conditions.set(k, (conditions.get(k) || 0) + 1);
  }
  const list = (m) => [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  const sets = {};
  for (const [g, m] of setsByGame) {
    if (g !== ERA_GAME) { sets[g] = list(m); continue; }
    // Pokémon sets carry their era and come in the era's own order — oldest
    // era first, release order inside one — which is the picker's order.
    sets[g] = list(m)
      .map((x) => ({ ...x, ...eraPlace(x.name) }))
      .sort((a, b) => eraRank(a.era) - eraRank(b.era) || a.order - b.order || a.name.localeCompare(b.name))
      .map(({ name, count, era }) => ({ name, count, era }));
  }
  return {
    games: gameFacets((cards || []).filter(Boolean), (c) => c.game),
    sets,
    conditions: list(conditions)
  };
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

/** How many cards one search answers with; "Show more" asks for the next lot. */
export const STOREFRONT_PAGE = 30;
/** How many of the dearest cards each section opens on, before anybody types. */
export const FEATURED_PER_SECTION = 9;

/**
 * The only keys a search carries. The browser builds its request through
 * searchQueryString() and the server reads it back through searchCriteria(),
 * so nothing but these — no wish list, nothing about the visitor — can ride
 * along to the server, and nothing but these is acted on there.
 */
export const SEARCH_KEYS = ["q", "game", "era", "set", "price", "condition", "sort"];

export function searchCriteria(params) {
  const get = (k) => {
    const v = typeof params?.get === "function" ? params.get(k) : params?.[k];
    return v == null ? "" : String(v).slice(0, 80);
  };
  const sort = get("sort");
  const price = get("price");
  const offset = Number.parseInt(get("offset"), 10);
  return {
    query: get("q"),
    game: get("game"),
    era: isEra(get("era")) ? get("era") : "",
    set: get("set"),
    condition: get("condition"),
    price: STOREFRONT_PRICE_FILTERS.some((f) => f.key === price) ? price : "any",
    sort: STOREFRONT_SORTS.some((x) => x.key === sort) ? sort : DEFAULT_STOREFRONT_SORT,
    offset: Number.isFinite(offset) && offset > 0 ? Math.min(offset, 100000) : 0
  };
}

export function searchQueryString({ query = "", game = "", era = "", set = "", price = "any", condition = "", sort = DEFAULT_STOREFRONT_SORT } = {}, offset = 0) {
  const p = new URLSearchParams();
  const put = (k, v) => { if (v) p.set(k, String(v)); };
  put("q", String(query || "").trim());
  put("game", game);
  // A set means nothing without its game: the picker only offers one inside a
  // game. An era is a Pokémon thing, and a set inside it is the narrower ask.
  if (game) put("set", set);
  if (game === ERA_GAME && !set) put("era", era);
  if (price && price !== "any") put("price", price);
  put("condition", condition);
  if (sort && sort !== DEFAULT_STOREFRONT_SORT) put("sort", sort);
  if (offset > 0) put("offset", offset);
  return p.toString();
}

/** Is a visitor asking for anything, or looking at the front page? */
export function isSearching({ query = "", game = "", era = "", set = "", price = "any", condition = "" } = {}) {
  return Boolean(normalise(query) || game || era || set || (price && price !== "any") || condition);
}

/**
 * One search, on the SERVER, over projected cards: what matches, sorted, a
 * page of it at a time.
 *
 * The two sections are never merged: every match from the visitor's own
 * section comes first, then the other, and the browser draws a heading where
 * the section changes. A card that might be at home is not one we can hand
 * over, and a list that interleaves the two is a list where nobody can tell
 * which is which.
 */
export function storefrontSearch(cards, { query = "", game = "", era = "", set = "", price = "any", condition = "", sort = DEFAULT_STOREFRONT_SORT, offset = 0 } = {}, { limit = STOREFRONT_PAGE, onlineFirst = false } = {}) {
  const cmp = COMPARATORS[sort] || COMPARATORS[DEFAULT_STOREFRONT_SORT];
  const keep = (c) =>
    cardMatches(c, query) &&
    priceMatches(c, price) &&
    (!game || (c.game || UNKNOWN_GAME) === game) &&
    (!game || !set || c.set === set) &&
    (game !== ERA_GAME || !era || set || (c.set ? eraPlace(c.set).era : null) === era) &&
    conditionMatches(c, condition);
  const section = (source) => (cards || [])
    .filter((c) => c && c.source === source && keep(c))
    .map((c, i) => ({ c, i, _n: normalise(c.name), pricePence: c.pricePence }))
    .sort((a, b) => cmp(a, b) || a.i - b.i)
    .map((x) => x.c);
  const box = section(BOX);
  const online = section(ONLINE);
  const all = onlineFirst ? [...online, ...box] : [...box, ...online];
  const from = Math.max(0, Number(offset) || 0);
  const page = all.slice(from, from + limit);
  return {
    cards: page,
    box: box.length,
    online: online.length,
    shown: all.length,
    offset: from,
    next: from + page.length < all.length ? from + page.length : null
  };
}

/**
 * What the page opens on before anybody types: the dearest priced cards in
 * each section, the visitor's own first, plus the options to narrow by. This
 * is the WHOLE of what the first load sends — a few dozen cards, not the
 * inventory — and the search box fetches the rest a page at a time.
 */
export function storefrontLanding(stock, { onlineFirst = false, perSection = FEATURED_PER_SECTION } = {}) {
  const cards = stock?.cards || [];
  const top = (source) => cards
    .filter((c) => c && c.source === source && c.pricePence != null)
    .sort((a, b) => b.pricePence - a.pricePence)
    .slice(0, perSection);
  const featured = onlineFirst ? [...top(ONLINE), ...top(BOX)] : [...top(BOX), ...top(ONLINE)];
  return {
    featured,
    facets: storefrontFacets(cards),
    box: stock?.box || 0,
    online: stock?.online || 0
  };
}

/**
 * The set picker's list for one game, narrowed by what the visitor typed.
 *
 * Pokémon comes back as eras, each a heading the visitor can pick whole, with
 * its sets under it; any other game is one group with no heading. Typing
 * matches the set's name, the words "base set" on an era's base set (the
 * catalogue calls the Sun & Moon base set just "Sun & Moon"), and the era's
 * own name — so "base" lists every base set, and "wizards" the whole era.
 * A group with nothing left in it is not shown.
 */
export function setPickerGroups(sets, query = "", game = "") {
  const q = setNorm(query);
  const words = q ? q.split(" ") : [];
  const hit = (s) => {
    if (!words.length) return true;
    const hay = ` ${setNorm(s.name)} ${setSearchWords(s.name)} ${s.era ? setNorm(eraLabel(s.era)) : ""} `;
    return words.every((w) => hay.includes(` ${w}`));
  };
  const list = (sets || []).filter(hit);
  if (game !== ERA_GAME) return list.length ? [{ era: "", label: "", count: list.reduce((n, s) => n + s.count, 0), sets: list }] : [];
  const groups = [];
  for (const s of list) {
    let g = groups[groups.length - 1];
    if (!g || g.era !== s.era) { g = { era: s.era, label: eraLabel(s.era), count: 0, sets: [] }; groups.push(g); }
    g.sets.push(s);
  }
  // An era's count is every card in it, not only the sets the search left.
  for (const g of groups) g.count = (sets || []).filter((s) => s.era === g.era).reduce((n, s) => n + s.count, 0);
  return groups;
}
