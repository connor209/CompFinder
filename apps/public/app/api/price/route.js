import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import SoldCompsApi from "@compfinder/core/soldcomps.js";
import { createServiceClient } from "@/lib/supabase";
import { claimSoldCompsSlot } from "@/lib/soldcomps-pacer";
import { clientIp } from "@/lib/client-ip";
import { turnstileEnabled, passIsValid, PASS_COOKIE } from "@/lib/turnstile";

/**
 * Public pricing endpoint. Same job as the app's /api/soldcomps, but with the
 * three differences that matter once anyone on the internet can call it:
 *
 *   - No auth. The app's route reads a per-user BYOK key and 401s otherwise;
 *     this one uses a single server-side key (SOLDCOMPS_API_KEY).
 *   - Cache first, always. A repeat query costs nothing, which is both the
 *     margin and the main defence against someone walking the catalogue.
 *   - Rate limited per IP, because the endpoint spends real money per miss.
 *   - Paced globally, because SoldComps' own limit is 60/minute across the
 *     whole key and a per-IP limit cannot see aggregate load.
 *   - Gated on a Turnstile pass once one is configured, because none of the
 *     above distinguishes a visitor from a script.
 *
 * POST { query, sold? }  ->  { ok, comps, cached, fetchedAt }
 */

// Sold data covers a 90-day window and barely moves hour to hour; asking
// prices change as listings come and go, and a stale "buy one now" row that
// has already sold is a worse experience than a slightly slower page.
const TTL_SECONDS = { sold: 24 * 60 * 60, active: 2 * 60 * 60 };

// Per-IP hourly cap on cache misses. 120 is generous enough that no real
// person searching cards hits it, and tight enough to bound the damage when
// someone decides to walk the catalogue: this endpoint spends real money per
// miss.
//
// It sat at 2000 through the audit phase so hundred-card runs wouldn't trip it
// while the page had no visitors but us. That is not a safe public number — at
// 2000 one scraper burns a month of SoldComps quota in an afternoon — so our
// own runs now go through AUDIT_TOKEN below instead, which is exempt from the
// limit without weakening it for anyone else.
const PUBLIC_LIMIT = 120;
const MAX_REQUESTS_PER_HOUR = Number(process.env.PUBLIC_RATE_LIMIT_PER_HOUR) > 0
  ? Number(process.env.PUBLIC_RATE_LIMIT_PER_HOUR)
  : PUBLIC_LIMIT;

/**
 * Shared secret that exempts a caller from the per-IP limit — for our own
 * audit runs (scripts/audit-public.mjs), which deliberately make a hundred
 * distinct searches in a few minutes and would otherwise be indistinguishable
 * from the abuse the limit exists to stop.
 *
 * It exempts from the LIMIT only. The cache still runs first, so an audit
 * re-run costs no upstream calls, and every other guard still applies.
 * Unset means no bypass exists at all — an absent or empty token can never
 * match, so leaving it unconfigured is the safe default rather than an
 * accidental open door.
 */
const AUDIT_TOKEN = process.env.AUDIT_TOKEN || "";

function isTrustedCaller(request) {
  if (!AUDIT_TOKEN) return false;
  const presented = request.headers.get("x-compfinder-audit") || "";
  if (presented.length !== AUDIT_TOKEN.length) return false;
  // Constant-time compare: a length-safe equality check here stops the token
  // being recovered a character at a time from response timing.
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(AUDIT_TOKEN));
  } catch {
    return false;
  }
}

const QUERY_OPTIONS = { ebaySite: "ebay.co.uk", itemLocation: "worldwide" };

// How far back to look for sold comps. A longer window finds more comps for a
// scarce card; a shorter one is more current for a card that's moving. Only
// these two are accepted — an arbitrary number from the client would fragment
// the cache into near-duplicate entries that each cost a fresh API call.
const ALLOWED_SOLD_WINDOWS = [30, 90];
const DEFAULT_SOLD_WINDOW = 90;

/**
 * Cache key. Normalises the query the same way for everyone — lowercased,
 * collapsed whitespace — so "Charizard  ex 199/165" and "charizard ex 199/165"
 * are one cache entry rather than two API calls.
 */
