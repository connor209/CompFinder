/**
 * A card nothing priced is £0.00, and £0.00 stops the run leaving.
 *
 *   node scripts/check-zeroprice.mjs      (or: npm run check)
 *
 * The fault this pins is one of the quiet ones. A CardUploader CSV arrives
 * with a placeholder `*StartPrice` on every row — £2.49 is the usual one, the
 * same figure as the pricing engine's floor. The eBay upload export left a row
 * it had no price for exactly as it found it, so a card SoldComps timed out on
 * went up at £2.49 looking, on every screen and in the file, indistinguishable
 * from a card the engine had genuinely priced at its floor. Nothing said
 * otherwise, because saying nothing WAS the behaviour.
 *
 * Three halves, and the third is the one that costs money if it rots:
 *
 * 1. **The value.** No price is written as zero, everywhere it is written.
 * 2. **The guard.** A run with a zero in it cannot be listed or exported, and
 *    the refusal names the cards rather than the count alone.
 * 3. **The greps.** The zero and the guard only work as a pair: a zero that
 *    can be exported is just a different wrong number in the file, and a guard
 *    with no zero behind it is a warning about nothing. So the money-out paths
 *    are grepped for both, and `packages/core` is grepped to make sure none of
 *    this leaked into the shared engine — the public page needs `null` for a
 *    card it cannot price, and a stranger's one-off lookup reading "£0.00"
 *    would be the site quoting a price it does not hold.
 */
import { readFileSync } from "node:fs";
import {
  UNPRICED_PENCE,
  isUnpriced,
  exportPence,
  unpricedRows,
  exportGuard
} from "../apps/app/lib/zero-price.js";
import { withOverride } from "../apps/app/lib/price-override.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

const rec = (over = {}) => ({
  rawPence: 4210,
  finalPence: 4249,
  confidence: "High",
  dataSource: "sold",
  note: "12 comps",
  included: [1, 2, 3],
  excluded: [],
  ...over
});

// --- 1. what counts as no price --------------------------------------------
// Every one of these is a real state a batch row ends a run in, and the point
// is that they collapse to ONE answer: the reasons differ, the number doesn't.
// [rec, unpriced?, why this case is here]
const CASES = [
  [rec(), false, "the ordinary priced card"],
  [null, true, "the run never got a result — a SoldComps timeout, a shed request"],
  [rec({ finalPence: null, note: "No sold comps found after exclusions" }), true,
    "comps came back and every one was excluded"],
  [rec({ finalPence: null, priceHeld: true, confidence: "None" }), true,
    "a slab below gradedMinComps, deliberately not priced from the raw copies"],
  [withOverride(rec({ finalPence: null }), 4000), false,
    "you typed one — which is the whole way out of a zero"],
  [withOverride(null, 500), false,
    "and typing one on a card with no rec at all works the same way"],
  [rec({ finalPence: 249 }), false,
    "the engine's own £2.49 floor is a PRICE — it was checked, and this file must never confuse the two"]
];
for (const [r, want, why] of CASES) {
  eq(`unpriced? (${why})`, isUnpriced(r), want);
}

// The number written down. A card with no price is not absent from the file
// and not blank in it: it is zero, which cannot be read as a cheap card and
// which eBay itself refuses to list at.
eq("a priced card writes its price", exportPence(rec()), 4249);
eq("your price writes yours", exportPence(withOverride(rec(), 4000)), 4000);
eq("no price writes zero, not null", exportPence(null), 0);
eq("and zero is the constant, not a literal at each call site", UNPRICED_PENCE, 0);
eq("a held slab writes zero too", exportPence(rec({ finalPence: null })), 0);

