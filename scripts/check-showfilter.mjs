/**
 * Searching the show stock: what a query finds, how the list is ordered, and —
 * the one that can cost you cards — what a bulk action actually acts on.
 *
 *   node scripts/check-showfilter.mjs      (or: npm run check)
 *
 * The search and sort cases are ordinary table tests: they fail visibly on
 * screen the moment they are wrong, and the awkward ones (AB2 before AB11, a
 * card with no sticker sorting last in BOTH directions) are the ones an
 * "obvious" tidy-up breaks.
 *
 * **The selection cases are the ones that matter.** Every bulk button on the
 * Show Desk — reallocate, return to spots, file to the back of a stack — reads
 * `selectionFor()`, and the desk's convention is that ticking nothing means
 * all of them. Before there was a filter, "all of them" and "all the ones on
 * screen" were the same set. Now they are not, and the failure is silent in
 * exactly the way this codebase cares about: the cards that moved were never
 * rendered, so nothing on screen says anything happened to them. Hence the
 * false-positive case below — a row that is ticked but filtered OUT must not
 * be acted on either.
 *
 * Offline, no Supabase, no framework: showfilter.js is pure by design.
 */
import { readFileSync } from "node:fs";
import {
  normalise,
  haystack,
  matchesQuery,
  listingState,
  hasSticker,
  matchesFilters,
  compareSku,
  sortCheckouts,
  showView,
  isFiltering,
  facetsOf,
  selectionFor,
  SHOW_SORTS,
  DEFAULT_SORT,
  STICKER_FILTERS,
  LISTING_FILTERS
} from "../apps/app/lib/showfilter.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// A checkout row, cut down to what this file reads.
const row = (id, over = {}) => ({
  id,
  sku: over.sku ?? id.toUpperCase(),
  title: over.title ?? null,
  event: over.event ?? null,
  stack_name: over.stack_name ?? null,
  sticker_pence: over.sticker_pence ?? null,
  checked_out_at: over.checked_out_at ?? null,
  hide_method: over.hide_method ?? null,
  hide_error: over.hide_error ?? null,
  ebay_item_id: over.ebay_item_id ?? null
});

// --- 1. what a search looks at --------------------------------------------

const umbreon = row("a", {
  sku: "AB11",
  title: "Pokémon TCG Umbreon VMAX 215/203 Evolving Skies Alt Art",
  event: "London Expo Aug",
  stack_name: "Stack C",
  sticker_pence: 84000
});

// [query, matches?, why this case is here]
const QUERIES = [
  ["", true, "an empty box is not a filter"],
  ["   ", true, "nor is whitespace"],
  ["umbreon", true, "the obvious one"],
  ["UMBREON", true, "case is not a distinction anyone types"],
  ["umb", true, "part of a word finds it — you stop typing when you see the row"],
  ["pokemon", true, "an unaccented query finds the accented title"],
  ["Pokémon", true, "and an accented one still does"],
  ["umbreon 215", true, "two tokens, both present"],
  ["215 umbreon", true, "order-free — you type what you can see on the card"],
  ["215/203", true, "the collector number as it is written on the card"],
  ["ab11", true, "the SKU"],
  ["london", true, "the event"],
  ["stack c", true, "the stack it left"],
  ["charizard", false, "a different card"],
  ["umbreon charizard", false, "AND, not OR — one miss is a miss"],
  ["216", false, "a near-miss on the number is still a miss"]
];
for (const [q, want, why] of QUERIES) {
  eq(`query ${JSON.stringify(q)} (${why})`, matchesQuery(umbreon, q), want);
}

// Punctuation collapses on BOTH sides, which is what makes the number case
// work without a rule of its own.
eq("normalise flattens punctuation", normalise("215/203"), "215 203");
eq("normalise strips accents", normalise("Pokémon"), "pokemon");
eq("normalise of nothing", normalise(null), "");
eq("a row with no fields at all has an empty haystack", haystack({}), "");
// A row that has never been matched to a card is still findable by its SKU.
eq("a titleless row still matches its SKU", matchesQuery(row("b", { sku: "C4" }), "c4"), true);

// --- 2. the listing state, one definition ----------------------------------
// The chip on the row and the filter that finds those rows read the same
// function; two definitions would disagree about which cards can double-sell.
const LISTING = [
  [{ hide_method: "quantity", ebay_item_id: "1" }, "hidden", "quantity 0 — restores at check-in"],
  [{ hide_method: "ended", ebay_item_id: "1" }, "hidden", "ended, relists on return"],
  [{ ebay_item_id: "1" }, "live", "still on sale while it sits in a box at a show"],
  [{ hide_error: "eBay said no", hide_method: "quantity", ebay_item_id: "1" }, "failed",
    "an error outranks the method it was attempting — the bad news is the honest answer"],
  [{}, "none", "no listing matched the SKU"],
  [null, "none", "nothing in, nothing claimed"]
];
for (const [co, want, why] of LISTING) {
  eq(`listingState (${why})`, listingState(co), want);
}

