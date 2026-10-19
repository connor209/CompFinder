/**
 * Show Binders: cards that live in a binder, checked out and back in as one.
 *
 *   node scripts/check-showbinder.mjs      (or: npm run check)
 *
 * A binder sits at home with its cards on sale on eBay. Before a show the
 * whole binder is checked out, so nothing in it can sell online while it is on
 * a table; after it, the binder is checked in — what is still in a pocket goes
 * back on sale, what isn't was sold.
 *
 * What this pins, and what each costs if it slips:
 *
 * - Which stacks ARE binders. "Show Binder 2" is; a stack somebody called
 *   "Binder" or "Show Binders" is not, and reading it as one would stop
 *   numbering a real stack.
 * - A binder has POCKETS, not a live count (decided 2026-10-19): position is
 *   a fixed address shown as p4-7, nine to a page, and a sold or removed card
 *   leaves its GAP — the next card filed in takes the first empty pocket, and
 *   a pocket held by a card away at a show is not empty. No filing plan picks
 *   a binder, exactly like the toploader box.
 * - Check-in leaves NOTHING open. Every card is either back on sale or sold;
 *   a card that is neither is a listing hidden for ever.
 * - Only the binder's own SHOW checkouts are checked in — never a card that
 *   left a stack, never the stream box.
 */
import { readFileSync } from "node:fs";
import {
  SHOW_BINDER_PREFIX, isShowBinder, showBindersOf, nextBinderName,
  binderSuffix, renamedBinder, binderCounts, binderContents,
  POCKETS_PER_PAGE, pocketOf, freePockets, comparePockets, openFromBinder, binderCheckIn
} from "../apps/app/lib/showbinder.js";
import { isUnorderedStack, fileableStacks, isToploaderStack } from "../apps/app/lib/toploader.js";
import { positionLabel, locationsBySku } from "../apps/app/lib/stackpos.js";
import { planReallocation } from "../apps/app/lib/checkout.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- 1. which stacks are binders --------------------------------------------
eq("the prefix alone", isShowBinder(SHOW_BINDER_PREFIX), true);
eq("numbered", isShowBinder("Show Binder 2"), true);
eq("named", isShowBinder("Show Binder — Pokémon"), true);
eq("a stack row", isShowBinder({ id: "b", name: "Show Binder 1" }), true);
eq("made by hand, odd spacing and case", isShowBinder("  show   binder 3 "), true);
eq("bare 'Binder' is a stack somebody named", isShowBinder("Binder"), false);
eq("'Show Binders' is not the prefix", isShowBinder("Show Binders"), false);
eq("a letter stack", isShowBinder("A"), false);
eq("the toploader box is not a binder", isShowBinder("Toploaders"), false);
eq("nothing", isShowBinder(null), false);

const stacks = [
  { id: "a", name: "A" },
  { id: "b10", name: "Show Binder 10" },
  { id: "t", name: "Toploaders" },
  { id: "b2", name: "Show Binder 2" }
];
eq("binders found, in number order", showBindersOf(stacks).map((s) => s.id), ["b2", "b10"]);
eq("first binder", nextBinderName(["A", "Toploaders"]), "Show Binder 1");
eq("one past the highest", nextBinderName(stacks.map((s) => s.name)), "Show Binder 11");
eq("an unnumbered binder counts as 1", nextBinderName(["Show Binder"]), "Show Binder 2");

// --- 1b. renaming: the prefix stays, so a binder stays a binder --------------
eq("the editable part", binderSuffix("Show Binder 2"), "2");
eq("a separator is not part of it", binderSuffix("Show Binder — Pokémon"), "Pokémon");
eq("a rename keeps the prefix", renamedBinder("Pokémon", ["A"], "Show Binder 1"), "Show Binder Pokémon");
eq("typing the prefix too is not doubled", renamedBinder("show binder Yu-Gi-Oh", [], "Show Binder 1"), "Show Binder Yu-Gi-Oh");
eq("a renamed binder is still a binder", isShowBinder(renamedBinder("Graded", [], "Show Binder 1")), true);
eq("blank is refused", renamedBinder("   ", [], "Show Binder 1"), null);
eq("the prefix alone is refused", renamedBinder("Show Binder", [], "Show Binder 1"), null);
eq("another stack's name is refused, case-blind", renamedBinder("pokemon", ["Show Binder Pokemon"], "Show Binder 1"), null);
eq("its own name, re-cased, is fine", renamedBinder("one", [], "Show Binder One"), "Show Binder one");
eq("too long is refused", renamedBinder("x".repeat(41), [], "Show Binder 1"), null);

