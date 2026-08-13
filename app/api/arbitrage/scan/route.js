import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { browseActiveListings, ebayConfigured } from "@/lib/ebay";

/**
 * Arbitrage scan — step 1: fetch a batch of active marketplace listings
 * (newly listed, fixed-price) for a generic query. The client then prices
 * each against historic sold comps (via /api/soldcomps) to find where a live
 * listing sits below what the card actually sells for.
 *
 * Kept server-side so the eBay app key never reaches the browser. Uses the
 * client-credentials app token (public data) — no per-user eBay login needed.
 *
 * GET /api/arbitrage/scan?q=pokemon%20card&limit=25
 */
export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in.", listings: [] }, { status: 401 });

  if (!ebayConfigured()) {
    return NextResponse.json({ ok: false, error: "eBay API keys aren't configured on the server.", listings: [] }, { status: 503 });
  }

  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") || "pokemon card").trim();
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "25", 10) || 25, 1), 50);
  const sort = sp.get("sort") || "newlyListed";

  try {
    const listings = await browseActiveListings({ q, limit, sort, marketplace: "EBAY_GB" });
    return NextResponse.json({ ok: true, listings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Scan failed.", listings: [] }, { status: 502 });
  }
}
