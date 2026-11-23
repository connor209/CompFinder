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
  removeBlocker, listingForGroup, nextCopySeqs, listingsToTouch, priceFromComps, listBlockers, ORDER_WINDOW_HOURS,
  groupsFromItems, groupKey, queueOf, desiredFor, planFor, assignSales, unitKey, pickList, pilePositions, isForSale, pileOf, displayOrder
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

// ---- scale: only what changed ---------------------------------------------------------
{
  const g = { key: "lapras|36/236|cosmic eclipse|NM", title: "Lapras NM", condition: "NM" };
  const live = { id: "A", ebay_item_id: "111", card_key: g.key, title: "x", condition: "NM" };
  eq("new copies join the live listing for the same card + condition", listingForGroup([live], g)?.id, "A");
  eq("…never an ended one", listingForGroup([{ ...live, ended_at: "x" }], g), null);
  eq("…never another condition", listingForGroup([{ ...live, card_key: "lapras|36/236|cosmic eclipse|LP" }], g), null);
  eq("an older listing with no key joins on title + condition", listingForGroup([{ id: "B", ebay_item_id: "2", card_key: null, title: "Lapras NM", condition: "nm" }], g)?.id, "B");
  eq("joining copies go to the back of the queue", nextCopySeqs([C("c1", "A", 1), C("c2", "A", 5), C("x", "B", 9)], "A", 2), [6, 7]);

  const listings = [L("A", "111", "c1"), L("B", "222", "b1"), L("D", "444", "d2")];
  const copies = [C("c1", "A", 1), C("c2", "A", 2), C("b1", "B", 3), C("d1", "D", 4, { reserved_line: "z#1" }), C("d2", "D", 5)];
  eq("nothing changed → eBay is asked about nothing", listingsToTouch(listings, copies).map((l) => l.id), []);
  eq("a reserved listing is asked about", listingsToTouch(listings, copies, { reservedListingIds: ["A"] }).map((l) => l.id), ["A"]);
  eq("the notified item is asked about", listingsToTouch(listings, copies, { itemId: "222" }).map((l) => l.id), ["B"]);
  const behind = [L("A", "111", "c1"), L("B", "222", "b1"), L("D", "444", "d1")];
  eq("photos behind the queue (a failed revision) are retried, from our rows alone", listingsToTouch(behind, copies).map((l) => l.id), ["D"]);
  eq("a notification reads a narrow window", ORDER_WINDOW_HOURS.notification <= 6, true);

  eq("a comps price is pence", priceFromComps({ suggested_price: 12.49 }), 1249);
  eq("an unpriced card is null, not zero", [priceFromComps({ suggested_price: 0 }), priceFromComps({ suggested_price: null }), priceFromComps(null)], [null, null, null]);
  eq("List all is refused naming the unpriced", listBlockers([{ key: "a", title: "Mew" }, { key: "b", title: "Lugia" }], (k) => (k === "a" ? 249 : null)), ["Lugia"]);
}

// ---- taking one copy off ----------------------------------------------------------------
{
  const l = L("A", "111", "c1");
  const copies = [C("c1", "A", 1), C("c2", "A", 2), C("c3", "A", 3, { reserved_line: "x#1", reserved_order: "o-9" }), C("c4", "A", 4, { pulled_at: "t" })];
  eq("a copy for sale can be removed", removeBlocker(copies[1], l, copies), null);
  eq("…a sold one can't (it's a buyer's)", /has sold/.test(removeBlocker(copies[2], l, copies)), true);
  eq("…a pulled one can't", /pulled/.test(removeBlocker(copies[3], l, copies)), true);
  eq("…nor the last for sale: that is End listing", /last copy/.test(removeBlocker(copies[0], l, [copies[0], copies[2]])), true);
  eq("…nor on an ended listing", /ended/.test(removeBlocker(copies[1], { ...l, ended_at: "t" }, copies)), true);
}