function cacheKey(query, sold, soldAfterDays) {
  const normal = String(query).toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${normal}|${QUERY_OPTIONS.ebaySite}|${sold ? "sold" : "active"}|${soldAfterDays}`)
    .digest("hex");
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const sold = body.sold !== false;
  // Anything not on the allow-list falls back to the default rather than
  // erroring — a bad value is a caller bug, not something a visitor can fix.
  const soldAfterDays = ALLOWED_SOLD_WINDOWS.includes(body.soldAfterDays)
    ? body.soldAfterDays
    : DEFAULT_SOLD_WINDOW;
  if (!query) {
    return NextResponse.json({ ok: false, error: "Type a card to price." }, { status: 400 });
  }
  // A query far longer than any real card name is a probe, not a search.
  if (query.length > 120) {
    return NextResponse.json({ ok: false, error: "That search is too long." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Pricing is temporarily unavailable." }, { status: 503 });
  }

  const key = cacheKey(query, sold, soldAfterDays);
  const ttl = sold ? TTL_SECONDS.sold : TTL_SECONDS.active;
  const freshAfter = new Date(Date.now() - ttl * 1000).toISOString();

  // --- cache first, before the rate limit is even consulted -----------------
  // Deliberate: a cached answer costs us nothing, so there's no reason to deny
  // it to someone who has been searching a lot. Only misses are gated.
  const { data: hit } = await supabase
    .from("soldcomps_cache")
    .select("payload, fetched_at")
    .eq("cache_key", key)
    .gte("fetched_at", freshAfter)
    .maybeSingle();

  if (hit) {
    return NextResponse.json({
      ok: true,
      comps: hit.payload.comps || [],
      // null, not false, when the entry predates this field — "we don't know"
      // and "there is no next page" lead to opposite conclusions about whether
      // a result set was capped, and coercing the first into the second makes
      // a fast-moving card look slow.
      hasNextPage: hit.payload.hasNextPage ?? null,
      rawItemCount: hit.payload.rawItemCount ?? (hit.payload.comps || []).length,
      cached: true,
      fetchedAt: hit.fetched_at
    });
  }

  // --- everything below here is on the path that spends money --------------
  const trusted = isTrustedCaller(request);
  const ip = clientIp(request);

  // Is there a browser here? The rate limit bounds one IP, which is no answer
  // at all to a few hundred proxies each behaving impeccably. Checked before
  // the limit because it costs a hash rather than a database write, and only
  // on a miss, so a visitor re-reading a cached price is never challenged.
  if (turnstileEnabled() && !trusted && !passIsValid(request.cookies.get(PASS_COOKIE)?.value, ip)) {
    return NextResponse.json(
      // The flag, not the prose, is what the client keys off: it solves a
      // challenge and retries once. Anything without a browser sees a 403.
      { ok: false, needsChallenge: true, error: "Just checking you're human — one moment." },
      { status: 403 }
    );
  }

  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  // Still counted for a trusted caller — the number is useful for seeing what
  // an audit actually cost — but not enforced against them.
  const { data: count, error: limitError } = await supabase.rpc("bump_rate_limit", {
    p_ip: trusted ? "audit" : ip,
    p_window: windowStart.toISOString()
  });
  // A failure here shouldn't take the page down, but it also shouldn't be a
  // silent way past the limit — log it and continue rather than fail open
  // quietly.
  if (limitError) console.error("rate limit check failed:", limitError.message);
  if (!trusted && !limitError && count > MAX_REQUESTS_PER_HOUR) {
    return NextResponse.json(
      { ok: false, error: "You've made a lot of searches this hour. Try again shortly." },
      { status: 429 }
    );
  }

  const apiKey = process.env.SOLDCOMPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Pricing is temporarily unavailable." }, { status: 503 });
  }

  let parsed;
  try {
    parsed = await fetchFromSoldComps(supabase, apiKey, query, sold, soldAfterDays);
  } catch (err) {
    // Shed by the global pacer: we are inside our own limit on purpose, not
    // broken. Saying so with a Retry-After beats a 502 that invites an
    // immediate retry and makes the queue worse.
    if (err.pacerBusy) {
      return NextResponse.json(
        { ok: false, error: "Lots of searches going through right now. Try again in a few seconds." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    // Upstream detail (quota, key problems) is ours, not the visitor's — it
    // would leak how the service is provisioned and they can't act on it.
    console.error("SoldComps request failed:", err.message);
    const status = err.httpStatus === 429 ? 429 : 502;
    return NextResponse.json({ ok: false, error: "Couldn't reach the price data just now. Try again in a moment." }, { status });
  }

  // Cache even an empty result: "nothing sold in 90 days" is a real answer,
  // and re-asking upstream every time a visitor searches an obscure card is
  // exactly the traffic we can least afford.
  const { error: writeError } = await supabase.from("soldcomps_cache").upsert(
    {
      cache_key: key,
      query: query.toLowerCase().replace(/\s+/g, " ").trim(),
      ebay_site: QUERY_OPTIONS.ebaySite,
      sold,
      payload: { comps: parsed.comps, hasNextPage: parsed.hasNextPage, rawItemCount: parsed.rawItemCount },
      comp_count: parsed.comps.length,
      fetched_at: new Date().toISOString()
    },
    { onConflict: "cache_key" }
  );
  if (writeError) console.error("cache write failed:", writeError.message);

  return NextResponse.json({
    ok: true,
    comps: parsed.comps,
    hasNextPage: parsed.hasNextPage ?? null,
    rawItemCount: parsed.rawItemCount,
    cached: false,
    fetchedAt: new Date().toISOString()
  });
}

// SoldComps' scraper returns 5xx on a query often enough that the business
// app treats it as routine and retries with backoff (see the isRateLimited
// path in apps/app). The public page has to do the same or a visitor sees a
// dead end where the app would have quietly recovered — a single 502 was
// exactly how this surfaced on the first live search.
//
// Only 5xx and 429 are retried: a 4xx won't change on a second attempt and
// every retry spends quota. Timeouts are deliberately NOT retried — each one
// costs the full per-attempt budget, and the visitor is watching a spinner.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [600, 1500];
// Shorter than the app's 20s: a batch run can afford to wait, a person can't.
const ATTEMPT_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFromSoldComps(supabase, apiKey, query, sold, soldAfterDays) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    // Every attempt claims a slot, not just the first. A retry is a request to
    // SoldComps like any other and counts against their 60/minute — pacing only
    // the first attempt would let a wobbly upstream triple our outgoing rate at
    // exactly the moment it is least able to take it.
    const slot = await claimSoldCompsSlot(supabase);
    if (!slot.ok) {
      // On a retry, the original failure is the more useful thing to report:
      // the visitor's request already went out once and came back broken.
      if (attempt > 0) break;
      const busy = new Error("Global SoldComps pacer shed the request");
      busy.pacerBusy = true;
      throw busy;
    }
    try {
      return await attemptSoldComps(apiKey, query, sold, soldAfterDays);
    } catch (err) {
      lastError = err;
      const retryable = err.httpStatus && RETRY_STATUSES.has(err.httpStatus);
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break;
      console.warn(`SoldComps ${err.httpStatus} on "${query}" — retry ${attempt + 1}`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function attemptSoldComps(apiKey, query, sold, soldAfterDays) {
  const url = SoldCompsApi.buildRequestUrl({
    keyword: query,
    count: 240,
    ebaySite: QUERY_OPTIONS.ebaySite,
    itemLocation: QUERY_OPTIONS.itemLocation,
    // Ignored upstream for active listings, but passing 0 keeps the cache key
    // and the request honest about which mode this is.
    soldAfterDays: sold ? soldAfterDays : 0,
    itemCondition: "any"
  });
  const fullUrl = sold ? url : `${url}&sold=false`;

  let response;
  try {
    response = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Without this a hung upstream holds the function open until the platform
      // kills it, and the visitor watches a spinner the whole time.
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
    });
  } catch (networkErr) {
    // No httpStatus, so the retry loop won't spend another attempt on it.
    const e = new Error(
      networkErr.name === "TimeoutError" || networkErr.name === "AbortError"
        ? `SoldComps didn't respond within ${ATTEMPT_TIMEOUT_MS / 1000}s`
        : `Network error calling SoldComps: ${networkErr.message}`
    );
    throw e;
  }

  if (!response.ok) {
    const e = new Error(`SoldComps returned HTTP ${response.status}`);
    e.httpStatus = response.status;
    throw e;
  }
  const json = await response.json();
  const parsed = SoldCompsApi.parseResponse(json, "GBP");
  // hasNextPage is the difference between "12 sales in 90 days" and "at least
  // 40" — without it a saturated result set reads as a complete one, and any
  // volume figure built on it silently understates a fast-moving card.
  parsed.rawItemCount = Array.isArray(json.items) ? json.items.length : 0;
  return parsed;
}
