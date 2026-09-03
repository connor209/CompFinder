/**
 * A price you set by hand, and everywhere it has to travel.
 *
 *   node scripts/check-override.mjs      (or: npm run check)
 *
 * Two halves, and the second is why this file exists at all.
 *
 * The TABLE half is the parser and the precedence rules — what counts as a
 * price, what a blank box means, and which number wins. Ordinary table tests.
 *
 * The GREP half is the one that earns its keep. An override is only worth
 * anything if every path that SPENDS money reads it: the eBay upload CSV, the
 * bulk lister, the sticker ladder, the saved run, the price history. Each of
 * those already had a perfectly good `rec.finalPence` in it, and the failure
 * mode when one of them keeps reading it is silent and expensive — the screen
 * shows your £40, the file uploaded to eBay carries the app's £12.49, and
 * nothing anywhere says they disagree. So the money-out files are grepped for
 * a direct read of `finalPence`, and the ones that legitimately need the
 * engine's figure (to display it beside yours, or to compare against the
 * market) have to say so in a way that reads as deliberate.
 */
import { readFileSync } from "node:fs";
import {
  parseOverridePence,
  effectivePence,
  isOverridden,
  withOverride,
  clearOverride,
  overrideNote,
  overriddenFromPence,
  poundsStr,
  MAX_OVERRIDE_PENCE
} from "../apps/app/lib/price-override.js";
import { stickerFor, stickerRows, stickerSummary } from "../apps/app/lib/showstock.js";
import { pricedSkuMap } from "../apps/app/lib/ebayexport.js";
import { slimRec, restoreResults, batchRows } from "../apps/app/lib/batch-store.js";
import { reviewVerdict } from "../apps/app/lib/matching.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

const rec = (over = {}) => ({
  rawPence: 83748,
  finalPence: 83500,
  confidence: "High",
  dataSource: "sold",
  note: "8 comps",
  included: [1, 2, 3, 4, 5, 6, 7, 8],
  excluded: [],
  ...over
});

// --- 1. what counts as a price ---------------------------------------------
// [typed, pence, why this case is here]
const PARSED = [
  ["12.50", 1250, "the ordinary case"],
  ["£12.50", 1250, "the £ people type is not an error"],
  ["12", 1200, "whole pounds"],
  ["  7.05  ", 705, "surrounding space is a slip, not a rejection"],
  ["1,299.99", 129999, "a thousands separator survives a paste from a sheet"],
  ["0.01", 1, "a penny is a price"],
  ["", null, "a blank box is how an override is cleared, not an error"],
  ["   ", null, "and so is a box of spaces"]
];
for (const [typed, want, why] of PARSED) {
  const { pence, error } = parseOverridePence(typed);
  eq(`parse ${JSON.stringify(typed)} (${why})`, { pence, error }, { pence: want, error: null });
}

// Refusals. Each returns prose, because it is shown on the row — a parser that
// fails silently here leaves you looking at the old price believing it is new.
const REFUSED = [
  ["twelve", "words are not prices"],
  ["12.505", "a third decimal is a finger slip, and rounding it lists the card at a price nobody chose"],
  ["-5", "a negative price is nonsense"],
  ["12.50.50", "two decimal points"],
  ["1e3", "exponent notation is a typo here, not £1000"],
  ["0", "a price of nothing is not a cheap card"],
  ["0.001", "a tenth of a penny rounds to zero — refused rather than silently free"],
  ["100000", "£100,000 is past what eBay will take: a missing decimal point on a £1000 card"]
];
for (const [typed, why] of REFUSED) {
  const { pence, error } = parseOverridePence(typed);
  if (pence != null || !error) fail(`parse ${JSON.stringify(typed)} should have been refused (${why})`);
}
eq("the ceiling itself is allowed", parseOverridePence("99999.99").pence, MAX_OVERRIDE_PENCE);

