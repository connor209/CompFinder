/**
 * Switch eBay's sale notifications on, off, or show what is set.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   EBAY_CLIENT_ID=… EBAY_CLIENT_SECRET=… \
 *     node scripts/ebay-notifications.mjs --show
 *   …   node scripts/ebay-notifications.mjs --on https://<the app>/api/ebay/notify
 *   …   node scripts/ebay-notifications.mjs --off
 *
 * With them on, eBay POSTs to /api/ebay/notify the moment a copy sells and a
 * pooled listing's picture moves in seconds instead of at the next 15-minute
 * sweep (apps/app/lib/copysync.js). The route also needs EBAY_DEV_ID on the
 * comp-finder project, or it cannot verify eBay's signature and acts on
 * nothing.
 *
 * Run once, by hand. The URL is set for the whole eBay keyset; the events are
 * switched on for the account named by --user, else the most recently
 * connected one. UNTESTED against live eBay — --show afterwards is the check.
 */
import { createClient } from "@supabase/supabase-js";
import {
  getValidUserAccessToken, setNotificationPreferences, getNotificationPreferences
} from "../apps/app/lib/ebay.js";

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null; };
const ON = args.includes("--on") ? argOf("--on") : null;
const OFF = args.includes("--off");
const SHOW = args.includes("--show") || (!ON && !OFF);

if (args.includes("--on") && !/^https:\/\/.+\/api\/ebay\/notify$/.test(ON || "")) {
  console.error("--on needs the full https URL ending /api/ebay/notify.");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let userId = argOf("--user");
if (!userId) {
  const { data } = await sb.from("ebay_accounts").select("user_id").order("connected_at", { ascending: false }).limit(1);
  userId = data?.[0]?.user_id || null;
}
if (!userId) { console.error("No connected eBay account."); process.exit(1); }
const token = await getValidUserAccessToken(sb, userId);
if (!token) { console.error("Could not get an eBay token — reconnect the account in the app."); process.exit(1); }

try {
  if (ON) { await setNotificationPreferences(token, { url: ON, enable: true }); console.log(`✓ notifications on → ${ON}`); }
  if (OFF) { await setNotificationPreferences(token, { enable: false }); console.log("✓ sale notifications off"); }
  if (SHOW || ON || OFF) {
    const p = await getNotificationPreferences(token);
    console.log(`URL: ${p.url || "(none)"} · application ${p.appEnabled || "?"}`);
    for (const e of p.events) console.log(`  ${e.event}: ${e.state}`);
    if (!p.events.length) console.log("  (no events set for this account)");
  }
} catch (err) {
  console.error(`✗ ${err?.message || err}`);
  process.exit(1);
}
