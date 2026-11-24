/**
 * The lab's inventory view (docs/LISTING_STUDIO.md, part C): one row per
 * listing — a card in a condition — with its copies underneath. Pure; the
 * screen is app/panel/lab/inventory.
 *
 * Built off the same rows the lab already reads, through the same queue and
 * pile rules (lab-copies.js), so this view and the lab page can never
 * disagree about which copy is on show or where a card is.
 */
import { splitLotCost } from "./card-costs.js";
import { queueOf, displayOrder, pilePositions, pileOf } from "./lab-copies.js";
import { renderListing } from "./listing-template.js";

export const PAGE_SIZE = 50;
/** Page sizes on offer; 0 is "all", for a run small enough to want on one screen. */
export const PAGE_SIZES = [25, 50, 100, 200, 0];

export const STATUSES = [
  ["live", "Live"],
  ["soldout", "Sold out"],
  ["ended", "Ended"]
];

export const SORTS = [
  ["added-desc", "Newest first"],
  ["added-asc", "Oldest first"],
  ["price-desc", "Price, high to low"],
  ["price-asc", "Price, low to high"],
  ["name-asc", "Name A–Z"],
  ["forsale-desc", "Most copies for sale"]
];

/** Lowercased, accents off, punctuation to spaces — how both sides of a search are read. */
export function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
}

/** A listing's status: ended (by us), sold out (live on eBay at quantity 0), or live. */
export function statusOf(listing, forSale) {
  if (listing?.ended_at) return "ended";
  return forSale > 0 ? "live" : "soldout";
}

/**
 * One row per listing. Counts:
 *   forSale   copies in the queue (not sold, not picked)
 *   waiting   sold to an order, still on the shelf — these are on the Pick list
 *   picked    gone
 */
export function inventoryRows(listings, copies) {
  const pos = pilePositions(copies);
  const byListing = new Map();
  for (const c of copies || []) {
    const k = String(c.listing_id);
    if (!byListing.has(k)) byListing.set(k, []);
    byListing.get(k).push(c);
  }
  return (listings || []).map((l) => {
    const mine = byListing.get(String(l.id)) || [];
    const queue = queueOf(l.id, copies);
    const head = queue[0] || null;
    const waiting = mine.filter((c) => c.reserved_line && !c.pulled_at).length;
    const picked = mine.filter((c) => c.pulled_at).length;
    const card = l.card || {};
    const piles = [...new Set(mine.map((c) => pileOf(c.sku).pile))].sort();
    const showing = mine.find((c) => String(c.id) === String(l.pictured_copy_id)) || null;
    // What the copies still for sale cost us, per copy (card-costs.js):
    // averaged over the ones that carry a cost, and how many of them do.
    const costed = queue.filter((c) => c.cost_pence != null);
    return {
      id: l.id,
      listing: l,
      title: l.title,
      name: card.name || "",
      number: card.number || "",
      set: card.set || "",
      language: card.language || "",
      condition: String(l.condition || "").toUpperCase(),
      subtype: l.subtype || "",
      status: statusOf(l, queue.length),
      // An ended listing sells nothing: its unsold copies are in their piles,
      // on no listing, so they are not "for sale" anywhere.
      forSale: l.ended_at ? 0 : queue.length,
      waiting,
      picked,
      total: mine.length,
      pricePence: l.price_pence ?? null,
      marketPence: l.market_pence ?? null,
      costPence: costed.length ? Math.round(costed.reduce((t, c) => t + Number(c.cost_pence), 0) / costed.length) : null,
      costed: costed.length,
      marketAt: l.market_at || null,
      itemId: l.ebay_item_id || null,
      addedAt: l.created_at || null,
      // Card-level picture: the database image when there is one, else the
      // scan of the copy on show. A row never stands for one copy, so the
      // stock image is honest HERE — and only here.
      picture: l.db_image_url || (showing || head)?.scan_urls?.[0] || mine[0]?.scan_urls?.[0] || null,
      pictureIsDb: Boolean(l.db_image_url),
      piles,
      copies: displayOrder(l.id, copies).map((c) => ({
        ...c,
        pile: pos.get(String(c.id))?.pile || pileOf(c.sku).pile,
        position: pos.get(String(c.id))?.position || null,
        state: c.pulled_at ? "picked" : c.reserved_line ? "sold" : head && String(head.id) === String(c.id) ? "next" : "queued",
        onShow: String(l.pictured_copy_id || "") === String(c.id) && !l.ended_at
      })),
      search: norm([l.title, card.name, card.number, card.set, card.setCode, card.rarity, l.subtype, l.ebay_item_id, ...mine.map((c) => c.sku)].join(" "))
    };
  });
}

