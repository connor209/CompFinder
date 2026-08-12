import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ebayConfigured } from "@/lib/ebay";

/** Connection status for the Settings UI: connected?, username, count, when. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false, configured: ebayConfigured() });

  try {
    const admin = createAdminClient();
    const { data: acct } = await admin
      .from("ebay_accounts")
      .select("ebay_username,last_synced_at,connected_at")
      .eq("user_id", user.id)
      .single();

    let count = 0;
    if (acct) {
      const { count: c } = await admin
        .from("ebay_listings")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      count = c || 0;
    }

    return NextResponse.json({
      connected: !!acct,
      username: acct?.ebay_username || null,
      lastSynced: acct?.last_synced_at || null,
      count,
      configured: ebayConfigured()
    });
  } catch (err) {
    return NextResponse.json({ connected: false, configured: ebayConfigured(), error: err.message }, { status: 500 });
  }
}
