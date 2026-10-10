import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, endListing, fetchItemQuantity, reviseItemQuantity } from "@/lib/ebay";

/**
 * Delist — end a single active listing on eBay. Ownership-guarded (the item
 * must be in the signed-in user's synced inventory) and removes the row from
 * the cache on success.
 *
 * POST { itemId, oneCopy? } → { ok, ended, remaining? }
 *
 * `oneCopy` is how a sale at the table asks: ONE card has gone, so a listing
 * with more copies behind it drops by one and stays live, and only the last
 * copy ends it. Ending a quantity-3 listing because one copy sold took the
 * other two off eBay AND out of every customer search on the Show Desk, since
 * the counter, the binder and the storefront all read `ebay_listings`.
 *
 * The count is read live (fetchItemQuantity), never off the synced row: a copy
 * that sold online since the last sync would otherwise be put back on sale. If
 * the live read fails we end nothing and say so — the sale is already
 * recorded, an un-ended listing is a retry, and guessing either way is worse.
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

    if (body.oneCopy) {
      let live;
      try {
        live = await fetchItemQuantity(token, itemId);
      } catch (err) {
        return NextResponse.json({ ok: false, error: `couldn't read how many copies are left (${err.message || "eBay unreachable"})` }, { status: 502 });
      }
      if (live.available != null && live.available > 1) {
        const remaining = live.available - 1;
        await reviseItemQuantity(token, itemId, remaining);
        try {
          await admin.from("ebay_listings").update({ quantity: remaining }).eq("user_id", user.id).eq("ebay_item_id", itemId);
        } catch {
          /* the next sync corrects it */
        }
        return NextResponse.json({ ok: true, itemId, ended: false, remaining });
      }
    }

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

    return NextResponse.json({ ok: true, itemId, ended: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "End-listing failed." }, { status: 502 });
  }
}