// --- 2. which number wins --------------------------------------------------
eq("no override reads the engine's price", effectivePence(rec()), 83500);
eq("an override wins", effectivePence(withOverride(rec(), 4000)), 4000);
eq("the engine's price is NEVER edited", withOverride(rec(), 4000).finalPence, 83500);
eq("and is still readable beside yours", overriddenFromPence(withOverride(rec(), 4000)), 83500);
eq("no rec at all is no price", effectivePence(null), null);
eq("a rec is not overridden until it is", isOverridden(rec()), false);
eq("an override is loud enough to test for", isOverridden(withOverride(rec(), 4000)), true);

// Typing the recommendation back in is not an override — it is agreement, and
// carrying it as one puts "overridden from £835 to £835" on every screen and
// in every export from then on.
eq("typing the same number clears rather than records", isOverridden(withOverride(rec(), 83500)), false);

// Panel.js and QuickSearch.js both lean on the IDENTITY of the returned rec to
// tell a real edit from confirming a box unchanged. Without it, tabbing through
// a run would put a duplicate row in your price history for every card.
const untouched = rec();
eq("confirming an unchanged box hands back the very same rec", withOverride(untouched, 83500) === untouched, true);
eq("and so does clearing one that was never overridden", clearOverride(untouched) === untouched, true);
eq("nothing in, nothing out", withOverride(null, null) === null, true);
const priced = withOverride(null, 500);
eq("re-typing the price you already set is not a second decision either",
  withOverride(priced, 500) === priced, true);

// A card the app could not price at all is the strongest case for typing one:
// the row is going in a box with a label on it either way.
const fromNothing = withOverride(null, 500);
eq("a card with no rec still takes a price", effectivePence(fromNothing), 500);
eq("and carries no comps, because there were none",
  { used: fromNothing.included.length, source: fromNothing.dataSource }, { used: 0, source: "override" });
eq("clearing that one goes back to nothing, not to a priceless result",
  clearOverride(fromNothing), null);
eq("clearing an ordinary one goes back to the engine",
  effectivePence(clearOverride(withOverride(rec(), 4000))), 83500);
eq("clearing leaves no trace behind to be found later",
  Object.prototype.hasOwnProperty.call(clearOverride(withOverride(rec(), 4000)), "overridePence"), false);
eq("clearing something that was never overridden is a no-op", clearOverride(rec()), rec());

// The sentence every screen and both exports show. One definition, so the CSV
// and the row cannot describe the same edit differently.
eq("the note names both numbers",
  overrideNote(withOverride(rec(), 4000)), "Priced by hand at £40.00, overriding £835.00.");
eq("and says so plainly when there was nothing to override",
  overrideNote(fromNothing), "Priced by hand at £5.00 — the app couldn't price this card.");
eq("no override, no note", overrideNote(rec()), null);
eq("pounds are pounds", [poundsStr(1250), poundsStr(null)], ["£12.50", "—"]);

// --- 3. the sticker gate ---------------------------------------------------
// Every hold says the same thing: the EVIDENCE is too thin to print. A price
// you typed isn't built on that evidence, so it is not what the gate is for —
// and a card the app refused to price is exactly the card an override exists
// for. It still goes through the ladder: what you typed is an eBay price.
const heldLow = rec({ confidence: "Low", included: [1], finalPence: 1249 });
eq("a thin price is still held", stickerFor(heldLow).held, true);
eq("your price on a thin card is not held",
  stickerFor(withOverride(heldLow, 1500)), { pence: 1500, held: false, reason: null, overridden: true });
eq("your price on an asking-price card is not held either",
  stickerFor(withOverride(rec({ dataSource: "active" }), 2000)).held, false);
eq("your price on a card the app couldn't price at all gets a sticker",
  stickerFor(withOverride(null, 700)).pence, 700);
eq("and it is still cash-rounded, not printed to the penny",
  stickerFor(withOverride(rec(), 749)).pence, 700);
eq("an unoverridden card is untouched by any of this",
  stickerFor(rec()), { pence: 84000, held: false, reason: null, overridden: false });