// ---- the database image is never a scan ---------------------------------------------
{
  const { splitScans } = await import("../apps/app/lib/lab-copies.js");
  // Off a real export: two scans under /cards/, CardUploader's database image under /catalog/.
  const urls = [
    "https://images.carduploader.com/cards/2026/11/23/d389b0784180cdeaeffeffd92675cbff.jpg",
    "https://images.carduploader.com/cards/2026/11/23/989e38048ff2bca314a6ad692f3aa000.jpg",
    "https://images.carduploader.com/catalog/japanese_pokemon_cards/2026/10/26/3cf6.jpg"
  ];
  const sp = splitScans(urls);
  eq("the /catalog/ picture is the database image, not a scan", [sp.scans.length, sp.dbImage], [2, urls[2]]);
  eq("…whatever position it sits in", splitScans([urls[2], urls[0]]).scans, [urls[0]]);
  const { groups, refused } = groupsFromItems([
    { sku: "CS-9PDUJK", title: "Mareep", cardName: "Mareep", cardNumber: "002/020", set: "Zeraora Deck", condition: "NM", images: urls },
    { sku: "TEST3-1", title: "Mareep", cardName: "Mareep", cardNumber: "002/020", set: "Zeraora Deck", condition: "NM", images: [urls[2]] },
    { sku: "TEST3-2", title: "Mareep", cardName: "Mareep", cardNumber: "002/020", set: "Zeraora Deck", condition: "NM", images: urls }
  ]);
  eq("a CardUploader SKU is refused, saying how to fix it", /Automatic eBay Inventory/.test(refused.find((r) => r.sku === "CS-9PDUJK")?.why || ""), true);
  eq("a row with only a database image has no scans to list", /only a database image/.test(refused.find((r) => r.sku === "TEST3-1")?.why || ""), true);
  eq("the copy's scans never include the database image", groups[0].copies[0].scans.includes(urls[2]), false);
  eq("…which the group keeps for the inventory view", groups[0].dbImage, urls[2]);
}

// ---- templates ----------------------------------------------------------------------
{
  const T = await import("../apps/app/lib/listing-template.js");
  const card = { name: "Mareep", number: "002/020", set: "Zeraora Deck", finish: "Holo", condition: "NM", language: "Japanese", game: "Pokémon TCG", sku: "TEST2-1" };
  const t1 = T.buildTitle({ abbreviateCondition: true, parts: [{ type: "field", key: "name" }, { type: "field", key: "number" }, { type: "field", key: "set" }, { type: "field", key: "language", upper: true }, { type: "field", key: "condition" }] }, card);
  eq("a title from parts, capitals where asked", t1.text, "Mareep 002/020 Zeraora Deck JAPANESE NM");
  eq("condition spelled out when not abbreviated", T.buildTitle({ abbreviateCondition: false, parts: [{ type: "field", key: "condition" }] }, card).text, "Near Mint");
  eq("an empty part leaves no double space", T.buildTitle({ parts: [{ type: "field", key: "name" }, { type: "field", key: "rarity" }, { type: "text", value: "TCG" }] }, card).text, "Mareep TCG");
  const long = T.buildTitle({ parts: [{ type: "field", key: "name" }, { type: "text", value: "x".repeat(30) + " " + "y".repeat(30) + " " + "z".repeat(30) }] }, card);
  eq("over 80 is cut at a whole word, and says so", [long.cut, long.text.length <= 80, long.text.endsWith("y".repeat(30))], [true, true, true]);
  const d = T.renderDescription("<p>{name} — {set}</p><p>{bogus}</p>", { ...card, name: "<b>M</b>" });
  eq("placeholders are filled and escaped", d.html.startsWith("<p>&lt;b&gt;M&lt;/b&gt; — Zeraora Deck</p>"), true);
  eq("an unknown placeholder is reported, not dropped", d.unknown, ["bogus"]);
  eq("the photo promise is always appended", d.html.includes(T.PHOTO_PROMISE), true);
  eq("scripts are refused at save", /Scripts/.test(T.descriptionProblem("<script>x</script>") || ""), true);
  eq("event handlers are refused", /Event handlers/.test(T.descriptionProblem('<img src=x onerror="a()">') || ""), true);
  eq("plain HTML is fine", T.descriptionProblem("<p><b>Thanks</b> for looking</p>"), null);
  eq("shop images go first, after the first scan, and last", T.arrangePictures(["s1", "s2"], [{ url: "L", position: "last" }, { url: "F", position: "first" }, { url: "S", position: "second" }, { url: "off", enabled: false }]), ["F", "s1", "S", "s2", "L"]);
  const many = T.arrangePictures(Array.from({ length: 20 }, (_, i) => `s${i}`), Array.from({ length: 6 }, (_, i) => ({ url: `shop${i}`, position: "last" })));
  eq("over 24 pictures drops shop images, never scans", [many.length, many.filter((u) => /^s\d+$/.test(u)).length], [24, 20]);
  eq("Best Offer thresholds in pence", T.bestOfferFor({ enabled: true, autoAcceptPct: "90", minPct: "70" }, 1000), { autoAcceptPence: 900, minPence: 700 });
  eq("accept below decline is refused", Boolean(T.bestOfferFor({ enabled: true, autoAcceptPct: "60", minPct: "70" }, 1000).error), true);
  eq("Best Offer off sends nothing", T.bestOfferFor({ enabled: false }, 1000), null);
  eq("a title without the card name can't be saved", T.settingsProblems(T.withDefaults({ title: { parts: [{ type: "text", value: "x" }] } })).some((p) => /card name/.test(p)), true);
  eq("an empty saved row reads as the defaults", T.withDefaults(null).categoryId, "183454");
  const r = T.renderListing({ shopImages: [{ url: "BANNER", position: "first" }] }, { condition: "NM", card, copies: [{ sku: "TEST2-1", scans: ["a", "b"] }] }, { pricePence: 249 });
  eq("renderListing: what the preview shows is what the server sends", [r.pictures, r.title.startsWith("Mareep 002/020")], [["BANNER", "a", "b"], true]);

  // Rotation keeps the listing's own shop images, and only swaps the scans.
  const { desiredFor } = await import("../apps/app/lib/lab-copies.js");
  const listing = { id: "A", ebay_item_id: "1", extra_images: [{ url: "BANNER", position: "first" }] };
  const cps = [{ id: "c1", listing_id: "A", copy_seq: 0, scan_urls: ["c1a"], reserved_line: "x#1" }, { id: "c2", listing_id: "A", copy_seq: 1, scan_urls: ["c2a", "c2b"] }];
  eq("a rotation keeps the shop images and swaps the scans", desiredFor(listing, cps).pictureUrls, ["BANNER", "c2a", "c2b"]);
}

