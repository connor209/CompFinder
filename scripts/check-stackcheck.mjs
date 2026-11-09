/**
 * The stack checker: a stack in your hand, checked against the stack on screen.
 *
 *   node scripts/check-stackcheck.mjs      (or: npm run check)
 *
 * What it pins, in the order they would cost cards:
 *
 * - A save writes POSITIONS from the slots the stack already held, so a card
 *   away at a show keeps its place in the count, and a card brought in never
 *   ties with one at a show.
 * - A typed SKU is exact. "AB1" answering for "AB11" moves the wrong card.
 * - A draft read back after the stack changed drops what has gone and adds
 *   what has arrived, rather than writing a stale order over it.
 * - Nothing is written for a row that did not move.
 */
import { readFileSync } from "node:fs";
import {
  startCheck, confirmCurrent, notHere, bringHere, addHere, moveCard, setCursor,
  unmissing, locateSku, restoreCheck, savePlan, checkSummary, liveOrder
} from "../apps/app/lib/stackcheck.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const card = (n, over = {}) => ({
  id: `c${n}`, stack_id: "A", sku: `A${n}`, title: `Card ${n}`, position: n,
  pulled_at: null, checked_out_at: null, ...over
});
const STACK = [1, 2, 3, 4, 5].map((n) => card(n));

// --- 1. the walk -------------------------------------------------------------
let s = startCheck("A", STACK);
eq("starts in the live order, nothing seen", [s.order, s.cursor], [["c1", "c2", "c3", "c4", "c5"], 0]);
s = confirmCurrent(s);
eq("✓ moves on one", s.cursor, 1);
// In the hand: card 4 where card 2 was expected (2 and 3 are behind it).
s = bringHere(s, "c4");
eq("a later card comes up to here, seen", [s.order, s.cursor], [["c1", "c4", "c2", "c3", "c5"], 2]);
s = notHere(s);
eq("not here takes the expected card out of the walk", [s.order, s.missing, s.cursor], [["c1", "c4", "c3", "c5"], ["c2"], 2]);
s = bringHere(s, "c2");
eq("a not-found card turning up later comes back, seen", [s.order, s.missing, s.cursor], [["c1", "c4", "c2", "c3", "c5"], [], 3]);
// Bringing a card from ABOVE the cursor down to here must not skip a card.
s = bringHere(s, "c1");
eq("a seen card brought down keeps the cursor on the next card", [s.order, s.cursor], [["c4", "c2", "c1", "c3", "c5"], 3]);
eq("…which is still card 3", s.order[s.cursor], "c3");

// --- 2. ↑ ↓ -----------------------------------------------------------------
let m = startCheck("A", STACK);
m = moveCard(m, "c3", -1);
eq("↑ swaps with the card above", m.order, ["c1", "c3", "c2", "c4", "c5"]);
eq("the top card cannot go up", moveCard(m, "c1", -1).order, m.order);
eq("the bottom card cannot go down", moveCard(m, "c5", +1).order, m.order);
eq("the cursor does not move with an arrow", moveCard(setCursor(m, 2), "c2", +1).cursor, 2);
eq("the cursor is clamped to the stack", setCursor(m, 99).cursor, 5);

// --- 3. a typed SKU is exact -------------------------------------------------
const OTHER = [
  card(11, { id: "b11", stack_id: "B", sku: "AB11" }),
  card(12, { id: "b12", stack_id: "B", sku: "AB12", checked_out_at: "2026-11-01T10:00:00Z" })
];
const ALL = [...STACK, ...OTHER];
let l = startCheck("A", STACK);
eq("a card still to come in this stack", locateSku(l, "a3", ALL), { kind: "here", id: "c3" });
eq("A1 is never A11 or AB11", locateSku(l, "AB1", ALL), { kind: "unknown" });
eq("a card in another stack", locateSku(l, " ab11 ", ALL).kind, "elsewhere");
eq("a card at a show is refused, not moved", locateSku(l, "AB12", ALL).kind, "away");
eq("blank is nothing", locateSku(l, "  ", ALL).kind, "unknown");
l = notHere(l);
eq("a not-found card is found as missing", locateSku(l, "A1", ALL), { kind: "missing", id: "c1" });
l = confirmCurrent(l);
eq("a card already seen says so", locateSku(l, "A2", ALL), { kind: "here", id: "c2", seen: true });
// Two copies with one SKU: the one still to come answers.
const DUP = [card(1), card(2, { sku: "A1" }), card(3)];
let d = confirmCurrent(startCheck("A", DUP));
eq("of two copies, the unseen one answers", locateSku(d, "A1", DUP), { kind: "here", id: "c2" });

// --- 4. cards from elsewhere, and new ones -----------------------------------
let e = confirmCurrent(startCheck("A", STACK));
e = addHere(e, { ...OTHER[0], stackName: "Stack B" });
eq("a card from another stack goes in here, seen", [e.order.slice(0, 3), e.cursor], [["c1", "b11", "c2"], 2]);
eq("and remembers where it came from", e.extra.b11, { sku: "AB11", title: "Card 11", fromStack: "B", fromName: "Stack B" });
e = addHere(e, { sku: "ZZ9", title: "Mystery" });
eq("a new card gets a new: id", e.order[2], "new:1");
let undoNew = setCursor(e, 2);
undoNew = notHere(undoNew);
eq("a card added this check and then 'not here' is simply undone", [undoNew.order.includes("new:1"), undoNew.missing, "new:1" in undoNew.extra], [false, [], false]);

