/**
 * What a card cost us (lib/card-costs.js, migration 044), and what a sale
 * made. Built 2026-11-24 so profit can be read per card on lab listings,
 * where one listing is several copies bought for different money.
 *
 *   node scripts/check-cardcosts.mjs      (or: npm run check)
 *
 * The rule that matters, as everywhere else profit is worked out: a cost not
 * known is UNKNOWN, never £0 — £0 books the whole price as profit.
 */
import { readFileSync } from "node:fs";
import { parseCostPence, splitLotCost, costIndex, saleCost, costTotals } from "../apps/app/lib/card-costs.js";
import { applyBulk, groupToSend } from "../apps/app/lib/lab-draft.js";
import { costPlan, viewTotals } from "../apps/app/lib/lab-inventory.js";

let failed = 0, passed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; return; }
  failed++;
  console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- typing a cost ----
eq("pounds, pence and £ all read; zero is a cost; junk is not",
  ["1.20", "£0.35", "35p", "2", "0", "", "abc", "1.234"].map(parseCostPence), [120, 35, 35, 200, 0, null, null, null]);

// ---- a lot split by price ----
{
  const m = splitLotCost([{ id: "a", copies: 1, weight: 4000 }, { id: "b", copies: 2, weight: 200 }, { id: "c", copies: 1, weight: 0 }], 1000);
  const total = m.get("a") * 1 + m.get("b") * 2 + m.get("c") * 1;
  eq("the dearer card carries more of the lot, and the shares come to the lot", [m.get("a") > m.get("b"), total], [true, 1000]);
  const even = splitLotCost([{ id: "a", copies: 2, weight: 0 }, { id: "b", copies: 2, weight: 0 }], 400);
  eq("no prices at all: an even split per copy", [even.get("a"), even.get("b")], [100, 100]);
  eq("nothing to split over is nothing", splitLotCost([], 500).size, 0);
}

// ---- a sale's cost ----
{
  const idx = costIndex({
    listingCosts: [{ ebay_item_id: "111", cost_pence: 300 }, { ebay_item_id: "222", cost_pence: null }],
    cards: [{ reserved_line: "L1#1", cost_pence: 80 }, { reserved_line: "L1#2", cost_pence: 120 }, { reserved_line: "L3#1", cost_pence: null }]
  });
  eq("a lab sale costs what its reserved copies cost, unit by unit", saleCost({ line_item_id: "L1", ebay_item_id: "999", quantity: 2 }, idx), { pence: 200, source: "copy" });
  eq("an older listing falls back to its cost per unit", saleCost({ line_item_id: "L2", ebay_item_id: "111", quantity: 2 }, idx), { pence: 600, source: "listing" });
  eq("one unknown unit makes the whole line unknown, never £0", saleCost({ line_item_id: "L1", ebay_item_id: "999", quantity: 3 }, idx), { pence: null, source: null });
  eq("a copy with no cost and no listing cost is unknown", saleCost({ line_item_id: "L3", ebay_item_id: "222", quantity: 1 }, idx), { pence: null, source: null });
  eq("a costed copy plus the listing's cost for the rest is mixed", saleCost({ line_item_id: "L1", ebay_item_id: "111", quantity: 3 }, idx), { pence: 500, source: "mixed" });
}

// ---- totals never count an uncosted card as free ----
eq("margin only over costed copies", costTotals([{ cost_pence: 100 }, { cost_pence: null }], () => 500), { cost: 100, value: 1000, costed: 1, uncosted: 1, margin: 400 });

// ---- Add copies: costs ride on the copies that list ----
{
  const row = (id, price, n) => ({ id, pricePence: price, copies: Array.from({ length: n }, (_, i) => ({ sku: `${id}-${i}` })), skippedSkus: [], comps: null, result: null });
  let rows = [row("a", 1000, 1), row("b", 250, 2), { ...row("c", 999, 1), result: { ok: true } }];
  rows = applyBulk(rows, ["a", "b", "c"], { op: "costEach", pence: 40 });
  eq("each copy: every row not yet listed, a listed row untouched", rows.map((r) => r.costPence ?? null), [40, 40, null]);
  rows = applyBulk(rows, ["a", "b"], { op: "costLot", pence: 900 });
  eq("a lot: split by price over the ticked rows, summing to the lot", [rows[0].costPence > rows[1].costPence, rows[0].costPence + rows[1].costPence * 2], [true, 900]);
  eq("the cost is sent on each copy, and never as a group field", [groupToSend(rows[1]).copies.map((c) => c.costPence), "costPence" in groupToSend(rows[1])], [[rows[1].costPence, rows[1].costPence], false]);
  eq("no cost sends none", groupToSend(applyBulk(rows, ["a"], { op: "costClear" })[0]).copies[0].costPence, undefined);
}

// ---- Inventory: a cost plan for listed cards ----
{
  const inv = [
    { id: "L1", pricePence: 1000, copies: [{ id: "c1", sku: "A1", cost_pence: null }, { id: "c2", sku: "A2", cost_pence: 50 }] },
    { id: "L2", pricePence: 250, copies: [{ id: "c3", sku: "B1", cost_pence: null }] }
  ];
  eq("each: only copies with no cost yet, unless replacing", costPlan(inv, { mode: "each", pence: 30 }).map((p) => [p.sku, p.pence]), [["A1", 30], ["B1", 30]]);
  eq("replacing touches every copy", costPlan(inv, { mode: "each", pence: 30, overwrite: true }).length, 3);
  const lot = costPlan(inv, { mode: "lot", pence: 500 });
  eq("a lot over listed cards sums to the lot", lot.reduce((t, p) => t + p.pence, 0), 500);
  eq("a cost that isn't one plans nothing", costPlan(inv, { mode: "each", pence: null }).length, 0);
  const vt = viewTotals([{ forSale: 3, costed: 2, costPence: 100, pricePence: 400, marketPence: null }]);
  eq("view totals: cost and margin over the costed copies, the rest counted", [vt.cost, vt.uncosted, vt.margin], [200, 1, 600]);
}

// ---- the greps ----
{
  const sales = read("apps/app/app/panel/Sales.js");
  if (!/saleCost\(/.test(sales)) { failed++; console.error("✗ Sales must cost a sale through saleCost(), so a lab copy's own cost is used"); } else passed++;
  const store = read("apps/app/lib/lab-store.js");
  if (!/export async function setCardCosts/.test(store) || !/missing: true/.test(store)) { failed++; console.error("✗ setCardCosts must degrade (missing: true) before migration 044"); } else passed++;
  const route = read("apps/app/app/api/lab/route.js");
  if (!/costsFor\(sb, user, rows, group\)[\s\S]*costsFor\(sb, user, rows, group\)/.test(route)) { failed++; console.error("✗ both a new listing and a join must write the copies' costs"); } else passed++;
  const mig = read("supabase/migrations/044_card_costs.sql");
  if (!/add column if not exists cost_pence/.test(mig)) { failed++; console.error("✗ migration 044 must add stack_cards.cost_pence"); } else passed++;
}

if (failed) { console.error(`\n${failed} of ${failed + passed} cost checks failed.`); process.exit(1); }
console.log(`✓ ${passed} cost checks pass.`);