// --- 2. pockets, never filed into by a plan ----------------------------------
eq("nine to a page", POCKETS_PER_PAGE, 9);
eq("the first pocket", pocketOf(1)?.label, "p1-1");
eq("the last of page one", pocketOf(9)?.label, "p1-9");
eq("the first of page two", pocketOf(10)?.label, "p2-1");
eq("page 4, pocket 7", pocketOf(34), { page: 4, pocket: 7, label: "p4-7" });
eq("no position is no pocket", pocketOf(null), null);
eq("zero is no pocket", pocketOf(0), null);
{
  const inB = [
    { id: "1", stack_id: "b", position: 1 },
    { id: "2", stack_id: "b", position: 2, pulled_at: "2026-10-18" },      // sold: its pocket is free
    { id: "3", stack_id: "b", position: 3, checked_out_at: "2026-10-18" }, // at a show: pocket held
    { id: "4", stack_id: "b", position: 5 },
    { id: "5", stack_id: "a", position: 4 }                                // another stack
  ];
  eq("gaps first, a sold card's pocket reused, an away card's kept", freePockets(inB, "b", 3), [2, 4, 6]);
  eq("an empty binder starts at pocket 1", freePockets([], "b", 2), [1, 2]);
  eq("asking for none gets none", freePockets(inB, "b", 0), []);
  const order = [
    { title: "Zed", position: 12 }, { title: "Abra", position: null }, { title: "Mew", position: 3 }, { title: "Bulba" }
  ].sort(comparePockets).map((c) => c.title);
  eq("page order, unpocketed cards last by name", order, ["Mew", "Zed", "Abra", "Bulba"]);
}

eq("a binder is unordered", isUnorderedStack("Show Binder 1"), true);
eq("so is the box", isUnorderedStack("Toploaders"), true);
eq("a stack is not", isUnorderedStack("A"), false);
eq("a binder is not the toploader box", isToploaderStack("Show Binder 1"), false);
eq("no plan files into a binder or the box", fileableStacks(stacks).map((s) => s.id), ["a"]);
eq("a binder label gives the pocket, never a live count", positionLabel("Show Binder 1", 4, 9, 34), "📒 Show Binder 1 · p4-7");
eq("a binder card with no pocket says only the binder", positionLabel("Show Binder 1", 4, 9), "📒 Show Binder 1");
eq("the box keeps its own icon", positionLabel("Toploaders", 4, 9), "🗂 Toploaders");
eq("a stack still counts", positionLabel("A", 4, 9), "A · 4 of 9");
const located = locationsBySku(
  [{ id: "1", sku: "B1", stack_id: "b2", position: 1 }, { id: "2", sku: "A1", stack_id: "a", position: 1 }],
  new Map([["b2", "Show Binder 2"], ["a", "A"]])
);
eq("⌖ locate names the binder and the pocket", located.get("b1"), "📒 Show Binder 2 · p1-1");
const plan = planReallocation(3, fileableStacks(stacks).map((s) => ({ ...s, used: 0 })), 100);
eq("a filing plan only ever picks a real stack", plan.groups.map((g) => g.stackId), ["a"]);

// --- 3. how full each binder is ---------------------------------------------
const cards = [
  { id: "1", stack_id: "b2" },
  { id: "2", stack_id: "b2", checked_out_at: "2026-10-18" },
  { id: "3", stack_id: "b2", pulled_at: "2026-10-18" },
  { id: "4", stack_id: "b2", lostFlag: true }, // away per the desk's index
  { id: "5", stack_id: "a" }
];
const counts = binderCounts(showBindersOf(stacks), cards, (c) => !!c.checked_out_at || !!c.lostFlag);
eq("home and away, pulled counted as neither", counts.get("b2"), { home: 1, away: 2 });
eq("an empty binder", counts.get("b10"), { home: 0, away: 0 });
eq("a stack is not counted", counts.has("a"), false);

