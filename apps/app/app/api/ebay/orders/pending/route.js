import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchPendingOrders } from "@/lib/ebay";
import { LABELLED_WINDOW_DAYS } from "@/lib/packed-store";

/**
 * Orders that still need picking/packing — the pull sheet's source. Includes
 * orders eBay calls dispatched because a label was printed, marked
 * `labelPrinted`; the sheet drops the ones it has packed (lib/packed-store.js).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const t0 = Date.now();
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });
    const tokenMs = Date.now() - t0;
    const { lines, labelledError, timing } = await fetchPendingOrders(token, { labelledWithinDays: LABELLED_WINDOW_DAYS });
    // Where the server's time went, for the pull sheet's "Opened in" line.
    return NextResponse.json({ ok: true, lines, labelledError, timing: { tokenMs, ...timing } });
  } catch (err) {
    if (err.scope) return NextResponse.json({ ok: false, scopeError: true, error: "Reconnect your eBay account to enable order picking." }, { status: 403 });
    return NextResponse.json({ ok: false, error: err.message || "Failed to load orders." }, { status: 502 });
  }
}
