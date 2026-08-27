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
import { isListingAvailable, availableSkus, soldOutSkus } from "../apps/app/lib/stockcheck.js";

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

if (failures) {
  console.error(`\ncheck-instock: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-instock: OK — a zeroed listing is a card that has gone, and both screens know it.");
