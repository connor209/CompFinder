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
 * SoldComps, whose own documented limit is 60/minute — one per second — and
 * hammering a supplier we depend on to prove our own tool works would be a
 * poor trade. It also produces junk results: overload comes back as upstream
 * errors that are indistinguishable, from the outside, from the tool failing.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPacer({
  // SoldComps documents 60 requests/minute, so the floor between calls has to
  // be at least a second. The first version used 400ms and called it "well
  // under" — that is 150/min, two and a half times over, and a 282-card run at
  // 350ms failed 155 of 282 with upstream errors that looked like the tool
  // breaking rather than us flooding a supplier. 1200ms leaves headroom for
  // the retries, which also count against their limit.
  minGapMs = 1200,
  maxPerHour = 900,      // our own ceiling, independent of whatever the server allows
  maxRetries = 4,
  onWait = () => {}
} = {}) {
  let lastCallAt = 0;
  const callTimes = [];
  let served = 0;
  let waitedMs = 0;
  let retried = 0;
  let recovered = 0;

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
   *
   * 5xx is retried too, on a shorter backoff, and that is not a nicety. A
   * 294-card run lost 69 cards — 23% of it — to bare 502s: the route had
   * already spent its own two internal retries, this returned the failure
   * as-is, and the summary then reported "224 priced (100%)" because it
   * measured against the cards that came back rather than the cards asked
   * for. A baseline with a quarter of it missing is worse than no baseline,
   * because the next run's diff reads the recovered cards as improvements.
   */
  async function call(fn) {
    let lastStatus = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await throttle();
      let res;
      try {
        res = await fn();
      } catch (err) {
        // A thrown fetch (socket reset, DNS blip) is the same class of problem
        // as a 502 and gets the same treatment.
        res = { status: 0, body: { ok: false, error: err.message } };
      }
      lastStatus = res.status;
      if (res.status !== 429 && !(res.status === 0 || res.status >= 500)) {
        served++;
        if (attempt > 0) recovered++;
        return res;
      }
      retried++;
      const backoff = res.status === 429
        ? Math.min(60_000, 5000 * 2 ** attempt)   // honour a rate limit properly
        : Math.min(20_000, 2000 * 2 ** attempt);  // upstream wobble: shorter
      onWait(`${res.status === 429 ? "rate limited" : `upstream ${res.status || "error"}`} — backing off ${Math.round(backoff / 1000)}s (attempt ${attempt + 1})`);
      waitedMs += backoff;
      await sleep(backoff);
    }
    throw new Error(`gave up after ${maxRetries} backoffs (last status ${lastStatus}) — stopping rather than hammering`);
  }

  const stats = () => ({
    served,
    retried,
    recovered,
    waitedSeconds: Math.round(waitedMs / 1000),
    inLastHour: callTimes.length
  });

  return { call, stats };
}
