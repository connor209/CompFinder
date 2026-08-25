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

/**
 * The shorter window, taken out of the ninety-day set rather than fetched.
 *
 * Thirty days of sales are already inside ninety days of sales — every comp
 * carries the date it ended. Asking SoldComps again for a subset of what we
 * are already holding costs a request, five seconds, and a bot check, on a
 * control the visitor expects to be instant. And because the warmer only ever
 * fills the ninety-day entry, the thirty-day view was a guaranteed cache miss
 * on all 455 published cards, every time, forever.
 *
 * WHEN IT IS NOT SAFE, and this is the whole subtlety: SoldComps returns one
 * page, newest first, so a fast-moving card comes back CAPPED. A capped
 * ninety-day response is not the last ninety days, it is the last forty sales
 * — and filtering that to thirty days gives you a different, smaller answer
 * than a real thirty-day search would. So a capped set is refetched, and
 * hasNextPage of null — an older cache entry that predates the field — counts
 * as capped rather than complete. "We don't know" and "there is no next page"
 * lead to opposite conclusions, and the safe one is to ask.
 *
 * @returns the narrowed response, or null when it has to be fetched instead.
 */
export function deriveWindow(response, windowDays) {
  if (!response || !Array.isArray(response.comps)) return null;
  if (windowDays === DEFAULT_SOLD_WINDOW) return response;
  if (!SOLD_WINDOWS.includes(windowDays)) return null;
  // Anything other than a definite "not capped" gets asked for properly.
  if (response.hasNextPage !== false) return null;

  const cutoff = Date.now() - windowDays * 86400000;
  const comps = response.comps.filter((c) => {
    const at = c && c._source && c._source.endedAt;
    const t = at ? new Date(at).getTime() : NaN;
    // A comp with no date can't be placed in a window at all. Excluding it is
    // the honest reading — including it would be asserting a date we don't have.
    return Number.isFinite(t) && t >= cutoff;
  });

  return {
    ...response,
    comps,
    rawItemCount: comps.length,
    // The wider set was complete, so this subset of it is complete too.
    hasNextPage: false,
    derivedFrom: DEFAULT_SOLD_WINDOW
  };
}

export default { SOLD_WINDOWS, DEFAULT_SOLD_WINDOW, windowFromParam, cardHref, deriveWindow };
