import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, addFixedPriceListing, syncUserListings } from "@/lib/ebay";

/** Create a new fixed-price listing on eBay (beta). */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let L;
  try {
    L = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!L.title || !(Number(L.price) > 0) || !L.categoryId) {
    return NextResponse.json({ ok: false, error: "Title, price and category are required." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

    const result = await addFixedPriceListing(token, L);
    // Bring the new listing into the cache. Bulk callers pass skipSync and run
    // a single sync at the end instead of one per item.
    if (!L.skipSync) await syncUserListings(admin, user.id).catch(() => {});
    return NextResponse.json({ ok: true, itemId: result.itemId, warnings: result.warnings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Listing failed." }, { status: 502 });
  }
}
