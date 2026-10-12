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
import { buildPiles, pileKeyOf, shipKeyOf } from "../apps/app/lib/piles.js";

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

// --- greps: one definition --------------------------------------------------
const sheet = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
if (!/buildPiles\(/.test(sheet)) fail("PullSheet.js no longer builds piles through lib/piles.js");
if (/orderPile\s*=\s*new Map/.test(sheet)) fail("PullSheet.js is numbering piles per ORDER again — use buildPiles()");
const ebay = readFileSync(new URL("../apps/app/lib/ebay.js", import.meta.url), "utf8");
if (!/shipKey/.test(ebay)) fail("fetchPendingOrders no longer sends shipKey — every buyer's orders would fold regardless of address");

if (failures) {
  console.error(`check-piles: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-piles: ok");
