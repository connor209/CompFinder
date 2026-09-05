import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchItemPictures } from "@/lib/ebay";

/**
 * Every picture on one of the signed-in user's own listings.
 *
 * This exists for the live stream: a lot cycles four photographs of one card,
 * and the listing sync only ever stored the gallery thumbnail. See
 * apps/app/lib/livestream.js — the pictures shown on a stream are the
 * LISTING's pictures, deliberately, because eBay requires that what is shown
 * live matches the listing and because a buyer disputing the card afterwards
 * is then looking at the same photographs the stream showed them.
 *
 * Ownership-guarded against the synced inventory, exactly like end-listing:
 * this route reads from a connected eBay account, and the item has to be one
 * of the caller's own.
 *
 * GET /api/ebay/pictures?itemId=1234567890
 */
export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const itemId = String(new URL(request.url).searchParams.get("itemId") || "").replace(/[^0-9]/g, "");
  if (!itemId) return NextResponse.json({ ok: false, error: "Missing item id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("ebay_listings")
    .select("ebay_item_id,title,image_url")
    .eq("user_id", user.id)
    .eq("ebay_item_id", itemId)
    .single();
  if (!row) return NextResponse.json({ ok: false, error: "That listing isn't in your synced inventory." }, { status: 404 });

  try {
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });
    const { pictures, title } = await fetchItemPictures(token, itemId);
    return NextResponse.json({ ok: true, itemId, pictures, title: title || row.title || null });
  } catch (err) {
    // The gallery shot is a worse lot than four pictures and a better one than
    // no lot at all — a hall with bad wifi should cost you resolution, not the
    // card. The caller is told this is the fallback so it can say so.
    const fallback = row.image_url ? [String(row.image_url)] : [];
    return NextResponse.json(
      { ok: fallback.length > 0, itemId, pictures: fallback, title: row.title || null, degraded: true, error: err?.message || "eBay picture fetch failed." },
      { status: fallback.length ? 200 : 502 }
    );
  }
}
