import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { browseComps, ebayConfigured } from "@/lib/ebay";
import { readCache, writeCache } from "@/lib/comp-cache";

/**
 * What a card is LISTED at right now, from eBay's own Browse API.
 *
 * Separate from /api/soldcomps on purpose. That route asks SoldComps, which is
 * metered against the user's own key and is the only way to get SOLD history.
 * Active listings are different: eBay serves them first-party, 5,000 calls a
 * day on a standard keyset, using an APP-level token — so this needs no user
 * OAuth, no per-user key, and costs nothing per call.
 *
 * That difference is the point. Every live-market check in a batch run used to
 * spend a metered request, which is what made the check something to ration to
 * suspicious rows. It was the check that took Sunkern No. 191 from £19.49 to
 * £2.49 against a real market of £2.00, and the one that would have caught
 * Golbat No. 042 at £29.99 on a card listed at £3.48. Rationing it was always
 * the wrong trade; this removes the reason to.
 *
 * Still cached, for a different reason from the sold side: an asking price is
 * only true until someone buys it, so the TTL is two hours rather than a day
 * (see comp-cache.js). Within a run, that stops a repeated card paying twice.
 */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in.", isAuthError: true }, { status: 401 });
  }

  if (!ebayConfigured()) {
    // Not an error the caller should retry or stop a run over — the batch falls
    // back to asking SoldComps for actives exactly as it did before.
    return NextResponse.json(
      { ok: false, error: "eBay app credentials aren't configured — set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.", notConfigured: true },
      { status: 503 }
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

  // Keyed as an active lookup so it can never be served a sold answer, and
  // tagged with the source so switching back to SoldComps for actives would
  // not read entries fetched from somewhere else.
  const cacheOptions = { ...options, sold: false, ebaySite: `browse:${options.ebaySite || "ebay.co.uk"}` };
  const cached = await readCache(supabase, query, cacheOptions);
  if (cached) return NextResponse.json({ ok: true, ...cached });

  try {
    const comps = await browseComps({
      q: query,
      limit: options.limit || 50,
      ukOnly: (options.itemLocation || "domestic") !== "worldwide"
    });
    const result = { comps, hasNextPage: false, rawItemCount: comps.length, skippedWrongCurrency: 0, currenciesSeen: [], source: "ebay-browse" };
    if (comps.length > 0) await writeCache(supabase, query, cacheOptions, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
  }
}
