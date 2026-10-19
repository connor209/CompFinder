/**
 * Which pile a pull-sheet card goes into.
 *
 *   node scripts/check-piles.mjs      (or: npm run check)
 *
 * A pile is an envelope. eBay makes one order per checkout, so a buyer who
 * checks out three times arrives as three orders — and dealt a pile per order,
 * that is three envelopes and three lots of postage to one door. The pile key
 * is the buyer plus the address, and the cases below pin both halves: the
 * same buyer to the same place folds, the same buyer to two places does NOT
 * (a card in the wrong parcel), and an order with no username is never
 * guessed into anybody else's pile.
 */
import { readFileSync } from "node:fs";
import { buildPiles, currentPileNo, handPositions, pileKeyOf, pileLivePositions, pileOverview, pilePullOrder, shipKeyOf } from "../apps/app/lib/piles.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

const HOME = shipKeyOf({ postalCode: "G1 1AA", addressLine1: "1 High St" });
const WORK = shipKeyOf({ postalCode: "G2 2BB", addressLine1: "9 Office Rd" });
const line = (key, orderId, buyer, shipKey = HOME, over = {}) =>
  ({ key, orderId, buyer, deliveryName: buyer ? `${buyer} name` : "", shipKey, ...over });

// --- the address fingerprint ------------------------------------------------
eq("postcode spacing and case don't split an address",
  shipKeyOf({ postalCode: "g11aa", addressLine1: "1 high st." }), HOME);
eq("no address at all is empty, not a key", shipKeyOf(null), "");
eq("a postcode alone still compares", shipKeyOf({ postalCode: "G1 1AA" }), "G11AA|");

// --- the case that prompted it: one buyer, three checkouts, one door --------
{
  const { items, piles } = buildPiles([
    line("a", "o1", "ashketchum"),
    line("b", "o2", "misty"),
    line("c", "o3", "AshKetchum"),          // username case differs
    line("d", "o4", "ashketchum"),
  ]);
  eq("three orders from one buyer to one address are one pile", piles.length, 2);
  eq("pile numbers follow the deal order", items.map((i) => i.pileNo), [1, 2, 1, 1]);
  eq("the pile carries every order it holds", piles[0].orderIds, ["o1", "o3", "o4"]);
  eq("and the count is cards, not orders", piles[0].count, 3);
  eq("each card knows its pile spans several orders", items[0].pileOrders, 3);
}

// --- the same buyer to two places is two parcels ----------------------------
{
  const { piles } = buildPiles([
    line("a", "o1", "brock", HOME),
    line("b", "o2", "brock", WORK),
  ]);
  eq("one buyer, two addresses, two piles", piles.length, 2);
}

// --- several lines of one order stay together, as they always did ---------
{
  const { piles } = buildPiles([line("a", "o1", "misty"), line("b", "o1", "misty")]);
  eq("two lines of one order are one pile", piles.length, 1);
  eq("listing the order once", piles[0].orderIds, ["o1"]);
}

// --- no username: never guessed into a pile ---------------------------------
{
  const { piles } = buildPiles([
    line("a", "o1", "", HOME),
    line("b", "o2", "", HOME),
    line("c", "o3", null, HOME),
  ]);
  eq("orders with no buyer each keep their own pile", piles.length, 3);
  eq("but lines of the same buyerless order still share one",
    pileKeyOf(line("x", "o1", "")), pileKeyOf(line("y", "o1", "")));
}

