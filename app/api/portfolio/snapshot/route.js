import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { snapshotUserPortfolio } from "@/lib/portfolio";

/**
 * Take (or refresh) today's portfolio snapshot for the signed-in user. Called
 * from the dashboard on load so the "value over time" chart has a current
 * point without waiting for the nightly cron. Idempotent — upserts one row per
 * day. Uses the admin client to write portfolio_snapshots (service-role only).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const row = await snapshotUserPortfolio(admin, user.id, today);
    return NextResponse.json({ ok: true, snapshot: row });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Snapshot failed." }, { status: 500 });
  }
}
