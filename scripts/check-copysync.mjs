/**
 * Multi-copy listings, unattended — what each trigger may change.
 *
 *   node scripts/check-copysync.mjs      (or: npm run check)
 *
 * lib/copysync.js is the first thing in the app that edits eBay listings with
 * nobody watching, so what this pins is mostly what it must NOT do: touch a
 * single listing, act without the unshipped orders, set a quantity off a
 * day-old number, believe an unsigned notification, or run before it is
 * switched on.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { revisePooledListing, isEbayHosted } from "../apps/app/lib/ebay.js";
import {
  copySyncMode, pooledItemIds, planCopySync, runCopySync, verifyNotification,
  readNotification, NOTIFICATION_MAX_AGE_MS, SALE_EVENTS
} from "../apps/app/lib/copysync.js";

let failures = 0;
const fail = (m) => { console.error(`  ${m}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, got) => { if (!got) fail(`${label} — expected truthy, got ${JSON.stringify(got)}`); };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const POOL = "1111";
const SINGLE = "2222";
const copy = (n, over = {}) => ({
  id: `c${n}`, stack_id: "A", sku: "MACHOP-52", ebay_item_id: POOL, position: n, copy_seq: n,
  scan_url: `https://scans.example/${n}.jpg`, added_at: `2026-11-0${n}T10:00:00Z`,
  pulled_at: null, checked_out_at: null, ...over
});
const CARDS = [copy(1), copy(2), copy(3),
  { id: "s1", stack_id: "B", sku: "A50", ebay_item_id: SINGLE, position: 50, pulled_at: null, checked_out_at: null, scan_url: "https://scans.example/s.jpg" }];
const LISTINGS = new Map([[POOL, { ebay_item_id: POOL, title: "Machop 52/102", quantity: 3 }], [SINGLE, { ebay_item_id: SINGLE, title: "Pikachu", quantity: 1 }]]);
const PICTURED_1 = new Map([[POOL, { pictured_copy_id: "c1" }]]);
const SOLD = [{ lineItemId: "L1", sku: "MACHOP-52", itemId: POOL, quantity: 1 }];

// --- switched off unless switched on ----------------------------------------
eq("unset is off", copySyncMode({}), "off");
eq("anything unrecognised is off", copySyncMode({ COPY_SYNC: "yes please" }), "off");
eq("dry is dry", copySyncMode({ COPY_SYNC: " DRY " }), "dry");
eq("on is on", [copySyncMode({ COPY_SYNC: "on" }), copySyncMode({ COPY_SYNC: "1" })], ["on", "on"]);
const offRun = await runCopySync({ from() { throw new Error("touched the database"); } }, "u1", { env: {} });
ok("off touches nothing at all", offRun.off && !offRun.errors.length);

// --- only pooled listings, whatever is asked for ----------------------------
eq("a pool is two or more rows on one item id", [...pooledItemIds(CARDS)], [POOL]);
eq("pulled rows still count, so a pool is looked after to its last copy",
  [...pooledItemIds([copy(1, { pulled_at: "x" }), copy(2, { pulled_at: "x" }), copy(3)])], [POOL]);
const askedSingle = planCopySync({ cards: CARDS, lines: [], listings: LISTINGS, state: new Map(), itemIds: [SINGLE, "9999"], trigger: "box", liveQuantity: new Map([[SINGLE, 0]]) });
eq("a single listing is never planned, even when named", askedSingle.items, []);

// --- never blind ------------------------------------------------------------
const blind = planCopySync({ cards: CARDS, lines: null, listings: LISTINGS, state: PICTURED_1 });
ok("no orders, no plan", blind.blind && blind.items.length === 0);

// --- a sale changes the picture, and only the picture -----------------------
const sale = planCopySync({ cards: CARDS, lines: SOLD, listings: new Map([[POOL, { ...LISTINGS.get(POOL), quantity: 3 }]]), state: PICTURED_1, trigger: "sale" });
eq("after a sale the picture moves to the next copy", sale.items[0].plan.changes.pictureUrls, ["https://scans.example/2.jpg"]);
eq("...and the quantity is left to eBay, even off a stale mirror", sale.items[0].plan.changes.quantity, undefined);
ok("...and no reason claims otherwise", sale.items[0].plan.reasons.every((r) => !r.startsWith("quantity")));
const settled = planCopySync({ cards: CARDS, lines: SOLD, listings: LISTINGS, state: new Map([[POOL, { pictured_copy_id: "c2" }]]), trigger: "sale" });
ok("the next sweep has nothing to do", settled.items[0].plan.empty);

// --- a quantity only off a number read just now ------------------------------
const NO_ORDERS = [];
const PULLED = [copy(1, { pulled_at: "2026-11-07T19:00:00Z" }), copy(2), copy(3)];
const boxLive = planCopySync({ cards: PULLED, lines: NO_ORDERS, listings: LISTINGS, state: new Map([[POOL, { pictured_copy_id: "c2" }]]), trigger: "box", liveQuantity: new Map([[POOL, 3]]) });
eq("a box change sets the quantity off eBay's live number", boxLive.items[0].plan.changes.quantity, 2);
const boxNoLive = planCopySync({ cards: PULLED, lines: NO_ORDERS, listings: LISTINGS, state: new Map([[POOL, { pictured_copy_id: "c2" }]]), trigger: "box", liveQuantity: new Map() });
eq("...and sets none when the live read failed", boxNoLive.items[0].plan.changes.quantity, undefined);
const nightly = planCopySync({ cards: PULLED, lines: NO_ORDERS, listings: LISTINGS, state: new Map([[POOL, { pictured_copy_id: "c2" }]]), trigger: "nightly" });
eq("the nightly run trusts the mirror it has just refreshed", nightly.items[0].plan.changes.quantity, 2);
const ended = planCopySync({ cards: CARDS, lines: [], listings: new Map(), state: new Map(), trigger: "nightly" });
eq("a pool missing from the synced listings is skipped and says so", ended.items.map((i) => i.skipped), ["not in your synced listings"]);

// --- the notification: eBay's signature or nothing ---------------------------
const md5base64 = (s) => createHash("md5").update(s, "utf8").digest("base64");
const KEYS = { devId: "dev", appId: "app", certId: "cert" };
const now = Date.parse("2026-11-07T12:00:00.000Z");
const ts = "2026-11-07T11:59:00.000Z";
const goodSig = md5base64(`${ts}devappcert`);
eq("a signature eBay made is accepted", verifyNotification({ ...KEYS, timestamp: ts, signature: goodSig, now, md5base64 }), { ok: true });
eq("a wrong one is not", verifyNotification({ ...KEYS, timestamp: ts, signature: md5base64("nope"), now, md5base64 }).why, "signature");
eq("an old one is not, however well signed",
  verifyNotification({ ...KEYS, timestamp: ts, signature: goodSig, now: now + NOTIFICATION_MAX_AGE_MS + 60_000, md5base64 }).why, "stale");
eq("without the Dev ID nothing verifies", verifyNotification({ ...KEYS, devId: undefined, timestamp: ts, signature: goodSig, now, md5base64 }).why, "missing");

const SOAP = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header><ebl:RequesterCredentials xmlns:ebl="urn:ebay:apis:eBLBaseComponents"><ebl:NotificationSignature>${goodSig}</ebl:NotificationSignature></ebl:RequesterCredentials></soapenv:Header><soapenv:Body><GetItemTransactionsResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Timestamp>${ts}</Timestamp><Ack>Success</Ack><NotificationEventName>FixedPriceTransaction</NotificationEventName><RecipientUserID>seller</RecipientUserID><Item><ItemID>${POOL}</ItemID></Item></GetItemTransactionsResponse></soapenv:Body></soapenv:Envelope>`;
eq("the notification is read for signature, time, event and item",
  readNotification(SOAP), { signature: goodSig, timestamp: ts, event: "FixedPriceTransaction", itemId: POOL });
ok("a fixed-price sale is a sale event", SALE_EVENTS.includes("FixedPriceTransaction"));

// --- the wiring -------------------------------------------------------------
const cronCopies = read("apps/app/app/api/cron/copies/route.js");
ok("the sweep refuses every call without CRON_SECRET (it does not fall open)", /if \(!secret \|\|/.test(cronCopies));
ok("the sweep is a sale run: picture only", /trigger: "sale"/.test(cronCopies));
const notify = read("apps/app/app/api/ebay/notify/route.js");
ok("the notification is verified before anything is read", notify.indexOf("verifyNotification(") < notify.indexOf("createAdminClient()"));
ok("...and is a sale run", /trigger: "sale"/.test(notify));
const cronSync = read("apps/app/app/api/cron/sync/route.js");
ok("the nightly reconcile runs only after a successful listings refresh",
  /if \(listingsOk\) \{[\s\S]*?runCopySync\(admin, a\.user_id, \{ trigger: "nightly" \}\)/.test(cronSync));
ok("the pull sheet tells the app after a Commit", /fetch\("\/api\/ebay\/copies"/.test(read("apps/app/app/panel/PullSheet.js")));
ok("the in-app route is a box run", /trigger: "box"/.test(read("apps/app/app/api/ebay/copies/route.js")));
const workflow = read(".github/workflows/copy-sync.yml");
ok("the sweep runs every 15 minutes", /cron: '\*\/15 \* \* \* \*'/.test(workflow));

// --- the scans go to eBay's own picture hosting first -----------------------
// eBay: self-hosted and EPS-hosted URLs "cannot be mixed … within the same
// listing", and self-hosting needs PictureSource=Vendor, which cannot be
// changed once a listing has images. So the revision carries EPS URLs only.
const realFetch = globalThis.fetch;
const calls = [];
const fakeFetch = (failOn = null) => async (url, opts = {}) => {
  calls.push({ url: String(url), body: String(opts.body || "") });
  if (String(url).includes("create_image_from_url")) {
    const src = JSON.parse(opts.body).imageUrl;
    if (failOn && src.includes(failOn)) return new Response(JSON.stringify({ errors: [{ longMessage: "too small" }] }), { status: 400 });
    return new Response(JSON.stringify({ imageUrl: `https://i.ebayimg.com/images/g/${src.split("/").pop()}/s-l1600.jpg` }), { status: 201 });
  }
  return new Response(`<?xml version="1.0"?><ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseFixedPriceItemResponse>`, { status: 200 });
};
try {
  globalThis.fetch = fakeFetch();
  const r = await revisePooledListing("tok", POOL, { imageUrls: ["https://cdn.carduploader.example/front.jpg", "https://cdn.carduploader.example/back.jpg"] });
  const revise = calls.find((c) => c.body.includes("ReviseFixedPriceItemRequest"));
  ok("each scan is uploaded to eBay before the revision", calls.filter((c) => c.url.includes("create_image_from_url")).length === 2);
  ok("...and the revision carries eBay's URLs, in order, and none of ours",
    /front\.jpg\/s-l1600[\s\S]*back\.jpg\/s-l1600/.test(revise.body) && !revise.body.includes("carduploader"));
  ok("...front first, so the gallery shot is the front", revise.body.indexOf("front.jpg") < revise.body.indexOf("back.jpg"));
  eq("the result says what eBay hosted", r.hosted.length, 2);

  calls.length = 0;
  globalThis.fetch = fakeFetch();
  await revisePooledListing("tok", POOL, { imageUrls: ["https://i.ebayimg.com/images/g/abc/s-l1600.jpg"] });
  eq("an eBay-hosted picture is not uploaded again", calls.filter((c) => c.url.includes("create_image_from_url")).length, 0);

  calls.length = 0;
  globalThis.fetch = fakeFetch("back.jpg");
  let threw = false;
  try { await revisePooledListing("tok", POOL, { imageUrls: ["https://cdn.carduploader.example/front.jpg", "https://cdn.carduploader.example/back.jpg"] }); } catch { threw = true; }
  ok("one picture eBay refuses stops the whole revision", threw);
  ok("...and the listing is never revised with half its pictures", !calls.some((c) => c.body.includes("ReviseFixedPriceItemRequest")));

  calls.length = 0;
  threw = false;
  try { await revisePooledListing("tok", POOL, { imageUrls: ["http://insecure.example/a.jpg"] }); } catch { threw = true; }
  ok("an http picture is refused before anything is sent", threw && calls.length === 0);

  calls.length = 0;
  globalThis.fetch = fakeFetch();
  await revisePooledListing("tok", POOL, { quantity: 2 });
  ok("a quantity-only revision uploads nothing", calls.length === 1 && !calls[0].body.includes("PictureDetails"));
} finally {
  globalThis.fetch = realFetch;
}
ok("eBay's own picture host is recognised", isEbayHosted("https://i.ebayimg.com/images/g/x/s-l500.jpg") && !isEbayHosted("https://ebayimg.com.evil.example/x.jpg"));
ok("the unattended path revises through the EPS step", /revisePooledListing\(/.test(read("apps/app/lib/copysync.js")) && !/reviseFixedPriceListing\(/.test(read("apps/app/lib/copysync.js")));
ok("...and so does the hand-run script", !/reviseFixedPriceListing\(/.test(read("scripts/copyqueue-run.mjs")));

if (failures) {
  console.error(`\ncheck-copysync: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-copysync: OK — pooled listings only, never blind, a sale moves the picture and nothing else.");
