import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCopySync, copySyncMode } from "@/lib/copysync";

/**
 * The sweep: every pooled listing's picture, put right off the unshipped
 * orders (lib/copysync.js, trigger "sale"). Called every 15 minutes by
 * .github/workflows/copy-sync.yml, because Vercel's plan here runs scheduled
 * jobs once a day. It is the backstop for eBay's sale notification, and the
 * only trigger until that is set up.
 *
 * Costs one orders read per account and a revision only where a picture is
 * wrong — quantity is never touched here (eBay lowers it on a sale itself, and
 * the mirror is up to a day old).
 *
 * **Requires CRON_SECRET**, unlike /api/cron/sync, which falls open without
 * one. This route edits listings; an open one is a button anybody can press.
 */
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: secret ? "Unauthorized." : "CRON_SECRET is not set, so this route is closed." }, { status: 401 });
  }
  const mode = copySyncMode();
  if (mode === "off") return NextResponse.json({ ok: true, mode, note: "COPY_SYNC is off — nothing done." });

  let admin;
  try { admin = createAdminClient(); } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  const { data: accounts } = await admin.from("ebay_accounts").select("user_id");
  const results = [];
  for (const a of accounts || []) {
    try {
      const r = await runCopySync(admin, a.user_id, { trigger: "sale" });
      results.push({ user: a.user_id, ...r });
      if (r.changed.length || r.errors.length) console.log(`[cron/copies] ${a.user_id}: ${JSON.stringify(r)}`);
    } catch (err) {
      results.push({ user: a.user_id, errors: [err?.message || String(err)] });
      console.error(`[cron/copies] ${a.user_id}: ${err?.message || err}`);
    }
  }
  const failed = results.some((r) => r.errors?.length);
  return NextResponse.json({ ok: !failed, mode, results });
}
