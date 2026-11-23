// The quantity-listing lab (apps/app/lib/lab-copies.js): which copy a sale
// takes, what the listing shows next, and the one case the test is measuring —
// a buyer who saw a different copy from the one they will be sent.
//
//   node scripts/check-labcopies.mjs
//
// Not in `npm run check` yet: the lab is a side build and adds nothing to the
// shared checks until it has been confirmed. Also greps that nothing outside
// the lab imports it, which is the promise the side build makes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  groupsFromItems, groupKey, queueOf, desiredFor, planFor, assignSales, unitKey, pickList, pilePositions, isForSale
} from "../apps/app/lib/lab-copies.js";

let failed = 0;
let n = 0;
function eq(name, got, want) {
  n += 1;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed += 1; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
}

// ---- grouping a CardUploader export -------------------------------------------
const item = (sku, cond, extra = {}) => ({
  sku, title: `Lapras 36/236 Cosmic Eclipse ${cond}`, cardName: "Lapras", cardNumber: "36/236", set: "Cosmic Eclipse",
  condition: cond, images: [`https://cdn.example/${sku}-f.jpg`, `https://cdn.example/${sku}-b.jpg`], graded: false, ...extra
});
{
  const { groups, refused } = groupsFromItems([
    item("LAB1", "NM"), item("LAB2", "LP"), item("LAB3", "NM"), item("LAB4", "NM", { images: [] }),
    item("LAB5", "DMG"), item("LAB6", "NM", { graded: true }), item("LAB3", "NM"), item("", "NM")
  ]);
  eq("NM and LP are two listings", groups.map((g) => [g.condition, g.copies.map((c) => c.sku)]), [["NM", ["LAB1", "LAB3"]], ["LP", ["LAB2"]]]);
  eq("copies keep file order as pile order", groups[0].copies.map((c) => c.seq), [0, 2]);
  eq("refused, each with a reason", refused.map((r) => r.sku), ["LAB4", "LAB5", "LAB6", "LAB3", "row 9"]);
  eq("accents and spacing don't split a card", groupKey({ cardName: "Pokémon  Ball", cardNumber: "1", set: "x", condition: "nm" }) === groupKey({ cardName: "pokemon ball", cardNumber: "1", set: "X", condition: "NM" }), true);
}

// ---- the queue ------------------------------------------------------------------
const L = (id, item, pictured) => ({ id, ebay_item_id: item, pictured_copy_id: pictured, released_lines: [] });
const C = (id, listing, seq, extra = {}) => ({ id, listing_id: listing, sku: `LAB${seq}`, copy_seq: seq, pile_seq: seq, added_at: "2026-11-23T10:00:00Z", scan_urls: [`https://cdn.example/${id}.jpg`], ...extra });

{
  const copies = [C("c3", "A", 3), C("c1", "A", 1), C("c2", "A", 2), C("x1", "B", 4)];
  eq("queue is copy_seq order", queueOf("A", copies).map((c) => c.id), ["c1", "c2", "c3"]);
  eq("a reserved copy is not for sale", isForSale({ reserved_line: "l#1" }), false);
  eq("a pulled copy is not for sale", isForSale({ pulled_at: "now" }), false);
  const sold = copies.map((c) => (c.id === "c1" ? { ...c, reserved_line: "l1#1" } : c));
  eq("after a sale the head moves on", desiredFor(L("A", "111", "c1"), sold).head.id, "c2");
  eq("…and the quantity drops", desiredFor(L("A", "111", "c1"), sold).quantity, 2);
  const plan = planFor(L("A", "111", "c1"), sold, 2);
  eq("plan: move pictures to c2", [plan.headId, plan.pictureUrls], ["c2", ["https://cdn.example/c2.jpg"]]);
  eq("plan: eBay's count agrees, nothing to ask", plan.quantityMismatch, null);
  eq("plan: already showing the head, nothing to send", planFor(L("A", "111", "c2"), sold, 2).pictureUrls, null);
  eq("plan: eBay disagrees on quantity → asked, not sent", planFor(L("A", "111", "c2"), sold, 3).quantityMismatch, { ebay: 3, ours: 2 });
  const allGone = copies.map((c) => (c.listing_id === "A" ? { ...c, reserved_line: `${c.id}#1` } : c));
  eq("plan: nothing left → no photo change", planFor(L("A", "111", "c3"), allGone, 0).pictureUrls, null);
}