// ---- where a copy is in the pile --------------------------------------------------
{
  const copies = [C("c1", "A", 1, { reserved_line: "a#1" }), C("c2", "A", 2, { pulled_at: "x" }), C("c3", "A", 3, { reserved_line: "b#1" }), C("c4", "B", 4)];
  eq("pulled copies close the pile up; reserved ones don't", [...pilePositions(copies)].map(([k, v]) => [k, v.position]), [["c1", 1], ["c3", 2], ["c4", 3]]);
  eq("pick list: reserved, deepest first", pickList(copies).map((c) => [c.id, c.position]), [["c3", 2], ["c1", 1]]);

  // The bug the second run found: two files, each numbered from 0, one pile.
  eq("the pile is the SKU's letters, the number its place", [pileOf("TEST-3"), pileOf("TEST2-14"), pileOf("LAB7"), pileOf("A_50")], [{ pile: "TEST", n: 3 }, { pile: "TEST2", n: 14 }, { pile: "LAB", n: 7 }, { pile: "A", n: 50 }]);
  const two = [
    { id: "t1", sku: "TEST-1", pile_seq: 0, listing_id: "A", copy_seq: 0 },
    { id: "t3", sku: "TEST-3", pile_seq: 2, listing_id: "A", copy_seq: 2 },
    { id: "u1", sku: "TEST2-1", pile_seq: 0, listing_id: "A", copy_seq: 3 },
    { id: "u2", sku: "TEST2-2", pile_seq: 1, listing_id: "B", copy_seq: 0, reserved_line: "x#1" }
  ];
  const p2 = pilePositions(two);
  eq("two runs are two piles, each counted from 1", ["t1", "t3", "u1", "u2"].map((id) => `${p2.get(id).pile}#${p2.get(id).position}`), ["TEST#1", "TEST#2", "TEST2#1", "TEST2#2"]);
  eq("a pick names its pile", pickList(two).map((c) => `${c.pile}#${c.position}`), ["TEST2#2"]);
  eq("a listing's row shows the queue in selling order, not file order", displayOrder("A", two).map((c) => c.id), ["t1", "t3", "u1"]);
}

// ---- the side build stays on the side ----------------------------------------------
{
  const root = new URL("../apps/app/", import.meta.url).pathname;
  const allowed = new Set(["lib/lab-copies.js", "lib/lab-store.js", "lib/lab-ebay.js", "app/api/lab/route.js", "app/panel/lab/LabCopies.js", "app/panel/lab/page.js", "lib/lab-run.js", "lib/lab-notify.js", "app/api/lab/ebay-notify/route.js", "app/api/lab/sweep/route.js", "app/panel/lab/settings/ListingSettings.js", "app/panel/lab/settings/page.js", "lib/listing-template.js"]);
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
  eq("every lab-store read or write filters on user_id", reads.filter((r) => !/insert\(/.test(r) && !/upsert\(\{ user_id: userId/.test(r) && !/"user_id", userId/.test(r) && !/select\("id, user_id, checked_at"\)/.test(r) && !/select\("user_id"\)/.test(r)), []);
  eq("…the sweep's user list is only read by the sweep", offendersOf("usersWithLiveListings", ["lib/lab-store.js", "app/api/lab/sweep/route.js"]), []);
  eq("…and the one that doesn't is only called by the notification route", offendersOf("ownerOfLiveItem", ["lib/lab-store.js", "app/api/lab/ebay-notify/route.js"]), []);
  const run = readFileSync(join(root, "lib/lab-run.js"), "utf8");
  eq("a check never asks eBay about every listing", /for \(const l of live\)[^}]*fetchItemQuantity/.test(run), false);
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
