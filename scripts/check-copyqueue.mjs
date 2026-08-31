/**
 * One listing, several copies — which one goes, what the listing shows.
 *
 *   node scripts/check-copyqueue.mjs      (or: npm run check)
 *
 * The failures this pins are all invisible on screen. A quantity-2 order that
 * pulls one card looks like a completed pull sheet. An arbitrary choice of
 * which of three identical-SKU copies to pull looks correct, because they are
 * all the right card — until the photograph is of a different one. A listing
 * left at quantity 3 with a copy at a show looks like stock.
 *
 * The fixture is the method as described: three copies of one card behind one
 * listing, each with its own scan, sold one at a time.
 */
import {
  queueFor, queuesBySku, queuesByListing, pictureUrlsFor, desiredStateFor,
  reconcile, pullPlanFor, isSellableCopy, isMissingSchema, MAX_PICTURES,
  extrasFromListingPictures
} from "../apps/app/lib/copyqueue.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const ok = (label, got) => { if (!got) fail(`${label} — expected truthy, got ${JSON.stringify(got)}`); };

const ITEM = "1234567890";
/** One copy: its own stack row, its own SKU, its own scan. */
const copy = (n, over = {}) => ({
  id: `copy-${n}`,
  stack_id: "A",
  sku: "UMB-215",                 // the LISTING's SKU — every copy carries it
  title: "Umbreon VMAX 215/203",
  ebay_item_id: ITEM,
  position: n,
  copy_seq: n,
  scan_url: `https://store.example/scan-${n}.jpg`,
  added_at: `2026-08-0${n}T10:00:00Z`,
  pulled_at: null,
  checked_out_at: null,
  ...over
});
const THREE = [copy(1), copy(2), copy(3)];
const NAMES = new Map([["A", "A"]]);

// --- 1. the queue ----------------------------------------------------------
eq("three copies behind one listing queue in copy_seq order",
  queueFor(ITEM, THREE).map((c) => c.id), ["copy-1", "copy-2", "copy-3"]);
eq("a listing nobody holds copies of has an empty queue", queueFor("999", THREE), []);
eq("and so does no item id at all", queueFor(null, THREE), []);

// Order is the head of the queue, and the head is the card in the photograph.
// Two reads of the same data returning different heads would rotate the
// picture to a card nobody sold.
const SHUFFLED = [copy(3), copy(1), copy(2)];
eq("the order does not depend on how the rows came back",
  queueFor(ITEM, SHUFFLED).map((c) => c.id), ["copy-1", "copy-2", "copy-3"]);

// Before migration 027 there is no copy_seq. The fallback is the order the
// cards were scanned in, which is the right default and is still stable.
const NO_SEQ = [copy(3, { copy_seq: null }), copy(1, { copy_seq: null }), copy(2, { copy_seq: null })];
eq("without copy_seq the queue falls back to when each copy was added",
  queueFor(ITEM, NO_SEQ).map((c) => c.id), ["copy-1", "copy-2", "copy-3"]);
const IDENTICAL = ["b", "a", "c"].map((k) => ({ ...copy(1), id: k, copy_seq: null, added_at: "2026-08-01T10:00:00Z" }));
eq("two copies agreeing on everything still order by id, every time",
  queueFor(ITEM, IDENTICAL).map((c) => c.id), ["a", "b", "c"]);

// --- 2. away is not sellable ----------------------------------------------
// A listing at quantity 3 with one copy on a table two hundred miles away
// sells a card twice. The show desk already treats away as away.
const AWAY = [copy(1, { checked_out_at: "2026-08-29T09:00:00Z" }), copy(2), copy(3)];
eq("a copy at a show is out of the queue", queueFor(ITEM, AWAY).map((c) => c.id), ["copy-2", "copy-3"]);
eq("...and the listing's quantity drops with it", desiredStateFor(ITEM, AWAY).quantity, 2);
eq("a pulled copy is gone for good",
  queueFor(ITEM, [copy(1, { pulled_at: "2026-08-30T09:00:00Z" }), copy(2), copy(3)]).map((c) => c.id),
  ["copy-2", "copy-3"]);