// "Still sellable online" is the filter worth having, and it is the union of
// the two states that can take your money twice.
const live = row("l", { ebay_item_id: "1" });
const failed = row("f", { hide_error: "boom", ebay_item_id: "2" });
const hidden = row("h", { hide_method: "quantity", ebay_item_id: "3" });
const none = row("n");
for (const [co, want] of [[live, true], [failed, true], [hidden, false], [none, false]]) {
  eq(`sellable filter on ${co.id}`, matchesFilters(co, { listing: "sellable" }), want);
}
eq("hidden filter", [live, failed, hidden, none].filter((c) => matchesFilters(c, { listing: "hidden" })).map((c) => c.id), ["h"]);
eq("no-listing filter", [live, failed, hidden, none].filter((c) => matchesFilters(c, { listing: "none" })).map((c) => c.id), ["n"]);
eq("any listing keeps everything", [live, failed, hidden, none].filter((c) => matchesFilters(c, {})).length, 4);

// --- 3. sticker, event and stack filters -----------------------------------
const stickered = row("s", { sticker_pence: 1200, event: "Cardiff", stack_name: "A" });
const bare = row("t", { event: "Bristol", stack_name: "A" });
// A zero sticker is a sticker — £0 is a decision, not an absence. (It cannot
// be reached through the desk, which refuses anything below £1, but the test
// pins that `hasSticker` asks about presence rather than truthiness.)
const zero = row("z", { sticker_pence: 0 });
eq("a price is a sticker", hasSticker(stickered), true);
eq("no price is no sticker", hasSticker(bare), false);
eq("zero is a sticker, not an absence", hasSticker(zero), true);
eq("stickered only", [stickered, bare, zero].filter((c) => matchesFilters(c, { sticker: "yes" })).map((c) => c.id), ["s", "z"]);
eq("unstickered only", [stickered, bare, zero].filter((c) => matchesFilters(c, { sticker: "no" })).map((c) => c.id), ["t"]);
eq("one event", [stickered, bare].filter((c) => matchesFilters(c, { event: "Cardiff" })).map((c) => c.id), ["s"]);
eq("one stack", [stickered, bare].filter((c) => matchesFilters(c, { stack: "A" })).length, 2);
eq("a stack nothing left", [stickered, bare].filter((c) => matchesFilters(c, { stack: "Z" })).length, 0);

// --- 4. sorting -------------------------------------------------------------

// SKUs read off a box: AB2 comes before AB11. Sorting them as text does not.
const SKUS = [
  ["AB2", "AB11", -1, "2 before 11 — the whole reason this comparator exists"],
  ["AB11", "AB2", 1, "and the other way round"],
  ["A5", "B1", -1, "the letter leads"],
  ["ab2", "AB2", 0, "case is not a difference in a SKU"],
  ["A2", "A2b", -1, "a suffix sorts after the bare SKU"],
  ["A2", "", -1, "a missing SKU sorts last"],
  ["", "A2", 1, "either way round"]
];
for (const [a, b, want, why] of SKUS) {
  eq(`compareSku ${a || "∅"} vs ${b || "∅"} (${why})`, Math.sign(compareSku(a, b)), want);
}

const packed = [
  row("1", { sku: "AB11", title: "Umbreon VMAX", sticker_pence: 84000, checked_out_at: "2026-08-20T09:00:00Z", stack_name: "C" }),
  row("2", { sku: "AB2", title: "Charizard V", sticker_pence: null, checked_out_at: "2026-08-21T09:00:00Z", stack_name: "A" }),
  row("3", { sku: "B7", title: "Alakazam", sticker_pence: 1200, checked_out_at: "2026-08-19T09:00:00Z", stack_name: "A" })
];
const ids = (rows) => rows.map((r) => r.id);

