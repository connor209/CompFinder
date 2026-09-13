/**
 * "We already have this card" has to mean this PRINTING of it.
 *
 *   node scripts/check-stockmatch.mjs      (or: npm run check)
 *
 * A batch row is matched against our live eBay listings and our own price
 * history on the collector number plus one word of the name (`cardKey()`).
 * That key cannot tell a Shedinja 14/107 from a Shedinja 14/107 Reverse Holo,
 * and neither can it tell a raw copy from the same card in a slab — so the
 * batch screen reported "In stock · £2.37" for cards we hold in the other
 * printing, drew a "▲ £6.62 vs listed" delta between two different cards, and
 * on a show pool would have started a graded sticker from that price.
 *
 * The engine has refused to pool those comps since a £7.97 Reverse Holo landed
 * in a £2.34-£3.48 set (`variantMismatch`, packages/core/pricing.js). This is
 * the same rule one screen further on.
 *
 * The false-positive cases below are the ones that matter. Splitting too
 * eagerly costs a real match — the shelf copy stops being mentioned at all,
 * which is how a card gets listed at half what its twin is up for.
 */
import { readFileSync } from "node:fs";
import {
  printingOf, samePrinting, printingDiff,
  buildStockIndex, buildHistoryIndex, checkRow
} from "../apps/app/lib/stockcheck.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// --- 1. which printing is this title talking about? ------------------------
// [title, { reverse, graded, grade }, why this case is here]
const TITLES = [
  ["Shedinja 14/107 Deoxys Prerelease Stamped Reverse Holo NM", { reverse: true, stamped: true, graded: false, grade: null },
    "the card that started the stamped rule — sold under market priced off plain copies"],
  ["Staff of Nin Mirrodin Besieged NM", { reverse: false, stamped: false, graded: false, grade: null },
    "a Magic card NAMED Staff — the app prices every game"],
  ["Shedinja 14/107 Deoxys Pokemon Reverse Holo NM", { reverse: true, stamped: false, graded: false, grade: null },
    "THE case — a CardUploader title, and what the batch row carries"],
  ["Shedinja 14/107 Deoxys Pokemon NM", { reverse: false, stamped: false, graded: false, grade: null },
    "...and the copy on the shelf that was answering for it"],
  ["Barboach 60/110 Holon Phantoms Pokemon Reverse Holo NM", { reverse: true, stamped: false, graded: false, grade: null },
    "the second row on the screenshot that started this"],
  ["Pikachu 58/102 Base Set Holo Rare", { reverse: false, stamped: false, graded: false, grade: null },
    "plain Holo is NOT Reverse Holo — the rule core learned the hard way"],
  ["Umbreon VMAX 215/203 Evolving Skies Reverse  Holo", { reverse: true, stamped: false, graded: false, grade: null },
    "the two words with whatever spacing a seller typed"],
  ["Reversal Energy 192/182 Paradox Rift", { reverse: false, stamped: false, graded: false, grade: null },
    "a card NAMED Reversal is not a reverse holo — word boundary, not substring"],
  ["Charizard 4/102 Base Set PSA 10 GEM MINT", { reverse: false, stamped: false, graded: true, grade: 10 },
    "a slab is a different object at a different price, same as a variant"],
  ["Charizard 4/102 Base Set CGC 9", { reverse: false, stamped: false, graded: true, grade: 9 },
    "companies are pooled, grades are kept apart — the engine's own split"],
  ["Charizard 4/102 Base Set — not graded, raw", { reverse: false, stamped: false, graded: false, grade: null },
    "a seller saying what it ISN'T. Reading this as a slab inverts everything"],
  ["Blastoise 2/102 Reverse Holo PSA 9", { reverse: true, stamped: false, graded: true, grade: 9 },
    "both axes at once, and they are independent"],
  ["", { reverse: false, stamped: false, graded: false, grade: null }, "nothing to read is not a variant"]
];
for (const [title, want, why] of TITLES) {
  eq(`printingOf(${JSON.stringify(title)}) — ${why}`, printingOf(title), want);
}

// --- 2. same card, or not? ------------------------------------------------
const rev = printingOf("Shedinja 14/107 Reverse Holo");
const plain = printingOf("Shedinja 14/107");
const psa10 = printingOf("Shedinja 14/107 PSA 10");
const psa9 = printingOf("Shedinja 14/107 PSA 9");
const gradedNoNumber = { reverse: false, stamped: false, graded: true, grade: null };

eq("a reverse holo is not the plain copy", samePrinting(rev, plain), false);
eq("...and it is not one-way — the plain copy is not the reverse either", samePrinting(plain, rev), false);
eq("the plain copy is itself", samePrinting(plain, printingOf("Shedinja 14/107 NM")), true);
eq("a slab is not the raw card", samePrinting(psa10, plain), false);
eq("a 10 is not a 9 — the gap is multiples", samePrinting(psa10, psa9), false);
eq("a slab whose grade wouldn't parse is still a slab, not a different one",
  samePrinting(psa10, gradedNoNumber), true);