const stickers = stickerRows([
  { sku: "AB11", title: "Umbreon VMAX 215/203", rec: rec() },
  { sku: "AB12", title: "Charizard V 154/185", rec: withOverride(heldLow, 1500) },
  { sku: "AB13", title: "Snorlax 131/198", rec: null }
]);
eq("the sticker row is rounded from the price actually gone with",
  stickers[1].recommendedPence, 1500);
eq("and still says what it replaced", stickers[1].overriddenFromPence, 1249);
eq("a row nobody touched reports no replacement", stickers[0].overriddenFromPence, null);
eq("an overridden row is marked as yours", stickers.map((r) => r.pricedByHand), [false, true, false]);
eq("a hand-priced card comes off the held pile", stickerSummary(stickers), { priced: 2, held: 1 });

// TWO hand-set prices can land on one card, and they are different decisions:
// a price typed on the RESULT is an eBay price the ladder turns into cash; a
// price typed on the STICKER is the label. The label wins, and the row still
// reports the eBay price it was suggested from — a sticker panel that hid one
// of the two would make a card look mispriced when it isn't.
const both = stickerRows(
  [{ sku: "AB11", title: "Umbreon VMAX 215/203", rec: withOverride(rec(), 4000) }],
  { overrides: { 0: 3000 } }
);
eq("the sticker typed on the label wins over the one typed on the result",
  { sticker: both[0].stickerPence, suggested: both[0].suggestedPence, ebay: both[0].recommendedPence },
  { sticker: 3000, suggested: 4000, ebay: 4000 });
eq("and both are still visible as hand-set",
  { onTheResult: both[0].pricedByHand, onTheLabel: both[0].edited }, { onTheResult: true, onTheLabel: true });

// --- 4. what leaves the building -------------------------------------------
eq("the eBay upload file carries your price, not the one you rejected",
  [...pricedSkuMap([{ sku: "AB11", rec: withOverride(rec(), 4000) }]).entries()], [["AB11", 4000]]);
eq("a card the app couldn't price is uploadable once you name a price",
  [...pricedSkuMap([{ sku: "AB13", rec: withOverride(null, 500) }]).entries()], [["AB13", 500]]);
// It used to stay OUT of the file, which meant the row kept whatever price
// CardUploader had put there — £2.49, indistinguishable from the engine's
// floor. It goes in at zero instead, and check-zeroprice.mjs owns why.
eq("and until you do it is in the file at zero, not quietly at its old price",
  [...pricedSkuMap([{ sku: "AB13", rec: null }]).entries()], [["AB13", 0]]);

// --- 5. a saved run remembers it -------------------------------------------
// A run is re-opened days later precisely to list from, so a correction that
// doesn't survive the round trip is a correction that gets un-made by the
// person trusting the screen.
const saved = slimRec(withOverride(rec(), 4000));
eq("the saved shape keeps both numbers",
  { final: saved.finalPence, over: saved.overridePence }, { final: 83500, over: 4000 });
eq("a run with no override stores a null rather than a missing key",
  slimRec(rec()).overridePence, null);
const roundTripped = restoreResults(batchRows([{ title: "Umbreon VMAX", sku: "AB11", rec: withOverride(rec(), 4000) }]));
eq("and it comes back as an override, not as a number in a field nobody reads",
  effectivePence(roundTripped.results[0].rec), 4000);
eq("re-opened, the engine's figure is still there to go back to",
  overriddenFromPence(roundTripped.results[0].rec), 83500);

// --- 6. the review queue -------------------------------------------------
// The queue asks "do you agree with this price?". A row carrying your own
// number has answered it, and a count that keeps flagging cards you have
// already priced is a count nobody reads.
eq("a held price needs a look", reviewVerdict(rec({ finalPence: null })).needsReview, true);
eq("your price on it does not",
  reviewVerdict(withOverride(rec({ finalPence: null }), 4000)).needsReview, false);