// ---- sales → reservations ---------------------------------------------------------
const line = (id, item, qty, date) => ({ line_item_id: id, order_id: `o-${id}`, ebay_item_id: item, quantity: qty, sold_date: date, title: "Lapras" });
{
  const copies = [C("c1", "A", 1), C("c2", "A", 2), C("c3", "A", 3)];
  const listings = [L("A", "111", "c1")];

  const one = assignSales(copies, listings, [line("l1", "111", 1, "2026-11-23T12:00:00Z"), line("zz", "999", 1, "2026-11-23T12:00:00Z")]);
  eq("one sale takes the copy on show, no flag", one.reservations.map((r) => [r.copyId, r.mismatch]), [["c1", false]]);
  eq("another listing's sale is ignored", one.reservations.length, 1);

  // Two sales between checks: the listing showed c1 for both.
  const two = assignSales(copies, listings, [line("l2", "111", 1, "2026-11-23T13:00:00Z"), line("l1", "111", 1, "2026-11-23T12:00:00Z")]);
  eq("two sales go in SALE order", two.reservations.map((r) => [r.line, r.copyId]), [["l1#1", "c1"], ["l2#1", "c2"]]);
  eq("…and the second buyer is flagged: they saw c1", two.reservations.map((r) => r.mismatch), [false, true]);

  const multi = assignSales(copies, listings, [line("l3", "111", 2, "2026-11-23T12:00:00Z")]);
  eq("a quantity-2 line takes two copies", multi.reservations.map((r) => [r.line, r.copyId]), [["l3#1", "c1"], ["l3#2", "c2"]]);
  eq("…only unit 1 is held to the photo", multi.reservations.map((r) => r.mismatch), [false, false]);

  const after = copies.map((c) => (c.id === "c1" ? { ...c, reserved_line: unitKey("l1", 1) } : c));
  const again = assignSales(after, [L("A", "111", "c2")], [line("l1", "111", 1, "2026-11-23T12:00:00Z")]);
  eq("running it twice reserves nothing the second time", again.reservations.length, 0);

  const released = assignSales(copies, [{ ...L("A", "111", "c1"), released_lines: ["l1#1"] }], [line("l1", "111", 1, "2026-11-23T12:00:00Z")]);
  eq("a released (cancelled) unit never takes a copy back", released.reservations.length, 0);

  const over = assignSales([C("c1", "A", 1)], listings, [line("l1", "111", 2, "2026-11-23T12:00:00Z")]);
  eq("more sold than held → oversold, never invented", [over.reservations.length, over.oversold.map((o) => o.line)], [1, ["l3#2".replace("l3", "l1")]]);
}

// ---- which eBay failures are worth a retry -------------------------------------------
{
  const { isTransientEbayError } = await import("../apps/app/lib/lab-copies.js");
  eq("eBay's 'System error … try again later' is retried (it had made the change)", isTransientEbayError("System error. Unable to process your request. Please try again later."), true);
  eq("a 503 is retried", isTransientEbayError("eBay listing revision failed (503)."), true);
  eq("a refused picture is not", isTransientEbayError("The picture URL is invalid."), false);
  eq("an ended listing is not", isTransientEbayError("You are not allowed to revise ended listings."), false);
}

// ---- where a copy is in the pile --------------------------------------------------
{
  const copies = [C("c1", "A", 1, { reserved_line: "a#1" }), C("c2", "A", 2, { pulled_at: "x" }), C("c3", "A", 3, { reserved_line: "b#1" }), C("c4", "B", 4)];
  eq("pulled copies close the pile up; reserved ones don't", [...pilePositions(copies)].map(([k, v]) => [k, v]), [["c1", 1], ["c3", 2], ["c4", 3]]);
  eq("pick list: reserved, deepest first", pickList(copies).map((c) => [c.id, c.position]), [["c3", 2], ["c1", 1]]);
}

