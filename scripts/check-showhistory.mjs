/**
 * Show history: how a show's checkout rows add up to brought, sold, not back,
 * sell-through and takings.
 *
 *   node scripts/check-showhistory.mjs      (or: npm run check)
 *
 * The cases that matter are the ones that would quietly move the rate:
 *
 * - a card re-packed for day two is ONE card brought, not a return plus a
 *   second card, or a busy two-day show reads worse than a quiet one;
 * - a card sold straight off eBay stock by the Current Deal is takings but was
 *   never in the box, so it must not be in "brought";
 * - "not checked back in" counts toward sell-through but never toward takings;
 * - an unpriced sale is counted as a sale and flagged, not read as £0;
 * - the totals pool the cards rather than averaging the shows' rates.
 *
 * Offline, no Supabase, no framework: showhistory.js is pure by design.
 */
import { readFileSync } from "node:fs";
import {
  eventKey,
  showOf,
  isDirectSale,
  outcomeOf,
  latestPerCard,
  summariseShow,
  showHistory,
  totalsOf,
  historyCsv,
  costOf,
  withExpenses,
  pct
} from "../apps/app/lib/showhistory.js";
import { parseExpensePence, isMissingTable, EXPENSE_CATEGORIES } from "../apps/app/lib/show-expenses-store.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

let n = 0;
const row = (over = {}) => ({
  id: over.id ?? `r${++n}`,
  event: "event" in over ? over.event : "Glasgow",
  sku: over.sku ?? null,
  title: over.title ?? null,
  stack_card_id: "stack_card_id" in over ? over.stack_card_id : `c${n}`,
  checked_out_at: over.checked_out_at ?? "2026-09-05T08:00:00Z",
  resolved_at: over.resolved_at ?? null,
  resolution: over.resolution ?? null,
  sold_price_pence: over.sold_price_pence ?? null,
  sticker_pence: over.sticker_pence ?? null,
  ebay_item_id: over.ebay_item_id ?? null,
  relisted_item_id: over.relisted_item_id ?? null
});
const sold = (pence, over = {}) => row({ resolved_at: "2026-09-05T15:00:00Z", resolution: "sold", sold_price_pence: pence, ...over });
const back = (over = {}) => row({ resolved_at: "2026-09-06T09:00:00Z", resolution: "returned", ...over });

// ---- grouping ---------------------------------------------------------------
eq("event key folds case and spacing", eventKey("  Glasgow   Comic Con "), "glasgow comic con");
eq("same show typed two ways", showOf(row({ event: "glasgow" })).key, showOf(row({ event: "Glasgow " })).key);
eq("unnamed rows grouped by day, and say so", showOf(row({ event: "", checked_out_at: "2026-09-05T08:00:00Z" })).named, false);
eq("unnamed on different days are different shows",
  showOf(row({ event: null, checked_out_at: "2026-09-05T12:00:00Z" })).key === showOf(row({ event: null, checked_out_at: "2026-09-12T12:00:00Z" })).key,
  false);

// ---- outcomes -----------------------------------------------------------------
eq("unresolved is out", outcomeOf(row()), "out");
eq("sold is sold", outcomeOf(sold(500)), "sold");
eq("returned is returned", outcomeOf(back()), "returned");
eq("direct sale: checked out and sold in one instant",
  isDirectSale(row({ checked_out_at: "2026-09-05T11:00:00Z", resolved_at: "2026-09-05T11:00:00Z", resolution: "sold" })), true);
eq("a box card sold later is not a direct sale", isDirectSale(sold(500)), false);
eq("a returned card is never a direct sale",
  isDirectSale(row({ checked_out_at: "2026-09-05T11:00:00Z", resolved_at: "2026-09-05T11:00:00Z", resolution: "returned" })), false);

