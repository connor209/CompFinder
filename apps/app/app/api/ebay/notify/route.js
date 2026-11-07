import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCopySync, verifyNotification, readNotification, SALE_EVENTS, copySyncMode } from "@/lib/copysync";

/**
 * eBay's Platform Notification endpoint: a copy of a listing has sold.
 *
 * The fast path for a pooled listing's picture (lib/copysync.js, trigger
 * "sale"). The 15-minute sweep does the same job if this never fires, so
 * every refusal here is quiet and cheap: a 200 with nothing done, because
 * eBay retries anything else and a retry of a forged message is still forged.
 *
 * Trusted only on eBay's signature — `Base64(MD5(Timestamp + DevID + AppID +
 * CertID))` — and only if the timestamp is fresh. Then the item id is looked up
 * in OUR synced listings to find whose it is; an item nobody here owns does
 * nothing. runCopySync() only ever touches pooled listings, so even a valid
 * notification about a single listing changes nothing.
 *
 * Needs EBAY_DEV_ID beside the client id and secret (the developer account's
 * Dev ID, from the same eBay keyset page). Without it nothing is verified, so
 * nothing is acted on.
 */
export const maxDuration = 60;

const md5base64 = (s) => createHash("md5").update(s, "utf8").digest("base64");
const done = (note) => NextResponse.json({ ok: true, note });

export async function POST(request) {
  const xml = await request.text().catch(() => "");
  const n = readNotification(xml);
  if (copySyncMode() === "off") return done("copy sync off");

  const v = verifyNotification({
    timestamp: n.timestamp,
    signature: n.signature,
    devId: process.env.EBAY_DEV_ID,
    appId: process.env.EBAY_CLIENT_ID,
    certId: process.env.EBAY_CLIENT_SECRET,
    md5base64
  });
  if (!v.ok) {
    console.warn(`[ebay/notify] refused (${v.why}) event=${n.event || "?"} item=${n.itemId || "?"}`);
    return done("not verified");
  }
  if (!SALE_EVENTS.includes(n.event) || !n.itemId) return done("not a sale");

  let admin;
  try { admin = createAdminClient(); } catch { return done("no database"); }
  const { data: rows } = await admin.from("ebay_listings").select("user_id").eq("ebay_item_id", n.itemId).limit(1);
  const userId = rows?.[0]?.user_id || null;
  if (!userId) return done("not one of ours");

  try {
    const r = await runCopySync(admin, userId, { itemIds: [n.itemId], trigger: "sale" });
    if (r.changed.length || r.errors.length) console.log(`[ebay/notify] ${n.event} ${n.itemId}: ${JSON.stringify(r)}`);
  } catch (err) {
    console.error(`[ebay/notify] ${n.itemId}: ${err?.message || err}`);
  }
  return done("handled");
}