/**
 * Does a row match the search? Every word typed has to be in it, any order.
 * A word that is an exact SKU of one of its copies always matches, so
 * "TEST2-14" finds its card even though the hyphen is read as a space.
 */
export function matchesSearch(row, q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const skus = new Set(row.copies.map((c) => String(c.sku).toLowerCase()));
  if (skus.has(String(q).trim().toLowerCase())) return true;
  return words.every((w) => row.search.includes(w));
}

export const EMPTY_FILTERS = {
  q: "", status: "", condition: "", pile: "", language: "", subtype: "", waiting: false,
  set: "", minPrice: "", maxPrice: "", vsMarket: "", multi: false, added: "", game: "", vsCm: ""
};

/** Price against the sold-comps figure: the question a repricing pass starts from. */
export const VS_MARKET = [
  ["under", "Priced under market"],
  ["over", "Priced over market"],
  ["match", "At market (±10%)"],
  ["none", "No market figure"]
];
export const ADDED = [["1d", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
const ADDED_MS = { "1d": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

/** Price less market, in pence and as a share of market — or null when either is missing. */
export function marketGap(row) {
  if (row?.pricePence == null || row?.marketPence == null || row.marketPence <= 0) return null;
  const pence = row.pricePence - row.marketPence;
  return { pence, pct: Math.round((pence / row.marketPence) * 100) };
}

/**
 * Price less Cardmarket's trend (in pounds), the same shape as marketGap. The
 * Cardmarket figure is attached by the screen as `row.cm` (lib/cm-match.js):
 * it is read daily, where the sold-comps market is frozen at listing time.
 */
export function cmGap(row) {
  const cm = row?.cm?.pence;
  if (row?.pricePence == null || cm == null || cm <= 0) return null;
  const pence = row.pricePence - cm;
  return { pence, pct: Math.round((pence / cm) * 100) };
}

function vsOf(g) {
  if (!g) return "none";
  if (Math.abs(g.pct) <= 10) return "match";
  return g.pence < 0 ? "under" : "over";
}
const vsCmOf = (row) => vsOf(cmGap(row));

/** The same four buckets, against Cardmarket. */
export const VS_CM = [
  ["under", "Priced under Cardmarket"],
  ["over", "Priced over Cardmarket"],
  ["match", "At Cardmarket (±10%)"],
  ["none", "No Cardmarket figure"]
];

function vsMarketOf(row) {
  const g = marketGap(row);
  if (!g) return "none";
  if (Math.abs(g.pct) <= 10) return "match";
  return g.pence < 0 ? "under" : "over";
}

/** A row's game, as the TCG column reads it. */
export const gameOf = (row) => [row.listing?.card?.game, row.language].filter(Boolean).join(" ");

export function filterRows(rows, f = EMPTY_FILTERS, now = Date.now()) {
  const min = parsePence(f.minPrice);
  const max = parsePence(f.maxPrice);
  return (rows || []).filter((r) =>
    matchesSearch(r, f.q) &&
    (!f.set || r.set === f.set) &&
    (!f.game || gameOf(r) === f.game) &&
    (min == null || (r.pricePence != null && r.pricePence >= min)) &&
    (max == null || (r.pricePence != null && r.pricePence <= max)) &&
    (!f.vsMarket || vsMarketOf(r) === f.vsMarket) &&
    (!f.vsCm || vsCmOf(r) === f.vsCm) &&
    (!f.multi || r.total > 1) &&
    (!f.added || (r.addedAt && now - Date.parse(r.addedAt) <= (ADDED_MS[f.added] || Infinity))) &&
    (!f.status || r.status === f.status) &&
    (!f.condition || r.condition === f.condition) &&
    (!f.pile || r.piles.includes(f.pile)) &&
    (!f.language || r.language === f.language) &&
    (!f.subtype || r.subtype === f.subtype) &&
    (!f.waiting || r.waiting > 0)
  );
}

const CONDITION_RANK = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };
/** "074/165" → [74, 165], "SV-P 12" → [12, 0]: a number that sorts as a number. */
const numberKey = (n) => { const m = String(n || "").match(/(\d+)(?:\D+(\d+))?/); return m ? Number(m[1]) * 10000 + Number(m[2] || 0) : null; };

/**
 * The sorts the screen offers, by column. Text sorts natural ("TEST5-2" before
 * "TEST5-10"); set sorts by set, then by number within it.
 */
export const SORT_FIELDS = [
  ["added", "Date added"], ["name", "Name"], ["set", "Set & number"], ["sku", "SKU"], ["condition", "Condition"],
  ["price", "Price"], ["market", "Market"], ["gap", "Price vs market (£)"], ["gappct", "Price vs market (%)"],
  ["cm", "Cardmarket"], ["cmgap", "Price vs Cardmarket (%)"], ["forsale", "Quantity"],
  ["where", "Stack & position"], ["cost", "Cost"], ["margin", "Price less cost"]
];

/**
 * Where a row's cards physically are: each copy still on the shelf, as its
 * stack and its LIVE position there (stackpos.js's number, the one Stacks and
 * the pull sheet count to — it closes up as cards are pulled, so it is not
 * the SKU's number once anything has gone). Sold-to-pick copies are on the
 * shelf too and say so; picked ones are gone and left out.
 */
export function whereOf(row) {
  return (row?.copies || [])
    .filter((c) => c.state !== "picked")
    .map((c) => ({ sku: c.sku, pile: c.pile, position: c.position ?? null, sold: c.state === "sold" }))
    .sort((a, b) => String(a.pile).localeCompare(String(b.pile), undefined, { numeric: true }) || (a.position ?? 1e9) - (b.position ?? 1e9));
}

/** "LAB-TEST5 #12" — one place, as a person reads it off a stack. */
export function whereText(w) {
  if (!w) return "";
  return `${w.pile}${w.position ? ` #${w.position}` : ""}`;
}

/** Sort. A row with no value (no price, no market) sorts LAST in both directions — never as 0. */
export function sortRows(rows, key = "added-desc") {
  const [field, dir] = String(key).split("-");
  const sign = dir === "asc" ? 1 : -1;
  const val = (r) => {
    switch (field) {
      case "price": return r.pricePence;
      case "market": return r.marketPence;
      case "gap": return marketGap(r)?.pence ?? null;
      case "gappct": return marketGap(r)?.pct ?? null;
      case "cm": return r.cm?.pence ?? null;
      case "cmgap": return cmGap(r)?.pct ?? null;
      case "added": return r.addedAt;
      case "name": return r.name || r.title;
      case "set": return r.set ? `${r.set}\u0000${String(numberKey(r.number) ?? "").padStart(12, "0")}` : null;
      case "sku": return r.copies?.[0]?.sku ?? null;
      case "condition": return CONDITION_RANK[r.condition] ?? null;
      case "forsale": return r.forSale;
      case "cost": return r.costPence;
      case "margin": return r.costPence == null || r.pricePence == null ? null : r.pricePence - r.costPence;
      case "where": { const w = whereOf(r)[0]; return w ? `${w.pile}\u0000${String(w.position ?? 999999).padStart(6, "0")}` : null; }
      default: return null;
    }
  };
  return (rows || []).slice().sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va == null && vb == null) return String(a.id).localeCompare(String(b.id));
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    return c ? c * sign : String(a.id).localeCompare(String(b.id));
  });
}