// ---- the side build stays on the side ----------------------------------------------
{
  const root = new URL("../apps/app/", import.meta.url).pathname;
  const allowed = new Set(["lib/lab-copies.js", "lib/lab-store.js", "lib/lab-ebay.js", "app/api/lab/route.js", "app/panel/lab/LabCopies.js", "app/panel/lab/page.js", "lib/lab-run.js", "lib/lab-notify.js", "app/api/lab/ebay-notify/route.js"]);
  const offenders = [];
  const offendersOf = (needle, okFiles) => {
    const out = [];
    const w = (dir) => {
      for (const f of readdirSync(dir)) {
        if (f === "node_modules" || f === ".next") continue;
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { w(p); continue; }
        if (!/\.(js|jsx|mjs)$/.test(f)) continue;
        const rel = p.slice(root.length);
        if (!okFiles.includes(rel) && readFileSync(p, "utf8").includes(needle)) out.push(rel);
      }
    };
    w(root);
    return out;
  };
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f === ".next") continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx|mjs)$/.test(f)) continue;
      const rel = p.slice(root.length);
      if (allowed.has(rel)) continue;
      const src = readFileSync(p, "utf8");
      if (/lab-(copies|store|ebay|run|notify)|lab_(listings|copies|events)|\/api\/lab\b/.test(src)) offenders.push(rel);
    }
  };
  walk(root);
  eq("nothing outside the lab reads or links to it", offenders, []);

  const store = readFileSync(join(root, "lib/lab-store.js"), "utf8");
  const reads = store.match(/\.from\(LAB_TABLES\.\w+\)[^;]*/g) || [];
  // ownerOfLiveItem is the one exception, by design: it is how a notification finds its user.
  eq("every lab-store read or write filters on user_id", reads.filter((r) => !/insert\(/.test(r) && !/"user_id", userId/.test(r) && !/select\("id, user_id, checked_at"\)/.test(r)), []);
  eq("…and the one that doesn't is only called by the notification route", offendersOf("ownerOfLiveItem", ["lib/lab-store.js", "app/api/lab/ebay-notify/route.js"]), []);
  const run = readFileSync(join(root, "lib/lab-run.js"), "utf8");
  eq("the lab-run never writes the app's own stock tables", /stack_cards|stock_checkouts|listing_copy_state|ebay_listings/.test(run), false);
  const route = readFileSync(join(root, "app/api/lab/route.js"), "utf8");
  eq("the lab never writes the app's own stock tables", /stack_cards|stock_checkouts|listing_copy_state|ebay_listings/.test(route + store), false);
}

// ---- eBay's sale notification ------------------------------------------------------
{
  const { parseNotification, verifySignature } = await import("../apps/app/lib/lab-notify.js");
  const { createHash } = await import("node:crypto");
  const soap = (ts, sig, event = "FixedPriceTransaction", item = "407384047214") =>
    `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header>` +
    `<ebl:RequesterCredentials xmlns:ebl="urn:ebay:apis:eBLBaseComponents"><ebl:NotificationSignature>${sig}</ebl:NotificationSignature></ebl:RequesterCredentials>` +
    `</soapenv:Header><soapenv:Body><GetItemTransactionsResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Timestamp>${ts}</Timestamp><Ack>Success</Ack>` +
    `<NotificationEventName>${event}</NotificationEventName><RecipientUserID>seller</RecipientUserID><Item><ItemID>${item}</ItemID></Item>` +
    `</GetItemTransactionsResponse></soapenv:Body></soapenv:Envelope>`;
  const ts = "2026-11-23T12:00:00.000Z";
  const now = Date.parse(ts) + 30000;
  const n1 = parseNotification(soap(ts, "abc"));
  eq("a sale notification parses", [n1.event, n1.itemId, n1.timestamp, n1.signature], ["FixedPriceTransaction", "407384047214", ts, "abc"]);
  const { NO_PREFERENCE } = await import("../apps/app/lib/lab-notify.js");
  eq("eBay's 'nothing ever set' reads as off, not an error", NO_PREFERENCE.test("There is no valid preference found for your request."), true);
  eq("garbage parses to nothing, never throws", parseNotification("<<not xml").event ?? null, null);

  const saved = { d: process.env.EBAY_DEV_ID, a: process.env.EBAY_CLIENT_ID, c: process.env.EBAY_CLIENT_SECRET };
  delete process.env.EBAY_DEV_ID;
  process.env.EBAY_CLIENT_ID = "app"; process.env.EBAY_CLIENT_SECRET = "cert";
  eq("no EBAY_DEV_ID → unverifiable, not trusted and not refused", verifySignature(n1, now), "unverifiable");
  process.env.EBAY_DEV_ID = "dev";
  const good = createHash("md5").update(`${ts}devappcert`).digest("base64");
  eq("eBay's signature verifies", verifySignature(parseNotification(soap(ts, good)), now), "verified");
  eq("a wrong signature is refused", verifySignature(parseNotification(soap(ts, "x" + good.slice(1))), now), "bad");
  eq("an old notification is refused (replay)", verifySignature(parseNotification(soap(ts, good)), now + 11 * 60 * 1000), "bad");
  for (const [k, v] of [["EBAY_DEV_ID", saved.d], ["EBAY_CLIENT_ID", saved.a], ["EBAY_CLIENT_SECRET", saved.c]]) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
}

console.log(failed ? `\n${failed} of ${n} lab checks failed.` : `✓ ${n} lab checks pass.`);
process.exit(failed ? 1 : 0);
