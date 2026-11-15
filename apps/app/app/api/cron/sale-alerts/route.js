import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchPendingOrders } from "@/lib/ebay";
import { runSaleAlerts } from "@/lib/sale-alerts.js";

/**
 * Discord alerts for new eBay orders — lib/sale-alerts.js has the rules.
 *
 * Called every ten minutes by .github/workflows/sale-alerts.yml, because
 * Vercel's free plan only runs its own crons once a day.
 *
 * Unlike /api/cron/sync this REQUIRES CRON_SECRET: it is called from outside
 * Vercel every ten minutes, and an open route would let anybody make it read
 * your orders and post to your channel on demand.
 *
 * DISCORD_SALES_WEBHOOK_URL is the channel's webhook (Discord → channel
 * settings → Integrations → Webhooks → Copy Webhook URL).
 */
export const maxDuration = 60;

const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Set CRON_SECRET in Vercel first." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const webhookUrl = String(process.env.DISCORD_SALES_WEBHOOK_URL || "").trim();
  if (!WEBHOOK.test(webhookUrl)) {
    return NextResponse.json({ ok: false, error: "DISCORD_SALES_WEBHOOK_URL is missing or isn't a Discord webhook URL." }, { status: 503 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  const { data: accounts, error } = await admin.from("ebay_accounts").select("user_id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results = [];
  for (const a of accounts || []) {
    try {
      const token = await getValidUserAccessToken(admin, a.user_id);
      if (!token) { results.push({ user: a.user_id, ok: false, error: "eBay not connected." }); continue; }
      const { lines } = await fetchPendingOrders(token);
      const r = await runSaleAlerts(admin, a.user_id, { lines, webhookUrl });
      if (r.missing) r.error = "Migration 038 hasn't been run — nothing was posted.";
      results.push({ user: a.user_id, ...r });
      if (!r.ok) console.error(`[cron/sale-alerts] ${a.user_id}: ${r.error}`);
    } catch (e) {
      const msg = e?.scope ? "Reconnect eBay to allow reading orders." : e?.message || String(e);
      results.push({ user: a.user_id, ok: false, error: msg });
      console.error(`[cron/sale-alerts] ${a.user_id}: ${msg}`);
    }
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
