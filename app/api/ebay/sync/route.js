import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserListings } from "@/lib/ebay";

/** Re-pull the connected user's active listings into the cache. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const result = await syncUserListings(admin, user.id);
    if (!result.connected) {
      return NextResponse.json({ ok: false, connected: false, error: "eBay account not connected." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Sync failed." }, { status: 500 });
  }
}
