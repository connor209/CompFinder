/**
 * Comp Finder — "do we already have this card?"
 *
 * When a batch is priced, every row is checked against two things we already
 * know:
 *
 *   1. our LIVE eBay listings (`ebay_listings`) — are we selling one right
 *      now, and at what price?
 *   2. our OWN price history (`price_checks`) — what did we decide this card
 *      was worth last time we looked?
 *
 * Both answers matter for the same reason: a new copy should go up in line
 * with the one already on the shelf, not undercut it by accident.
 *
 * Matching is deliberately conservative. A SKU match is exact and trusted. A
 * card match (collector number + first word of the name) is only trusted when
 * it is unambiguous — if two different listings answer to the same key, the
 * row is reported as ambiguous with the count, rather than picking one.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

/** Normalise a word for keying: lowercase, letters and digits only. */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalise a collector number: "030 / 149" and "30/149" are the same card. */
function normNumber(n) {
  const s = String(n || "").toLowerCase().replace(/\s+/g, "");
  const m = /^([a-z]{0,3})0*(\d+)\s*\/\s*([a-z]{0,3})0*(\d+)$/.exec(s);
  if (m) return `${m[1]}${m[2]}/${m[3]}${m[4]}`;
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * The key a card is filed under: its collector number plus the first
 * meaningful word of its name. Number alone would collide across sets and
 * games; the full name is too brittle (M-Rayquaza vs "M Rayquaza EX").
 * Returns null when there isn't enough to key on — better no match than a
 * wrong one.
 */
export function cardKey({ name, number }) {
  const num = normNumber(number);
  const word = norm(String(name || "").split(/\s+/)[0]);
  if (!num || !word) return null;
  return `${num}|${word}`;
}

/** The same key, derived from a free-text listing title. */
export function keyFromTitle(title) {
  const { number, nameTokens } = CompFinderPricing.buildCardQuery(title || "");
  return cardKey({ name: (nameTokens || [])[0] || "", number });
}

/**
 * Index the user's live listings by SKU and by card key.
 * `listings` are rows from `ebay_listings`.
 */
export function buildStockIndex(listings) {
  const bySku = new Map();
  const byCard = new Map();
  for (const l of listings || []) {
    const entry = {
      sku: l.sku || "",
      itemId: l.ebay_item_id,
      title: l.title || "",
      url: l.url || "",
      pricePence: l.price_value != null ? Math.round(Number(l.price_value) * 100) : null,
      currency: l.price_currency || "GBP",
      quantity: l.quantity ?? null
    };
    if (entry.sku) {
      const list = bySku.get(entry.sku) || [];
      list.push(entry);
      bySku.set(entry.sku, list);
    }
    const key = keyFromTitle(entry.title);
    if (key) {
      const list = byCard.get(key) || [];
      list.push(entry);
      byCard.set(key, list);
    }
  }
  return { bySku, byCard, size: (listings || []).length };
}

/**
 * Index past price checks by SKU and card key, keeping only the most recent
 * for each — "what did we say last time" is one number, not a history.
 * `checks` are rows from `price_checks`.
 */
export function buildHistoryIndex(checks) {
  const bySku = new Map();
  const byCard = new Map();
  const keep = (map, key, row) => {
    if (!key) return;
    const cur = map.get(key);
    if (!cur || String(row.created_at) > String(cur.created_at)) map.set(key, row);
  };
  for (const c of checks || []) {
    if (c.recommended_pence == null) continue;
    const row = {
      pricePence: c.recommended_pence,
      created_at: c.created_at,
      confidence: c.confidence || "",
      title: c.title || ""
    };
    if (c.sku) keep(bySku, c.sku, row);
    keep(byCard, keyFromTitle(c.title), row);
  }
  return { bySku, byCard };
}

/**
 * Look one batch row up in an index. Returns null (no match), or
 * { match, via, count, ambiguous } where `via` is "sku" or "card".
 */
function lookup(index, { sku, name, number, title }) {
  if (!index) return null;
  if (sku && index.bySku.has(sku)) {
    const list = index.bySku.get(sku);
    const arr = Array.isArray(list) ? list : [list];
    return { match: arr[0], via: "sku", count: arr.length, ambiguous: false };
  }
  const key = name || number ? cardKey({ name, number }) : keyFromTitle(title);
  if (!key || !index.byCard.has(key)) return null;
  const list = index.byCard.get(key);
  const arr = Array.isArray(list) ? list : [list];
  // Several different listings under one key: report it, don't guess.
  return { match: arr[0], via: "card", count: arr.length, ambiguous: arr.length > 1 };
}

/**
 * Annotate one batch row with what we already know about that card.
 * `row` needs { sku, title } and, when it came from a CardUploader CSV,
 * { csvItem: { cardName, cardNumber } } for the more reliable key.
 */
export function checkRow(row, { stock, history } = {}) {
  const ident = {
    sku: row?.sku || "",
    name: row?.csvItem?.cardName || "",
    number: row?.csvItem?.cardNumber || "",
    title: row?.title || ""
  };
  return {
    stock: lookup(stock, ident),
    history: lookup(history, ident)
  };
}

/**
 * How a recommendation compares to what we're already asking. Used to flag
 * the rows worth a human glance rather than to change any price.
 */
export function priceGap(recommendedPence, listedPence) {
  if (recommendedPence == null || listedPence == null || listedPence <= 0) return null;
  const delta = recommendedPence - listedPence;
  return { delta, pct: (delta / listedPence) * 100, big: Math.abs(delta) >= 300 && Math.abs(delta / listedPence) >= 0.2 };
}

/**
 * Is a listing actually buyable, or a shell of one that has already sold?
 *
 * eBay's out-of-stock control keeps a sold-out fixed-price listing in the
 * seller's ActiveList with `QuantityAvailable` at 0 — same item id, same
 * price, still "active" as far as the API is concerned, and invisible to
 * buyers. That is how a card that sold months ago is still a row in
 * `ebay_listings`, and it is why **"the SKU is in ebay_listings" was never the
 * same question as "we still have the card"**. Everything that reads a card's
 * listing to decide whether we still own it has to ask this instead.
 *
 * **Unknown is not sold out.** `normalizeItem()` in lib/ebay.js stores null
 * when eBay sends neither QuantityAvailable nor Quantity, and reading a
 * missing field as zero would empty a seller's whole show shortlist on the
 * strength of a field eBay didn't send. Only an explicit number at or below
 * zero counts as gone.
 */
export function isListingAvailable(listing) {
  const q = listing?.quantity;
  // `Number("")` is 0, which would read an empty column as sold out. It isn't
  // one — it is the same silence as a null.
  if (q == null || q === "") return true;
  const n = Number(q);
  return Number.isFinite(n) ? n > 0 : true;
}

/** The lowercased SKUs we can still actually sell, out of a set of listings. */
export function availableSkus(listings) {
  const set = new Set();
  for (const l of listings || []) {
    if (!l?.sku || !isListingAvailable(l)) continue;
    set.add(String(l.sku).toLowerCase());
  }
  return set;
}

/**
 * The lowercased SKUs that are still listed but sold out — the ones a card
 * count based on `ebay_listings` alone gets wrong.
 *
 * A SKU with a second, in-stock listing is NOT here: two listings under one
 * SKU means we have one to sell, and reporting the card as gone on the
 * strength of the dead one would send a real card home from the show.
 */
export function soldOutSkus(listings) {
  const live = availableSkus(listings);
  const set = new Set();
  for (const l of listings || []) {
    if (!l?.sku || isListingAvailable(l)) continue;
    const k = String(l.sku).toLowerCase();
    if (!live.has(k)) set.add(k);
  }
  return set;
}
