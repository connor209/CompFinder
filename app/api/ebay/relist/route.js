import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, relistListing, syncUserListings } from "@/lib/ebay";

/**
 * Relist a previously-ended listing. Ownership is verified against the
 * change log (the item must have been ended by this user). Re-syncs the cache
 * afterwards so the new listing appears.
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

  // Ownership: this item must appear in the user's end-listing history.
  const { data: logged } = await admin
    .from("ebay_price_changes")
    .select("id")
    .eq("user_id", user.id)
    .eq("ebay_item_id", itemId)
    .eq("source", "ended")
    .limit(1)
    .maybeSingle();
  if (!logged) {
    return NextResponse.json({ ok: false, error: "No ended listing found for that item in your history." }, { status: 404 });
  }

  try {
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

    const result = await relistListing(token, itemId);
    // Bring the new listing into the cache.
    await syncUserListings(admin, user.id).catch(() => {});
    return NextResponse.json({ ok: true, newItemId: result.newItemId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Relist failed." }, { status: 502 });
  }
}
