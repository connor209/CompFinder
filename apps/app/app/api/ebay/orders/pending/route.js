import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchPendingOrders } from "@/lib/ebay";

/** Orders that still need picking/shipping — the pull sheet's source. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });
    const lines = await fetchPendingOrders(token);
    return NextResponse.json({ ok: true, lines });
  } catch (err) {
    if (err.scope) return NextResponse.json({ ok: false, scopeError: true, error: "Reconnect your eBay account to enable order picking." }, { status: 403 });
    return NextResponse.json({ ok: false, error: err.message || "Failed to load orders." }, { status: 502 });
  }
}
