import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, endListing } from "@/lib/ebay";

/**
 * Delist — end a single active listing on eBay. Ownership-guarded (the item
 * must be in the signed-in user's synced inventory) and removes the row from
 * the cache on success.
 *
 * POST { itemId }
 */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const itemId = String(body.itemId || "").replace(/[^0-9]/g, "");
  if (!itemId) return NextResponse.json({ ok: false, error: "Missing item id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("ebay_listings")
    .select("ebay_item_id,title,price_value,price_currency")
    .eq("user_id", user.id)
    .eq("ebay_item_id", itemId)
    .single();
  if (!row) return NextResponse.json({ ok: false, error: "That listing isn't in your synced inventory." }, { status: 404 });

  try {
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

    await endListing(token, itemId);
    await admin.from("ebay_listings").delete().eq("user_id", user.id).eq("ebay_item_id", itemId);

    // Log the end so it can be relisted / audited (best-effort).
    try {
      await admin.from("ebay_price_changes").insert({
        user_id: user.id,
        ebay_item_id: itemId,
        title: row.title || null,
        old_price: row.price_value != null ? Number(row.price_value) : null,
        new_price: null,
        currency: row.price_currency || null,
        source: "ended"
      });
    } catch {
      /* audit table optional */
    }

    return NextResponse.json({ ok: true, itemId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "End-listing failed." }, { status: 502 });
  }
}
