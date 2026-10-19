import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserListings, syncUserSales } from "@/lib/ebay";
import { snapshotUserPortfolio } from "@/lib/portfolio";

/**
 * Scheduled auto-sync (Vercel Cron, daily — see vercel.json). Re-pulls every
 * connected account's active listings and recent sales so the inventory cache,
 * "already listed?" checks and P&L stay fresh without anyone hitting Sync.
 *
 * A failure is logged and returned, never only counted: an `errors: 1` with no
 * reason is what made "the sync sometimes doesn't work" impossible to chase
 * from the Vercel logs. Each account is tried on its own, so one account's
 * failure never stops the next.
 *
 * Secured with CRON_SECRET when set: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`. Set CRON_SECRET in the environment to
 * lock this route down.
 */
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  const { data: accounts } = await admin.from("ebay_accounts").select("user_id");
  const today = new Date().toISOString().slice(0, 10);
  let listings = 0;
  let sales = 0;
  let snapshots = 0;
  let errors = 0;
  const failures = [];
  const incomplete = [];
  for (const a of accounts || []) {
    try {
      const r = await syncUserListings(admin, a.user_id);
      listings += 1;
      if (r.connected && !r.complete) incomplete.push({ user: a.user_id, missed: r.missed || 0, truncated: !!r.truncated });
    } catch (e) {
      errors += 1;
      failures.push({ user: a.user_id, step: "listings", error: e?.message || String(e) });
      console.error(`[cron/sync] listings failed for ${a.user_id}: ${e?.message || e}`);
    }
    try {
      const r = await syncUserSales(admin, a.user_id, 90);
      if (!r.scopeError) sales += 1;
    } catch (e) {
      /* sales best-effort, but say so */
      failures.push({ user: a.user_id, step: "sales", error: e?.message || String(e) });
      console.error(`[cron/sync] sales failed for ${a.user_id}: ${e?.message || e}`);
    }
    // Snapshot AFTER the listings re-sync so the day's value reflects fresh data.
    try {
      await snapshotUserPortfolio(admin, a.user_id, today);
      snapshots += 1;
    } catch {
      /* snapshot best-effort */
    }
  }
  if (incomplete.length) console.warn(`[cron/sync] incomplete listing read, nothing removed: ${JSON.stringify(incomplete)}`);
  return NextResponse.json({ ok: errors === 0, accounts: (accounts || []).length, listings, sales, snapshots, errors, failures, incomplete });
}