// --- one pile at a time: a finished pile leaves the hand ---------------------
{
  // Hand top to bottom: a(Ash) b(Misty) c(Ash) d(Brock ×2) e(Misty)
  const { items } = buildPiles([
    line("a", "o1", "ash"),
    line("b", "o2", "misty"),
    line("c", "o3", "ash"),
    line("d", "o4", "brock", HOME, { qty: 2 }),
    line("e", "o5", "misty"),
  ]);
  const at = (pos, k) => pos.get(k) && [pos.get(k).from, pos.get(k).to];
  let done = new Set();
  let h = handPositions(items, done);
  eq("before anything, the hand counts every card", h.depth, 6);
  eq("a quantity-2 line takes two numbers", at(h.pos, "d"), [4, 5]);
  eq("and the card behind it counts both", at(h.pos, "e"), [6, 6]);
  eq("the deal starts on pile 1", currentPileNo(items, done), 1);
  const p1 = pilePullOrder(items, 1, h.pos);
  eq("a pile lists the top of the hand first", p1.map((i) => i.key), ["a", "c"]);
  eq("before a tick, the live number is the hand number",
    at(pileLivePositions(p1, h.pos, new Set()), "c"), [3, 3]);
  eq("ticking card 1 moves card 3 up to 2 at once",
    at(pileLivePositions(p1, h.pos, new Set(["a"])), "c"), [2, 2]);
  eq("a ticked card has no live number", pileLivePositions(p1, h.pos, new Set(["a"])).has("a"), false);
  {
    // Brock's quantity-2 line (cards 4–5) then a card behind it in the same pile.
    const two = buildPiles([line("x", "o1", "brock", HOME, { qty: 2 }), line("y", "o2", "brock")]).items;
    const hp = handPositions(two, new Set()).pos;
    eq("a ticked quantity-2 line moves the next card up by two",
      at(pileLivePositions(pilePullOrder(two, 1, hp), hp, new Set(["x"])), "y"), [1, 1]);
  }

  // Pile 1 complete: cards 1 and 3 leave, the rest close up.
  done = new Set(["a", "c"]);
  h = handPositions(items, done);
  eq("what was card 2 is card 1 once pile 1 is done", at(h.pos, "b"), [1, 1]);
  eq("and everything behind closes up", at(h.pos, "e"), [4, 4]);
  eq("a finished card has no number", h.pos.has("a"), false);
  eq("pile 2 is next", currentPileNo(items, done), 2);

  // A refresh brings a new line for Ash: pile 1 comes back round, first.
  const more = buildPiles([...items.map(({ pileNo, pileOrders, seqNo, ...it }) => it), line("f", "o6", "ash")]).items;
  eq("a completed pile that gains a card is not skipped", currentPileNo(more, new Set(["a", "c", "b", "e"])), 1);

  eq("every pile done is null, not pile 1", currentPileNo(items, new Set(["a", "b", "c", "d", "e"])), null);
}

// --- every pile at a glance -------------------------------------------------
{
  const { items, piles } = buildPiles([
    line("a1", "o1", "ann"), line("b1", "o2", "bob", HOME, { qty: 2 }), line("a2", "o3", "ann"), line("c1", "o4", ""),
  ]);
  const ov = pileOverview(items, piles, new Set(["a1", "a2"]));
  eq("overview: a completed pile is done, the next is now, the rest to do", ov.map((p) => p.state), ["done", "current", "todo"]);
  eq("overview: names the delivery name over the username", ov.map((p) => p.name), ["ann name", "bob name", "Buyer"]);
  eq("overview: a quantity-2 line is two cards", ov.map((p) => p.cards), [2, 2, 1]);
  eq("overview: a buyer's separate checkouts are one pile with both orders", ov[0].orders, 2);
  eq("overview: nothing done, pile 1 is now", pileOverview(items, piles, new Set()).map((p) => p.state), ["current", "todo", "todo"]);
}

// --- greps: one definition --------------------------------------------------
const sheet = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
if (!/buildPiles\(/.test(sheet)) fail("PullSheet.js no longer builds piles through lib/piles.js");
if (!/handPositions\(/.test(sheet)) fail("PullSheet.js numbers the hand itself — use handPositions(), or a finished pile stays counted");
if (/orderPile\s*=\s*new Map/.test(sheet)) fail("PullSheet.js is numbering piles per ORDER again — use buildPiles()");
const ebay = readFileSync(new URL("../apps/app/lib/ebay.js", import.meta.url), "utf8");
if (!/shipKey/.test(ebay)) fail("fetchPendingOrders no longer sends shipKey — every buyer's orders would fold regardless of address");

if (failures) {
  console.error(`check-piles: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-piles: ok");
