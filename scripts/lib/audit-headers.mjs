/**
 * Headers for our own calls to the public page's /api/price.
 *
 * The per-IP limit on that endpoint is 120/hour — a public number, set so a
 * scraper can't walk the catalogue at our expense. Every audit here makes far
 * more distinct searches than that in a few minutes, so from the server's side
 * a run is indistinguishable from the abuse the limit exists to stop. The
 * token is how we say "this one is us": it exempts the caller from the LIMIT
 * only, and the cache, the global SoldComps pacer and every other guard still
 * apply.
 *
 * Unset, the run still works — it just gets 429s after 120 misses, which is
 * the limit doing its job rather than a bug. Warning once is worth it because
 * that failure otherwise arrives an hour into a long run and looks like the
 * page falling over.
 */
let warned = false;

export function auditHeaders(extra = {}) {
  const token = process.env.AUDIT_TOKEN || "";
  if (!token && !warned) {
    warned = true;
    console.warn(
      "⚠️  AUDIT_TOKEN not set — this run is rate limited like any visitor (120 cache misses/hour).\n" +
      "   Set it to the deployment's AUDIT_TOKEN to run unthrottled by the per-IP limit."
    );
  }
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-compfinder-audit": token } : {}),
    ...extra
  };
}
