/**
 * The list turned round to face a customer, and the wants it collects.
 *
 *   node scripts/check-showcounter.mjs      (or: npm run check)
 *
 * The Show Desk is a working screen: it shows the SKU (a stack name plus a
 * position, so it says how deep the stock runs), whether the card is still
 * live on eBay, and a `£ Sold` button. Counter mode puts that same list in a
 * stranger's eyeline, so the question this file exists to answer is **what
 * can reach their eyes**.
 *
 * The leak these cases are built around is not a bug anyone would write on
 * purpose. It is the one that arrives LATER: a column is added to
 * stock_checkouts for some unrelated reason, nobody remembers this projection,
 * and it appears on a tablet pointed at a customer. So `counterRow()` is an
 * allow-list — it builds a new object key by key — and case 2 below asserts
 * that by stuffing a checkout row with private values and searching the whole
 * serialised result for any of them. A projection written the other way round
 * (spread the row, delete the private bits) passes every test anyone thinks to
 * write and fails the day a column is added.
 *
 * The same projection is what the public storefront would serve (see
 * docs/SHOW_STOREFRONT.md), which is why it is pinned here rather than left to
 * the screen: the version of this that faces the internet must not be a second
 * copy that disagrees about what is private.
 *
 * Offline, no Supabase, no framework.
 */
import { readFileSync } from "node:fs";
import {
  counterRow,
  counterView,
  listingRow,
  conditionOf,
  largeImage,
  onlineMatches,
  inBoxSkus,
  ONLINE_LIMIT,
  counterName,
  counterPrice,
  counterImage,
  COUNTER_FIELDS,
  COUNTER_NAME_MAX,
  ASK_TEXT
} from "../apps/app/lib/showcounter.js";
import { normaliseWant, wantsSummary, isMissingTable } from "../apps/app/lib/wants-store.js";
import { showView } from "../apps/app/lib/showfilter.js";
import { locationsBySku } from "../apps/app/lib/stackpos.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) fail(`${what}: got ${a}, expected ${b}`);
};

// A checkout row carrying every private thing the desk knows about a card.
const PRIVATE = {
  sku: "AB12",
  stack_name: "Stack A",
  stack_id: "stack-uuid",
  stack_card_id: "card-uuid",
  event: "Cardiff Expo",
  ebay_item_id: "115566778899",
  hide_method: "quantity",
  hide_error: "eBay said no",
  note: "bought in the Wilson lot for £4",
  sold_price_pence: 1200,
  return_stack_id: "other-uuid",
  relisted_item_id: "999888777",
  sticker_batch_id: "batch-uuid",
  user_id: "user-uuid"
};
const ROW = {
  id: "co-1",
  title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM",
  sticker_pence: 4000,
  checked_out_at: "2026-08-29T09:00:00Z",
  ...PRIVATE
};

// --- 1. the allow-list is exactly what it says ----------------------------
eq("a counter row carries exactly the allowed keys", Object.keys(counterRow(ROW)).sort(), [...COUNTER_FIELDS].sort());

// --- 2. nothing private survives the projection ---------------------------
// The serialised row is searched for each private VALUE, so a field renamed on
// the way through is caught as well as one passed straight along.
const serialised = JSON.stringify(counterRow(ROW, { images: new Map([["ab12", "https://i.ebayimg.com/x.jpg"]]) }));
for (const [field, value] of Object.entries(PRIVATE)) {
  if (typeof value === "string" && serialised.includes(value)) {
    fail(`${field} ("${value}") reached the counter view — a customer can read it`);
  }
  if (typeof value === "number" && serialised.includes(String(value))) {
    fail(`${field} (${value}) reached the counter view — a customer can read it`);
  }
}
// The keys themselves, in case a value ever coincides with something allowed.
for (const field of Object.keys(PRIVATE)) {
  if (serialised.includes(`"${field}"`)) fail(`the key ${field} is present on a counter row`);
}

