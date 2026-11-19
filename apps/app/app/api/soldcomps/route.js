import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSoldComps } from "@/lib/soldcomps-fetch";
import { readCache, writeCache } from "@/lib/comp-cache";

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

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body wasn't valid JSON." }, { status: 400 });
  }
  const { query, options = {} } = body || {};
  if (!query) {
    return NextResponse.json({ ok: false, error: "Missing search query." }, { status: 400 });
  }

  // Cache first, before the key is even read — a cached answer costs nothing
  // and a batch run re-priced the same day is the normal case rather than the
  // exception. Best effort throughout: migration 025 is applied by hand, and
  // without it this returns null and the run behaves exactly as it did before.
  // `fresh` skips the read, never the write: a sale from this morning is
  // missing from a cache entry fetched last night, and asking again is the
  // only way to see it. Not part of the cache key — it changes when we ask,
  // not what we are asking.
  const cached = body.fresh ? null : await readCache(supabase, query, options);
  if (cached) return NextResponse.json({ ok: true, ...cached });

  try {
    const result = await fetchSoldComps(profile.soldcomps_api_key, query, options);
    // Only a real answer is worth keeping. Caching an empty result would pin a
    // card at "no comps" for a day over one bad moment upstream, and the whole
    // point of a miss is that it is cheap to retry.
    if (result.comps.length > 0) await writeCache(supabase, query, options, result);
    return NextResponse.json({ ok: true, ...result, cached: false, fetchedAt: new Date().toISOString() });
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