// --- 5. the save --------------------------------------------------------------
// Positions with a card away at a show (c3 at position 3) and a gap.
const WITH_AWAY = [
  card(1, { position: 10 }), card(2, { position: 20 }),
  card(3, { position: 30, checked_out_at: "2026-11-01T10:00:00Z" }),
  card(4, { position: 40 }), card(5, { position: 50 })
];
let p = startCheck("A", WITH_AWAY);
eq("an away card is not in the walk", p.order, ["c1", "c2", "c4", "c5"]);
eq("nothing moved, nothing written", savePlan(p, WITH_AWAY), { updates: [], inserts: [], pulls: [] });
p = bringHere(p, "c5"); // card 5 is on top in the hand
eq("the new order takes the slots the stack already had", savePlan(p, WITH_AWAY).updates,
  [{ id: "c5", position: 10 }, { id: "c1", position: 20 }, { id: "c2", position: 40 }, { id: "c4", position: 50 }]);
// The away card at 30 still sits after the 2nd card in the count.
// A card brought in takes a slot past every unpulled card, away ones included.
let g = startCheck("A", [card(1, { position: 1 }), card(2, { position: 2 }), card(3, { position: 9, checked_out_at: "x" })]);
g = setCursor(g, 2);
g = addHere(g, { ...OTHER[0] });
g = addHere(g, { sku: "NEW1", title: "Brand new" });
const gp = savePlan(g, [card(1, { position: 1 }), card(2, { position: 2 }), card(3, { position: 9, checked_out_at: "x" }), ...OTHER]);
eq("a card from elsewhere moves stack and never ties with the card at a show", gp.updates, [{ id: "b11", position: 10, stack_id: "A" }]);
eq("a new card is inserted after it", gp.inserts, [{ key: "new:1", sku: "NEW1", title: "Brand new", position: 11 }]);
// Shared positions are split rather than left to the id tie-break.
const TIED = [card(1, { position: 5 }), card(2, { position: 5 }), card(3, { position: 5 })];
eq("tied positions are made distinct", savePlan(startCheck("A", TIED), TIED).updates, [{ id: "c2", position: 6 }, { id: "c3", position: 7 }]);
// Not found: pull the ones you tick, the rest go to the back.
let n = startCheck("A", STACK);
n = notHere(n); n = notHere(n); // c1 and c2 not in the hand
const np = savePlan(n, STACK, ["c1"]);
eq("a ticked not-found card is pulled", np.pulls, ["c1"]);
eq("an unticked one goes to the back", np.updates,
  [{ id: "c3", position: 1 }, { id: "c4", position: 2 }, { id: "c5", position: 3 }, { id: "c2", position: 4 }]);

// --- 6. resuming a draft against a stack that has changed ----------------------
let r = startCheck("A", STACK, 1000);
r = confirmCurrent(confirmCurrent(r)); // c1, c2 seen
r = notHere(r); // c3 not found
const LATER = [
  card(1, { pulled_at: "2026-11-02T00:00:00Z" }), // sold since
  card(2), card(3), card(4, { checked_out_at: "2026-11-02T00:00:00Z" }), card(5),
  card(6) // added since
];
r = { ...r, touchedAt: 1000 };
const back = restoreCheck(r, LATER, 2000);
eq("gone cards drop out, the cursor follows", [back.session.order, back.session.cursor], [["c2", "c5", "c6"], 1]);
eq("a not-found card still present stays not found", back.session.missing, ["c3"]);
eq("what changed is counted", [back.dropped, back.arrived], [2, 1]);
eq("a stale draft is not resumed", restoreCheck(r, LATER, 1000 + 15 * 24 * 3600 * 1000), null);
eq("junk is not resumed", restoreCheck({ v: 0 }, LATER), null);
eq("a new card survives a resume", restoreCheck(addHere(startCheck("A", STACK), { sku: "Q" }), STACK).session.order[0], "new:1");

// --- 7. the summary counts lifts, not displacements --------------------------
const big = Array.from({ length: 30 }, (_, i) => card(i + 1));
let b = setCursor(startCheck("A", big), 4);
b = bringHere(b, "c30");
eq("one card lifted from 30 to 5 is one move", checkSummary(b, big).moved, 1);
eq("unmissing puts a card back where it is expected", unmissing(notHere(startCheck("A", STACK)), "c1").order, ["c1", "c2", "c3", "c4", "c5"]);
eq("liveOrder skips pulled and away", liveOrder(LATER, "A").map((c) => c.id), ["c2", "c3", "c5", "c6"]);

// --- 8. the screen ------------------------------------------------------------
{
  const src = readFileSync(new URL("../apps/app/app/panel/StackCheck.js", import.meta.url), "utf8");
  if (!/from\s+"@\/lib\/stackcheck\.js"/.test(src)) fail("StackCheck.js does not use lib/stackcheck.js — a second copy of the rules would drift");
  if (!/savePlan\(/.test(src)) fail("StackCheck.js saves without savePlan()");
  if (!/restoreCheck\(/.test(src)) fail("StackCheck.js resumes a draft without restoreCheck() — a stale order could be written over the stack");
  if (!/confirm\(/.test(src)) fail("Save order does not confirm — it rewrites a stack's positions in one tap");
  if (/\.update\(\{[^}]*\bsku\b/.test(src)) fail("the checker writes a SKU — a SKU is a name and never moves");
}

if (failures) {
  console.error(`\ncheck-stackcheck: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-stackcheck: OK — the walk, exact SKUs, the slots a save writes, and a resumed draft.");
