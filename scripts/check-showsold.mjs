/**
 * Selling several cards at once at the table — and what that must never do.
 *
 *   node scripts/check-showsold.mjs      (or: npm run check)
 *
 * Bulk **£ Sold** is the only action on the Show Desk with nothing behind it:
 * the card is pulled from its stack for good, the eBay listing is ended, and
 * the checkout row is closed. Return-to-spots undoes itself by checking the
 * card back out; a sale does not. So the cases here are mostly about the ways
 * a bulk sale could quietly record the wrong thing:
 *
 * - an empty price box becoming **£0** rather than "no price", which reads as
 *   a giveaway and drags the day's takings down where nobody would look;
 * - a card whose listing was ENDED at checkout being counted as a listing to
 *   end again, or — much worse — a quantity-hidden one not being counted,
 *   since eBay's out-of-stock control puts that listing straight back on sale;
 * - one unreadable box letting the rest of the sale through, leaving you to
 *   work out afterwards which of the four cards went through.
 *
 * And the rule this shares with check-showfilter.mjs: the rows a bulk sale
 * acts on come from `selectionFor()`, so they are rows that were on screen.
 *
 * Offline, no Supabase, no framework: showsold.js is pure by design.
 */
import { readFileSync } from "node:fs";
import {
  stickerText, soldDraft, endsListing, soldEntries, soldSummary, soldMessage
} from "../apps/app/lib/showsold.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// A checkout row cut down to what this file reads.
const row = (id, over = {}) => ({
  id,
  sku: over.sku ?? id.toUpperCase(),
  title: over.title ?? `Card ${id}`,
  sticker_pence: over.sticker_pence ?? null,
  ebay_item_id: over.ebay_item_id ?? null,
  hide_method: over.hide_method ?? "none"
});

// --- 1. the price a sale starts from ---------------------------------------
eq("the sticker is the price the box opens with", stickerText(row("a", { sticker_pence: 700 })), "7.00");
eq("pence survive it", stickerText(row("a", { sticker_pence: 749 })), "7.49");
// Blank, never "0.00": an empty box invites the price that was agreed, a zero
// is a false record somebody has to notice and clear.
eq("no sticker means an empty box", stickerText(row("a")), "");
eq("a sticker of nothing is still not a zero", stickerText(row("a", { sticker_pence: null })), "");
eq("the draft is keyed by row id", soldDraft([row("a", { sticker_pence: 1200 }), row("b")]), { a: "12.00", b: "" });
eq("a row with no id is not in the draft", soldDraft([{ sticker_pence: 500 }]), {});

// --- 2. which listings have to be ended ------------------------------------
// The one that costs a card twice: quantity-hidden is still a listing, and
// eBay's out-of-stock control will put it back on sale the moment the quantity
// goes up. Only an ended listing needs nothing.
eq("a live listing must be ended", endsListing(row("a", { ebay_item_id: "1", hide_method: "none" })), true);
eq("a quantity-hidden listing must be ended", endsListing(row("a", { ebay_item_id: "1", hide_method: "quantity" })), true);
eq("an already-ended listing needs nothing", endsListing(row("a", { ebay_item_id: "1", hide_method: "ended" })), false);
eq("a card with no listing needs nothing", endsListing(row("a")), false);
eq("nothing at all is not a listing", endsListing(null), false);

// --- 3. what the typed prices come to --------------------------------------
const rows = [
  row("a", { sticker_pence: 700, ebay_item_id: "1" }),                          // sticker kept
  row("b", { sticker_pence: 1200, ebay_item_id: "2", hide_method: "quantity" }), // haggled down
  row("c"),                                                                      // no sticker, no price
  row("d", { sticker_pence: 500, ebay_item_id: "3", hide_method: "ended" })      // already ended
];
const prices = { a: "7.00", b: "10", c: "", d: "5.00" };
const entries = soldEntries(rows, prices);
eq("one entry per card, in order", entries.map((e) => e.id), ["a", "b", "c", "d"]);
eq("the prices are read to the penny", entries.map((e) => e.pence), [700, 1000, null, 500]);
eq("only the listings that need ending are flagged", entries.map((e) => e.ends), [true, true, false, false]);

