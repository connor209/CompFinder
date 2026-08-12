import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * "Already listed?" check. Given a search query, returns the signed-in user's
 * own active eBay listings that match — so the deep dive can flag a card they
 * already have up.
 *
 * Uses eBay's Browse API filtered by the user's own username (saved in
 * Settings), authenticated with an application token (client-credentials) —
 * no per-user eBay login needed. Requires EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
 * (the app's Production keyset) in the environment. Marketplace fixed to UK.
 *
 * GET /api/ebay/my-listings?q=Charizard%204/102
 */
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const MARKETPLACE = "EBAY_GB";

// Cached across warm invocations; eBay app tokens last ~2h.
let cachedToken = null;
let cachedExp = 0;

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExp - 60_000) return cachedToken;

  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope")
  });
  if (!res.ok) {
    throw new Error(`eBay auth failed (${res.status}). Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET.`);
  }
  const json = await res.json();
  cachedToken = json.access_token;
  cachedExp = now + (json.expires_in || 7200) * 1000;
  return cachedToken;
}

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in.", listings: [] }, { status: 401 });
  }

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ ok: true, configured: true, listings: [] });
  }

  // The user's eBay username lives in their profile settings.
  const { data: profile } = await supabase.from("profiles").select("settings").eq("id", user.id).single();
  const username = profile?.settings?.ebayUsername;
  if (!username) {
    return NextResponse.json({ ok: true, configured: false, listings: [] });
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return NextResponse.json({ ok: false, configured: false, error: "eBay API keys aren't set on the server.", listings: [] }, { status: 503 });
  }

  try {
    const token = await getAppToken();
    const params = new URLSearchParams({ q, limit: "10", filter: `sellers:{${username}}` });
    const res = await fetch(`${BROWSE_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE
      }
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, configured: true, error: `eBay search failed (${res.status}).`, listings: [] }, { status: 502 });
    }
    const json = await res.json();
    const listings = (json.itemSummaries || []).map((it) => ({
      title: it.title,
      url: it.itemWebUrl,
      image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
      price: it.price ? { value: it.price.value, currency: it.price.currency } : null
    }));
    return NextResponse.json({ ok: true, configured: true, listings });
  } catch (err) {
    return NextResponse.json({ ok: false, configured: true, error: err.message || "eBay lookup failed.", listings: [] }, { status: 500 });
  }
}
