/**
 * Where a card actually is in its stack.
 *
 *   node scripts/check-stackpos.mjs      (or: npm run check)
 *
 * The rule is one line of arithmetic and it had been written out three times —
 * the finder and the stack list in Stacks.js, and the pick order in
 * PullSheet.js — before the Show Desk needed a fourth. That is worth a check on
 * its own, because the failure is invisible: two screens each show a confident
 * number, they disagree by one, and you walk to the shelf and pick up the
 * wrong card. Nothing on screen ever looks wrong.
 *
 * The fixture below is the real scenario that prompted this: five cards taken
 * to a show, labelled, sold or returned. A SKU looks like a position — stacks
 * were seeded from eBay SKUs where `A50` meant "Stack A, position 50" — and
 * for a fresh stack the two agree exactly, which is what makes it so easy to
 * believe the SKU IS the position. They part company permanently the first
 * time anything is pulled.
 */
import { readFileSync } from "node:fs";
import { liveRanks, stackDepths, positionLabel } from "../apps/app/lib/stackpos.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

/** A stack seeded from SKUs, the way the auto-create flow builds one. */
const card = (n, over = {}) => ({
  id: `card-${n}`, stack_id: "A", sku: `A${n}`, position: n,
  pulled_at: null, checked_out_at: null, ...over
});

// --- 1. a fresh stack: SKU and position agree, which is the trap ------------
const FRESH = [1, 2, 3, 4, 5].map((n) => card(n));
eq("a fresh stack numbers 1..5",
  [...liveRanks(FRESH).values()].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
eq("and every card's rank matches the number in its SKU — for now",
  FRESH.every((c) => liveRanks(FRESH).get(c.id) === Number(c.sku.slice(1))), true);

// --- 2. pull one, and they part company for good ---------------------------
const PULLED = [card(1), card(2, { pulled_at: "2026-08-20T10:00:00Z" }), card(3), card(4), card(5)];
const pr = liveRanks(PULLED);
eq("a pulled card has no position at all", pr.get("card-2"), undefined);
eq("everything behind it moves up one", [pr.get("card-3"), pr.get("card-4"), pr.get("card-5")], [2, 3, 4]);
eq("...while its SKU still says A3", PULLED[2].sku, "A3");
eq("the stack is one shallower", stackDepths(PULLED).get("A"), 4);

// --- 3. checked out to a show: away is away --------------------------------
// The card comes back, possibly to this exact spot. But while it is at a show
// the stack really has closed up, so counting has to skip it — otherwise every
// card behind one is off by one for the whole weekend.
const AWAY = [card(1), card(2), card(3, { checked_out_at: "2026-08-27T09:00:00Z" }), card(4), card(5)];
const ar = liveRanks(AWAY);
eq("a card at a show has no position here", ar.get("card-3"), undefined);
eq("the cards behind it close up", [ar.get("card-4"), ar.get("card-5")], [3, 4]);
eq("the ones in front are unmoved", [ar.get("card-1"), ar.get("card-2")], [1, 2]);

// The scenario from the test that prompted this: five out, five back.
const RETURNED = AWAY.map((c) => ({ ...c, checked_out_at: null }));
eq("checked back in to its spot, it is number 3 again", liveRanks(RETURNED).get("card-3"), 3);

// --- 4. ranks are per stack, not across the shelf --------------------------
const TWO = [
  card(1), card(2),
  { ...card(1), id: "b-1", stack_id: "B", sku: "B1" },
  { ...card(2), id: "b-2", stack_id: "B", sku: "B2" }
];
const tr = liveRanks(TWO);
eq("each stack counts from one", [tr.get("card-1"), tr.get("b-1")], [1, 1]);
eq("and depths are per stack too",
  [stackDepths(TWO).get("A"), stackDepths(TWO).get("B")], [2, 2]);

// --- 5. the awkward rows ----------------------------------------------------
// Two cards can share a position (a hand-filed row, an import). Without a
// stable tie-break their order — and so their numbers — would change between
// renders on identical data, which is the same bug as disagreeing screens.
const TIED = [card(1), { ...card(2), id: "zzz" }, { ...card(2), id: "aaa" }];
eq("a tie is broken stably, not by chance",
  [liveRanks(TIED).get("aaa"), liveRanks(TIED).get("zzz")], [2, 3]);
eq("the same input gives the same answer twice",
  [...liveRanks(TIED).entries()], [...liveRanks([...TIED].reverse()).entries()].sort(
    (a, b) => a[1] - b[1]));

eq("a card with no stack is not numbered", liveRanks([card(1, { stack_id: null })]).size, 0);
eq("a null position sorts first rather than throwing",
  liveRanks([card(5), card(1, { position: null })]).get("card-1"), 1);
eq("no cards is an empty map, not a crash", liveRanks([]).size, 0);
eq("null is an empty map too", liveRanks(null).size, 0);
eq("depths of nothing", stackDepths(null).size, 0);

// --- 6. what it reads like on screen ---------------------------------------
eq("stack, position and depth", positionLabel("A", 12, 40), "A · 12 of 40");
eq("depth is optional", positionLabel("A", 12), "A · 12");
eq("a card with no position still says which stack", positionLabel("A", null, 40), "A");
eq("a nameless stack does not render 'undefined'", positionLabel(null, 3, 9), "— · 3 of 9");

// --- 7. one definition -----------------------------------------------------
// Three copies existed before this file. The greps below are what stop a
// fourth appearing the next time a screen needs to say where a card is.
const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

for (const screen of ["apps/app/app/panel/ShowDesk.js", "apps/app/app/panel/Stacks.js"]) {
  if (!read(screen).includes("liveRanks(")) {
    fail(`${screen} does not go through liveRanks() — it has its own idea of where a card is`);
  }
}
// The old hand-rolled form, which is what the copies looked like.
for (const screen of ["apps/app/app/panel/ShowDesk.js", "apps/app/app/panel/Stacks.js"]) {
  if (/positions\s*\.filter\(\s*\(?p\)?\s*=>\s*p\s*<=/.test(read(screen))) {
    fail(`${screen} still counts positions by hand — that is the copy this file replaced`);
  }
}
if (/^\s*import\s+.*from\s+["']@\//m.test(read("apps/app/lib/stackpos.js"))) {
  fail("stackpos.js has picked up an app-aliased import — it has to stay loadable under bare node");
}

if (failures) {
  console.error(`\ncheck-stackpos: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-stackpos: OK — a position is a live count, a SKU is a name, and one rule says which.");
