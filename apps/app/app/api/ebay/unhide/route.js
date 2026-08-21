import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, reviseItemQuantity, relistListing, syncUserListings } from "@/lib/ebay";

/**
 * Bring a hidden listing back when its card is checked back in. The reverse of
 * /api/ebay/hide: quantity-hidden items go back to quantity 1 (same item id);
 * ended items are relisted (eBay assigns a NEW item id, returned to the caller
 * so stack records can be updated). Ownership-guarded per method.
 *
 * POST { itemId, method: "quantity" | "ended" } → { ok, newItemId? }
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
  const method = body.method === "ended" ? "ended" : "quantity";
  if (!itemId) return NextResponse.json({ ok: false, error: "Missing item id." }, { status: 400 });

  const admin = createAdminClient();
  const token = await getValidUserAccessToken(admin, user.id);
  if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

  try {
    if (method === "quantity") {
      // Ownership: quantity-hidden items are still in the synced inventory.
      const { data: row } = await admin
        .from("ebay_listings")
        .select("ebay_item_id")
        .eq("user_id", user.id)
        .eq("ebay_item_id", itemId)
        .single();
      if (!row) return NextResponse.json({ ok: false, error: "That listing isn't in your synced inventory." }, { status: 404 });
      await reviseItemQuantity(token, itemId, 1);
      return NextResponse.json({ ok: true, itemId });
    }

    // Ownership for relist: the item must be in this user's end-listing log.
    const { data: logged } = await admin
      .from("ebay_price_changes")
      .select("id")
      .eq("user_id", user.id)
      .eq("ebay_item_id", itemId)
      .eq("source", "ended")
      .limit(1)
      .maybeSingle();
    if (!logged) return NextResponse.json({ ok: false, error: "No ended listing found for that item in your history." }, { status: 404 });

    const result = await relistListing(token, itemId);
    await syncUserListings(admin, user.id).catch(() => {});
    return NextResponse.json({ ok: true, newItemId: result.newItemId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Couldn't restore the listing." }, { status: 502 });
  }
}
