/**
 * One definition of "which eBay search is this card", and of the shape a
 * catalogue row takes once the page is holding it.
 *
 * Split out of use-card.js because that file is "use client": nothing running
 * on the server could import queryForCard from it, and three server-side
 * callers now need exactly the string it builds —
 *
 *   the sitemap    deciding which cards have a price worth advertising
 *   a card page    reading a cached price before the browser has run anything
 *   the warmer     writing that cache entry ahead of a crawler
 *
 * — because the cache key is a hash of that string. A second copy built even
 * slightly differently doesn't produce a wrong price; it produces a permanent
 * cache miss, on every card, while the code reads as though it works and the
 * warmer keeps writing entries nobody reads. Same shape of failure as the
 * liquidity read having two definitions, which took measuring 40 cards to spot.
 *
 * Isomorphic on purpose: no node builtins, so the client can still import it.
 * The hashing lives in cache-key.js, server-only.
 */
import { cleanSearchName } from "@compfinder/core/cardname.js";
import { languageOf } from "./resolve.js";

/** The only marketplace searched. Also part of the cache key. */
export const EBAY_SITE = "ebay.co.uk";

/**
 * One card → the search text that finds it. Set name included deliberately:
 * measured over 30 cards, "Mew ex 232/091" priced at £794 with the set in the
 * query and £546 without, because eBay returns a different result set.
 *
 * Byte-for-byte stable — this string is what the cache key hashes.
 */
export function queryForCard(card) {
  return [card.name, card.number || "", card.set || ""].join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A catalogue row as the rest of the page wants it. /api/resolve and
 * /api/suggest both return this, and anything pricing a card server-side has
 * to produce it identically — `name` especially, which is CLEANED rather than
 * raw. Searching the raw Cardmarket name would miss the cache written by every
 * visitor who arrived through the search box.
 */
export function cardFromRow(row) {
  return {
    id: row.cardmarket_id,
    name: cleanSearchName(row.name, row.game),
    number: row.collector_number,
    set: row.expansion,
    code: row.expansion_code,
    rarity: row.rarity,
    game: row.game,
    language: languageOf(row),
    image: row.image_small || null
  };
}

/**
 * The normalisation the cache key is built on, so "Charizard  ex 199/165" and
 * "charizard ex 199/165" are one entry rather than two API calls.
 */
export function normaliseQuery(query) {
  return String(query).toLowerCase().replace(/\s+/g, " ").trim();
}

export default { EBAY_SITE, queryForCard, cardFromRow, normaliseQuery };
