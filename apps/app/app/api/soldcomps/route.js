import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import SoldCompsApi from "@compfinder/core/soldcomps.js";

/**
 * Replaces background.js's fetchSoldComps message handler. Same job — call
 * SoldComps with the right key, normalize the response — but the key now
 * comes from the logged-in user's own row (see supabase/schema.sql), never
 * a shared account. This is the BYOK model discussed and confirmed as the
 * only one clearly covered by SoldComps' terms as written (see this
 * conversation's terms-of-service check) — a hosted-shared-key reseller
 * model was considered and explicitly deferred pending written
 * clarification from SoldComps, not built into this route.
 *
 * `sold=false` in the query string switches to SoldComps' own active-
 * listings mode (confirmed in their docs) — this IS the full replacement
 * for what the Terapeak bridge used to provide, with no browser tab, no
 * message-passing, no ToS question to even ask. The caller (the panel
 * page) tries sold=true first and falls back to sold=false only when zero
 * sold comps come back, same two-tier logic as before, just without an
 * extension in the middle.
 */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in.", isAuthError: true }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("soldcomps_api_key")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.soldcomps_api_key) {
    return NextResponse.json(
      { ok: false, error: "No SoldComps API key set — add one in Settings before running a batch.", isAuthError: true },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { query, options = {} } = body;
  if (!query) {
    return NextResponse.json({ ok: false, error: "Missing search query." }, { status: 400 });
  }

  try {
    const result = await fetchSoldComps(profile.soldcomps_api_key, query, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        isAuthError: err.isAuthError || false,
        isQuotaExceeded: err.isQuotaExceeded || false,
        isRateLimited: err.isRateLimited || false
      },
      { status: err.httpStatus || 500 }
    );
  }
}

async function fetchSoldComps(apiKey, query, options) {
  const url = SoldCompsApi.buildRequestUrl({
    keyword: query,
    count: options.count || 240,
    page: options.page || 1,
    ebaySite: options.ebaySite || "ebay.co.uk",
    itemLocation: options.itemLocation || "domestic",
    soldAfterDays: options.sold === false ? 0 : options.soldAfterDays ?? 90, // silently ignored by SoldComps when sold=false anyway — see docs
    itemCondition: options.itemCondition || "any",
    minPrice: options.minPrice ?? null,
    maxPrice: options.maxPrice ?? null
  });
  // `sold` isn't one of buildRequestUrl's existing params (it predates this
  // discovery) — appended directly here rather than touching that function,
  // since every other caller still wants the sold=true default behavior.
  const fullUrl = options.sold === false ? `${url}&sold=false` : url;

  let response;
  try {
    response = await fetch(fullUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (networkErr) {
    throw new Error(`Network error calling SoldComps: ${networkErr.message}`);
  }

  if (response.status === 401) {
    const e = new Error("SoldComps rejected the API key (401 Unauthorized) — check it's entered correctly in Settings.");
    e.isAuthError = true;
    e.httpStatus = 401;
    throw e;
  }
  if (response.status === 403) {
    const e = new Error(
      "SoldComps monthly request quota has been used up (403) — this won't recover until your billing cycle rolls over, or you upgrade your plan."
    );
    e.isQuotaExceeded = true;
    e.httpStatus = 403;
    throw e;
  }
  if (response.status === 429) {
    const e = new Error("SoldComps rate limit hit (429, max 60 requests/minute) — back off briefly and retry.");
    e.isRateLimited = true;
    e.httpStatus = 429;
    throw e;
  }
  if (response.status === 400) {
    let body = "";
    try {
      body = JSON.stringify(await response.json());
    } catch {
      /* body wasn't JSON, ignore */
    }
    throw new Error(`SoldComps rejected the request as invalid (400) — usually a missing keyword or out-of-range parameter. ${body}`);
  }
  if (response.status === 502 || response.status === 503 || response.status === 500) {
    const e = new Error(`SoldComps reported a transient server-side issue (HTTP ${response.status}) — worth a retry.`);
    e.isRateLimited = true; // reuses the same retry-with-backoff path as 429
    throw e;
  }
  if (!response.ok) {
    throw new Error(`SoldComps returned an unexpected error: HTTP ${response.status}`);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error("SoldComps returned a response that wasn't valid JSON — the API may have changed shape.");
  }

  const parsed = SoldCompsApi.parseResponse(json, options.expectedCurrency || "GBP");
  return {
    comps: parsed.comps,
    skippedWrongCurrency: parsed.skippedWrongCurrency,
    currenciesSeen: parsed.currenciesSeen,
    hasNextPage: parsed.hasNextPage,
    rawItemCount: Array.isArray(json.items) ? json.items.length : 0
  };
}
