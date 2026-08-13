import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUserListings, syncUserSales } from "@/lib/ebay";

/**
 * Scheduled auto-sync (Vercel Cron, daily — see vercel.json). Re-pulls every
 * connected account's active listings and recent sales so the inventory cache,
 * "already listed?" checks and P&L stay fresh without anyone hitting Sync.
 *
 * Secured with CRON_SECRET when set: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`. Set CRON_SECRET in the environment to
 * lock this route down.
 */
export const maxDuration = 60;

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
  let listings = 0;
  let sales = 0;
  let errors = 0;
  for (const a of accounts || []) {
    try {
      await syncUserListings(admin, a.user_id);
      listings += 1;
    } catch {
      errors += 1;
    }
    try {
      const r = await syncUserSales(admin, a.user_id, 90);
      if (!r.scopeError) sales += 1;
    } catch {
      /* sales best-effort */
    }
  }
  return NextResponse.json({ ok: true, accounts: (accounts || []).length, listings, sales, errors });
}
