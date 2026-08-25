/**
 * A rate gate for the batch run's outbound calls.
 *
 * The Batch screen used to price cards one at a time with a 1.2s sleep between
 * them. Measured over an 89-card run that is about 5.3 minutes, while the
 * supplier's own documented limit — SoldComps, 60 requests a minute — allows
 * the same work in 1.7. The sleep was doing the job of a rate limiter, badly:
 * it paced ONE worker, so the gap between calls was the request time PLUS the
 * sleep rather than the limit we were actually trying to respect.
 *
 * This separates the two ideas. Concurrency decides how many requests may be
 * in flight; the gate decides how often a new one may START. With a 1.1s gate,
 * three workers settle at roughly 54 calls a minute however fast or slow the
 * supplier is being, which is what the limit asks for.
 *
 * Three workers is the whole answer, and more is worse: past that the gate
 * binds anyway, so extra concurrency buys nothing and only risks 429s. See
 * docs/PRICING_RESEARCH.md for the measured table.
 *
 * scripts/lib/pace.mjs is the audit's version of this idea and carries the
 * fuller reasoning about why self-pacing beats relying on a supplier's limit
 * to push back. It is a Node script and belongs to the harness; this is the
 * browser's, deliberately smaller — no hourly ceiling, no backoff, because a
 * batch run is minutes rather than hours and fetchSoldCompsWithRetry already
 * handles a 429.
 */

/**
 * SoldComps documents 60 requests a minute — one a second. 1100ms leaves a
 * little room rather than cutting it exactly, the same margin migration 021
 * chose for the public page's pacer in Postgres.
 */
export const SOLDCOMPS_GAP_MS = 1100;

/**
 * eBay's Browse API is 5,000 calls a day on a standard keyset, which a batch
 * run cannot get near, so this only exists to be a good neighbour rather than
 * to stay inside a limit we are pressing against.
 */
export const BROWSE_GAP_MS = 200;

/** How many requests may be in flight at once. See above for why not more. */
export const BATCH_CONCURRENCY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns `await gate()` — resolves when it is this caller's turn to start.
 *
 * Serialised through a promise chain so concurrent callers queue rather than
 * all read the same `last` and start together, which is the bug a naive
 * timestamp check has and which only shows up under the concurrency this
 * exists to allow.
 */
export function createGate(minGapMs) {
  let chain = Promise.resolve();
  let last = 0;
  return function gate() {
    chain = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    return chain;
  };
}

/**
 * Runs `worker(i)` over every index, `concurrency` at a time.
 *
 * Workers pull the next index rather than being handed a fixed slice, so one
 * slow card doesn't leave two workers idle — which matters here because a
 * card needing a live-market check does roughly twice the work of one that
 * doesn't.
 *
 * `shouldStop()` is checked before each pull, so a run can end early — an
 * expired key, a spent quota — without waiting for work already in flight to
 * be scheduled. Requests already running still finish; their results are kept.
 */
export async function runPool(count, concurrency, worker, shouldStop = () => false) {
  let next = 0;
  const take = () => (next < count && !shouldStop() ? next++ : -1);
  const runner = async () => {
    for (let i = take(); i !== -1; i = take()) await worker(i);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(count, 1)) }, runner));
}

export default { createGate, runPool, SOLDCOMPS_GAP_MS, BROWSE_GAP_MS, BATCH_CONCURRENCY };