export function pageOf(rows, page, size = PAGE_SIZE) {
  if (!size) return { rows: rows || [], page: 1, pages: 1, total: (rows || []).length };
  const pages = Math.max(1, Math.ceil((rows || []).length / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Filter options built from the rows themselves, so an option that finds nothing is never offered. */
export function facets(rows) {
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  return {
    conditions: uniq(rows.map((r) => r.condition)),
    piles: uniq(rows.flatMap((r) => r.piles)),
    languages: uniq(rows.map((r) => r.language)),
    subtypes: uniq(rows.map((r) => r.subtype))
  };
}

/**
 * Filter options WITH counts, for the dropdowns ("TEST5 (46)"). Counted over
 * the rows given — the screen passes the rows every OTHER filter already
 * allows, so a count says what picking that option would show.
 */
export function facetCounts(rows) {
  const count = (vals) => {
    const m = new Map();
    for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  };
  return {
    sets: count(rows.map((r) => r.set)),
    conditions: count(rows.map((r) => r.condition)).sort((a, b) => (CONDITION_RANK[a[0]] ?? 9) - (CONDITION_RANK[b[0]] ?? 9)),
    piles: count(rows.flatMap((r) => r.piles)),
    languages: count(rows.map((r) => r.language)),
    subtypes: count(rows.map((r) => r.subtype)),
    games: count(rows.map(gameOf)),
    vsMarket: count(rows.map(vsMarketOf)),
    vsCm: count(rows.map(vsCmOf))
  };
}

/** What the rows on screen add up to: listings, copies for sale, and their worth at price and at market. */
export function viewTotals(rows) {
  const t = { listings: 0, copies: 0, price: 0, market: 0, unmarketed: 0, unpriced: 0, cm: 0, uncm: 0, cost: 0, uncosted: 0, costedValue: 0 };
  for (const r of rows || []) {
    t.listings += 1;
    t.copies += r.forSale;
    if (r.pricePence == null) t.unpriced += 1; else t.price += r.pricePence * r.forSale;
    if (r.marketPence == null) { if (r.forSale > 0) t.unmarketed += 1; } else t.market += r.marketPence * r.forSale;
    if (r.cm?.pence == null) { if (r.forSale > 0) t.uncm += 1; } else t.cm += r.cm.pence * r.forSale;
    // Cost over the copies that carry one; the rest are counted, never £0.
    const costed = r.costed || 0;
    t.uncosted += Math.max(0, r.forSale - costed);
    if (costed && r.costPence != null) {
      t.cost += r.costPence * costed;
      if (r.pricePence != null) t.costedValue += r.pricePence * costed;
    }
  }
  t.margin = t.cost || t.costedValue ? t.costedValue - t.cost : null;
  return t;
}

/** Columns worth showing: one that says the same thing on every row says nothing. */
export function columnsFor(rows) {
  const distinct = (f) => new Set((rows || []).map(f).filter((v) => v && v !== "—")).size;
  return {
    variant: distinct((r) => r.listing?.card?.finish) > 0,
    tcg: distinct(gameOf) > 1,
    subtype: distinct((r) => r.subtype) > 0,
    cm: (rows || []).some((r) => r.cm)
  };
}

/** The filters in force, each as a chip with how to clear it. */
export function activeChips(f) {
  const chips = [];
  const label = { status: "Status", condition: "Condition", pile: "Pile", language: "Language", subtype: "Subtype", set: "Set", game: "TCG" };
  for (const k of Object.keys(label)) if (f[k]) chips.push({ key: k, text: `${label[k]}: ${k === "status" ? (STATUSES.find(([v]) => v === f[k])?.[1] || f[k]) : f[k]}`, clear: { [k]: "" } });
  if (f.minPrice || f.maxPrice) chips.push({ key: "price", text: `Price ${f.minPrice ? `£${f.minPrice}` : "any"}–${f.maxPrice ? `£${f.maxPrice}` : "any"}`, clear: { minPrice: "", maxPrice: "" } });
  if (f.vsMarket) chips.push({ key: "vsMarket", text: VS_MARKET.find(([v]) => v === f.vsMarket)?.[1] || f.vsMarket, clear: { vsMarket: "" } });
  if (f.vsCm) chips.push({ key: "vsCm", text: VS_CM.find(([v]) => v === f.vsCm)?.[1] || f.vsCm, clear: { vsCm: "" } });
  if (f.added) chips.push({ key: "added", text: `Added: ${ADDED.find(([v]) => v === f.added)?.[1] || f.added}`, clear: { added: "" } });
  if (f.multi) chips.push({ key: "multi", text: "2+ copies", clear: { multi: false } });
  if (f.waiting) chips.push({ key: "waiting", text: "Sold, to pick", clear: { waiting: false } });
  return chips;
}

/**
 * The rows a bulk action may touch: ticked AND on screen now. A tick the
 * search or page has hidden is not acted on — the app's standing rule — and
 * ticking nothing means nothing, never everything.
 */
export function actionable(ticked, visibleRows) {
  const on = new Set([...(ticked || [])].map(String));
  return (visibleRows || []).filter((r) => on.has(String(r.id)));
}

/** Pence from what was typed in a price box, or null. */
export function parsePence(v) {
  const s = String(v ?? "").replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 ? p : null;
}

/**
 * The price change a bulk "set price" would make on each row, or why not.
 * `mode` is "exact" (one figure for all) or "market" (each row's own
 * sold-comps figure). Only live listings; a row with no market figure is
 * skipped in market mode and says so; unchanged rows are left alone.
 */
export function pricePlan(rows, { mode = "exact", pence = null } = {}) {
  return (rows || []).map((r) => {
    if (r.status === "ended") return { row: r, skip: "ended" };
    const to = mode === "market" ? r.marketPence : pence;
    if (to == null || !(to >= 99)) return { row: r, skip: mode === "market" ? "no sold-comps price" : "no price" };
    if (to === r.pricePence) return { row: r, skip: "already that price" };
    return { row: r, from: r.pricePence, to };
  });
}

// ---- Apply template -----------------------------------------------------------


/**
 * What re-applying the saved templates would do to each listing: the title
 * it has now against the one the template writes, whether eBay's 80 cuts
 * it, and why a row is skipped. Only live listings made since migration 041
 * can be re-rendered — older ones never stored the card's details, so there
 * is nothing to fill the placeholders from, and guessing them from the title
 * would put words on a live listing that nobody chose.
 *
 * The server runs this SAME function on its own read of the rows, so the
 * preview and what is sent cannot drift.
 */
export function templatePlan(rows, settings, { title = true, description = true } = {}) {
  return (rows || []).map((r) => {
    const l = r.listing || {};
    if (r.status === "ended") return { row: r, skip: "ended" };
    if (!l.card) return { row: r, skip: "listed before templates — no card details stored" };
    if (!title && !description) return { row: r, skip: "nothing chosen" };
    const head = (r.copies || []).find((c) => c.state === "next") || (r.copies || [])[0] || null;
    const out = renderListing(settings, { card: l.card, condition: r.condition, copies: head ? [{ sku: head.sku, scans: head.scan_urls || [] }] : [] }, { subtype: l.subtype || "" });
    if (out.unknownPlaceholders.length) return { row: r, skip: `description uses ${out.unknownPlaceholders.map((k) => `{${k}}`).join(", ")}` };
    const titleChanges = title && out.title !== l.title;
    if (!titleChanges && !description) return { row: r, skip: "title already matches" };
    return {
      row: r,
      fromTitle: l.title,
      toTitle: title ? out.title : null,
      titleChanges,
      titleCut: title && out.titleCut,
      descriptionHtml: description ? out.descriptionHtml : null
    };
  });
}

// ---- One row per copy, and the CSV --------------------------------------------

/** "All copies": every copy its own row, carrying its listing's columns. */
export function copyRows(rows) {
  return (rows || []).flatMap((r) => r.copies.map((c) => ({ ...r, id: `copy:${c.id}`, copy: c, copies: [c], listingRowId: r.id })));
}

/** "Hide empty": a listing with nothing left to sell (sold out or ended). */
export const isEmptyRow = (r) => r.forSale === 0;

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The rows on screen as a CSV: one line per copy, so every SKU is in it. */
export function inventoryCsv(rows) {
  const head = ["SKU", "Pile", "Position", "State", "Card", "Set", "Number", "Condition", "Language", "Subtype", "Price", "Market", "eBay item", "Listing status", "Added"];
  const lines = [head.join(",")];
  for (const r of rows || []) {
    for (const c of r.copies || []) {
      lines.push([
        c.sku, c.pile, c.position ?? "", c.state, r.name || r.title, r.set, r.number, r.condition, r.language, r.subtype,
        r.pricePence == null ? "" : (r.pricePence / 100).toFixed(2), r.marketPence == null ? "" : (r.marketPence / 100).toFixed(2),
        r.itemId || "", r.status, r.addedAt || ""
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n");
}

/**
 * Costs for the copies of some listings (Inventory → Cost): { copyId, sku,
 * pence } per copy. "each" puts one figure on every copy; "lot" shares a sum
 * by what each card is priced at (card-costs.js splitLotCost). A copy that
 * already has a cost keeps it unless `overwrite` — a sold copy's cost is what
 * its sale is measured against, and a later lot should not rewrite it.
 */
export function costPlan(rows, { mode = "each", pence = null, overwrite = false } = {}) {
  if (!Number.isInteger(pence) || pence < 0) return [];
  const target = (rows || [])
    .map((r) => ({ r, copies: (r.copies || []).filter((c) => overwrite || c.cost_pence == null) }))
    .filter((x) => x.copies.length);
  const each = mode === "lot"
    ? splitLotCost(target.map((x) => ({ id: x.r.id, copies: x.copies.length, weight: x.r.pricePence ?? x.r.marketPence ?? 0 })), pence)
    : null;
  return target.flatMap((x) => x.copies.map((c) => ({ copyId: c.id, sku: c.sku, pence: each ? each.get(String(x.r.id)) : pence })));
}
