import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import SoldCompsApi from "@compfinder/core/soldcomps.js";
import { createServiceClient } from "@/lib/supabase";

/**
 * Public pricing endpoint. Same job as the app's /api/soldcomps, but with the
 * three differences that matter once anyone on the internet can call it:
 *
 *   - No auth. The app's route reads a per-user BYOK key and 401s otherwise;
 *     this one uses a single server-side key (SOLDCOMPS_API_KEY).
 *   - Cache first, always. A repeat query costs nothing, which is both the
 *     margin and the main defence against someone walking the catalogue.
 *   - Rate limited per IP, because the endpoint spends real money per miss.
 *
 * POST { query, sold? }  ->  { ok, comps, cached, fetchedAt }
 */

// Sold data covers a 90-day window and barely moves hour to hour; asking
// prices change as listings come and go, and a stale "buy one now" row that
// has already sold is a worse experience than a slightly slower page.
const TTL_SECONDS = { sold: 24 * 60 * 60, active: 2 * 60 * 60 };

// Generous enough that no real person hits it, tight enough that a scraper
// can't run up the bill on distinct queries. Cache hits are counted too:
// cheap for us, but still a signal of automated traffic.
const MAX_REQUESTS_PER_HOUR = 120;

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

/**
 * Client IP. Vercel sets x-forwarded-for; the left-most entry is the client,
 * the rest are proxies. Falls back to a constant so a missing header buckets
 * everyone together rather than handing out an unlimited allowance.
 */
function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || request.headers.get("x-real-ip") || "unknown";
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
    return NextResponse.json({ ok: true, comps: hit.payload.comps || [], cached: true, fetchedAt: hit.fetched_at });
  }

  // --- rate limit, on the path that spends money ---------------------------
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const { data: count, error: limitError } = await supabase.rpc("bump_rate_limit", {
    p_ip: clientIp(request),
    p_window: windowStart.toISOString()
  });
  // A failure here shouldn't take the page down, but it also shouldn't be a
  // silent way past the limit — log it and continue rather than fail open
  // quietly.
  if (limitError) console.error("rate limit check failed:", limitError.message);
  if (!limitError && count > MAX_REQUESTS_PER_HOUR) {
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
    parsed = await fetchFromSoldComps(apiKey, query, sold, soldAfterDays);
  } catch (err) {
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
      payload: { comps: parsed.comps },
      comp_count: parsed.comps.length,
      fetched_at: new Date().toISOString()
    },
    { onConflict: "cache_key" }
  );
  if (writeError) console.error("cache write failed:", writeError.message);

  return NextResponse.json({ ok: true, comps: parsed.comps, cached: false, fetchedAt: new Date().toISOString() });
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

async function fetchFromSoldComps(apiKey, query, sold, soldAfterDays) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
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
  return SoldCompsApi.parseResponse(await response.json(), "GBP");
}