// ---- the re-pack: one card, two trips, latest wins ----------------------------
{
  const day1 = back({ stack_card_id: "gengar", resolved_at: "2026-09-05T18:00:00Z" });
  const day2 = sold(1200, { stack_card_id: "gengar", checked_out_at: "2026-09-06T08:00:00Z", resolved_at: "2026-09-06T14:00:00Z" });
  eq("re-packed card folds to one", latestPerCard([day1, day2]).length, 1);
  const m = summariseShow([day1, day2]);
  eq("re-pack: brought once", m.brought, 1);
  eq("re-pack: the day-two sale decides it", [m.sold, m.returned], [1, 0]);
  eq("re-pack: 100% sell-through, not 50%", pct(m.sellThrough), "100%");
}
{
  // Folded on SKU when there is no stack card.
  const a = back({ stack_card_id: null, sku: "AB12", resolved_at: "2026-09-05T18:00:00Z" });
  const b = row({ stack_card_id: null, sku: "ab12", checked_out_at: "2026-09-06T08:00:00Z" });
  eq("folds on SKU, case-blind", latestPerCard([a, b]).length, 1);
  // A row with neither is itself.
  const c = row({ stack_card_id: null, sku: null });
  const d = row({ stack_card_id: null, sku: null });
  eq("nothing to fold on: two rows, two cards", latestPerCard([c, d]).length, 2);
}

// ---- one show, all the figures -------------------------------------------------
{
  const rows = [
    sold(1000, { sticker_pence: 1200 }),
    sold(500, { sticker_pence: 500 }),
    sold(null, { sticker_pence: 800 }),     // sold, nobody typed the price
    back({ sticker_pence: 300 }),
    back(),
    row({ sticker_pence: 2000 }),           // not checked back in
    // Sold off eBay stock from the Current Deal: takings, not brought.
    row({ checked_out_at: "2026-09-05T13:00:00Z", resolved_at: "2026-09-05T13:00:00Z", resolution: "sold", sold_price_pence: 2500 }),
    // Cancelled: never happened.
    row({ resolved_at: "2026-09-05T09:00:00Z", resolution: "cancelled" })
  ];
  const m = summariseShow(rows);
  eq("brought excludes direct sales and cancellations", m.brought, 6);
  eq("sold / returned / not back", [m.sold, m.returned, m.notBack], [3, 2, 1]);
  eq("not settled while a card is out", m.settled, false);
  eq("sell-through counts not-back as sold", pct(m.sellThrough), "67%");
  eq("recorded sell-through is the floor", pct(m.recordedSellThrough), "50%");
  eq("box takings are recorded prices only", m.boxTakings, 1500);
  eq("direct sale in the takings", [m.directSold, m.directTakings, m.takings], [1, 2500, 4000]);
  eq("unpriced sale is flagged, not £0", m.soldUnpriced, 1);
  eq("average over PRICED sales", m.avgSale, Math.round(4000 / 3));
  eq("sticker value of everything brought", [m.stickerBrought, m.unstickered], [4800, 1]);
  // 1500 fetched against 1700 asked; the unpriced sale's £8 sticker is left out.
  eq("achieved vs sticker ignores unpriced sales", pct(m.achievedVsSticker), "88%");
}
{
  const m = summariseShow([sold(100), back()]);
  eq("settled show: both rates agree", [m.settled, pct(m.sellThrough), pct(m.recordedSellThrough)], [true, "50%", "50%"]);
  eq("no stickers: no ratio", m.achievedVsSticker, null);
}
{
  const m = summariseShow([row({ checked_out_at: "2026-09-05T13:00:00Z", resolved_at: "2026-09-05T13:00:00Z", resolution: "sold", sold_price_pence: 900 })]);
  eq("only direct sales: nothing brought, no rate", [m.brought, m.sellThrough], [0, null]);
  eq("…and pct says so", pct(m.sellThrough), "—");
}

