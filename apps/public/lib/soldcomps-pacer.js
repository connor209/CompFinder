/**
 * Global pacing for our calls to SoldComps.
 *
 * Their documented limit is 60 requests/minute across the whole key, and the
 * public page bills every visitor's search to one shared key. So the limit
 * that matters is a property of the deployment, and the only limiter we had
 * was per-IP — which cannot see aggregate load by construction. Fifty visitors
 * are fifty IPs, each comfortably inside its own allowance and collectively
 * several times over SoldComps'.
 *
 * The state lives in Postgres (migration 021) because each Vercel invocation
 * is its own process: an in-process bucket would pace one lambda and leave the
 * other nine unbounded.
 *
 * @see supabase/migrations/021_soldcomps_global_pacer.sql
 */

// 1100ms is ~54 requests/minute, deliberately short of 60 rather than exactly
// at it: clock skew between an invocation and Postgres, and SoldComps' own
// window boundaries, both eat into any margin we don't leave ourselves. The
// audit harness settled on 1200ms for the same reason after 350ms failed 155
// of 282 requests (scripts/lib/pace.mjs).
const DEFAULT_GAP_MS = 1100;

// How long a visitor's request may sit waiting for a slot before we give up on
// it. At a 1100ms gap this is about three requests deep — past that, telling
// someone to try again in a moment beats holding a spinner for six seconds and
// then showing them an upstream error anyway. It also has to stay well inside
// the function's own execution budget, which the upstream call and its retries
// are already spending.
const DEFAULT_MAX_WAIT_MS = 4000;

const num = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);

export const GAP_MS = num(process.env.SOLDCOMPS_MIN_GAP_MS, DEFAULT_GAP_MS);
export const MAX_WAIT_MS = num(process.env.SOLDCOMPS_MAX_WAIT_MS, DEFAULT_MAX_WAIT_MS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for this request's turn to call SoldComps.
 *
 * Resolves { ok: true } once the caller may go, or { ok: false } when the
 * queue is deeper than we're willing to make someone wait.
 *
 * Fails OPEN if the pacer itself is unreachable — the function missing (the
 * migration hasn't been run yet) or Postgres having a bad moment shouldn't
 * take pricing down, and failing open is exactly the behaviour that was in
 * place before this existed. It is logged rather than swallowed, because a
 * pacer that has quietly stopped pacing looks identical to one that's working
 * right up until the day it matters.
 */
export async function claimSoldCompsSlot(supabase, { gapMs = GAP_MS, maxWaitMs = MAX_WAIT_MS } = {}) {
  let slot;
  try {
    const { data, error } = await supabase.rpc("claim_soldcomps_slot", {
      p_gap_ms: gapMs,
      p_max_wait_ms: maxWaitMs
    });
    if (error) {
      console.error("SoldComps pacer unavailable, proceeding unpaced:", error.message);
      return { ok: true, degraded: true, waitedMs: 0 };
    }
    slot = data;
  } catch (err) {
    console.error("SoldComps pacer threw, proceeding unpaced:", err.message);
    return { ok: true, degraded: true, waitedMs: 0 };
  }

  // null is the pacer refusing, not failing: the queue is already longer than
  // maxWaitMs and this request should be shed rather than joined to it.
  if (!slot) return { ok: false, waitedMs: 0 };

  const waitMs = new Date(slot).getTime() - Date.now();
  // Clamped, not trusted. A slot far in the future would mean our clock and
  // Postgres' disagree badly; sleeping on that arithmetic would hold the
  // function open for as long as the skew, so cap it at what we already
  // decided we were willing to wait.
  if (waitMs > 0) await sleep(Math.min(waitMs, maxWaitMs));
  return { ok: true, waitedMs: Math.max(0, waitMs) };
}
