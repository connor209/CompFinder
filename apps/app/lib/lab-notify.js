/**
 * eBay sale notifications for the lab (Trading API Platform Notifications).
 *
 * eBay POSTs a FixedPriceTransaction notification to our URL the moment a
 * fixed-price item sells. The lab treats it as a POKE and nothing more: it
 * never trusts what the notification says was sold. It looks up whether the
 * item is a live lab listing and, if so, runs the same check the button runs,
 * which reads the sale from eBay's own order API with our own token. So a
 * forged notification can at worst make the lab check eBay early.
 *
 * The signature is still checked whenever it can be: eBay signs each
 * notification with Base64(MD5(Timestamp + DevID + AppID + CertID)). The app
 * has never needed a Developer ID before, so that check runs only once
 * EBAY_DEV_ID is set; until then an unsigned poke is throttled instead.
 *
 * App-wide setting, said plainly: the delivery URL is set for the whole eBay
 * APPLICATION (this app's keys), not per listing. Nothing else in the app uses
 * Platform Notifications, and CardUploader lists through its own keys, so it
 * is unaffected. The URL is shown before it is replaced, and a different URL
 * already there is never overwritten without saying so.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const TRADING_URL = "https://api.ebay.com/ws/api.dll";
const SITE_ID_UK = "3";
const COMPAT_LEVEL = "1249";
export const SALE_EVENT = "FixedPriceTransaction";
const MAX_SKEW_MS = 10 * 60 * 1000;

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });
const x = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function trading(token, call, inner) {
  const body = `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${inner}</${call}Request>`;
  const res = await fetch(TRADING_URL, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay ${call} failed (${res.status}).`);
  const resp = parser.parse(text)?.[`${call}Response`] || {};
  if (resp.Ack !== "Success" && resp.Ack !== "Warning") {
    const msg = arr(resp.Errors).map((e) => e?.LongMessage).filter(Boolean).join(" ");
    throw new Error(msg || `eBay rejected ${call}.`);
  }
  return resp;
}

/** What eBay has now: the app's delivery URL, and whether sales notify. */
export async function getNotificationState(token) {
  const app = await trading(token, "GetNotificationPreferences", `<PreferenceLevel>Application</PreferenceLevel>`);
  const user = await trading(token, "GetNotificationPreferences", `<PreferenceLevel>User</PreferenceLevel>`);
  const ad = app.ApplicationDeliveryPreferences || {};
  const events = arr(user.UserDeliveryPreferenceArray?.NotificationEnable);
  const sale = events.find((e) => e?.EventType === SALE_EVENT);
  return {
    url: ad.ApplicationURL || null,
    appEnabled: ad.ApplicationEnable === "Enable",
    saleEnabled: sale?.EventEnable === "Enable",
    devIdSet: Boolean(process.env.EBAY_DEV_ID)
  };
}

/** Point the app's notifications at `url` and turn on the sale event. */
export async function enableSaleNotifications(token, url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("eBay only delivers notifications to an https address.");
  await trading(token, "SetNotificationPreferences",
    `<ApplicationDeliveryPreferences><ApplicationURL>${x(u.toString())}</ApplicationURL>` +
    `<ApplicationEnable>Enable</ApplicationEnable><DeviceType>Platform</DeviceType></ApplicationDeliveryPreferences>` +
    `<UserDeliveryPreferenceArray><NotificationEnable><EventType>${SALE_EVENT}</EventType><EventEnable>Enable</EventEnable></NotificationEnable></UserDeliveryPreferenceArray>`
  );
  return getNotificationState(token);
}

/** Turn the sale event off for this account. The app URL is left alone. */
export async function disableSaleNotifications(token) {
  await trading(token, "SetNotificationPreferences",
    `<UserDeliveryPreferenceArray><NotificationEnable><EventType>${SALE_EVENT}</EventType><EventEnable>Disable</EventEnable></NotificationEnable></UserDeliveryPreferenceArray>`
  );
  return getNotificationState(token);
}

/**
 * Read a notification. Returns { event, itemId, timestamp, signature,
 * recipient } with nulls for anything missing; never throws on a bad body.
 */
export function parseNotification(xml) {
  let doc;
  try { doc = parser.parse(String(xml || "")); } catch { return { event: null }; }
  const env = doc?.Envelope || {};
  const header = env.Header || {};
  const body = env.Body || {};
  const name = Object.keys(body)[0] || null;
  const resp = name ? body[name] || {} : {};
  return {
    event: resp.NotificationEventName || null,
    itemId: resp.Item?.ItemID != null ? String(resp.Item.ItemID) : null,
    timestamp: resp.Timestamp || null,
    signature: header.RequesterCredentials?.NotificationSignature || null,
    recipient: resp.RecipientUserID || null
  };
}

/**
 * eBay's signature: Base64(MD5(Timestamp + DevID + AppID + CertID)), and a
 * timestamp within ten minutes so an old notification cannot be replayed.
 * Returns "verified", "unverifiable" (no EBAY_DEV_ID) or "bad".
 */
export function verifySignature({ timestamp, signature }, now = Date.now()) {
  const dev = process.env.EBAY_DEV_ID;
  const appId = process.env.EBAY_CLIENT_ID;
  const cert = process.env.EBAY_CLIENT_SECRET;
  if (!dev || !appId || !cert) return "unverifiable";
  if (!timestamp || !signature) return "bad";
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t) || Math.abs(now - t) > MAX_SKEW_MS) return "bad";
  const want = Buffer.from(createHash("md5").update(`${timestamp}${dev}${appId}${cert}`).digest("base64"));
  const got = Buffer.from(String(signature));
  return want.length === got.length && timingSafeEqual(want, got) ? "verified" : "bad";
}