// ---- history and totals --------------------------------------------------------
{
  const rows = [
    sold(1000, { event: "Glasgow", checked_out_at: "2026-09-05T08:00:00Z", resolved_at: "2026-09-05T15:00:00Z" }),
    back({ event: "glasgow", checked_out_at: "2026-09-05T08:00:00Z", resolved_at: "2026-09-06T18:00:00Z" }),
    // Ten brought to a later show, one sold.
    ...Array.from({ length: 9 }, () => back({ event: "Leeds", checked_out_at: "2026-09-19T08:00:00Z", resolved_at: "2026-09-20T18:00:00Z" })),
    sold(300, { event: "Leeds", checked_out_at: "2026-09-19T08:00:00Z", resolved_at: "2026-09-19T12:00:00Z" })
  ];
  const shows = showHistory(rows);
  eq("two shows", shows.map((s) => s.label), ["Leeds", "Glasgow"]);
  eq("newest first", shows[0].summary.lastAt > shows[1].summary.lastAt, true);
  eq("Glasgow spans two days", shows[1].summary.days, 2);
  const t = totalsOf(shows);
  // Pooled: 2 of 12 = 17%. Averaging the shows' rates (50% and 10%) says 30%.
  eq("totals pool cards, never average rates", pct(t.sellThrough), "17%");
  eq("total takings", t.takings, 1300);

  const csv = historyCsv(shows).split("\n");
  eq("csv: header plus one line per show", csv.length, 3);
  eq("csv: pounds to 2dp", csv[1].includes('"3.00"'), true);
  eq("csv: a quote in a name is escaped", historyCsv(showHistory([row({ event: 'The "Big" One' })])).includes('"The ""Big"" One"'), true);
}

// ---- profit ------------------------------------------------------------------------
{
  const costs = new Map([["111", 400], ["222", 900], ["333", 0], ["new444", 250]]);
  eq("cost by item id", costOf(row({ ebay_item_id: "111" }), costs), 400);
  eq("cost by the relisted id when the original has none", costOf(row({ ebay_item_id: "444", relisted_item_id: "new444" }), costs), 250);
  eq("a recorded cost of zero is a cost", costOf(row({ ebay_item_id: "333" }), costs), 0);
  eq("no cost recorded is null, never zero", costOf(row({ ebay_item_id: "999" }), costs), null);
  eq("no cost table at all", costOf(row({ ebay_item_id: "111" }), null), null);

  const rows = [
    sold(1000, { ebay_item_id: "111" }),          // +600
    sold(700, { ebay_item_id: "222" }),           // -200, a loss is a loss
    sold(500, { ebay_item_id: "999" }),           // no cost: left OUT, never £5 of profit
    sold(null, { ebay_item_id: "111" }),          // no price: nothing to take a cost from
    row({ ebay_item_id: "222" }),                 // not back: no sale, no profit
    back({ ebay_item_id: "111" }),                // came home: no profit
    // Off eBay stock via the deal: its profit counts.
    row({ ebay_item_id: "333", checked_out_at: "2026-09-05T13:00:00Z", resolved_at: "2026-09-05T13:00:00Z", resolution: "sold", sold_price_pence: 300 })
  ];
  const m = summariseShow(rows, costs);
  eq("profit over costed sales only", m.profit, 600 - 200 + 300);
  eq("costed vs uncosted counted", [m.costedSales, m.uncosted], [3, 1]);
  eq("cost of the costed sales", m.costOfSold, 1300);
  eq("takings the profit covers", m.takingsCosted, 2000);
  eq("margin over the covered takings, not all takings", pct(m.margin), "35%");
  eq("without costs there is no profit, not £0", summariseShow(rows).profit, null);

  const shows = showHistory([
    ...rows,
    sold(2000, { event: "Leeds", ebay_item_id: "222" }),
    sold(800, { event: "York" })                 // no cost anywhere at York
  ], costs);
  const t = totalsOf(shows);
  eq("totals: profit summed over shows that have one", t.profit, 700 + 1100);
  eq("a show with no costed sale has no profit", shows.find((s) => s.label === "York").summary.profit, null);
  eq("csv carries profit", historyCsv(shows).split("\n")[0].includes('"Profit (£)"'), true);
}