eq("nothing known about one side never splits a match", samePrinting(null, rev), true);

// --- 3. and it says WHICH, in words ---------------------------------------
eq("pricing the reverse, holding the plain copy", printingDiff(rev, plain), "non-reverse");
{
  const stamped = printingOf("Shedinja 14/107 Deoxys Prerelease Stamped");
  const ordinary = printingOf("Shedinja 14/107 Deoxys");
  eq("a stamped copy is not the ordinary one", samePrinting(stamped, ordinary), false);
  eq("...and it says which", printingDiff(stamped, ordinary), "unstamped");
  eq("holding the stamp while pricing the ordinary card", printingDiff(ordinary, stamped), "stamped");
}
eq("pricing the plain copy, holding the reverse", printingDiff(plain, rev), "reverse holo");
eq("pricing a raw card, holding a slab", printingDiff(plain, psa10), "graded 10");
eq("pricing a slab, holding the raw card", printingDiff(psa10, plain), "raw");
eq("pricing a PSA 10, holding a PSA 9", printingDiff(psa10, psa9), "graded 9");
eq("the same printing has nothing to say", printingDiff(plain, plain), "");

// --- 4. a batch row against our own listings ------------------------------
{
  const LISTINGS = [
    { sku: "OLD1", ebay_item_id: "1", title: "Shedinja 14/107 Deoxys Pokemon NM", price_value: 2.37, quantity: 1 },
    { sku: "OLD2", ebay_item_id: "2", title: "Barboach 60/110 Holon Phantoms Pokemon Reverse Holo NM", price_value: 8.99, quantity: 1 },
    { sku: "OLD3", ebay_item_id: "3", title: "Gengar 94/102 Base Set NM", price_value: 40.0, quantity: 1 },
    { sku: "OLD4", ebay_item_id: "4", title: "Gengar 94/102 Base Set Reverse Holo NM", price_value: 90.0, quantity: 1 }
  ];
  const stock = buildStockIndex(LISTINGS);
  const look = (title, sku = "") => checkRow({ sku, title }, { stock }).stock;

  // The bug, in one assertion: the row is the reverse, the shelf holds the plain.
  const near = look("Shedinja 14/107 Deoxys Pokemon Reverse Holo NM");
  eq("a different printing is NOT reported as the same card", near.otherPrinting, "non-reverse");
  eq("...but it is still handed back, labelled — nothing is dropped quietly",
    near.match.title, "Shedinja 14/107 Deoxys Pokemon NM");

  eq("the same printing matches, and says nothing about printings",
    look("Barboach 60/110 Holon Phantoms Pokemon Reverse Holo NM").otherPrinting, "");
  eq("a plain row against a plain listing still matches",
    look("Gengar 94/102 Base Set LP").otherPrinting, "");

  // Both printings on the shelf: the row must find ITS one, not the first one.
  const both = look("Gengar 94/102 Base Set Reverse Holo NM");
  eq("with both printings listed, the right one is picked", both.match.pricePence, 9000);
  eq("...and it is not reported as ambiguous — only one of them is this card", both.ambiguous, false);

  // A SKU is on the sleeve of one physical copy. It cannot be the wrong
  // printing of it, and second-guessing it here would break every row whose
  // listing title is spelled differently from the CSV's.
  eq("a SKU match is exact and stays trusted",
    look("Shedinja 14/107 Deoxys Pokemon Reverse Holo NM", "OLD1").via, "sku");
  eq("...and carries no printing complaint",
    look("Shedinja 14/107 Deoxys Pokemon Reverse Holo NM", "OLD1").otherPrinting, "");

  eq("a card we have never listed is still no match at all",
    look("Mewtwo 10/102 Base Set NM"), null);
}

// --- 5. "last priced" is per printing, not per card key --------------------
// One newest row per key would have the reverse priced last Tuesday answering
// for the plain copy priced this morning, purely because it is newer.
{
  const history = buildHistoryIndex([
    { title: "Shedinja 14/107 Deoxys Pokemon NM", recommended_pence: 249, created_at: "2026-09-10T09:00:00Z" },
    { title: "Shedinja 14/107 Deoxys Pokemon Reverse Holo NM", recommended_pence: 749, created_at: "2026-09-02T09:00:00Z" },
    { title: "Shedinja 14/107 Deoxys Pokemon Reverse Holo LP", recommended_pence: 700, created_at: "2026-08-01T09:00:00Z" }
  ]);
  const h = (title) => checkRow({ title }, { history }).history;
  eq("the reverse gets the reverse's last price, not the newer plain one",
    h("Shedinja 14/107 Deoxys Pokemon Reverse Holo NM").match.pricePence, 749);
  eq("the plain copy gets its own", h("Shedinja 14/107 Deoxys Pokemon NM").match.pricePence, 249);
  eq("one row per printing, newest kept",
    h("Shedinja 14/107 Deoxys Pokemon Reverse Holo NM").otherPrinting, "");

  // Only one printing ever priced: the near miss is labelled, not hidden.
  const only = buildHistoryIndex([
    { title: "Gengar 94/102 Base Set NM", recommended_pence: 4000, created_at: "2026-09-10T09:00:00Z" }
  ]);
  const g = checkRow({ title: "Gengar 94/102 Base Set Reverse Holo NM" }, { history: only }).history;
  eq("a price for the other printing says so", g.otherPrinting, "non-reverse");
}