// --- 3. a held price asks, and never quietly shows another number ---------
// stickerFor() withholds a price on low/no confidence and on prices built from
// active listings. Facing a customer a blank reads as free, and the eBay price
// is wrong by ~13.25% of fees plus £1.35 of postage a table sale never pays.
const held = counterRow({ id: "x", title: "Umbreon VMAX 215/203", sticker_pence: null });
eq("no sticker means ask, not a blank", held.priceText, ASK_TEXT);
eq("no sticker carries no pence", held.pricePence, null);
for (const bad of [0, -100, "", NaN, undefined]) {
  const r = counterRow({ id: "x", title: "Card", sticker_pence: bad });
  eq(`a sticker of ${JSON.stringify(bad)} asks rather than prices`, r.priceText, ASK_TEXT);
  eq(`a sticker of ${JSON.stringify(bad)} carries no pence`, r.pricePence, null);
}

// --- 4. cash reads as cash ------------------------------------------------
// The ladder lands on whole pounds, and "£3" reads across a table where
// "£3.00" reads as a listing price. Pence still show when somebody typed them.
eq("whole pounds lose the pence", counterPrice(300), "£3");
eq("a hand-typed sticker keeps its pence", counterPrice(350), "£3.50");
eq("£40 is £40", counterPrice(4000), "£40");
eq("nothing is an ask", counterPrice(null), ASK_TEXT);

// --- 5. the name a customer reads -----------------------------------------
eq(
  "the marketing tail and the 'Pokemon Card' prefix both go",
  counterName("Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM"),
  "Gengar VMAX 020/198"
);
eq("the collector number survives", counterName("Umbreon VMAX 215/203 Evolving Skies Alt Art"), "Umbreon VMAX 215/203");
// The false positive that matters: "card" is a real name, and the app prices
// every game even though the public page is Pokemon-only. Stripping a bare
// leading "card" would rename this one.
eq("a card actually called Card keeps its name", counterName("Card Trooper LOB-EN123"), "Card Trooper LOB-EN123");
eq("a nameless row still says something", counterName(""), "Card");
if (counterName("Pokemon Card " + "Gengar ".repeat(40) + "020/198").length > COUNTER_NAME_MAX) {
  fail("a very long title is not cut to the counter width");
}

// --- 6. a picture is this copy, or nothing --------------------------------
// Catalogue art is deliberately NOT substituted: it shows a mint scan of a
// played card to the person holding that card.
eq("the photo is looked up by SKU", counterImage({ sku: "AB12" }, new Map([["ab12", "u"]])), "u");
eq("a card with no listing photo has none", counterImage({ sku: "ZZ9" }, new Map([["ab12", "u"]])), null);
eq("no SKU, no photo", counterImage({}, new Map([["ab12", "u"]])), null);
eq("no map, no photo", counterImage({ sku: "AB12" }, null), null);

// --- 7. one search, two screens -------------------------------------------
// The customer's list and yours must find the same cards: a search that
// answers differently sends you to a card they cannot see, or promises one
// that is not in the box.
const POOL = [
  ROW,
  { id: "co-2", sku: "AB13", title: "Gengar ex 094/091 Paldean Fates", sticker_pence: 1500 },
  { id: "co-3", sku: "AB14", title: "Umbreon VMAX 215/203 Evolving Skies", sticker_pence: null }
];
for (const query of ["", "gengar", "umbreon", "215/203", "nothing-matches"]) {
  const desk = showView(POOL, { query });
  const counter = counterView(POOL, { query });
  eq(`"${query}" finds the same number of cards on both screens`, counter.shown, desk.shown);
  eq(`"${query}" projects every row it shows`, counter.rows.length, desk.rows.length);
}
eq("the priced count is the rows with a sticker", counterView(POOL, {}).priced, 2);
// Every row on the customer's list goes through the projection.
for (const r of counterView(POOL, {}).rows) {
  eq("every counter row is projected", Object.keys(r).sort(), [...COUNTER_FIELDS].sort());
}