eq("packed order is the default", ids(sortCheckouts(packed, DEFAULT_SORT)), ["3", "1", "2"]);
eq("newest packed first", ids(sortCheckouts(packed, "out-desc")), ["2", "1", "3"]);
eq("by SKU", ids(sortCheckouts(packed, "sku")), ["2", "1", "3"]);
eq("by card name", ids(sortCheckouts(packed, "name")), ["3", "2", "1"]);
eq("by stack, then SKU within it", ids(sortCheckouts(packed, "stack")), ["2", "3", "1"]);
// A card with no sticker has no place in a price column, so it goes to the end
// of BOTH — treating it as £0 would head the cheapest-first list with the cards
// that have no price at all, which is the opposite of what that view is for.
eq("dearest sticker first, unpriced last", ids(sortCheckouts(packed, "sticker-desc")), ["1", "3", "2"]);
eq("cheapest sticker first, unpriced still last", ids(sortCheckouts(packed, "sticker-asc")), ["3", "1", "2"]);
// An unknown key is a stale preference, not a reason to render nothing.
eq("an unknown sort falls back to the default", ids(sortCheckouts(packed, "nonsense")), ["3", "1", "2"]);
eq("sorting never mutates the caller's list", ids(packed), ["1", "2", "3"]);
eq("every offered sort actually sorts", SHOW_SORTS.every((s) => sortCheckouts(packed, s.key).length === 3), true);

// --- 5. the view, and what it says it hid ----------------------------------
const view = showView(packed, { query: "a", sort: "sku" });
eq("the view counts what it kept", [view.shown, view.total, view.hidden], [3, 3, 0]);
const narrowed = showView(packed, { query: "umbreon" });
eq("and what it dropped", [narrowed.shown, narrowed.total, narrowed.hidden], [1, 3, 2]);
eq("a filtered view says so", narrowed.filtering, true);
eq("an unfiltered one does not", showView(packed, {}).filtering, false);
eq("a dropdown left alone is not a filter", isFiltering({ sticker: "any", listing: "any" }), false);
eq("a dropdown set is", isFiltering({ sticker: "no" }), true);
eq("the sort is not a filter", isFiltering({ sort: "sku" }), false);

eq("events, commonest first", facetsOf([stickered, bare, row("u", { event: "Cardiff" })], "event"),
  [{ value: "Cardiff", count: 2 }, { value: "Bristol", count: 1 }]);
eq("a blank field is not a facet", facetsOf([row("v", { event: "  " })], "event"), []);

// --- 6. what a bulk action acts on -----------------------------------------
// This is the one that costs cards. Every bulk button reads selectionFor().
const visible = [packed[0], packed[1]];
eq("nothing ticked means everything you can SEE", ids(selectionFor(visible, new Set())), ["1", "2"]);
eq("and never a row the filter dropped", selectionFor(visible, new Set()).some((r) => r.id === "3"), false);
eq("ticked rows are the selection", ids(selectionFor(visible, new Set(["2"]))), ["2"]);
// The false positive that matters: a row ticked before the search was typed is
// still in the Set. It must not be filed by a button that isn't showing it.
eq("a ticked row that is now hidden is NOT acted on", ids(selectionFor(visible, new Set(["2", "3"]))), ["2"]);
eq("an empty list acts on nothing", ids(selectionFor([], new Set(["1"]))), []);
eq("an array of ids works like a Set", ids(selectionFor(visible, ["1"])), ["1"]);

// --- 7. the screen reads this file, and only this file ---------------------
// Two definitions of "which rows am I looking at" would disagree the moment
// one of them is edited, and the disagreement is invisible: the list looks
// fine, and the button quietly acts on a different set.
const desk = readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8");
if (!/from "@\/lib\/showfilter\.js"/.test(desk)) {
  fail("ShowDesk.js no longer imports showfilter.js — the search and the bulk actions have parted company");
}
for (const [what, re] of [
  ["the view", /showView\(/],
  ["the selection", /selectionFor\(/]
]) {
  if (!re.test(desk)) fail(`ShowDesk.js does not build ${what} through showfilter.js`);
}
// The old convention, spelled out inline, is exactly what this file replaced.
if (/sel\.size\s*>\s*0\s*\?\s*open\.filter/.test(desk)) {
  fail("ShowDesk.js selects from the whole checkout list again — a bulk action can move rows nobody can see");
}
// Every option in a dropdown can be reached. An option that matches nothing
// whatever the data is a bug you have to try before you can see it, which is
// the same reason the event and stack lists are built from the rows.
const EVERY_STATE = [live, failed, hidden, none, stickered, bare];
for (const f of STICKER_FILTERS) {
  if (!EVERY_STATE.some((c) => matchesFilters(c, { sticker: f.key }))) {
    fail(`the "${f.label}" sticker option can never match a card`);
  }
}
for (const f of LISTING_FILTERS) {
  if (!EVERY_STATE.some((c) => matchesFilters(c, { listing: f.key }))) {
    fail(`the "${f.label}" listing option can never match a card`);
  }
}

if (failures) {
  console.error(`\ncheck-showfilter: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-showfilter: OK — the search finds the card, the order reads right, and a bulk action only ever touches what's on screen.");
