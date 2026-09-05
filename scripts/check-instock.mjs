/**
 * A quantity of zero is a card that is gone.
 *
 *   node scripts/check-instock.mjs      (or: npm run check)
 *
 * eBay's out-of-stock control keeps a SOLD fixed-price listing in the seller's
 * ActiveList with the quantity zeroed: same item id, same price, still
 * "active" as far as the Trading API is concerned. So `ebay_listings` carries
 * rows for cards that left the building months ago, and every screen that
 * asked "is this SKU listed?" got a yes.
 *
 * That shipped, and the show desk is where it hurt: "★ Recommend show stock"
 * ranks live stack cards by listing price, so the cards it was wrong about
 * came out at the TOP — the expensive ones are the ones that sell. T21
 * Blaine's Charmander, sold on eBay, quantity 0, recommended to pack for a
 * show. The Stacks reconcile tool, which exists precisely to catch cards that
 * have left, missed the same rows for the same reason: it matched on the SKU
 * being present rather than the listing being buyable.
 *
 * Two directions to fail in, and the false-positive cases below matter more:
 *
 * - Too strict, and a real card gets left at home. A null quantity is eBay not
 *   saying, not a zero; a second in-stock listing under one SKU means we still
 *   have one to sell.
 * - Too loose, and you drive to a show looking for cards that aren't there.
 */
import { readFileSync } from "node:fs";
import { isListingAvailable, availableSkus, soldOutSkus, awayIndex, listingStock } from "../apps/app/lib/stockcheck.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// --- 1. one listing: can we sell it? ---------------------------------------
// [listing, available?, why this case is here]
const CASES = [
  [{ quantity: 1 }, true, "the ordinary single card"],
  [{ quantity: 4 }, true, "a multi-quantity listing"],
  [{ quantity: 0 }, false, "THE case — sold, and eBay left the listing standing"],
  [{ quantity: "0" }, false, "the column comes back as a string from some drivers"],
  [{ quantity: -1 }, false, "nonsense, but not a card we have"],
  [{ quantity: null }, true, "eBay sent no quantity — unknown is not sold out"],
  [{}, true, "the field is absent entirely — same reading"],
  [{ quantity: "" }, true, "an empty string is not a number, so it says nothing"],
  [{ quantity: "two" }, true, "unparseable is unknown, and unknown stays sellable"],
  [null, true, "no listing at all is a question for the caller, not a zero"]
];
for (const [listing, want, why] of CASES) {
  eq(`isListingAvailable(${JSON.stringify(listing)}) — ${why}`, isListingAvailable(listing), want);
}

// --- 2. a set of listings splits in two ------------------------------------
const LISTINGS = [
  { sku: "A50", quantity: 1 },
  { sku: "T21", quantity: 0 },          // sold; the one that started this
  { sku: "b12", quantity: 0 },          // sold, and cased differently to the stack card
  { sku: "C7", quantity: null },        // eBay didn't say
  { sku: "D9", quantity: 0 },           // dead listing...
  { sku: "D9", quantity: 2 },           // ...but we still have one to sell
  { sku: null, quantity: 1 }            // no SKU: nothing to key on
];
eq("the SKUs we can still sell", [...availableSkus(LISTINGS)].sort(), ["a50", "c7", "d9"]);
eq("the SKUs that are listed but gone", [...soldOutSkus(LISTINGS)].sort(), ["b12", "t21"]);
eq("a SKU with a live second listing is NOT reported gone", soldOutSkus(LISTINGS).has("d9"), false);
eq("SKUs are matched case-insensitively, as everywhere else", availableSkus([{ sku: "A50", quantity: 1 }]).has("a50"), true);
eq("empty input is empty, not a crash", [[...availableSkus(null)], [...soldOutSkus(undefined)]], [[], []]);