// --- 6b. the condition, which is the fact a customer cannot check --------
// They can see a card in the box. They cannot see one that is online, and
// condition is the difference between a £40 card and a £12 one.
eq("the grade in the title is written out in full", conditionOf({ title: "Gengar VMAX 020/198 NM" }), "Near Mint");
eq("played grades too", conditionOf({ title: "Charizard Base Set lightly played" }), "Lightly Played");
eq("nothing stated is not a claim", conditionOf({ title: "Pikachu 25/100" }), null);
// eBay's own field is SECOND, not first, and its generic values are dropped.
// On a TCG single the seller writes the grade in the title and leaves the
// dropdown on "Ungraded" — true, and no use to somebody choosing a copy.
eq("a useless eBay condition is not shown", conditionOf({ title: "Gengar 020/198", extra: { condition: "Ungraded" } }), null);
eq("a meaningful eBay condition is", conditionOf({ title: "Gengar 020/198", extra: { condition: "Graded - PSA 9" } }), "Graded - PSA 9");
eq("the title beats the dropdown", conditionOf({ title: "Gengar 020/198 NM", extra: { condition: "Used" } }), "Near Mint");
// The name is cut at the collector number, so condition could never ride
// along inside it — which is why it is its own field.
if (/NM|Near Mint/.test(counterName("Gengar VMAX 020/198 Near Mint"))) {
  fail("the condition is inside the name — it belongs in its own field, where it survives the title being cut");
}

// --- 6c. the picture, at a size worth looking at -------------------------
eq(
  "eBay's size is swapped, not the URL rebuilt",
  largeImage("https://i.ebayimg.com/images/g/abc/s-l140.jpg"),
  "https://i.ebayimg.com/images/g/abc/s-l1600.jpg"
);
// A picture we cannot resize is still a picture. Returning null here would
// trade a small view for no view.
eq("a URL that isn't eBay's is left alone", largeImage("https://x.test/pic.jpg"), "https://x.test/pic.jpg");
eq("no picture stays no picture", largeImage(null), null);

// --- 7b. the online stock, and the line between it and the box ------------
// A second list of cards we own but may not have in the room. Everything here
// is about not promising the wrong thing, in either direction.
const LISTING_PRIVATE = { sku: "AB12", url: "https://www.ebay.co.uk/itm/115566778899" };
// `extra` is a jsonb bag — conditionOf() reads ONE key out of it, and the rest
// (what we watch, what it cost us to list, whatever gets added next) must not
// ride along behind it.
// Distinctive values on purpose: a short number like 77 is a substring of the
// item id, and the search below would "find" a leak that isn't there. The
// first version of this case did exactly that.
const LISTING_EXTRA_PRIVATE = { watchCount: 987654, quantitySold: 876543, category: "Our internal category" };
const LISTING = {
  ebay_item_id: "115566778899",
  title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign",
  price_value: 45.5,
  quantity: 1,
  image_url: "https://i.ebayimg.com/x.jpg",
  extra: { condition: "Ungraded", ...LISTING_EXTRA_PRIVATE },
  ...LISTING_PRIVATE
};
eq("an online row is the same shape as a box row", Object.keys(listingRow(LISTING)).sort(), [...COUNTER_FIELDS].sort());
const lSerialised = JSON.stringify(listingRow(LISTING));
for (const [field, value] of Object.entries(LISTING_PRIVATE)) {
  // The SKU is our shelf address. The URL is an invitation to buy it online
  // instead of from the table the customer is standing at.
  if (lSerialised.includes(value)) fail(`${field} reached the counter from an eBay listing`);
}
for (const [field, value] of Object.entries(LISTING_EXTRA_PRIVATE)) {
  if (lSerialised.includes(String(value))) fail(`extra.${field} rode along behind the condition lookup`);
}
eq("the eBay price is shown as it stands", listingRow(LISTING).priceText, "£45.50");

