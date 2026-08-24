/**
 * The soldcomps_cache primary key, in one place.
 *
 * Server-only — it hashes, so it must not reach a client bundle. Split out of
 * the price route when card pages started reading the cache directly: the
 * route WRITES these entries and a server-rendered page or the warmer READS
 * them without going through the route at all, so the two have to derive the
 * same key from the same query or the page silently never finds anything.
 */
import { createHash } from "node:crypto";
import { EBAY_SITE, normaliseQuery } from "./card-query.js";

export function cacheKeyFor(query, sold, soldAfterDays) {
  return createHash("sha256")
    .update(`${normaliseQuery(query)}|${EBAY_SITE}|${sold ? "sold" : "active"}|${soldAfterDays}`)
    .digest("hex");
}

export default { cacheKeyFor };