// --- 2b. a zero has two causes, and they want opposite treatment -----------
// eBay zeroes a listing when the card SELLS. We zero it ourselves when the
// card is checked out to a show. Same field, same value, and the difference is
// the difference between "already gone" and "in a box on the table in front of
// you". My listings hides the first and labels the second, so getting this
// backwards either buries real stock or pads the list with cards that left
// months ago.
{
  const CHECKOUTS = [
    { id: "co-1", sku: "AB11", ebay_item_id: "111", hide_method: "quantity", event: "Glasgow", resolved_at: null },
    { id: "co-2", sku: "C4", ebay_item_id: null, hide_method: "quantity", event: "Glasgow", resolved_at: null },
    { id: "co-3", sku: "D9", ebay_item_id: "333", hide_method: "none", event: "Glasgow", resolved_at: null },
    // Came home again — it explains nothing about a zero today.
    { id: "co-4", sku: "E1", ebay_item_id: "444", hide_method: "quantity", resolved_at: "2026-09-01T10:00:00Z" }
  ];
  const away = awayIndex(CHECKOUTS);
  const st = (l) => listingStock(l, away);

  eq("a stocked listing is live, checkout or not",
    st({ ebay_item_id: "111", sku: "AB11", quantity: 3 }).state, "live");
  eq("zero + an open checkout on the same item id is AT A SHOW",
    st({ ebay_item_id: "111", sku: "AB11", quantity: 0 }).state, "show");
  eq("...and it carries the checkout, so the row can say where",
    st({ ebay_item_id: "111", sku: "AB11", quantity: 0 }).checkout.event, "Glasgow");
  eq("matched on SKU when the checkout predates the listing link",
    st({ ebay_item_id: "999", sku: "c4", quantity: 0 }).state, "show");
  eq("zero with nothing to explain it is GONE — the card sold",
    st({ ebay_item_id: "222", sku: "T21", quantity: 0 }).state, "gone");
  eq("a RESOLVED checkout explains nothing — that card came home",
    st({ ebay_item_id: "444", sku: "E1", quantity: 0 }).state, "gone");

  // The double-sale case: the card is away, but we are not the ones who zeroed
  // the listing, so something else did. Away AND suspect, never confidently
  // one or the other.
  const odd = st({ ebay_item_id: "333", sku: "D9", quantity: 0 });
  eq("checked out with the listing left alone, then zeroed by eBay", [odd.state, odd.suspect], ["show", true]);
  eq("a listing we zeroed ourselves is not suspect",
    st({ ebay_item_id: "111", sku: "AB11", quantity: 0 }).suspect, false);

  // The two ways of not knowing. Neither may be read as "sold".
  eq("a missing quantity is not a zero, so it never reaches the question",
    st({ ebay_item_id: "222", sku: "T21", quantity: null }).state, "live");
  eq("no checkout data at all is UNKNOWN, never gone — a failed probe is not evidence",
    listingStock({ ebay_item_id: "222", sku: "T21", quantity: 0 }, null).state, "unknown");
  eq("and unknown stays visible, which is what the screen keys off",
    listingStock({ quantity: 0 }, null).state !== "gone", true);
}

// --- 3. nobody derives this a second time ----------------------------------
// The rule was written out nowhere and assumed in two places; it now lives in
// stockcheck.js. A screen that tests `quantity` itself is how the two answers
// start to disagree, and a disagreement here is invisible — one screen packs
// a card for the show that the other has already written off.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const SCREENS = [
  ["apps/app/app/panel/ShowDesk.js", "buildRecs", "the show stock recommendations"],
  ["apps/app/app/panel/Stacks.js", "runReconcile", "the stacks reconcile tool"]
];
for (const [file, fn, what] of SCREENS) {
  const src = read(file);
  const start = src.indexOf(`async function ${fn}`);
  if (start === -1) {
    fail(`${file} no longer has ${fn}() — ${what} has moved without this check moving with it`);
    continue;
  }
  const rest = src.slice(start + 10);
  const end = rest.search(/\n  (async )?function /);
  const body = end === -1 ? rest : rest.slice(0, end);

  if (!/ebay_listings"\)\.select\("[^"]*quantity/.test(body)) {
    fail(`${fn}() does not select quantity — ${what} cannot tell a sold card from a live one`);
  }
  if (!/isListingAvailable|availableSkus|soldOutSkus/.test(body)) {
    fail(`${fn}() does not go through stockcheck.js — ${what} is deciding availability on its own`);
  }
  if (/quantity\s*(>|>=|===|!==|==|<|<=)/.test(body) || /\.quantity\s*\?\?/.test(body)) {
    fail(`${fn}() tests quantity by hand — that is the second definition this module exists to prevent`);
  }
}

// The count of what was dropped is shown. Nothing in this codebase drops rows
// quietly, and this one especially: a card missing from the shortlist looks
// exactly like a card we never owned, when it actually needs reconciling.
if (!/recSkipped/.test(read("apps/app/app/panel/ShowDesk.js"))) {
  fail("ShowDesk.js no longer reports how many cards were left out as sold");
}
if (!/outofstock/.test(read("apps/app/app/panel/Stacks.js"))) {
  fail("Stacks.js no longer distinguishes a sold-out listing from an unlisted one");
}

// My listings is the third screen that asks, and it is the one that HIDES rows
// on the answer — so it has to go through the same module, and it has to say
// how many it hid. A row that vanished with no count looks exactly like a card
// we never had, in the one list you would go looking in to find out.
{
  const inv = read("apps/app/app/panel/Inventory.js");
  if (!/listingStock|awayIndex/.test(inv)) {
    fail("Inventory.js decides what a zeroed listing means on its own — that is the second definition stockcheck.js exists to prevent");
  }
  if (/\bl\.quantity\s*(>|>=|===|!==|==|<|<=)/.test(inv)) {
    fail("Inventory.js tests a listing quantity by hand");
  }
  if (!/goneCount/.test(inv)) {
    fail("Inventory.js hides sold-out listings without reporting how many — nothing here drops rows quietly");
  }
  if (!/awayCount/.test(inv)) {
    fail("Inventory.js no longer says how many of its cards are out at a show");
  }
  // The failed-probe direction. Hiding on a lookup that never answered is how
  // a card you are standing next to disappears from your own inventory.
  if (!/setAway\(null\)/.test(inv)) {
    fail("Inventory.js has no path that leaves the checkout lookup unanswered — a failed probe must not read as 'nothing is at a show'");
  }
}

if (failures) {
  console.error(`\ncheck-instock: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-instock: OK — a zero is a sold card or a card at a show, and the three screens agree which.");
