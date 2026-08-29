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
  counterName,
  counterPrice,
  counterImage,
  COUNTER_FIELDS,
  COUNTER_NAME_MAX,
  ASK_TEXT
} from "../apps/app/lib/showcounter.js";
import { normaliseWant, wantsSummary, isMissingTable } from "../apps/app/lib/wants-store.js";
import { showView } from "../apps/app/lib/showfilter.js";

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
// An empty box must not hand a customer the desk's own copy, which tells them
// to type a SKU into a form counter mode does not render.
if (!/counterMode \? \(\s*\n\s*<p className="dd-empty">/.test(desk)) {
  fail("counter mode has no empty state of its own — an empty box shows the desk's 'enter a SKU above' copy");
}

// Counter mode has to REMOVE the desk, not restyle it: a customer can scroll,
// and an off-palette "£ Sold" is still a button.
if (!desk.includes("{counterMode ? null : (")) {
  fail("no part of the desk is gated on counterMode — the checkout form and bulk actions still render to a customer");
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
