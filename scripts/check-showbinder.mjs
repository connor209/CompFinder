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
 * - Every binder card has a BINDER SKU, never a live count (decided
 *   2026-10-19): the binder's code, carried in its name and kept by every
 *   rename, and a fixed slot — B1-047. A sold or removed card retires its
 *   number, and new cards go at the BACK, after the highest slot ever used,
 *   so an old label never comes to mean a different card. No filing plan
 *   picks a binder, exactly like the toploader box.
 * - Check-in leaves NOTHING open. Every card is either back on sale or sold;
 *   a card that is neither is a listing hidden for ever.
 * - Only the binder's own SHOW checkouts are checked in — never a card that
 *   left a stack, never the stream box.
 */
import { readFileSync } from "node:fs";
import {
  SHOW_BINDER_PREFIX, isShowBinder, showBindersOf, nextBinderName,
  binderSuffix, renamedBinder, binderCounts, binderContents,
  POCKETS_PER_PAGE, binderNumber, binderCode, codeless, binderSlot, nextSlots, comparePockets,
  nameKey, compareByCardName, sortBinderRows, repocketPlan, openFromBinder, binderCheckIn
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
eq("a binder with no number does not hold one", nextBinderName(["Show Binder"]), "Show Binder 1");

// --- 1b. the binder's code, and renaming around it -------------------------
eq("the number is the code", [binderNumber("Show Binder 3"), binderCode("Show Binder 3")], [3, "B3"]);
eq("with a label after it", binderCode("Show Binder 3 · Pokémon"), "B3");
eq("a B is forgiven", binderCode("show binder B12 Graded"), "B12");
eq("a stack row", binderCode({ name: "Show Binder 2" }), "B2");
eq("a binder named by hand has no code yet", binderCode("Show Binder Pokémon"), null);
eq("a stack is never a binder code", binderCode("A12"), null);
eq("the editable part is the label after the code", binderSuffix("Show Binder 3 · Pokémon"), "Pokémon");
eq("a plain binder has no label", binderSuffix("Show Binder 2"), "");
eq("a codeless binder's label", binderSuffix("Show Binder — Pokémon"), "Pokémon");
eq("a rename keeps the binder's number", renamedBinder("Pokémon", ["A"], "Show Binder 1"), "Show Binder 1 · Pokémon");
eq("renaming again replaces the label, never the number", renamedBinder("Graded", [], "Show Binder 1 · Pokémon"), "Show Binder 1 · Graded");
eq("typing the prefix too is not doubled", renamedBinder("show binder Yu-Gi-Oh", [], "Show Binder 1"), "Show Binder 1 · Yu-Gi-Oh");
eq("blank goes back to the plain name", renamedBinder("   ", [], "Show Binder 4 · Pokémon"), "Show Binder 4");
eq("a codeless binder is given the next number on rename", renamedBinder("Pokémon", ["Show Binder 2", "Show Binder Pokémon"], "Show Binder Pokémon"), "Show Binder 3 · Pokémon");
eq("another stack's name is refused, case-blind", renamedBinder("pokemon", ["Show Binder 1 · Pokemon"], "Show Binder 1"), null);
eq("its own name, re-cased, is fine", renamedBinder("one", [], "Show Binder 2 · One"), "Show Binder 2 · one");
eq("too long is refused", renamedBinder("x".repeat(41), [], "Show Binder 1"), null);
eq("a renamed binder is still a binder", isShowBinder(renamedBinder("Graded", [], "Show Binder 1")), true);
eq("codeless binders get the next free numbers, labels kept",
  codeless([{ id: "p", name: "Show Binder Pokémon" }, { id: "x", name: "Show Binder 2" }, { id: "y", name: "Show Binder — Graded" }, { id: "s", name: "A" }]),
  [{ id: "y", name: "Show Binder 3 · Graded" }, { id: "p", name: "Show Binder 4 · Pokémon" }]);
eq("nothing to give when every binder has a code", codeless([{ id: "x", name: "Show Binder 2 · Pokémon" }]), []);

// --- 2. binder SKUs: fixed slots, new cards at the back ----------------------
eq("nine to a page", POCKETS_PER_PAGE, 9);
eq("a binder SKU is the code and a 3-digit slot", binderSlot("Show Binder 1", 47), { sku: "B1-047", page: 6 });
eq("the first slot", binderSlot("Show Binder 1 · Pokémon", 1)?.sku, "B1-001");
eq("past 999 it simply grows", binderSlot("Show Binder 2", 1204)?.sku, "B2-1204");
eq("a codeless binder still numbers the slot", binderSlot("Show Binder Pokémon", 5)?.sku, "#005");
eq("no slot is no binder SKU", binderSlot("Show Binder 1", null), null);
eq("zero is no binder SKU", binderSlot("Show Binder 1", 0), null);
eq("new cards go at the BACK, after the highest slot ever used", nextSlots(46, 3), [47, 48, 49]);
eq("an empty binder starts at 1", nextSlots(0, 2), [1, 2]);
eq("no cards, no slots", nextSlots(10, 0), []);
{
  const order = [
    { title: "Zed", position: 12 }, { title: "Abra", position: null }, { title: "Mew", position: 3 }, { title: "Bulba" }
  ].sort(comparePockets).map((c) => c.title);
  eq("slot order, unslotted cards last by name", order, ["Mew", "Zed", "Abra", "Bulba"]);
}

eq("a binder is unordered", isUnorderedStack("Show Binder 1"), true);
eq("so is the box", isUnorderedStack("Toploaders"), true);
eq("a stack is not", isUnorderedStack("A"), false);
eq("a binder is not the toploader box", isToploaderStack("Show Binder 1"), false);
eq("no plan files into a binder or the box", fileableStacks(stacks).map((s) => s.id), ["a"]);
eq("a binder card is named by its binder SKU, never a live count", positionLabel("Show Binder 1", 4, 9, 34), "📒 Show Binder 1 · B1-034");
eq("a binder card with no slot says only the binder", positionLabel("Show Binder 1", 4, 9), "📒 Show Binder 1");
eq("the box keeps its own icon", positionLabel("Toploaders", 4, 9), "🗂 Toploaders");
eq("a stack still counts", positionLabel("A", 4, 9), "A · 4 of 9");
const located = locationsBySku(
  [{ id: "1", sku: "B1", stack_id: "b2", position: 1 }, { id: "2", sku: "A1", stack_id: "a", position: 1 }],
  new Map([["b2", "Show Binder 2"], ["a", "A"]])
);
eq("⌖ locate names the binder SKU", located.get("b1"), "📒 Show Binder 2 · B2-001");
const plan = planReallocation(3, fileableStacks(stacks).map((s) => ({ ...s, used: 0 })), 100);
eq("a filing plan only ever picks a real stack", plan.groups.map((g) => g.stackId), ["a"]);

// --- 2b. A–Z by card name, and re-pocketing --------------------------------
eq("the game word is not the name", nameKey("Pokemon TCG Charizard ex 199/165 151 NM"), "charizard ex 199/165");
eq("nor another game's prefix", nameKey("MTG Lightning Bolt Alpha"), "lightning bolt alpha");
eq("accents fold", nameKey("Flabébé 1/2"), "flabebe 1/2");
{
  const deck = [
    { id: "u", title: "Umbreon VMAX 215/203", sku: "B1", position: 1 },
    { id: "c2", title: "Pokemon Charizard ex 199/165", sku: "B9", position: 2 },
    { id: "a", title: "Abra 43/102", sku: "B3", position: 4 },
    { id: "c1", title: "Charizard 4/102 Base Set", sku: "B2", position: 7 },
    { id: "z", title: "", sku: "B5", position: 8 }
  ];
  eq("A–Z by NAME, the Pokémon prefix ignored, no title last",
    [...deck].sort(compareByCardName).map((c) => c.id), ["a", "c1", "c2", "u", "z"]);
  const rows = deck.map((card, i) => ({ card, pricePence: [500, null, 120, 9000, null][i] }));
  eq("list sorted by name", sortBinderRows(rows, "name").map((r) => r.card.id), ["a", "c1", "c2", "u", "z"]);
  eq("price high first, unpriced last", sortBinderRows(rows, "price-desc").map((r) => r.card.id), ["c1", "u", "a", "c2", "z"]);
  eq("price low first, unpriced STILL last", sortBinderRows(rows, "price-asc").map((r) => r.card.id), ["a", "u", "c1", "c2", "z"]);
  eq("pocket order is the default", sortBinderRows(rows).map((r) => r.card.id), ["u", "c2", "a", "c1", "z"]);
  eq("sorting the list never moves a pocket", deck.map((c) => c.position), [1, 2, 4, 7, 8]);

  const bound = deck.map((c) => ({ ...c, stack_id: "b" })).concat([{ id: "x", stack_id: "a", title: "Aaa", position: 1 }]);
  const plan = repocketPlan(bound, "b", undefined, "Show Binder 1");
  eq("re-pocket runs A–Z from B1-001, gaps closed, other stacks untouched",
    plan.order.map((m) => `${m.card.id}:${m.to.sku}`), ["a:B1-001", "c1:B1-002", "c2:B1-003", "u:B1-004", "z:B1-005"]);
  eq("every card here changes pocket", plan.moves.map((m) => m.card.id), ["a", "c1", "c2", "u", "z"]);
  const sorted = plan.order.map((m) => ({ ...m.card, position: m.position }));
  eq("a binder already A–Z with no gaps has nothing to move", repocketPlan(sorted, "b").moves.length, 0);
  const oneOff = sorted.map((c) => (c.id === "z" ? { ...c, position: 9 } : c));
  eq("only the cards whose pocket changes are moves", repocketPlan(oneOff, "b").moves.map((m) => m.card.id), ["z"]);
  eq("a move says which binder SKU it was", plan.moves[0].from.sku, "B1-004");
  const out = repocketPlan(bound.map((c) => (c.id === "u" ? { ...c, checked_out_at: "2026-10-19" } : c)), "b");
  eq("refused while a card is out at a show", [out.ok, out.away.map((c) => c.id)], [false, ["u"]]);
  eq("a sold card is not re-pocketed", repocketPlan(bound.map((c) => (c.id === "a" ? { ...c, pulled_at: "x" } : c)), "b").order.length, 4);
}

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
if (!/repocketPlan\(stackCards, binder\.id, \(c\) => isCardAway\(c, awayIndex\), binder\.name\)/.test(desk)) {
  fail("re-pocketing must go through repocketPlan() with the desk's own away reading, or a card at a show loses its pocket");
}
if ((desk.match(/nextSlots\(await maxPosition\(sb, /g) || []).length < 2) {
  fail("filing into a binder (📒 Into, and a check-in To a binder) must go at the BACK — nextSlots() after maxPosition(), which counts sold cards so no binder SKU is reused");
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
console.log("✓ check-showbinder: binders named and coded, binder SKUs fixed with new cards at the back, never planned into, and checked in with nothing left open");