// --- 6. nobody reads the match around the label ---------------------------
// The row, the count, the filter, the sticker and the export all have to agree
// about which listings are this card, so they all go through stockedMatch().
// A raw `?.stock?.match?.pricePence` is the reverse holo's asking price
// becoming a sticker on the plain copy.
{
  const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
  if (!/function stockedMatch\(/.test(panel)) {
    fail("Panel.js has no stockedMatch() — the one reading of 'we already stock this card' has gone");
  }
  const raw = [...panel.matchAll(/\bk(?:nown)?\??\.stock\?\.match/g)];
  if (raw.length) {
    fail(`Panel.js reads a matched listing without going through stockedMatch() (${raw.length} place(s)) — a different printing's price would reach a delta, a sticker or an export`);
  }
  if (!/const listedByIndex[\s\S]{0,400}stockedMatch\(/.test(panel)) {
    fail("the sticker's 'what we already ask on eBay' no longer goes through stockedMatch() — a graded sticker could start from the raw copy's price");
  }
  if (!/otherPrintingCount/.test(panel)) {
    fail("Panel.js no longer counts the rows whose only match is a different printing — a row that used to say 'In stock' and now says nothing looks like the check broke");
  }
}

// --- 7. the results sheet shows the card, and hides only the working ------
// The batch results used to be a ten-column table whose hiding worked by
// nth-child, which is how adding "In stock" silently hid the Current column
// instead for months. It is a row layout now (ResultSheet), so the rule that
// replaces the header/CSS pin is about WHAT a row may drop: the working goes,
// the answer and the warnings stay, and the scan of the copy in hand is drawn
// wherever the file carried one.
{
  const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../apps/app/app/globals.css", import.meta.url), "utf8");

  if (/<table id="compfinder-results"/.test(panel)) {
    fail("the batch results are a table again — if that is deliberate, this check has to go back to pinning the header order against the nth-child rules that hide its columns");
  }
  if (/hide-current-price|hide-working/.test(panel)) {
    fail("Panel.js still sets a positional column-hiding class — that mechanism is what hid the wrong column for months");
  }
  if (/#compfinder-results\.(hide-current-price|hide-working)/.test(css)) {
    fail("globals.css still carries the positional hiding rules for a table that no longer exists");
  }

  // The scan is the whole reason a row can be read at a glance, and it comes
  // off the CardUploader row the card arrived on — which both upload paths now
  // carry, and the saved run keeps in csv_item.
  if (!/function RowScan\(/.test(panel)) {
    fail("Panel.js no longer draws the scan on a result row");
  }
  if (!/r\?\.csvItem\?\.images\?\.\[0\]/.test(panel)) {
    fail("the scan is no longer read off the row's own CardUploader item");
  }
  // A row with no scan draws nothing. Catalogue art here would show a mint
  // card where a played one is — the rule counter mode settled.
  if (!/if \(!src\) return null;/.test(panel)) {
    fail("a row with no scan must draw nothing rather than reach for a substitute");
  }
  if (/card_catalog|image_small/.test(panel)) {
    fail("Panel.js is reaching for catalogue art on a result row");
  }

  // What the working toggle may take, and what it may never take.
  if (!/\{showDetails \? <div className="rs-q"/.test(panel)) {
    fail("the sheet row no longer folds the query away with the rest of the working");
  }
  if (!/showDetails && rec\?\.note \? <div className="rc-note">/.test(panel)) {
    fail("the sheet row no longer folds the engine's note away with the rest of the working");
  }
  if (!/!showDetails && rec && noteIsCaveat\(rec\)/.test(panel)) {
    fail("a note carrying a ⚠ loses its mark on the sheet row when the working is hidden");
  }
  if (!/rec && overrideNote\(rec\) \? <div className="rc-note rc-note-mine">/.test(panel)) {
    fail("the override note is behind the working toggle on the sheet row — a price somebody typed is loud on every screen");
  }

  // A run spends money for several minutes; which cards are on the bench is
  // the one thing that was invisible while it did.
  if (!/setPricingNow/.test(panel)) {
    fail("Panel.js no longer says which cards are being priced right now");
  }
  if (!/} finally \{\s*setPricingNow\(\(cur\) => cur\.filter/.test(panel)) {
    fail("the bench is cleared somewhere other than a finally — priceOne exits from half a dozen places and a missed one leaves a card on the bench for ever");
  }
}

if (failures) {
  console.error(`\ncheck-stockmatch: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-stockmatch: OK — the reverse holo and the slab are their own cards, and the working can be folded away without taking a warning with it.");
