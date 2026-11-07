import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCopySync } from "@/lib/copysync";

/**
 * Something in the app just changed the box — the pull sheet committed a pull
 * — so put the affected pooled listings right now, picture AND quantity, off a
 * live eBay read (lib/copysync.js, trigger "box").
 *
 * POST { itemIds: [...] } → the run's summary. Signed-in only, and acts on the
 * caller's own account; runCopySync() ignores any id that is not a pooled
 * listing of theirs.
 */
export const maxDuration = 60;

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 }); }
  const itemIds = (Array.isArray(body?.itemIds) ? body.itemIds : [])
    .map((x) => String(x || "").replace(/[^0-9]/g, "")).filter(Boolean).slice(0, 100);
  if (!itemIds.length) return NextResponse.json({ ok: true, considered: 0 });

  try {
    const r = await runCopySync(createAdminClient(), user.id, { itemIds, trigger: "box" });
    return NextResponse.json({ ok: !r.errors.length, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Copy sync failed." }, { status: 500 });
  }
}