// --- 3b. what is in a binder ------------------------------------------------
{
  const inside = [
    { id: "1", stack_id: "b2", sku: "B1", title: "Umbreon VMAX 215/203" },
    { id: "2", stack_id: "b2", sku: "B2", title: "Charizard ex 199/165", checked_out_at: "2026-10-18" },
    { id: "3", stack_id: "b2", sku: "B3", title: "Gengar 94/102" },
    { id: "4", stack_id: "b2", sku: "B4", title: "Pikachu", pulled_at: "2026-10-18" },
    { id: "5", stack_id: "a", sku: "A1", title: "Mew" },
    { id: "6", stack_id: "b2", sku: "B6", title: "Alakazam 1/102" }
  ];
  const reasons = { b2: "outofstock", b3: "sold", b6: "notlisted" };
  const prices = { b1: 82500, b2: 30000, b3: 4000, b6: 1500 };
  const got = binderContents(inside, "b2", {
    offSale: (sku) => reasons[String(sku).toLowerCase()] || null,
    priceOf: (sku) => prices[String(sku).toLowerCase()] ?? null
  });
  eq("every card in the binder, by name, pulled and other stacks out",
    got.rows.map((r) => r.card.id), ["6", "2", "3", "1"]);
  eq("an away card is at a show, not sold out — its listing is hidden on purpose",
    got.rows.find((r) => r.card.id === "2").status, "away");
  eq("statuses", Object.fromEntries(got.rows.map((r) => [r.card.sku, r.status])),
    { B6: "notlisted", B2: "away", B3: "sold", B1: "home" });
  eq("counts", got.counts, { home: 1, away: 1, sold: 1, outofstock: 0, notlisted: 1 });
  eq("value is what is still ours to sell, never a sold card", got.valuePence, 82500 + 30000);
  eq("an empty binder", binderContents(inside, "b10").rows.length, 0);
}

// --- 4. checking in ----------------------------------------------------------
const checkouts = [
  { id: "c1", stack_id: "b2", resolved_at: null },
  { id: "c2", stack_id: "b2", resolved_at: null, pool: "show" },
  { id: "c3", stack_id: "b2", resolved_at: "2026-10-18", resolution: "sold" }, // £ Sold at the table
  { id: "c4", stack_id: "b2", resolved_at: null, pool: "stream" },
  { id: "c5", stack_id: "a", resolved_at: null },
  { id: "c6", stack_id: "b2", resolved_at: null }
];
const out = openFromBinder(checkouts, "b2");
eq("only this binder's open SHOW checkouts", out.map((c) => c.id), ["c1", "c2", "c6"]);
const ci = binderCheckIn(out, new Set(["c2", "c5"]));
eq("missing cards are sold", ci.sold.map((c) => c.id), ["c2"]);
eq("everything else goes back on sale", ci.back.map((c) => c.id), ["c1", "c6"]);
eq("nothing left open", ci.back.length + ci.sold.length, out.length);
eq("a stale id from another stack is ignored", ci.sold.some((c) => c.id === "c5"), false);
eq("all present: all back", binderCheckIn(out, []).back.length, 3);

// --- 5. the desk wiring ------------------------------------------------------
const desk = read("apps/app/app/panel/ShowDesk.js");
if (!/sellLine\(sb, checkoutLine\(co\)/.test(desk)) {
  fail("a missing binder card must be sold through sellLine(), the one definition of a sale");
}
if ((desk.match(/freePockets\(stackCards,/g) || []).length < 2) {
  fail("filing into a binder (📒 Into, and a check-in To a binder) must take the first free pockets via freePockets()");
}
if (!/binderCheckIn\(binderOut, binderMissing\)/.test(desk)) {
  fail("the binder check-in must split through binderCheckIn(), or a card can be left open");
}
if (!/!isCardAway\(c, awayIndex\) && !inBinder\(c\)/.test(desk)) {
  fail("★ Recommend show stock must leave out cards in a Show Binder — the binder goes to a show whole");
}
if (/["']Show Binder["']/.test(desk.replace(/\/\/.*$/gm, ""))) {
  fail("ShowDesk.js spells the binder prefix by hand — use SHOW_BINDER_PREFIX / nextBinderName()");
}

if (failures) {
  console.error(`\n✗ check-showbinder: ${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ check-showbinder: binders named, pocketed with gaps kept, never planned into, and checked in with nothing left open");