eq("isSellableCopy says so on its own", [
  isSellableCopy(copy(1)),
  isSellableCopy(copy(1, { pulled_at: "x" })),
  isSellableCopy(copy(1, { checked_out_at: "x" })),
  isSellableCopy(null)
], [true, false, false, false]);

// --- 3. the picture is ONE copy's scan ------------------------------------
// Three scans on a quantity-3 listing tell a buyer three cards exist and
// nothing about which one they get — worse than a stock photo, because it
// looks like it is telling them something.
const pics = pictureUrlsFor(THREE[0], ["https://store.example/back.jpg"]);
eq("the head copy's scan leads, then the shared shots",
  pics, ["https://store.example/scan-1.jpg", "https://store.example/back.jpg"]);
ok("no other copy's scan is on the listing",
  !pics.some((u) => u.includes("scan-2") || u.includes("scan-3")));
eq("a repeated URL is sent once", pictureUrlsFor(THREE[0], ["https://store.example/scan-1.jpg"]).length, 1);
eq("the list is capped", pictureUrlsFor(THREE[0], Array.from({ length: 40 }, (_, i) => `https://x/${i}.jpg`)).length, MAX_PICTURES);
// Before 027 there is no scan_url, and the right answer is to propose nothing
// rather than to strip the listing's existing photo.
eq("no scan means no picture change proposed", pictureUrlsFor(copy(1, { scan_url: null }), []), null);
eq("blank counts as no scan", pictureUrlsFor(copy(1, { scan_url: "   " }), []), null);

// --- 4. reconcile: running it twice does nothing the second time -----------
// This is the whole reason there is no ledger. The desired state is a function
// of what is in the box, so a repeat run has nothing to say.
const want3 = desiredStateFor(ITEM, THREE);
const settled = reconcile(want3, { quantity: 3 }, { pictured_copy_id: "copy-1" });
eq("a listing that already says the right thing gets no revision", settled.changes, {});
ok("...and reports itself settled", settled.empty);

const firstRun = reconcile(want3, { quantity: 3 }, null);
eq("a listing never pictured gets the head copy's scan",
  firstRun.changes.pictureUrls, ["https://store.example/scan-1.jpg"]);
eq("and its quantity is already right, so it is left alone", firstRun.changes.quantity, undefined);

// One sells: the pull sheet marks copy-1 pulled, and the listing follows.
const AFTER_ONE = [copy(1, { pulled_at: "2026-08-30T09:00:00Z" }), copy(2), copy(3)];
const after = reconcile(desiredStateFor(ITEM, AFTER_ONE), { quantity: 3 }, { pictured_copy_id: "copy-1" });
eq("after a sale the quantity comes down", after.changes.quantity, 2);
eq("...and the picture becomes the next copy's scan",
  after.changes.pictureUrls, ["https://store.example/scan-2.jpg"]);

// --- 5. the queue running out ---------------------------------------------
// Quantity 0 hides the listing while keeping the item id. There is no picture
// to rotate to, and proposing one would be proposing to strip every picture.
const NONE = THREE.map((c) => ({ ...c, pulled_at: "2026-08-30T09:00:00Z" }));
const empty = reconcile(desiredStateFor(ITEM, NONE), { quantity: 3 }, { pictured_copy_id: "copy-3" });
eq("an empty queue drives quantity to zero", empty.changes.quantity, 0);
eq("...never below it", Math.sign(empty.changes.quantity), 0);
eq("...and touches no pictures", empty.changes.pictureUrls, undefined);