const STOCK = [
  LISTING,
  { ebay_item_id: "2", sku: "AB13", title: "Gengar ex 094/091", price_value: 12, quantity: 0 },
  { ebay_item_id: "3", sku: "AB14", title: "Gengar V 156/198", price_value: 8 },
  { ebay_item_id: "4", sku: "AB15", title: "Umbreon VMAX 215/203", price_value: 900, quantity: 2 }
];
// Thousands of listings under a hundred real ones is a catalogue, not a stock
// list — so the second list exists only in answer to a question.
eq("no query, no online list", onlineMatches(STOCK, { query: "" }).length, 0);
eq("a query finds the online stock", onlineMatches(STOCK, { query: "gengar" }).map((r) => r.name), ["Gengar VMAX 020/198", "Gengar V 156/198"]);
// A sold card is STILL a row in ebay_listings — eBay's out-of-stock control
// zeroes the quantity and leaves it active. Offering one at a table is worse
// than never showing it.
if (onlineMatches(STOCK, { query: "gengar" }).some((r) => r.name.includes("094"))) {
  fail("a sold-out listing is offered to a customer");
}
// The false positive that costs a sale: no quantity column is SILENCE, not a
// zero. Reading it as sold-out hides real stock.
if (!onlineMatches(STOCK, { query: "gengar" }).some((r) => r.name.includes("156/198"))) {
  fail("a listing with no quantity is being read as sold out — that is stock we could have sold");
}
// A card checked out with its listing left live is in both sets. Shown twice,
// it reads as two copies.
eq(
  "a card already in the box is not offered again below it",
  onlineMatches(STOCK, { query: "gengar", inBoxSkus: inBoxSkus([{ sku: "ab12" }]) }).map((r) => r.name),
  ["Gengar V 156/198"]
);
eq("the box SKUs are matched case-insensitively", [...inBoxSkus([{ sku: "AB12" }])], ["ab12"]);
const many = Array.from({ length: 60 }, (_, i) => ({ ebay_item_id: String(i), sku: `S${i}`, title: `Gengar ${i}/198`, price_value: i + 1, quantity: 1 }));
eq("the online list is capped", onlineMatches(many, { query: "gengar" }).length, ONLINE_LIMIT);
eq("dearest first, so the cards worth a conversation are the ones on screen", onlineMatches(many, { query: "gengar" })[0].name, "Gengar 59/198");

// --- 7c. where a card is, and who is allowed to see it -------------------
// The location is the one piece of desk data allowed on the counter screen,
// and only on a tap. Two things have to hold: the number has to be right, and
// it must not be on the row until somebody asks for it.
const STACK_CARDS = [
  { id: "1", sku: "AB1", stack_id: "s1", position: 1 },
  { id: "2", sku: "AB2", stack_id: "s1", position: 2, pulled_at: "2026-08-01" },
  { id: "3", sku: "AB3", stack_id: "s1", position: 3 },
  { id: "4", sku: "AB4", stack_id: "s1", position: 4, checked_out_at: "2026-08-29" },
  { id: "5", sku: "AB5", stack_id: "s1", position: 5 }
];
const LOC = locationsBySku(STACK_CARDS, new Map([["s1", "A"]]));
// The rule this whole file inherits: pulled and checked-out cards close the
// numbering up behind them, so AB3 is the SECOND card you count to, not the
// third. Reading the SKU as the position is the mistake that sends you to the
// wrong card.
eq("the numbering closes up behind a pulled card", LOC.get("ab3"), "A · 2 of 3");
eq("and behind a card away at the show", LOC.get("ab5"), "A · 3 of 3");
if (LOC.has("ab2")) fail("a pulled card is given a position — there is no honest number for it");
if (LOC.has("ab4")) fail("a card away at the show is given a position in its stack");
eq("SKUs are matched however they are cased", LOC.get("ab1"), "A · 1 of 3");

// The lookup must not be smuggled onto the row to make the tap easier.
if (/location|stack|position/i.test(JSON.stringify(Object.keys(listingRow(LISTING))))) {
  fail("a projected row carries location data — it must be resolved from desk state instead");
}

// --- 8. the want list ------------------------------------------------------
eq("wants group the way the search matches", normaliseWant("  GENGAR vmax "), normaliseWant("gengar VMAX"));
const WANTS = [
  { id: "1", query: "gengar", query_norm: "gengar", had_match: true, created_at: "2026-08-29T10:00:00Z" },
  { id: "2", query: "Gengar", query_norm: "gengar", had_match: false, created_at: "2026-08-29T11:00:00Z" },
  { id: "3", query: "lugia", query_norm: "lugia", had_match: false, created_at: "2026-08-29T12:00:00Z" },
  { id: "4", query: "pikachu", query_norm: "pikachu", had_match: true, created_at: "2026-08-29T13:00:00Z" }
];
const summary = wantsSummary(WANTS);
eq("one row per thing asked for", summary.length, 3);
eq("commonest first", summary[0].key, "gengar");
eq("asks are counted", summary[0].asks, 2);
eq("misses are counted", summary[0].misses, 1);
// Ties break toward what we could not sell: the list is read with a float in
// hand, so the card to BUY sorts above the card we already stock.
eq("a tie puts the miss above the card we had", [summary[1].key, summary[2].key], ["lugia", "pikachu"]);

