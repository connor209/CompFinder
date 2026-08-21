import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, reviseItemQuantity, endListing } from "@/lib/ebay";

/**
 * Hide a listing while its card is checked out to a show. Modes:
 *  - "auto" (default): quantity → 0 first (keeps the item id, watchers and
 *    history — needs the seller's out-of-stock control enabled); if eBay
 *    rejects that, falls back to ENDING the listing, logged for relist.
 *  - "quantity": out-of-stock only — surfaces eBay's error instead of
 *    falling back (for sellers who want to know their OOS setting is off).
 *  - "ended": straight to end & relist-on-return.
 * Ownership-guarded.
 *
 * POST { itemId, mode? } → { ok, method: "quantity" | "ended" }
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
  const mode = ["auto", "quantity", "ended"].includes(body.mode) ? body.mode : "auto";

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("ebay_listings")
    .select("ebay_item_id,title,price_value,price_currency")
    .eq("user_id", user.id)
    .eq("ebay_item_id", itemId)
    .single();
  if (!row) return NextResponse.json({ ok: false, error: "That listing isn't in your synced inventory." }, { status: 404 });

  const token = await getValidUserAccessToken(admin, user.id);
  if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

  // Preferred: out-of-stock hide. Same item comes back with quantity → 1.
  if (mode !== "ended") {
    try {
      await reviseItemQuantity(token, itemId, 0);
      return NextResponse.json({ ok: true, method: "quantity", itemId });
    } catch (err) {
      if (mode === "quantity") {
        return NextResponse.json(
          { ok: false, error: `${err.message || "eBay rejected the out-of-stock hide."} Check the out-of-stock option in your eBay selling preferences, or switch the hide method to Auto.` },
          { status: 502 }
        );
      }
      /* auto: seller likely doesn't have out-of-stock control — fall through to end */
    }
  }

  try {
    await endListing(token, itemId);
    await admin.from("ebay_listings").delete().eq("user_id", user.id).eq("ebay_item_id", itemId);
    // Log the end so the relist path (and audit) can find it later.
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
    return NextResponse.json({ ok: true, method: "ended", itemId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Couldn't hide the listing." }, { status: 502 });
  }
}
