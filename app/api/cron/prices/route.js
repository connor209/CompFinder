import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPrices, prunePriceHistory } from "@/lib/pricesync";

/**
 * Nightly Cardmarket price pull (Vercel Cron — see vercel.json), then thin the
 * old history. Same work as the "Sync now" button in Settings; this is the
 * unattended path, so it's guarded by CRON_SECRET rather than a session.
 *
 * GET /api/cron/prices           all enabled games
 * GET /api/cron/prices?game=x    just one
 */
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

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
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, games: results.length, failed, pruned, results });
}