// --- 9. a pending migration degrades, it does not break the desk ----------
// Migrations here are applied by hand and the code ships first, so the want
// list has to be absent rather than fatal.
if (!isMissingTable({ code: "42P01" })) fail("a missing table is not recognised by its Postgres code");
if (!isMissingTable(new Error('relation "public.show_wants" does not exist'))) fail("a missing relation is not recognised");
if (!isMissingTable(new Error("Could not find the table in the schema cache"))) fail("a cold PostgREST schema cache is not recognised");
if (isMissingTable(new Error("network request failed"))) fail("an ordinary failure is being read as a pending migration");

const migration = readFileSync(new URL("../supabase/migrations/026_show_wants.sql", import.meta.url), "utf8");
for (const needed of ["show_wants", "had_match", "query_norm", "enable row level security"]) {
  if (!migration.includes(needed)) fail(`migration 026 no longer creates ${needed}`);
}

// --- 10. the screen reads these files, and only these files ---------------
const desk = readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8");
if (!/from "@\/lib\/showcounter\.js"/.test(desk)) {
  fail("ShowDesk.js no longer imports showcounter.js — the customer's view is being built inline again");
}
if (!desk.includes("counterView(")) fail("ShowDesk.js does not build the counter list through counterView()");
if (desk.includes("show_wants")) {
  fail("ShowDesk.js names show_wants directly — the table shape belongs in lib/wants-store.js alone");
}

// The counter BRANCH of the render may not reach a private field. Sliced out
// of the file rather than reasoned about, because the whole risk here is
// someone adding a span to the wrong branch.
const open = desk.indexOf("{counterMode ? (");
const close = desk.indexOf("\n            ) : (", open);
if (open < 0 || close < 0) {
  fail("the counter branch of the render is no longer recognisable — check this file still guards the right code");
} else {
  const branch = desk.slice(open, close);
  for (const forbidden of [
    "markSold", "returnOne", "setSticker", "toggleSel", "hideChip",
    "stack-sku", "stack_name", "co.event", "sd-rowacts", "checkbox"
  ]) {
    if (branch.includes(forbidden)) {
      fail(`the counter list renders ${forbidden} — that is desk data or a destructive control facing a customer`);
    }
  }
  if (!branch.includes("counter.rows")) fail("the counter list is not rendered from the projection");
  if (/\bvisible\b/.test(branch)) fail("the counter list reads `visible` — it must render only projected rows");
}

// The way IN has to be findable. Gated on there being stock checked out, the
// toggle disappeared exactly when somebody went looking for it — a control you
// can only discover while packing for a show is one nobody discovers.
const toggleAt = desk.indexOf("Show a customer");
if (toggleAt < 0) {
  fail("the counter-mode toggle is gone — there is no way into the customer view");
} else {
  // Anchored on the enclosing <button rather than a fixed window back from the
  // label: the button's own title strings are long enough to fill any window
  // small enough to be meaningful, which is how the first version of this
  // assertion passed while the gate was back in place.
  const tagAt = desk.lastIndexOf("<button", toggleAt);
  const before = desk.slice(Math.max(0, tagAt - 300), tagAt);
  if (/open\.length\s*[><=]/.test(before)) {
    fail("the counter-mode toggle is gated on stock being checked out again — it vanishes when someone goes looking for it");
  }
}
// Rendered is not the same as visible. The toggle shipped ungated and still
// could not be found: `.panel-head` is a nowrap flex row, and on a phone the
// third button in that header sat off the right-hand edge of the screen.
const css = readFileSync(new URL("../apps/app/app/globals.css", import.meta.url), "utf8");
if (!/\.sd-scope \.panel-head\s*\{[^}]*flex-wrap:\s*wrap/.test(css)) {
  fail("the show desk's panel headers no longer wrap — a third button in one goes off the side of a phone");
}
// A held price must stay on its card's row rather than dropping below it.
if (!/\.sd-scope \.ps-row\.sd-counter-row\s*\{[^}]*flex-wrap:\s*nowrap/.test(css)) {
  fail("counter rows wrap again — \"Ask at the table\" drops onto a line of its own, away from the card it belongs to");
}

