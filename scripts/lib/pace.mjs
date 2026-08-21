/**
 * Self-pacing caller for the public API.
 *
 * The audit deliberately makes far more requests, far faster, than any real
 * visitor. Rather than relying on the server's limit being raised — or on a
 * bypass token being configured — the harness governs itself: a floor on the
 * gap between calls, a ceiling on calls per hour, and a real backoff when the
 * server does push back.
 *
 * That matters beyond our own rate limit. Every cache miss is a live call to
 * SoldComps, whose own documented limit is 60/minute, and hammering a supplier
 * we depend on to prove our own tool works would be a poor trade.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPacer({
  minGapMs = 400,        // floor between calls; 150/min stays well under SoldComps' 60/min
  maxPerHour = 900,      // our own ceiling, independent of whatever the server allows
  maxRetries = 4,
  onWait = () => {}
} = {}) {
  let lastCallAt = 0;
  const callTimes = [];
  let served = 0;
  let waitedMs = 0;
  let retried = 0;

  async function throttle() {
    const now = Date.now();

    // Rolling hour ceiling. If we've spent the budget, wait for the oldest
    // call to age out rather than failing the run partway through.
    const hourAgo = now - 3600_000;
    while (callTimes.length && callTimes[0] < hourAgo) callTimes.shift();
    if (callTimes.length >= maxPerHour) {
      const waitFor = callTimes[0] + 3600_000 - now + 1000;
      onWait(`hourly ceiling reached — pausing ${Math.round(waitFor / 1000)}s`);
      waitedMs += waitFor;
      await sleep(waitFor);
    }

    const since = Date.now() - lastCallAt;
    if (since < minGapMs) {
      waitedMs += minGapMs - since;
      await sleep(minGapMs - since);
    }
    lastCallAt = Date.now();
    callTimes.push(lastCallAt);
  }

  /**
   * Runs `fn`, which must resolve to { status, body }. A 429 is the server
   * telling us we misjudged the pace, so it's honoured with a real wait rather
   * than retried immediately — retrying hard against a rate limit is how a
   * throttle becomes an outage.
   */
  async function call(fn) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await throttle();
      const res = await fn();
      if (res.status !== 429) {
        served++;
        return res;
      }
      retried++;
      const backoff = Math.min(60_000, 5000 * 2 ** attempt);
      onWait(`rate limited — backing off ${Math.round(backoff / 1000)}s (attempt ${attempt + 1})`);
      waitedMs += backoff;
      await sleep(backoff);
    }
    throw new Error(`still rate limited after ${maxRetries} backoffs — stopping rather than hammering`);
  }

  const stats = () => ({
    served,
    retried,
    waitedSeconds: Math.round(waitedMs / 1000),
    inLastHour: callTimes.length
  });

  return { call, stats };
}
