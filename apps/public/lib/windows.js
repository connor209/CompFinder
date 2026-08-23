/**
 * The sold windows the page offers.
 *
 * One list, three users: the toggle on the answer screen, the `days` search
 * param both card screens read, and the allow-list `/api/price` validates
 * against. An arbitrary number from the client would fragment the cache into
 * near-duplicate entries that each cost a fresh API call, so anything off the
 * list falls back to the default rather than erroring — a bad value is a
 * caller bug, not something a visitor can fix.
 *
 * Ordered as the toggle shows them: shortest first.
 */
export const SOLD_WINDOWS = [30, 90];

/** Ninety days finds more sales, which is the right default for a scarce card. */
export const DEFAULT_SOLD_WINDOW = 90;

/** A `days` search param, or anything else, into a window we will honour.
 *  A repeated `?days=30&days=90` arrives as an array, which parseInt would
 *  quietly read as the first element — so only a single value is considered. */
export function windowFromParam(value) {
  if (typeof value !== "string" && typeof value !== "number") return DEFAULT_SOLD_WINDOW;
  const n = Number.parseInt(value, 10);
  return SOLD_WINDOWS.includes(n) ? n : DEFAULT_SOLD_WINDOW;
}

/** The card URL for a query at a window. The default is left off, so the
 *  ordinary link stays the shareable one it has always been. */
export function cardHref(query, days, suffix = "") {
  const base = `/card/${encodeURIComponent(query)}${suffix}`;
  return days && days !== DEFAULT_SOLD_WINDOW ? `${base}?days=${days}` : base;
}

export default { SOLD_WINDOWS, DEFAULT_SOLD_WINDOW, windowFromParam, cardHref };
