import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Forget the user's eBay connection: drop cached listings + stored tokens. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    await admin.from("ebay_listings").delete().eq("user_id", user.id);
    await admin.from("ebay_accounts").delete().eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Disconnect failed." }, { status: 500 });
  }
}
