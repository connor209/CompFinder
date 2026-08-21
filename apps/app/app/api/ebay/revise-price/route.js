import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, reviseItemPrice } from "@/lib/ebay";

/**
 * Write-back Phase 2a — update a single listing's price on eBay.
 *
 * Guardrails:
 *  - Ownership: we only revise items that are in the signed-in user's cached
 *    inventory (ebay_listings), so a caller can't touch arbitrary listings.
 *  - Sanity: a drastic change (new < 20% or > 5× the current price) is refused
 *    unless the client explicitly passes force:true (after an extra confirm).
 *  - Audit: every applied change is logged to ebay_price_changes (best-effort).
 *
 * POST { itemId, price, force? }   price in major units (e.g. pounds)
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
  const price = Number(body.price);
  const force = body.force === true;
  if (!itemId) return NextResponse.json({ ok: false, error: "Missing item id." }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ ok: false, error: "Invalid price." }, { status: 400 });

  const admin = createAdminClient();

  // Ownership guard — the item must be in this user's cached inventory.
  const { data: row } = await admin
    .from("ebay_listings")
    .select("ebay_item_id,title,price_value,price_currency")
    .eq("user_id", user.id)
    .eq("ebay_item_id", itemId)
    .single();
  if (!row) {
    return NextResponse.json({ ok: false, error: "That listing isn't in your synced inventory." }, { status: 404 });
  }

  // Sanity guard against a bad comp match nuking a live price.
  const oldPrice = row.price_value != null ? Number(row.price_value) : null;
  if (oldPrice && (price < oldPrice * 0.2 || price > oldPrice * 5) && !force) {
    return NextResponse.json({
      ok: false,
      needsConfirm: true,
      warning: `New price £${price.toFixed(2)} is a big change from £${oldPrice.toFixed(2)}. Confirm to proceed.`,
      oldPrice
    });
  }

  const currency = row.price_currency || "GBP";

  try {
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

    await reviseItemPrice(token, itemId, price, currency);

    // Reflect the new price in the cache immediately.
    await admin.from("ebay_listings").update({ price_value: price }).eq("user_id", user.id).eq("ebay_item_id", itemId);

    // Audit (best-effort — table may not exist yet).
    try {
      await admin.from("ebay_price_changes").insert({
        user_id: user.id,
        ebay_item_id: itemId,
        title: row.title || null,
        old_price: oldPrice,
        new_price: price,
        currency,
        source: "market-update"
      });
    } catch {
      /* audit table optional */
    }

    return NextResponse.json({ ok: true, itemId, price, oldPrice });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Price update failed." }, { status: 502 });
  }
}