// --- 2. which rows, and what the refusal says ------------------------------
const RUN = [
  { sku: "AB11", title: "Umbreon VMAX 215/203", rec: rec() },
  { sku: "AB12", title: "Charizard V 154/185", rec: null },
  { sku: "AB13", title: "Snorlax 131/198", rec: rec({ finalPence: null }) },
  { sku: "AB14", title: "Mew ex 232/165", rec: withOverride(null, 900) },
  { sku: "AB15", title: "Gengar VMAX 020/072", rec: rec({ finalPence: null }) }
];

eq("the zeros are found, in the order they sit in the run",
  unpricedRows(RUN).map((r) => r.sku), ["AB12", "AB13", "AB15"]);
eq("and each carries what the message needs to name it",
  unpricedRows(RUN)[0], { index: 1, sku: "AB12", title: "Charizard V 154/185" });

const blocked = exportGuard(RUN, "The eBay upload CSV");
eq("a run with a zero in it does not leave", blocked.ok, false);
eq("and the count is the number of zeros, not of rows", blocked.count, 3);
if (!blocked.message.includes("AB12 (Charizard V 154/185)")) {
  fail("the refusal doesn't name the first offending card — a refusal you have to go hunting behind is one that gets ignored");
}
if (!blocked.message.includes("The eBay upload CSV")) {
  fail("the refusal doesn't say which export it is refusing");
}
if (/\bmore\b/.test(blocked.message)) {
  fail("three cards is few enough to name in full — the message shouldn't be trailing off");
}

// Past a handful it has to stop naming them: 40 titles in a status line is not
// read either, and the count is what tells you the run is a long way off.
const many = exportGuard(
  Array.from({ length: 6 }, (_, i) => ({ sku: `AB${20 + i}`, title: `Card ${i}`, rec: null }))
);
if (!/\band 3 more\b/.test(many.message)) {
  fail(`a long list should name a few and count the rest: ${many.message}`);
}

const clean = exportGuard(RUN.filter((r) => !isUnpriced(r.rec)));
eq("a run with none is not blocked", { ok: clean.ok, count: clean.count, message: clean.message },
  { ok: true, count: 0, message: "" });
eq("an empty run is not a run with a problem", exportGuard([]).ok, true);
eq("neither is nothing at all", exportGuard(null).ok, true);

// One row, and the sentence has to still read. Getting this wrong is how a
// guard ends up saying "1 cards have no price and are sitting at £0.00".
const one = exportGuard([{ sku: "AB12", title: "Charizard V 154/185", rec: null }]);
if (/1 cards\b/.test(one.message) || /\bhave no price\b/.test(one.message)) {
  fail(`the one-card refusal doesn't read as English: ${one.message}`);
}

// --- 3. the eBay upload file went with Bulk pricing (2026-11-26) -----------
// The CSV writer that the £2.49 went out on is gone; /api/batch-comps still
// writes an unpriced card as 0.00 (check-batchcomps.mjs pins that).

// --- 4. the greps ----------------------------------------------------------
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// The engine is shared with Last Comp, where a card with no price has to stay
// NULL: a public page rendering "£0.00" is the site quoting a price it does
// not hold, to a stranger, about their own card.
for (const file of ["packages/core/pricing.js"]) {
  if (/zero-price/.test(read(file))) {
    fail(`${file} reaches into the app's zero rule — packages/core must not know about it`);
  }
}
const publicFiles = ["apps/public/lib/card-page.js", "apps/public/lib/listings.js"];
for (const file of publicFiles) {
  let src;
  try { src = read(file); } catch { continue; }
  if (/zero-price/.test(src)) {
    fail(`${file} imports the app's zero rule — the public page must show no price, not £0.00`);
  }
}

// Loadable under bare node, like price-override.js beside it.
const lib = read("apps/app/lib/zero-price.js");
if (/^\s*import\s+.*from\s+["']@\//m.test(lib)) {
  fail("zero-price.js has picked up an app-aliased import — it has to stay loadable under bare node");
}

if (failures > 0) {
  console.error(`\ncheck-zeroprice: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-zeroprice: OK — a card nothing priced is £0.00, and £0.00 stops the run leaving.");
