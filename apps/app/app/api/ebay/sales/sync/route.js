import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserSales } from "@/lib/ebay";

/** Pull recent completed sales into the ebay_sales cache. */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let days = 90;
  try {
    const body = await request.json();
    if (body && Number.isFinite(Number(body.days))) days = Math.min(Math.max(Number(body.days), 1), 365);
  } catch {
    /* default */
  }

  try {
    const admin = createAdminClient();
    const result = await syncUserSales(admin, user.id, days);
    if (!result.connected) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });
    if (result.scopeError) {
      return NextResponse.json({ ok: false, scopeError: true, error: "Reconnect your eBay account to enable sales tracking." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, count: result.count });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Sales sync failed." }, { status: 502 });
  }
}
