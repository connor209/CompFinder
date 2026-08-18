import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPrices, prunePriceHistory } from "@/lib/pricesync";

/**
 * Run the price ingest on demand from Settings.
 *
 * The cron route does the same work but is guarded by CRON_SECRET, which a
 * browser can't send — so this one authenticates with the signed-in session
 * instead. Prices are public reference data, so any signed-in user may refresh
 * them; nothing user-specific is read or written.
 *
 * POST { game? } — one game, or every enabled one when omitted.
 */
export const maxDuration = 300;

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* body is optional */
  }
  const game = typeof body.game === "string" && body.game ? body.game : null;

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  let results;
  try {
    results = await syncPrices(admin, { game });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }

  // Only worth pruning after a full run; a single game barely moves the needle.
  const pruned = game ? null : await prunePriceHistory(admin);
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, failed, pruned, results });
}