const sum = soldSummary(entries);
eq("the takings are the priced cards only", sum.totalPence, 2200);
eq("and the counts say which is which", [sum.count, sum.priced, sum.unpriced], [4, 3, 1]);
eq("the ending count matches the rows", sum.ending, 2);
eq("a readable panel may be confirmed", sum.ok, true);

// A blank box is a card sold without a price — NOT a card sold for nothing.
const blank = soldSummary(soldEntries([row("c")], { c: "" }));
eq("an empty box records no price", blank.priced, 0);
eq("and adds nothing to the takings", blank.totalPence, 0);
eq("it is not an error either", blank.ok, true);

// --- 4. one bad box stops the lot ------------------------------------------
// Going ahead with the readable rows and skipping the rest is the worst
// outcome: four cards on the counter, some sold, the customer already gone.
const bad = soldSummary(soldEntries(rows, { ...prices, b: "ten pounds" }));
eq("an unreadable price blocks the sale", bad.ok, false);
eq("and says which row", bad.errors.map((e) => e.id), ["b"]);
eq("the good rows are still counted, so the panel can show them", bad.priced, 2);
eq("nothing to sell is nothing to confirm", soldSummary([]).ok, false);

// --- 5. what the desk says afterwards --------------------------------------
const said = soldMessage({ sold: 4, priced: 3, totalPence: 2200, warnings: [] });
if (!/4 cards sold/.test(said)) fail(`the message does not count the cards: ${said}`);
if (!/£22\.00/.test(said)) fail(`the message does not carry the takings: ${said}`);
if (!/1 without a price/.test(said)) fail(`the message hides the unpriced card: ${said}`);
const warned = soldMessage({ sold: 1, priced: 1, totalPence: 700, warnings: ["A1: listing not ended"] });
if (!/⚠ A1: listing not ended/.test(warned)) fail(`a warning was dropped: ${warned}`);
if (!/1 card sold/.test(soldMessage({ sold: 1, priced: 1, totalPence: 700 }))) fail("one card is not pluralised as one");

// --- 6. the screen sells through this file, and only this file -------------
const desk = readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8");
if (!/from "@\/lib\/showsold\.js"/.test(desk)) {
  fail("ShowDesk.js no longer imports showsold.js — the bulk sale has a second set of rules");
}
// One definition of what selling a card DOES. Two would eventually disagree
// about whether the listing gets ended, and the row button and the bulk bar
// would part company in exactly the way that sells a card twice.
const endCalls = desk.match(/\/api\/ebay\/end-listing/g) || [];
if (endCalls.length !== 1) {
  fail(`ShowDesk.js ends a listing in ${endCalls.length} places — soldOne() is meant to be the only one`);
}
if (!/async function soldOne\(/.test(desk)) fail("ShowDesk.js has no soldOne() — the row button and the bulk bar have parted company");
for (const [what, re] of [
  ["the single sale", /soldOne\(supabase\(\), co, pence\)/],
  ["the bulk sale", /async function markSoldMany\(/],
  ["the confirm panel", /soldPlan/]
]) {
  if (!re.test(desk)) fail(`ShowDesk.js does not build ${what} the way this check expects`);
}
// The rule shared with check-showfilter.mjs: a bulk sale acts on what is on
// screen. The panel is opened over `selected`, which is selectionFor()'s
// answer — never over the whole checkout list.
if (!/const rows = selected;/.test(desk)) {
  fail("the bulk sale no longer opens over selectionFor()'s rows — it can sell cards nobody can see");
}
// A price typed here is a SALE price, not a sticker: no cash ladder, no
// rounding to the pound. £7.50 is what changed hands.
if (/labelPrice\(|toPoundPence\(/.test(desk.slice(desk.indexOf("async function markSoldMany"), desk.indexOf("function buildSoldPlan")))) {
  fail("the bulk sale rounds the price — a sale is what changed hands, not a sticker");
}

if (failures) {
  console.error(`\ncheck-showsold: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-showsold: OK — a bulk sale sells what's on screen, at the price on the card, and says what it ended.");
