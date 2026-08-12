import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
 * GET /api/ebay/my-listings?name=Zapdos&number=15/62
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

  const sp = new URL(request.url).searchParams;
  const name = (sp.get("name") || sp.get("q") || "").trim();
  const number = (sp.get("number") || "").trim();
  if (!name) {
    return NextResponse.json({ ok: true, configured: true, listings: [] });
  }

  const normNum = number.replace(/\s+/g, "").toLowerCase();
  const nameWords = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const matches = (list) =>
    list.filter((l) => {
      const title = (l.title || "").toLowerCase();
      if (normNum) return title.replace(/\s+/g, "").includes(normNum);
      return nameWords.length > 0 && nameWords.every((w) => title.includes(w));
    });

  // Preferred path: if the user has CONNECTED their eBay account, match against
  // the locally cached inventory — instant, exact, and covers every listing
  // (not just what Browse happens to index). No live eBay call needed.
  try {
    const admin = createAdminClient();
    const { data: acct } = await admin.from("ebay_accounts").select("user_id").eq("user_id", user.id).single();
    if (acct) {
      const { data: cached } = await admin
        .from("ebay_listings")
        .select("title,url,image_url,price_value,price_currency")
        .eq("user_id", user.id);
      const listings = matches(cached || [])
        .slice(0, 10)
        .map((l) => ({
          title: l.title,
          url: l.url,
          image: l.image_url || null,
          price: l.price_value != null ? { value: l.price_value, currency: l.price_currency } : null
        }));
      return NextResponse.json({ ok: true, configured: true, connected: true, listings });
    }
  } catch {
    // Service role not set up, or table missing — fall through to the Browse
    // path below so username-only users still get a (best-effort) check.
  }

  // Fallback path (no connected account): the user's eBay username lives in
  // their profile settings, and we search the public Browse API by name.
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
    // Search by NAME only (eBay full-text is finicky about "15/62"-style
    // fragments), then interpret the card number ourselves against the
    // returned titles — far more robust than making eBay match the number.
    const params = new URLSearchParams({ q: name, limit: "50", filter: `sellers:{${username}}` });
    const res = await fetch(`${BROWSE_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, configured: true, error: `eBay search failed (${res.status}). ${body.slice(0, 200)}`.trim(), listings: [] },
        { status: 502 }
      );
    }
    const json = await res.json();
    const items = json.itemSummaries || [];

    // Same interpretation as the connected path: keep listings whose title
    // contains the (whitespace-insensitive) card number, else match on name.
    const listings = matches(items)
      .slice(0, 10)
      .map((it) => ({
      title: it.title,
      url: it.itemWebUrl,
      image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
      price: it.price ? { value: it.price.value, currency: it.price.currency } : null
    }));
    return NextResponse.json({ ok: true, configured: true, listings, scanned: items.length });
  } catch (err) {
    return NextResponse.json({ ok: false, configured: true, error: err.message || "eBay lookup failed.", listings: [] }, { status: 500 });
  }
}
