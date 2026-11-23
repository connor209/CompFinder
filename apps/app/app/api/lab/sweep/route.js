import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken } from "@/lib/ebay";
import { usersWithLiveListings, logEvent } from "@/lib/lab-store";
import { runCheck } from "@/lib/lab-run";

/**
 * The lab's nightly safety net (vercel.json, after the 3am sync). eBay does
 * not promise to deliver every notification, so once a day every account with
 * a live lab listing gets the same check the button runs, over the last three
 * days of orders. A sale a notification missed is reserved here, and a
 * listing whose photos fell behind is moved on. Costs one order read per
 * account plus calls for the listings that changed — never one per listing.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, the same as the
 * existing jobs.
 */
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  let users;
  try {
    users = await usersWithLiveListings(admin);
  } catch (e) {
    // The lab's tables missing is not an error for a job that runs every night.
    return NextResponse.json({ ok: true, users: 0, note: e.message });
  }
  const out = [];
  for (const userId of users) {
    try {
      const token = await getValidUserAccessToken(admin, userId);
      if (!token) { out.push({ userId, ok: false, error: "no eBay token" }); continue; }
      const r = await runCheck(admin, userId, token, { source: "sweep" });
      await logEvent(admin, userId, null, "sweep", { reserved: r.reserved, moved: r.moved, asked: r.asked, orders: r.orders, oversold: r.oversold, error: r.ok ? undefined : r.error });
      out.push({ userId, ok: r.ok, reserved: r.reserved, moved: r.moved });
    } catch (e) {
      console.error("lab sweep failed", userId, e);
      await logEvent(admin, userId, null, "error", { action: "sweep", message: e.message });
      out.push({ userId, ok: false, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, users: out.length, results: out });
}