eq("a card overruled by the live market needs a look",
  reviewVerdict(rec({ soldOverruled: true })).needsReview, true);
eq("your price on that one does not either",
  reviewVerdict(withOverride(rec({ soldOverruled: true }), 4000)).needsReview, false);

// --- 7. nothing that spends money reads the recommendation directly --------
// The grep that makes the rest of this file mean anything. A `rec.finalPence`
// left in one of these paths lists the card at the price you overrode, and
// says nothing about it anywhere.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const MONEY_OUT = [
  ["apps/app/lib/ebayexport.js", "the eBay upload file"],
  ["apps/app/lib/showstock.js", "the sticker ladder"]
];
for (const [file, what] of MONEY_OUT) {
  const src = read(file);
  // `exportPence` counts: it is `effectivePence` with the unpriced case
  // written as zero (lib/zero-price.js), so a price you set still wins.
  if (!/\b(effectivePence|exportPence)\s*\(/.test(src)) {
    fail(`${file} no longer reads effectivePence — ${what} can't see a price you set`);
  }
  for (const line of src.split("\n")) {
    if (/^\s*[*/]/.test(line)) continue; // prose about the rule is not the rule
    if (/\brec\??\.finalPence\b/.test(line) || /\brec\?\.\.?finalPence\b/.test(line)) {
      fail(`${file} reads finalPence directly — ${what} would ignore an override: ${line.trim()}`);
    }
  }
}

// The batch screen is the one that lists, exports, stickers and records, and
// it is 2,500 lines long: the specific call sites are named rather than the
// file, because a grep over the whole of it would fail on the places that
// legitimately show the engine's number beside yours.
const panel = read("apps/app/app/panel/Panel.js");
const PANEL_MUST = [
  ["pricePence: effectivePence(r.rec)", "the bulk lister would list at the price you overrode"],
  // exportPence is effectivePence with the unpriced case written as 0.00 —
  // see lib/zero-price.js. A bare finalPence here would print the price you
  // overrode; either of these prints the one you went with.
  ["const pence = exportPence(r.rec);", "Export CSV would print the price you overrode"],
  ["recommended_pence: effectivePence(rec)", "price history would record a price you didn't go with"],
  ["effectivePence(r.rec) != null).length", "the List-on-eBay count would ignore hand-priced cards"],
  ["updateItemRec(", "a saved run would not learn about a price set after it was saved"]
];
for (const [needle, why] of PANEL_MUST) {
  if (!panel.includes(needle)) fail(`Panel.js: ${why} (looking for \`${needle}\`)`);
}
if (!panel.includes("<PriceOverride")) fail("Panel.js no longer renders the override control — there is no way to set a price");

const quick = read("apps/app/app/panel/QuickSearch.js");
if (!quick.includes("suggestedPence={effectivePence(view.rec)}")) {
  fail("QuickSearch.js hands ListForm the recommendation — a deep-dive override wouldn't reach the listing");
}
if (!quick.includes("recommended_pence: effectivePence(rec)")) {
  fail("QuickSearch.js records the recommendation in history rather than the price gone with");
}

// One control, three screens. Two would drift, and a price control that reads
// differently depending on the screen is one you have to check twice.
for (const [file, screen] of [["apps/app/app/panel/Panel.js", "the batch screen"], ["apps/app/app/panel/QuickSearch.js", "a deep dive"]]) {
  if (!read(file).includes('from "./PriceOverride"')) {
    fail(`${screen} has stopped using the shared override control`);
  }
}

// Loadable under bare node, like everything else this file imports.
const lib = read("apps/app/lib/price-override.js");
if (/^\s*import\s+.*from\s+["']@\//m.test(lib)) {
  fail("price-override.js has picked up an app-aliased import — it has to stay loadable under bare node");
}

if (failures > 0) {
  console.error(`\ncheck-override: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-override: OK — your price wins, the app's is kept, and everything that spends money reads yours.");