// ---- show costs ----------------------------------------------------------------------
{
  eq("£45 is 4500p", parseExpensePence("£45"), 4500);
  eq("12.50 is 1250p", parseExpensePence("12.50"), 1250);
  eq("a thousand with a comma", parseExpensePence("1,200"), 120000);
  eq("zero refused", parseExpensePence("0"), null);
  eq("negative refused", parseExpensePence("-5"), null);
  eq("three decimals refused, not rounded", parseExpensePence("4.555"), null);
  eq("junk refused", parseExpensePence("forty"), null);
  eq("pending migration recognised", isMissingTable({ code: "42P01" }), true);
  eq("categories keep 'other' last (the fallback)", EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1].key, "other");

  const costs = new Map([["111", 400]]);
  const glasgow = [sold(1000, { event: "Glasgow", ebay_item_id: "111" })];   // gross +600
  const expenses = [
    { id: "x1", show_key: "e:glasgow", show_label: "Glasgow", category: "table", amount_pence: 5000, created_at: "2026-08-01T10:00:00Z" },
    { id: "x2", show_key: "e:glasgow", show_label: "Glasgow", category: "travel", amount_pence: 1500, created_at: "2026-09-05T07:00:00Z" },
    // York: costs logged, cards sold, but no card has a cost recorded.
    { id: "x3", show_key: "e:york", show_label: "York", category: "table", amount_pence: 3000, created_at: "2026-09-10T10:00:00Z" },
    // Leeds: table fee paid ahead, nothing checked out yet.
    { id: "x4", show_key: "e:leeds", show_label: "Leeds", category: "table", amount_pence: 4000, created_at: "2026-09-20T10:00:00Z" }
  ];
  const shows = showHistory([...glasgow, sold(900, { event: "york" })], costs, expenses);
  const by = (label) => shows.find((s) => s.key === `e:${label.toLowerCase()}`);

  eq("costs join on the show key, case-blind event", by("Glasgow").summary.expensesPence, 6500);
  eq("net is gross less costs, and can be a loss", by("Glasgow").summary.net, 600 - 6500);
  eq("no card costs: no net profit, never takings-as-profit", by("York").summary.net, null);
  eq("…but takings less costs is still said", by("York").summary.takingsLessExpenses, 900 - 3000);
  eq("a show with only costs still gets a block", Boolean(by("Leeds")), true);
  eq("…dated by its costs", by("Leeds").summary.lastAt, "2026-09-20T10:00:00.000Z");
  eq("…with nothing brought", by("Leeds").summary.brought, 0);
  eq("its costs ride on the block for the editor", by("Glasgow").expenses.map((e) => e.id), ["x1", "x2"]);

  const t = totalsOf(shows);
  eq("total costs are every show's", t.expensesPence, 13500);
  // Only Glasgow can be netted. York's and Leeds's costs must not be taken off
  // Glasgow's profit, or a show with no card costs makes another look worse.
  eq("total net only over shows that have a net", t.net, 600 - 6500);
  eq("no costs anywhere: net equals gross", withExpenses({ profit: 700, takings: 1000 }, []).net, 700);
  eq("csv carries net profit", historyCsv(shows).split("\n")[0].includes('"Net profit (£)"'), true);
}

// ---- wiring ----------------------------------------------------------------------
{
  const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
  if (!/showhistory:\s*"show-history"/.test(panel)) fail("Panel.js: no /panel/show-history slug");
  if (!/stream === "showhistory" && <ShowHistory \/>/.test(panel)) fail("Panel.js: Show history is not rendered");
  // The history is a reader. A write from it would be a second place a
  // checkout gets resolved, and the desk and the deal already guard theirs.
  const screen = readFileSync(new URL("../apps/app/app/panel/ShowHistory.js", import.meta.url), "utf8");
  if (/\.(update|insert|upsert|delete)\s*\(/.test(screen)) fail("ShowHistory.js writes to the database directly — show costs go through show-expenses-store.js, and checkouts are never written here");
  if (/stock_checkouts["'`]\s*\)\s*\.(update|insert|upsert|delete)/.test(screen)) fail("ShowHistory.js writes stock_checkouts");
  // show_expenses is named in its store only, like show_wants and the batch tables.
  const { readdirSync } = await import("node:fs");
  const libDir = new URL("../apps/app/lib/", import.meta.url);
  const panelDir = new URL("../apps/app/app/panel/", import.meta.url);
  for (const [dir, files] of [[libDir, readdirSync(libDir)], [panelDir, readdirSync(panelDir)]]) {
    for (const f of files) {
      if (!f.endsWith(".js") || f === "show-expenses-store.js") continue;
      if (readFileSync(new URL(f, dir), "utf8").includes('"show_expenses"')) fail(`${f} names show_expenses — only show-expenses-store.js may`);
    }
  }
}

if (failures) {
  console.error(`check-showhistory: ${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("check-showhistory: ok");
