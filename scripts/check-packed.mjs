/**
 * Which orders stay on the pull sheet once eBay calls them dispatched.
 *
 *   node scripts/check-packed.mjs      (or: npm run check)
 *
 * Printing a postage label through eBay uploads the tracking and eBay marks
 * the order FULFILLED on the spot — before anybody has pulled or packed the
 * card. The sheet read "to do" off that status, so printing labels first made
 * the orders vanish. Done is now ours: a pile completed on Pack. These cases
 * pin which lines survive, in particular the two guesses that cost: a failed
 * read must not put a week of SENT orders back, and a pile completed in this
 * deal must not leave the Pack screen under somebody's hand.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { sheetLines, isMissingTable } from "../apps/app/lib/packed-store.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const keys = (ls) => ls.map((l) => l.lineItemId);

const lines = [
  { lineItemId: "a", orderId: "o1", labelPrinted: false },  // no label yet
  { lineItemId: "b", orderId: "o2", labelPrinted: true },   // label printed, not packed
  { lineItemId: "c", orderId: "o3", labelPrinted: true },   // label printed, packed earlier
  { lineItemId: "d", orderId: "o4", labelPrinted: true },   // packed in THIS deal
  { lineItemId: "e", orderId: "o5", labelPrinted: false }   // packed before its label — old workflow
];
const packed = new Set(["o3", "o4", "o5"]);

eq("a label-printed order stays until it is packed", keys(sheetLines(lines, packed)), ["a", "b", "e"]);
eq("an order eBay hasn't dispatched is on the sheet whatever we recorded", keys(sheetLines(lines, packed)).includes("e"), true);
eq("a pile completed this deal stays on Pack, so nothing renumbers",
  keys(sheetLines(lines, packed, new Set(["d"]))), ["a", "b", "d", "e"]);
eq("unknown packed state: label-printed orders stay OFF, as the sheet always did",
  keys(sheetLines(lines, null)), ["a", "e"]);
eq("order ids compare as strings", keys(sheetLines([{ lineItemId: "x", orderId: 12, labelPrinted: true }], new Set(["12"]))), []);
eq("nothing in, nothing out", sheetLines(undefined, new Set()), []);

eq("a pending migration is recognised", isMissingTable({ code: "42P01" }), true);
eq("so is PostgREST's wording", isMissingTable({ message: "Could not find the table 'public.packed_orders' in the schema cache" }), true);
eq("an ordinary failure is not a missing migration", isMissingTable({ message: "network error" }), false);

// --- greps -----------------------------------------------------------------
const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const ebay = read("apps/app/lib/ebay.js");
if (!/orderfulfillmentstatus:\{FULFILLED\}/.test(ebay)) fail("fetchPendingOrders no longer asks for label-printed (FULFILLED) orders — printing labels first empties the sheet again");
if (!/labelPrinted/.test(ebay)) fail("order lines no longer say whether a label was printed");
const route = read("apps/app/app/api/ebay/orders/pending/route.js");
if (!/labelledWithinDays/.test(route)) fail("the pending-orders route stopped asking for label-printed orders");
const sheet = read("apps/app/app/panel/PullSheet.js");
if (!/sheetLines\(/.test(sheet)) fail("PullSheet.js filters label-printed orders itself — use sheetLines()");
if (!/markOrdersPacked\(/.test(sheet)) fail("completing a pile no longer records the order as packed — it would stay on the sheet forever");

// packed_orders is named in packed-store.js only (and its migration).
const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((f) => {
  const p = `${dir}/${f}`;
  if (f === "node_modules" || f.startsWith(".")) return [];
  return statSync(new URL(p, root)).isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(f) ? [p] : [];
});
for (const f of walk("apps/app")) {
  if (f.endsWith("lib/packed-store.js")) continue;
  if (/["'`]packed_orders["'`]/.test(read(f))) fail(`${f} names packed_orders — go through lib/packed-store.js`);
}

if (failures) {
  console.error(`check-packed: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-packed: ok");