// An empty box must not hand a customer the desk's own copy, which tells them
// to type a SKU into a form counter mode does not render — and must not stop
// there either: with nothing checked out the online list is the only stock
// there is, and the search box is the only way to it.
if (!/open\.length === 0 && !customerMode \?/.test(desk)) {
  fail("the desk's empty state is not gated on customerMode — a customer is told to enter a SKU, or loses the search entirely");
}

// The reveal is a tap, not a default. Gated wrong, every stack name and depth
// is on a screen pointed at a customer.
const onlineAt = desk.indexOf("sd-counter-online");
if (onlineAt < 0) {
  fail("the online list is gone");
} else {
  const block = desk.slice(onlineAt, onlineAt + 2200);
  if (!/locationOpen === c\.id \?/.test(block)) {
    fail("the location is not gated on a tap — a stack name and depth are on screen by default");
  }
  // Same allow-list rule as the box rows: the SKU is our shelf address.
  if (block.includes("c.sku") || block.includes("stack-sku")) {
    fail("the online row renders the SKU — that is our shelf address, facing a customer");
  }
}

// The picture opens from the row rather than being fetched per row: a route
// that costs an API call for every card on screen is one nobody can use at a
// table on venue wifi.
if (!desk.includes("setPhoto(")) fail("the counter photos can no longer be opened");
if (/imageLarge.*fetch\(|fetch\(.*imageLarge/.test(desk)) {
  fail("the large photo is being fetched — it is a string swap on a URL we already hold");
}

// The two lists must stay two lists. Merged, a card we might have at home is
// indistinguishable from one in the box, and the box is the only one anybody
// can actually hand over.
if (!desk.includes("sd-counter-split")) {
  fail("the online stock is no longer under a heading of its own — merged, it reads as cards in the box");
}
// And the wording must express doubt rather than absence. Not everything that
// travels to a show gets checked out, so "not here" is a claim the data cannot
// support — and saying it about a card that IS in the box loses a sale we had
// already made.
const splitAt = desk.indexOf("sd-counter-split");
if (splitAt > 0) {
  const heading = desk.slice(splitAt, splitAt + 600);
  if (!/Ask us about these/.test(heading)) fail("the online section no longer asks — check the copy still invites a question");
  if (/not here|we don't have|haven't got/i.test(heading)) {
    fail("the online section claims the card is absent — checkout is not complete enough to know that");
  }
}

// Counter mode has to REMOVE the desk, not restyle it: a customer can scroll,
// and an off-palette "£ Sold" is still a button.
//
// The question every piece of desk chrome asks is `customerMode`, not
// `counterMode`. There are two customer screens now — the list and the binder
// — and gating the checkout form on the LIST alone would render it behind the
// binder, which is the same leak with an extra step. So the gate is asserted
// on `customerMode`, and `counterMode` is asserted to be only half of it.
if (!desk.includes("{customerMode ? null : (")) {
  fail("no part of the desk is gated on customerMode — the checkout form and bulk actions still render to a customer");
}
if (!/const customerMode = counterMode \|\| binderMode/.test(desk)) {
  fail("customerMode is no longer both customer screens — some desk chrome is gated on one of them alone");
}
// A negative gate on `counterMode` is that mistake written down: it hides
// something from the list and shows it to the binder.
const negatives = desk.match(/![\s]*counterMode/g) || [];
if (negatives.length > 0) {
  fail(`${negatives.length} piece(s) of the desk are hidden from the counter list but not the binder — gate them on customerMode`);
}

const store = readFileSync(new URL("../apps/app/lib/wants-store.js", import.meta.url), "utf8");
if (/^\s*import\s+.*from\s+["']@\//m.test(store)) {
  fail("wants-store.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
}
const counterLib = readFileSync(new URL("../apps/app/lib/showcounter.js", import.meta.url), "utf8");
if (/^\s*import\s+.*from\s+["']@\//m.test(counterLib)) {
  fail("showcounter.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
}
// The projection must be built, never filtered. A spread is how the later
// column leaks; see the header.
if (/\.\.\.co\b/.test(counterLib)) {
  fail("counterRow spreads the checkout row — it must build the allowed keys, or the next column added leaks");
}

if (failures) {
  console.error(`\ncheck-showcounter: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-showcounter: OK — a customer sees the card, the name and the price, and nothing else.");
