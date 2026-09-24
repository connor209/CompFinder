/**
 * Show history — how each show went, read off the `stock_checkouts` ledger.
 *
 * Every trip is already recorded: a card checked out writes a row, and it is
 * resolved later as `sold` (with the takings) or `returned`. So the history
 * needs no table of its own and no migration — it is a grouping of rows the
 * desk has been writing since migration 016.
 *
 * Pure by design, like showfilter.js: no Supabase, no React, so
 * `scripts/check-showhistory.mjs` can pin the arithmetic offline.
 *
 * Four rules worth knowing before changing anything here:
 *
 * - **A show is its event name.** Two days at Glasgow are one show, typed the
 *   same way both mornings, so the key is the name trimmed and case-folded.
 *   A row with no event name is grouped by the DAY it was checked out, which
 *   is the best guess at "the trip" the data allows — and it says so rather
 *   than lumping every unnamed checkout since August into one show.
 *
 * - **A card is counted once per show.** Checked out, filed back, checked out
 *   again the next morning is one card brought, not two — otherwise every card
 *   re-packed for day two counts as a card that came home, and sell-through
 *   reads lower the busier the show was. The LATEST trip decides its outcome.
 *   Keyed on the stack card, then the SKU; a row carrying neither is counted
 *   as itself, since there is nothing honest to fold it on.
 *
 * - **A card sold straight off eBay stock was never in the box.** The Current
 *   Deal writes those rows already resolved (`checked_out_at === resolved_at`,
 *   see `sellLine()` in deal.js). They are real takings at the show and they
 *   are counted as takings — but not as cards BROUGHT, or sell-through would
 *   be flattered by every card sold from a phone screen of listings at home.
 *
 * - **"Not checked back in" is counted as sold, and says so.** That is how the
 *   table actually works — what comes home gets filed back in, what doesn't
 *   was sold — and the sell-through rate follows it. But a card still out is
 *   not a RECORDED sale: it has no price, it may be in the car, and on the
 *   show still running every card is "not back". So the two are kept apart on
 *   every row (`sold` vs `notBack`), `settled` says whether anything is still
 *   out, and the takings are only ever what was recorded.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The name a show is grouped under: trimmed, whitespace collapsed, case-folded. */
export function eventKey(name) {
  const s = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
  return s ? s.toLowerCase() : "";
}

/** A YYYY-MM-DD for the local day an ISO timestamp falls on. */
export function dayOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The show a checkout row belongs to: `{ key, label, named }`. */
export function showOf(row) {
  const k = eventKey(row?.event);
  if (k) {
    return { key: `e:${k}`, label: String(row.event).replace(/\s+/g, " ").trim(), named: true };
  }
  const day = dayOf(row?.checked_out_at);
  return { key: `d:${day || "unknown"}`, label: day ? `Unnamed · ${day}` : "Unnamed", named: false };
}

/**
 * Sold straight off eBay stock by the Current Deal: written resolved in the
 * same instant it was "checked out", so it never sat in the box.
 */
export function isDirectSale(row) {
  if (!row || row.resolution !== "sold" || !row.resolved_at || !row.checked_out_at) return false;
  const a = new Date(row.checked_out_at).getTime();
  const b = new Date(row.resolved_at).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** What happened to one trip: "sold" | "returned" | "out" | "cancelled". */
export function outcomeOf(row) {
  if (!row?.resolved_at) return "out";
  if (row.resolution === "sold") return "sold";
  if (row.resolution === "cancelled") return "cancelled";
  return "returned";
}

/** The one physical card a row is about, within a show. */
function cardKeyOf(row) {
  if (row.stack_card_id) return `c:${row.stack_card_id}`;
  if (row.sku) return `s:${String(row.sku).trim().toLowerCase()}`;
  return `r:${row.id}`;
}

const ts = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};
const latestOf = (row) => Math.max(ts(row.checked_out_at), ts(row.resolved_at));

/**
 * Collapse one show's box rows to one row per physical card, the latest trip
 * winning. Exported so the check can pin the re-pack case directly.
 */
export function latestPerCard(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = cardKeyOf(r);
    const prev = by.get(k);
    if (!prev || latestOf(r) > latestOf(prev) || (latestOf(r) === latestOf(prev) && String(r.id) > String(prev.id))) {
      by.set(k, r);
    }
  }
  return [...by.values()];
}