// --- 6. a missing quantity is silence, not a zero -------------------------
// The same rule isListingAvailable holds. We still propose the number, because
// a revision is absolute rather than a delta, but the report says we could not
// see what it was.
const unknown = reconcile(want3, { quantity: null }, { pictured_copy_id: "copy-1" });
eq("an absent quantity is not read as sold out", unknown.changes.quantity, 3);
ok("...and the reason says we could not see it", unknown.reasons.some((r) => /cannot tell/.test(r)));
eq("an empty string is the same silence", reconcile(want3, { quantity: "" }, { pictured_copy_id: "copy-1" }).changes.quantity, 3);

// --- 7. the pull sheet: a line item at quantity 2 is TWO cards -------------
// fetchPendingOrders has always returned this number and the pull sheet has
// always ignored it — invisible while every listing was one card, and a card
// short the first time one isn't.
const TWO_AT_ONCE = [{ lineItemId: "L1", orderId: "O1", sku: "UMB-215", title: "Umbreon", quantity: 2 }];
const plan = pullPlanFor(THREE, TWO_AT_ONCE, NAMES);
eq("two units, not one", plan.length, 2);
eq("and they are two DIFFERENT cards", plan.map((u) => u.copy?.id), ["copy-1", "copy-2"]);
eq("each unit is its own tickable row", plan.map((u) => u.key), ["L1#1", "L1#2"]);
eq("each says which of how many it is", plan.map((u) => `${u.unit}/${u.ofUnits}`), ["1/2", "2/2"]);
// Per COPY, not per SKU. A SKU has always named one card, so locationsBySku
// keeps one label for it — which here would send you to the same card twice.
eq("and where to walk — a DIFFERENT card for each unit",
  plan.map((u) => u.where), ["A · 1 of 3", "A · 2 of 3"]);
// The rule is still stackpos.js's: pulled and away copies close the numbering
// up behind them, so the second copy of three is second only while the first
// is still there.
eq("with the first copy gone, the next one is card 1 of 2",
  pullPlanFor([copy(1, { pulled_at: "x" }), copy(2), copy(3)],
    [{ lineItemId: "L9", sku: "UMB-215", quantity: 1 }], NAMES)[0].where,
  "A · 1 of 2");
// Copies of one card routinely live in different stacks — which is exactly why
// copy_seq is not `position`.
eq("copies in different stacks each name their own",
  pullPlanFor([copy(1), copy(2, { stack_id: "B", position: 7 })],
    [{ lineItemId: "L8", sku: "UMB-215", quantity: 2 }],
    new Map([["A", "A"], ["B", "B"]])).map((u) => u.where),
  ["A · 1 of 1", "B · 1 of 1"]);

// Two separate orders for the same listing take successive copies, not the
// same one twice — which is the bug the old first-wins lookup would have had.
const TWO_ORDERS = [
  { lineItemId: "L1", sku: "UMB-215", title: "Umbreon", quantity: 1 },
  { lineItemId: "L2", sku: "UMB-215", title: "Umbreon", quantity: 1 }
];
eq("two orders take two copies", pullPlanFor(THREE, TWO_ORDERS, NAMES).map((u) => u.copy?.id), ["copy-1", "copy-2"]);

// --- 8. more sold than we hold, and other honest failures -----------------
// An oversell is a real event. It gets a row with no copy and a reason, rather
// than a crash or a silently short list.
const OVERSOLD = pullPlanFor([copy(1)], [{ lineItemId: "L1", sku: "UMB-215", quantity: 3 }], NAMES);
eq("every unit is still reported", OVERSOLD.length, 3);
eq("the first is answerable, the rest are not", OVERSOLD.map((u) => u.copy?.id ?? null), ["copy-1", null, null]);
eq("and they say why", OVERSOLD.slice(1).map((u) => u.reason), ["no copy left in the stack", "no copy left in the stack"]);

const AWAY_PLAN = pullPlanFor([copy(1, { checked_out_at: "2026-08-29T09:00:00Z" })],
  [{ lineItemId: "L1", sku: "UMB-215", quantity: 1 }], NAMES);
