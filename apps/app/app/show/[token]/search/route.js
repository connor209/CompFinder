import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicStorefrontCached } from "@/lib/storefront-store.js";
import { storefrontSearch, searchCriteria } from "@/lib/storefront.js";
import { storefrontSets } from "../sets";

/**
 * The storefront's search box: one page of matching cards for a link.
 *
 * Anonymous, like the page it serves, and through the same road —
 * loadPublicStorefront(), owner-filtered by hand, projected — so what comes
 * back is cut from exactly what the page could already show. It reads only
 * the keys in SEARCH_KEYS (searchCriteria()), so the visitor's wish list has
 * no way in, and it is never a view: only the page load counts one.
 *
 * Kept for a minute per token on a warm instance; see
 * loadPublicStorefrontCached(). A dead link answers 404 with nothing in it,
 * the same for unknown and switched off, as the page does.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow"
};

export async function GET(request, { params }) {
  const { token } = await params;
  let result;
  try {
    result = await loadPublicStorefrontCached(createAdminClient(), token, { loadSets: storefrontSets });
    if (result?.timing && !result.timing.logged) {
      // Logged once per load: a cache hit hands back the same object.
      result.timing.logged = true;
      console.info(`[storefront] search reads=${result.timing.readMs}ms project=${result.timing.projectMs}ms cards=${result.timing.cards}`);
    }
  } catch {
    result = { ok: false, reason: "error" };
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason === "error" ? "error" : "ended" }, { status: result.reason === "error" ? 503 : 404, headers: HEADERS });
  }
  const criteria = searchCriteria(new URL(request.url).searchParams);
  const page = storefrontSearch(result.stock.cards, criteria, { onlineFirst: result.storefront.shop });
  return NextResponse.json({ ok: true, ...page }, { headers: HEADERS });
}