const ratio = (n, d) => (d > 0 ? n / d : null);

/**
 * What a card cost us, from `listing_costs` — the only per-card cost the app
 * keeps, keyed by eBay item id. The checkout's own item id first, then the
 * one it was relisted under, since an ended-and-relisted card may carry its
 * cost against either. `costs` is a Map of item id -> pence; null means no
 * cost is recorded, which is NOT a cost of zero.
 */
export function costOf(row, costs) {
  if (!costs || !row) return null;
  for (const id of [row.ebay_item_id, row.relisted_item_id]) {
    if (id == null) continue;
    const c = costs.get(String(id));
    if (c != null && Number.isFinite(Number(c))) return Number(c);
  }
  return null;
}

/**
 * The figures for one show, from every checkout row that belongs to it.
 * Takings are recorded sales only — a card not checked back in has no price.
 */
export function summariseShow(rows, costs = null) {
  const direct = rows.filter(isDirectSale);
  const box = latestPerCard(
    rows.filter((r) => !isDirectSale(r) && outcomeOf(r) !== "cancelled")
  );

  let sold = 0, returned = 0, notBack = 0;
  let boxTakings = 0, soldUnpriced = 0;
  let stickerBrought = 0, unstickered = 0;
  let stickerOfSold = 0, takingsOfStickered = 0;
  for (const r of box) {
    const o = outcomeOf(r);
    if (o === "sold") {
      sold++;
      if (r.sold_price_pence != null) boxTakings += r.sold_price_pence;
      else soldUnpriced++;
      // Achieved-vs-sticker only where BOTH figures exist: an unpriced sale
      // against a sticker would read as a 100% discount.
      if (r.sticker_pence != null && r.sold_price_pence != null) {
        stickerOfSold += r.sticker_pence;
        takingsOfStickered += r.sold_price_pence;
      }
    } else if (o === "returned") returned++;
    else notBack++;
    if (r.sticker_pence != null) stickerBrought += r.sticker_pence;
    else unstickered++;
  }

  let directTakings = 0, directUnpriced = 0;
  for (const r of direct) {
    if (r.sold_price_pence != null) directTakings += r.sold_price_pence;
    else directUnpriced++;
  }

  // Profit is only ever over sales carrying BOTH a price and a cost. A sale
  // with no cost recorded would otherwise count its whole price as profit,
  // which is the flattering direction — so it is left out and counted instead,
  // and the screen says how much of the takings the figure covers.
  let profit = 0, costedSales = 0, costOfSold = 0, takingsCosted = 0, uncosted = 0;
  for (const r of [...box.filter((x) => outcomeOf(x) === "sold"), ...direct]) {
    if (r.sold_price_pence == null) continue;
    const c = costOf(r, costs);
    if (c == null) { uncosted++; continue; }
    costedSales++;
    costOfSold += c;
    takingsCosted += r.sold_price_pence;
    profit += r.sold_price_pence - c;
  }

  const brought = box.length;
  const times = rows.flatMap((r) => [ts(r.checked_out_at), ts(r.resolved_at)]).filter(Boolean);
  const first = times.length ? Math.min(...times) : 0;
  const last = times.length ? Math.max(...times) : 0;
  const pricedSales = sold - soldUnpriced + direct.length - directUnpriced;
  const takings = boxTakings + directTakings;

  return {
    brought,
    sold,
    returned,
    notBack,
    settled: notBack === 0,
    // The rate as the table works: whatever did not come home, sold.
    sellThrough: ratio(sold + notBack, brought),
    // The floor under it: only sales somebody recorded.
    recordedSellThrough: ratio(sold, brought),
    boxTakings,
    directSold: direct.length,
    directTakings,
    takings,
    soldUnpriced: soldUnpriced + directUnpriced,
    avgSale: pricedSales > 0 ? Math.round(takings / pricedSales) : null,
    // Gross profit on the cards sold, before table fees and travel.
    profit: costedSales > 0 ? profit : null,
    costOfSold,
    costedSales,
    uncosted,
    takingsCosted,
    margin: ratio(profit, takingsCosted),
    stickerBrought,
    unstickered,
    // What the sold cards fetched against what their stickers asked.
    achievedVsSticker: ratio(takingsOfStickered, stickerOfSold),
    firstAt: first ? new Date(first).toISOString() : null,
    lastAt: last ? new Date(last).toISOString() : null,
    days: first && last ? Math.max(1, Math.round((last - first) / DAY_MS) + 1) : 0
  };
}