eq("a copy sold while it is at a show is not a copy you can post", AWAY_PLAN[0].copy, null);
eq("...and it says which of the two that is", AWAY_PLAN[0].reason, "checked out to a show");
eq("an already-pulled copy says so too",
  pullPlanFor([copy(1, { pulled_at: "x" })], [{ lineItemId: "L1", sku: "UMB-215", quantity: 1 }], NAMES)[0].reason,
  "already pulled");
eq("a line with no SKU says that",
  pullPlanFor(THREE, [{ lineItemId: "L1", sku: null, quantity: 1 }], NAMES)[0].reason,
  "no SKU on the order line");
eq("a missing quantity on a line is one card, not none",
  pullPlanFor(THREE, [{ lineItemId: "L1", sku: "UMB-215" }], NAMES).length, 1);

// --- 9. SKU lookup is a queue, not whichever row came back first -----------
const bySku = queuesBySku(SHUFFLED);
eq("the SKU maps to every copy, in order",
  bySku.get("umb-215").map((c) => c.id), ["copy-1", "copy-2", "copy-3"]);
eq("SKUs are matched case-insensitively, as the pull sheet does",
  queuesBySku([copy(1, { sku: "UMB-215" })]).get("umb-215").length, 1);
eq("listings map to their queues too",
  queuesByListing(SHUFFLED).get(ITEM).map((c) => c.id), ["copy-1", "copy-2", "copy-3"]);
eq("a copy on no listing is in no listing's queue", queuesByListing([copy(1, { ebay_item_id: null })]).size, 0);

// --- 10. a pending migration degrades, it does not throw ------------------
ok("a missing table reads as a pending migration", isMissingSchema({ code: "42P01" }));
ok("so does a missing column", isMissingSchema({ code: "42703" }));
ok("so does PostgREST's schema cache", isMissingSchema({ message: "Could not find the 'scan_url' column in the schema cache" }));
ok("an ordinary failure is not one", !isMissingSchema({ message: "network unreachable" }));

// --- 11. the listing's OTHER photographs survive a rotation ---------------
// PictureURL replaces the whole set, so a revision carrying the scan alone
// deletes the back-of-card shot — and deletes it from a live listing, where
// nobody can put it back. Position 1 is the copy-scan slot; 2..n are kept.
const EB = (n) => `https://i.ebayimg.com/${n}.jpg`;
eq("the first picture is the slot the scan replaces; the rest are kept, in order",
  extrasFromListingPictures([EB("front"), EB("back"), EB("corner")]),
  [EB("back"), EB("corner")]);
eq("a listing with one picture has no extras to keep",
  extrasFromListingPictures([EB("front")]), []);
eq("no pictures at all is not a crash", extrasFromListingPictures(null), []);
eq("blanks are not pictures", extrasFromListingPictures([EB("front"), "", null, "  "]), []);
eq("a duplicated head cannot come back as an extra beside the new scan",
  extrasFromListingPictures([EB("a"), EB("a"), EB("b")]), [EB("b")]);

// The property that has to hold on the FIFTIETH rotation, not just the first.
// What we send puts the scan back at position 1, so the next rotation drops
// the scan it is replacing and keeps exactly the same extras — rather than
// stacking every copy's scan onto the listing, one per sale.
const sent1 = pictureUrlsFor(copy(1), extrasFromListingPictures([EB("front"), EB("back")]));
eq("the scan leads and the kept pictures follow",
  sent1, ["https://store.example/scan-1.jpg", EB("back")]);
const sent2 = pictureUrlsFor(copy(2), extrasFromListingPictures(sent1));
eq("the next copy replaces the scan and never stacks a second one",
  sent2, ["https://store.example/scan-2.jpg", EB("back")]);
const sent3 = pictureUrlsFor(copy(3), extrasFromListingPictures(sent2));
eq("and again, so the set never grows",
  sent3, ["https://store.example/scan-3.jpg", EB("back")]);

if (failures) {
  console.error(`\ncheck-copyqueue: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-copyqueue: OK — the pictured copy is the copy that goes, and a quantity-2 order is two cards.");
