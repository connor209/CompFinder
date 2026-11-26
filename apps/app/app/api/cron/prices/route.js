import { NextResponse } from "next/server";
import { cronRefusal } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPrices, prunePriceHistory } from "@/lib/pricesync";
import { refreshEurGbp } from "@/lib/fx";

/**
 * Nightly Cardmarket price pull (Vercel Cron — see vercel.json), then thin the
 * old history. Same work as the "Sync now" button in Settings; this is the
 * unattended path, so it's guarded by CRON_SECRET rather than a session.
 *
 * GET /api/cron/prices           all enabled games
 * GET /api/cron/prices?game=x    just one
 *
 * Also refreshes the ECB's euro→pound rate (lib/fx.js, migration 043).
 */
export const maxDuration = 300;

export async function GET(request) {
  const refused = cronRefusal(request);
  if (refused) return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status });

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  const game = new URL(request.url).searchParams.get("game");
  let results;
  try {
    results = await syncPrices(admin, { game });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  const pruned = await prunePriceHistory(admin);
  // The euro rate every Cardmarket figure is shown at. A failure here is
  // reported and changes nothing: yesterday's rate stays in place.
  const fx = await refreshEurGbp(admin);
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, games: results.length, failed, pruned, fx, results });
}