/**
 * Every show, newest first, each with its summary and its own rows (one per
 * card for the box, plus the direct sales) for the drill-down.
 */
export function showHistory(rows, costs = null) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const s = showOf(r);
    if (!groups.has(s.key)) groups.set(s.key, { ...s, rows: [] });
    groups.get(s.key).rows.push(r);
  }
  const shows = [...groups.values()].map((g) => {
    const summary = summariseShow(g.rows, costs);
    const cards = latestPerCard(g.rows.filter((r) => !isDirectSale(r) && outcomeOf(r) !== "cancelled"));
    const direct = g.rows.filter(isDirectSale);
    return { key: g.key, label: g.label, named: g.named, summary, cards, direct };
  });
  return shows.sort((a, b) => ts(b.summary.lastAt) - ts(a.summary.lastAt) || a.label.localeCompare(b.label));
}

/** Every show added up. Rates are over the pooled cards, never an average of rates. */
export function totalsOf(shows) {
  const t = {
    shows: shows.length, brought: 0, sold: 0, returned: 0, notBack: 0,
    takings: 0, directSold: 0, soldUnpriced: 0,
    profit: 0, costedSales: 0, uncosted: 0, takingsCosted: 0
  };
  for (const s of shows) {
    const m = s.summary;
    t.brought += m.brought;
    t.sold += m.sold;
    t.returned += m.returned;
    t.notBack += m.notBack;
    t.takings += m.takings;
    t.directSold += m.directSold;
    t.soldUnpriced += m.soldUnpriced;
    if (m.profit != null) t.profit += m.profit;
    t.costedSales += m.costedSales;
    t.uncosted += m.uncosted;
    t.takingsCosted += m.takingsCosted;
  }
  t.sellThrough = ratio(t.sold + t.notBack, t.brought);
  t.recordedSellThrough = ratio(t.sold, t.brought);
  if (t.costedSales === 0) t.profit = null;
  t.margin = t.profit == null ? null : ratio(t.profit, t.takingsCosted);
  return t;
}

/** "62%", or an em dash when there is nothing to divide by. */
export function pct(r) {
  return r == null ? "—" : `${Math.round(r * 100)}%`;
}

const HEADER = [
  "Show", "First activity", "Last activity", "Cards brought", "Sold (recorded)",
  "Returned", "Not checked back in", "Sell-through", "Recorded sell-through",
  "Box takings (£)", "Sold from eBay stock", "eBay-stock takings (£)",
  "Total takings (£)", "Sales with no price", "Sticker value brought (£)",
  "Achieved vs sticker", "Cost of costed sales (£)", "Profit (£)", "Margin",
  "Sales with a cost", "Sales with no cost recorded"
];

/**
 * The per-show table as CSV. One row per show; money in pounds to 2dp so a
 * spreadsheet sums it, rates as whole percentages so it reads as the screen.
 */
export function historyCsv(shows) {
  const money = (p) => (p / 100).toFixed(2);
  const cell = (c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`;
  const lines = [HEADER.map(cell).join(",")];
  for (const s of shows) {
    const m = s.summary;
    lines.push([
      s.label, m.firstAt ? dayOf(m.firstAt) : "", m.lastAt ? dayOf(m.lastAt) : "",
      m.brought, m.sold, m.returned, m.notBack,
      pct(m.sellThrough), pct(m.recordedSellThrough),
      money(m.boxTakings), m.directSold, money(m.directTakings), money(m.takings),
      m.soldUnpriced, money(m.stickerBrought),
      m.achievedVsSticker == null ? "" : pct(m.achievedVsSticker),
      money(m.costOfSold), m.profit == null ? "" : money(m.profit),
      m.margin == null ? "" : pct(m.margin), m.costedSales, m.uncosted
    ].map(cell).join(","));
  }
  return lines.join("\n");
}
