/**
 * Comp Finder — narrowing My listings by what a card IS: game, set,
 * condition, printing and asking price.
 *
 * Every reading here is somebody else's, on purpose. The game is games.js's
 * `gameOf()` (the Show Desk chips), the set is the catalogue matcher in
 * set-index.js (the pull sheet and the storefront), the condition is
 * showcounter.js's `conditionOf()` (core's `inferCondition()` under it), and
 * the printing is stockcheck.js's `printingOf()`. A filter with its own idea
 * of which set a card is in would disagree with the pull sheet about the same
 * listing, and nothing on screen would say so.
 *
 * Nothing is guessed into a bucket: a title the catalogue cannot place is
 * "No set found", a condition nobody wrote is "Not stated", and both are
 * options in their own right, so a card is never filtered out of existence
 * for lacking a field. Options are built from the listings, so one that
 * finds nothing is never offered.
 *
 * Framework-free: the screen and scripts/check-listingfilter.mjs both call it.
 */
import { gameOf, gameFacets, UNKNOWN_GAME } from "./games.js";
import { printingOf } from "./stockcheck.js";
import { conditionOf } from "./showcounter.js";

/** The bucket for a title the catalogue could not place in a set. */
export const NO_SET = "__none";
/** The bucket for a listing nobody wrote a condition on. */
export const NO_CONDITION = "__none";

export const PRINTING_FILTERS = [
  { key: "any", label: "Any printing" },
  { key: "raw", label: "Raw (not graded)" },
  { key: "graded", label: "Graded slabs" },
  { key: "reverse", label: "Reverse holo" },
  { key: "stamped", label: "Stamped" }
];

/** Bands on OUR asking price, in pence, inclusive. */
export const ASK_FILTERS = [
  { key: "any", label: "Any price" },
  { key: "u5", label: "Under £5", min: 0, max: 499 },
  { key: "5-20", label: "£5–£20", min: 500, max: 2000 },
  { key: "20-50", label: "£20–£50", min: 2001, max: 5000 },
  { key: "50-100", label: "£50–£100", min: 5001, max: 10000 },
  { key: "100+", label: "£100+", min: 10001, max: Infinity }
];

export const EMPTY_LISTING_FILTERS = Object.freeze({ game: "", set: "", condition: "", printing: "any", price: "any" });

/**
 * What one listing is, read once. `setOf` is title -> { name } | null (see
 * setMatcher()); `gameIndex` is buildSetGameIndex()'s. Either may be missing
 * when the catalogue could not be read — the game still answers off eBay's
 * category and the title, and every set reads as "No set found".
 */
export function tagListing(listing, { setOf = null, gameIndex = null } = {}) {
  const title = listing?.title || "";
  const set = setOf ? setOf(title) : null;
  return {
    game: gameOf({ category: listing?.extra?.category, title }, gameIndex),
    set: set?.name || NO_SET,
    condition: conditionOf(listing) || NO_CONDITION,
    printing: printingOf(title)
  };
}

/** Our ask in pence, or null. */
export function askPence(listing) {
  const v = listing?.price_value == null ? NaN : Number(listing.price_value);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

function printingMatches(p, key) {
  if (!key || key === "any") return true;
  if (!p) return false;
  if (key === "raw") return !p.graded;
  if (key === "graded") return !!p.graded;
  if (key === "reverse") return !!p.reverse;
  if (key === "stamped") return !!p.stamped;
  return true;
}

function priceMatches(pence, key) {
  if (!key || key === "any") return true;
  const band = ASK_FILTERS.find((f) => f.key === key);
  if (!band || band.min == null) return true;
  return pence != null && pence >= band.min && pence <= band.max;
}

/** Does a listing, with its tags, pass every filter? An empty filter passes everything. */
export function matchesListingFilters(listing, tags, criteria = EMPTY_LISTING_FILTERS) {
  const c = { ...EMPTY_LISTING_FILTERS, ...criteria };
  const t = tags || {};
  if (c.game && (t.game || UNKNOWN_GAME) !== c.game) return false;
  if (c.set && (t.set || NO_SET) !== c.set) return false;
  if (c.condition && (t.condition || NO_CONDITION) !== c.condition) return false;
  if (!printingMatches(t.printing, c.printing)) return false;
  if (!priceMatches(askPence(listing), c.price)) return false;
  return true;
}

/** Is any filter set? */
export function isListingFiltering(criteria = EMPTY_LISTING_FILTERS) {
  const c = { ...EMPTY_LISTING_FILTERS, ...criteria };
  return !!(c.game || c.set || c.condition || (c.printing && c.printing !== "any") || (c.price && c.price !== "any"));
}

function counted(values, emptyKey, emptyLabel) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  const named = [...m.entries()]
    .filter(([k]) => k !== emptyKey)
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // The bucket with no answer goes last, never first: it is the leftovers.
  if (m.has(emptyKey)) named.push({ key: emptyKey, label: emptyLabel, count: m.get(emptyKey) });
  return named;
}

/**
 * The dropdown options, with counts, built from the tags of the listings
 * being filtered — so an option that would show nothing is never offered.
 */
export function listingFacets(tagsList) {
  const list = (tagsList || []).filter(Boolean);
  return {
    games: gameFacets(list).map((g) => ({ key: g.slug, label: g.name, count: g.count })),
    sets: counted(list.map((t) => t.set || NO_SET), NO_SET, "No set found"),
    conditions: counted(list.map((t) => t.condition || NO_CONDITION), NO_CONDITION, "Not stated")
  };
}
