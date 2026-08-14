import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchBusinessPolicies } from "@/lib/ebay";

/**
 * List the signed-in seller's eBay Business Policies (shipping/payment/return)
 * so they can pick which to use for CompFinder-created listings. Needs the
 * sell.account.readonly scope; if the stored token predates it, returns
 * { scopeError: true } and the UI shows a reconnect prompt.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const token = await getValidUserAccessToken(admin, user.id);
    if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected.", connected: false });
    const policies = await fetchBusinessPolicies(token);
    return NextResponse.json({ ok: true, connected: true, policies });
  } catch (err) {
    if (err.scope) return NextResponse.json({ ok: false, scopeError: true, error: "Reconnect required for policy access." });
    return NextResponse.json({ ok: false, error: err.message || "Couldn't load policies." }, { status: 502 });
  }
}
