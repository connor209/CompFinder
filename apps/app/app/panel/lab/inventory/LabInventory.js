"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import LabHeader, { LAB_HEADER_CSS } from "../LabHeader";
import {
  inventoryRows, filterRows, sortRows, pageOf, actionable, parsePence, pricePlan, templatePlan,
  copyRows, isEmptyRow, inventoryCsv, EMPTY_FILTERS, STATUSES, PAGE_SIZES, SORT_FIELDS,
  facetCounts, viewTotals, columnsFor, activeChips, marketGap, cmGap, VS_MARKET, VS_CM, ADDED, gameOf, whereOf, whereText, costPlan
} from "@/lib/lab-inventory.js";
import { parseCostPence } from "@/lib/card-costs.js";
import { duplicateListings, isLinked } from "@/lib/card-identity.js";
import { removeBlocker } from "@/lib/lab-copies.js";
import { LAB_TABLE_CSS as CSS } from "../labTableCss";

/**
 * The lab's inventory, laid out like CardUploader's: totals in the header, one
 * toolbar, a dense table with ×N copies folding open, and a ⋮ per row. Rules
 * in lib/lab-inventory.js; every bulk action acts on rows ticked AND on
 * screen, and is planned again on the server before anything reaches eBay.
 */

const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const gbpBig = (p) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LABEL = { live: "Live", soldout: "Sold out", ended: "Ended" };
const STATE_LABEL = { next: "Next to sell", queued: "Queued", sold: "Sold · to pick", picked: "Picked" };
/** The screen's own choices, remembered on this device: filters, sort, view, page size. */
const VIEW_KEY = "cf-lab-inventory-view-v1";
function loadView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "null") || {}; } catch { return {}; }
}

function ago(iso) {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

export default function LabInventory() {
  const [lab, setLab] = useState(null);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [sortField, setSortField] = useState("added");
  const [sortDir, setSortDir] = useState("desc");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [grouped, setGrouped] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewLoaded, setViewLoaded] = useState(false);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(() => new Set());
  const [ticked, setTicked] = useState(() => new Set());
  const [panel, setPanel] = useState(null); // null | "filter" | "price" | "template"
  const [menu, setMenu] = useState(null); // row id with its ⋮ menu open
  const [priceMode, setPriceMode] = useState("exact");
  const [priceText, setPriceText] = useState("");
  const [costMode, setCostMode] = useState("each");
  const [costText, setCostText] = useState("");
  const [costOverwrite, setCostOverwrite] = useState(false);
  const [tplTitle, setTplTitle] = useState(true);
  const [tplDesc, setTplDesc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [failures, setFailures] = useState([]);
  const q = useDeferredValue(f.q);
  const menuRef = useRef(null);

  const reload = useCallback(async () => setLab(await api()), []);
  useEffect(() => { reload(); }, [reload]);
  // Remembered between visits on this device — the search box is not.
  useEffect(() => {
    const v = loadView();
    if (v.f) setF({ ...EMPTY_FILTERS, ...v.f, q: "" });
    if (v.sortField && SORT_FIELDS.some(([k]) => k === v.sortField)) setSortField(v.sortField);
    if (v.sortDir === "asc" || v.sortDir === "desc") setSortDir(v.sortDir);
    if (typeof v.hideEmpty === "boolean") setHideEmpty(v.hideEmpty);
    if (typeof v.grouped === "boolean") setGrouped(v.grouped);
    if (PAGE_SIZES.includes(v.pageSize)) setPageSize(v.pageSize);
    setViewLoaded(true);
  }, []);
  useEffect(() => {
    if (!viewLoaded) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ f: { ...f, q: "" }, sortField, sortDir, hideEmpty, grouped, pageSize })); } catch { /* blocked: nothing remembered */ }
  }, [viewLoaded, f, sortField, sortDir, hideEmpty, grouped, pageSize]);
  // "/" puts you in the search box, as it does on most tables.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || /^(input|textarea|select)$/i.test(e.target?.tagName || "")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  // Cardmarket's price guide for each listing's card, read from what the
  // nightly job stored — reference only, beside the sold-comps market.
  const [cm, setCm] = useState({ byId: {}, rate: null, error: null, loading: false, matched: 0, asked: 0 });
  useEffect(() => {
    if (!lab?.ok) return;
    // A listing whose copies are linked to their Cardmarket product sends the
    // product (card-identity.js) and is not matched again by name.
    const productOf = new Map();
    for (const c of lab.copies || []) if (c.cardmarket_id != null && !productOf.has(String(c.listing_id))) productOf.set(String(c.listing_id), c.cardmarket_id);
    const cards = (lab.listings || []).filter((l) => l.card?.set || productOf.has(String(l.id))).map((l) => ({ id: l.id, name: l.card?.name, number: l.card?.number, set: l.card?.set, finish: l.card?.finish || "", title: l.title, cardmarketId: productOf.get(String(l.id)) ?? undefined }));
    if (!cards.length) { setCm((x) => ({ ...x, error: "No listing has its card's set stored, so there is nothing to look up." })); return; }
    let gone = false;
    setCm((x) => ({ ...x, loading: true, error: null }));
    (async () => {
      const byId = {};
      let rate = null;
      let error = null;
      for (let i = 0; i < cards.length; i += 400) {
        try {
          const res = await fetch("/api/cardmarket/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards: cards.slice(i, i + 400) }) });
          const j = await res.json().catch(() => ({ ok: false, error: `the server answered ${res.status}` }));
          if (j.ok) { Object.assign(byId, j.results || {}); rate = { rate: j.rate, asOf: j.rateAsOf, fallback: j.rateFallback }; }
          else error = j.error || `the server answered ${res.status}`;
        } catch (e) { error = e.message || "the request failed"; }
      }
      const matched = Object.values(byId).filter((r) => r.pence != null).length;
      if (!gone) setCm({ byId, rate, error, loading: false, matched, asked: cards.length });
    })();
    return () => { gone = true; };
  }, [lab]);
  const all = useMemo(() => (lab?.ok ? inventoryRows(lab.listings, lab.copies).map((r) => (cm.byId[r.id] ? { ...r, cm: cm.byId[r.id] } : r)) : []), [lab, cm]);
  const matched = useMemo(() => {
    let rows = filterRows(all, { ...f, q });
    if (hideEmpty) rows = rows.filter((r) => !isEmptyRow(r));
    rows = sortRows(rows, `${sortField}-${sortDir}`);
    return grouped ? rows : copyRows(rows);
  }, [all, f, q, hideEmpty, grouped, sortField, sortDir]);
  const view = pageOf(matched, page, pageSize);
  // Each dropdown's counts are over the rows every OTHER filter allows, so a
  // count says exactly what picking that option would show.
  const base = useMemo(() => (hideEmpty ? all.filter((r) => !isEmptyRow(r)) : all), [all, hideEmpty]);
  const fc = useMemo(() => {
    const without = (keys) => filterRows(base, { ...f, q, ...Object.fromEntries(keys.map((k) => [k, EMPTY_FILTERS[k]])) });
    return {
      sets: facetCounts(without(["set"])).sets,
      conditions: facetCounts(without(["condition"])).conditions,
      piles: facetCounts(without(["pile"])).piles,
      languages: facetCounts(without(["language"])).languages,
      subtypes: facetCounts(without(["subtype"])).subtypes,
      games: facetCounts(without(["game"])).games,
      vsMarket: Object.fromEntries(facetCounts(without(["vsMarket"])).vsMarket),
      vsCm: Object.fromEntries(facetCounts(without(["vsCm"])).vsCm)
    };
  }, [base, f, q]);
  // The CM column is always there once the lab has loaded: an empty column
  // with a reason says more than a column that silently isn't drawn.
  const cols = useMemo(() => ({ ...columnsFor(all), cm: true }), [all]);
  // The same card in the same condition live on two listings: the copies
  // belong on one (card-identity.js). And how many cards aren't linked yet.
  const dups = useMemo(() => duplicateListings(all), [all]);
  const unlinked = useMemo(() => all.filter((r) => r.status !== "ended" && !isLinked(r.identity)).length, [all]);
  const chips = activeChips(f);
  const vt = useMemo(() => viewTotals(grouped ? matched : [...new Map(matched.map((r) => [r.listingRowId, all.find((a) => a.id === r.listingRowId)])).values()].filter(Boolean)), [matched, grouped, all]);
  // Bulk actions are on LISTINGS, and only in grouped view: a copy row stands
  // for one card, and "end listing" from a ticked copy would end its siblings.
  const onScreen = grouped ? actionable(ticked, view.rows) : [];
  const hiddenTicks = grouped ? ticked.size - onScreen.length : 0;
  const settings = lab?.listingSettings || null;
  const settingsSaved = Boolean(lab?.listingSettingsSaved);

  useEffect(() => { setPage(1); }, [q, f, sortField, sortDir, hideEmpty, grouped, pageSize]);

  const totals = useMemo(() => {
    const live = all.filter((r) => r.status !== "ended");
    return {
      products: live.length,
      cards: live.reduce((t, r) => t + r.forSale, 0),
      waiting: all.reduce((t, r) => t + r.waiting, 0),
      price: live.reduce((t, r) => t + (r.pricePence == null ? 0 : r.pricePence * r.forSale), 0),
      market: live.reduce((t, r) => t + (r.marketPence == null ? 0 : r.marketPence * r.forSale), 0),
      unmarketed: live.filter((r) => r.marketPence == null && r.forSale > 0).length
    };
  }, [all]);

  const pPlan = useMemo(() => (panel === "price" ? pricePlan(onScreen, { mode: priceMode, pence: parsePence(priceText) }) : []), [panel, onScreen, priceMode, priceText]);
  const tPlan = useMemo(() => (panel === "template" && settings ? templatePlan(onScreen, settings, { title: tplTitle, description: tplDesc }) : []), [panel, onScreen, settings, tplTitle, tplDesc]);
  const pGo = pPlan.filter((p) => !p.skip);
  const cPlan = useMemo(() => (panel === "cost" ? costPlan(onScreen, { mode: costMode, pence: parseCostPence(costText), overwrite: costOverwrite }) : []), [panel, onScreen, costMode, costText, costOverwrite]);
  const tGo = tPlan.filter((p) => !p.skip);

  const setFilter = (patch) => setF((x) => ({ ...x, ...patch }));
  const tick = (id, on) => setTicked((t) => { const n = new Set(t); if (on) n.add(String(id)); else n.delete(String(id)); return n; });
  const toggleOpen = (id) => setOpen((o) => { const n = new Set(o); if (n.has(String(id))) n.delete(String(id)); else n.add(String(id)); return n; });
  const allOnPage = grouped && view.rows.length > 0 && view.rows.every((r) => ticked.has(String(r.id)));
  const activeFilters = chips.length;
  // Clicking a column heading sorts by it; clicking it again turns it round.
  const sortBy = (field, firstDir = "asc") => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir(firstDir); }
  };
  const Th = ({ field, children, className = "", firstDir = "asc", title }) => (
    <th className={`${className} li-sortable ${sortField === field ? "on" : ""}`} aria-sort={sortField === field ? (sortDir === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <button onClick={() => sortBy(field, firstDir)}>{children}<span className="li-arrow">{sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span></button>
    </th>
  );
  const ncols = 12 + (cols.variant ? 1 : 0) + (cols.tcg ? 1 : 0) + (cols.cm ? 2 : 0);

  function finish(r, verb) {
    if (!r.ok) { setMsg({ bad: true, text: r.error || "That didn't work." }); return; }
    const bad = (r.results || []).filter((x) => !x.ok && !x.skipped);
    setFailures(bad.map((x) => ({ title: all.find((a) => String(a.id) === String(x.listingId))?.title || x.listingId, error: x.error })));
    const skipped = r.skipped ? `, ${r.skipped} skipped` : "";
    setMsg(bad.length ? { bad: true, text: `${r.changed} ${verb}${skipped}, ${bad.length} failed — see below.` } : { text: `${r.changed} ${verb}${skipped}.` });
    setPanel(null);
    setTicked(new Set());
    reload();
  }

  async function run(body, verb, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    setFailures([]);
    const r = await api(body);
    setBusy(false);
    finish(r, verb);
  }

  const listLines = (items, fmt) => items.slice(0, 8).map(fmt).join("\n") + (items.length > 8 ? `\n…and ${items.length - 8} more` : "");

  function applyPrices() {
    if (!pGo.length) return;
    run({ action: "setPrices", changes: pGo.map((p) => ({ listingId: p.row.id, pence: p.to })) }, "repriced",
      `Change ${pGo.length} price${pGo.length === 1 ? "" : "s"} on eBay?\n\n${listLines(pGo, (p) => `${p.row.title}: ${gbp(p.from)} → ${gbp(p.to)}`)}`);
  }

  /** What the copies cost us — saved on each card, not on eBay (card-costs.js). */
  async function saveCosts(costs, label) {
    if (!costs.length) return;
    setBusy(true);
    setMsg(null);
    const r = await api({ action: "setCosts", costs: costs.map((c) => ({ copyId: c.copyId, pence: c.pence })) });
    setBusy(false);
    setMsg(r.ok ? { text: `${label} — ${r.saved} cop${r.saved === 1 ? "y" : "ies"}.` } : { bad: true, text: r.error || "Costs weren't saved." });
    if (r.ok) { setPanel(null); setTicked(new Set()); reload(); }
  }

  /** Link every unlinked card to its Cardmarket product — once, then kept. */
  async function linkCards() {
    setBusy(true);
    setMsg(null);
    const r = await api({ action: "linkCatalog" });
    setBusy(false);
    if (!r.ok) { setMsg({ bad: true, text: r.error || "Linking failed." }); return; }
    const un = r.unmatched || [];
    setFailures(un.map((x) => ({ title: x.title, error: `not linked — ${x.why}` })));
    setMsg({ bad: un.length > 0, text: `${r.linked} card${r.linked === 1 ? "" : "s"} linked to the catalogue${un.length ? `, ${un.length} listing${un.length === 1 ? "" : "s"} couldn't be pinned to one product (below)` : ""}.` });
    reload();
  }

  function editCopyCost(c) {
    const typed = window.prompt(`What did ${c.sku} cost you? (blank to clear)`, c.cost_pence != null ? (c.cost_pence / 100).toFixed(2) : "");
    if (typed == null) return;
    const pence = typed.trim() === "" ? null : parseCostPence(typed);
    if (typed.trim() !== "" && pence == null) { setMsg({ bad: true, text: `"${typed}" isn't an amount.` }); return; }
    saveCosts([{ copyId: c.id, pence }], pence == null ? `${c.sku}'s cost cleared` : `${c.sku} cost ${gbp(pence)}`);
  }

  function applyTemplates() {
    if (!tGo.length) return;
    run({ action: "applyTemplate", listingIds: tGo.map((p) => p.row.id), title: tplTitle, description: tplDesc }, "rewritten",
      `Rewrite ${tGo.length} live listing${tGo.length === 1 ? "" : "s"} on eBay from your saved templates?\n\n` +
      `${[tplTitle && "Titles", tplDesc && "descriptions"].filter(Boolean).join(" and ")} will change. Pictures, prices and quantities won't.`);
  }

  function endRows(rows) {
    const live = rows.filter((r) => r.status !== "ended");
    if (!live.length) return;
    run({ action: "endMany", listingIds: live.map((x) => x.id) }, "ended",
      `End ${live.length} listing${live.length === 1 ? "" : "s"} on eBay?\n\n${listLines(live, (r) => r.title)}\n\nCopies not yet sold stay in their piles.`);
  }

  async function removeCopy(row, c) {
    if (!window.confirm(`Take ${c.sku} off "${row.title}"?\n\neBay quantity ${row.forSale} → ${row.forSale - 1}.\n\nThe card is still in its pile — take it out once this is done.`)) return;
    setBusy(true);
    const r = await api({ action: "remove", copyId: c.id });
    setBusy(false);
    setMsg(r.ok ? { text: `${r.sku} removed: eBay quantity ${r.from} → ${r.to}. Take it out of pile ${c.pile}.` } : { bad: true, text: r.error });
    reload();
  }

  async function releaseCopy(c) {
    if (!window.confirm(`Release ${c.sku}?\n\nOnly for a CANCELLED order (${c.reserved_order || "?"}). The copy goes back into its listing's queue and off the pull sheet.`)) return;
    setBusy(true);
    const r = await api({ action: "release", copyId: c.id });
    setBusy(false);
    setMsg(r.ok ? { text: `${c.sku} released — back in its queue.` } : { bad: true, text: r.error });
    reload();
  }

  function exportCsv() {
    const listings = grouped ? matched : [...new Map(matched.map((r) => [r.listingRowId, all.find((a) => a.id === r.listingRowId)])).values()].filter(Boolean);
    const blob = new Blob([inventoryCsv(listings)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lab-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!lab) return <main className="li-wrap">Loading the inventory…</main>;
  if (!lab.ok) return <main className="li-wrap">{lab.missing ? "Run migration 039 first." : lab.needsMove || lab.foldPending ? <>{lab.error} <a href="/panel/lab">Open the lab</a></> : `Couldn't load: ${lab.error}`}</main>;

  const Pager = () => (
    <span className="li-pager">
      <button className="li-icon" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} aria-label="Previous page">‹</button>
      Page {view.page} of {view.pages}
      <button className="li-icon" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} aria-label="Next page">›</button>
      <select className="li-select li-small" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows a page">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n ? `${n} a page` : "All"}</option>)}
      </select>
    </span>
  );

  return (
    <main className="li-wrap">
      <style>{CSS + INV_CSS + LAB_HEADER_CSS}</style>
      <LabHeader current="inventory" />

      {/* ---------------- Header ---------------- */}
      <div className="li-head">
        <div className="li-title">
          <h1>Inventory</h1>
          <span className="li-totals">
            {totals.products.toLocaleString("en-GB")} product{totals.products === 1 ? "" : "s"} · {totals.cards.toLocaleString("en-GB")} card{totals.cards === 1 ? "" : "s"}
            <span>Price <b>{gbpBig(totals.price)}</b></span>
            <span title={totals.unmarketed ? `${totals.unmarketed} listing${totals.unmarketed === 1 ? "" : "s"} with no sold-comps price aren't counted` : undefined}>
              Market <b>{gbpBig(totals.market)}</b>{totals.unmarketed ? "*" : ""}
            </span>
            {totals.waiting > 0 && <span className="li-warn">{totals.waiting} to pick</span>}
            {unlinked > 0 && <button className="li-link" disabled={busy} onClick={linkCards} title="Match each card to its Cardmarket product once and keep it, so prices and duplicates are read off the product rather than re-matched by name">🔗 {unlinked} not linked to the catalogue — link</button>}
            {dups.size > 0 && <span className="li-warn" title="The same card in the same condition is live on more than one listing — its copies belong on one">⚠ {dups.size} listings share a card</span>}
          </span>
        </div>
        <div className="li-headbtns">
          <button className="li-btn" onClick={exportCsv} disabled={!matched.length}>Export CSV</button>
        </div>
      </div>

      {/* ---------------- Toolbar ---------------- */}
      <div className="li-toolbar">
        <input ref={searchRef} className="li-search" placeholder="Search name, set, number, SKU, eBay item…  ( / )" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
        {fc.sets.length > 1 && (
          <select className="li-select" value={f.set} onChange={(e) => setFilter({ set: e.target.value })} aria-label="Set">
            <option value="">Set: All</option>
            {fc.sets.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
          </select>
        )}
        <select className="li-select" value={f.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="">Status: All</option>
          {STATUSES.map(([k, l]) => <option key={k} value={k}>Status: {l}</option>)}
        </select>
        <button className={`li-select ${panel === "filter" ? "on" : ""}`} onClick={() => setPanel(panel === "filter" ? null : "filter")}>
          Filter{activeFilters ? ` (${activeFilters})` : ""} ▾
        </button>
        <span className="li-spacer" />
        <span className="li-seg">
          <button className={hideEmpty ? "on" : ""} onClick={() => setHideEmpty(true)}>Hide empty</button>
          <button className={!hideEmpty ? "on" : ""} onClick={() => setHideEmpty(false)}>Show empty</button>
        </span>
        <span className="li-seg">
          <button className={grouped ? "on" : ""} onClick={() => setGrouped(true)}>Grouped</button>
          <button className={!grouped ? "on" : ""} onClick={() => setGrouped(false)}>All copies</button>
        </span>
        <select className="li-select" value={sortField} onChange={(e) => setSortField(e.target.value)}>
          {SORT_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="li-icon li-boxed" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} aria-label="Sort direction">{sortDir === "asc" ? "↑" : "↓"}</button>
      </div>

      {panel === "filter" && (
        <div className="li-panel li-filters">
          {fc.conditions.length > 0 && (
            <label>Condition
              <select value={f.condition} onChange={(e) => setFilter({ condition: e.target.value })}>
                <option value="">Any</option>{fc.conditions.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </label>
          )}
          {fc.piles.length > 0 && (
            <label>Pile
              <select value={f.pile} onChange={(e) => setFilter({ pile: e.target.value })}>
                <option value="">Any</option>{fc.piles.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </label>
          )}
          {fc.languages.length > 0 && (
            <label>Language
              <select value={f.language} onChange={(e) => setFilter({ language: e.target.value })}>
                <option value="">Any</option>{fc.languages.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </label>
          )}
          {fc.games.length > 1 && (
            <label>TCG
              <select value={f.game} onChange={(e) => setFilter({ game: e.target.value })}>
                <option value="">Any</option>{fc.games.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </label>
          )}
          {fc.subtypes.length > 0 && (
            <label>Subtype
              <select value={f.subtype} onChange={(e) => setFilter({ subtype: e.target.value })}>
                <option value="">Any</option>{fc.subtypes.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            </label>
          )}
          <label>Price
            <span className="li-range">
              <input className="li-num" inputMode="decimal" placeholder="£ min" value={f.minPrice} onChange={(e) => setFilter({ minPrice: e.target.value })} />
              <span>–</span>
              <input className="li-num" inputMode="decimal" placeholder="£ max" value={f.maxPrice} onChange={(e) => setFilter({ maxPrice: e.target.value })} />
            </span>
          </label>
          <label>vs market
            <select value={f.vsMarket} onChange={(e) => setFilter({ vsMarket: e.target.value })}>
              <option value="">Any</option>
              {VS_MARKET.map(([k, l]) => <option key={k} value={k}>{l} ({fc.vsMarket[k] || 0})</option>)}
            </select>
          </label>
          {cols.cm && (
            <label>vs Cardmarket
              <select value={f.vsCm} onChange={(e) => setFilter({ vsCm: e.target.value })}>
                <option value="">Any</option>
                {VS_CM.map(([k, l]) => <option key={k} value={k}>{l} ({fc.vsCm[k] || 0})</option>)}
              </select>
            </label>
          )}
          <label>Added
            <select value={f.added} onChange={(e) => setFilter({ added: e.target.value })}>
              <option value="">Any time</option>
              {ADDED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="li-check"><input type="checkbox" checked={f.multi} onChange={(e) => setFilter({ multi: e.target.checked })} /> 2+ copies</label>
          <label className="li-check"><input type="checkbox" checked={f.waiting} onChange={(e) => setFilter({ waiting: e.target.checked })} /> Sold, waiting to be picked</label>
        </div>
      )}

      {chips.length > 0 && (
        <div className="li-chips">
          {chips.map((c) => <button key={c.key} className="li-fchip" onClick={() => setFilter(c.clear)} title="Remove this filter">{c.text} ✕</button>)}
          <button className="li-link" onClick={() => setF({ ...EMPTY_FILTERS, q: f.q })}>Clear all</button>
        </div>
      )}

      {cm.loading && <div className="li-msg">Looking up Cardmarket prices…</div>}
      {!cm.loading && cm.error && <div className="li-msg bad">Cardmarket prices couldn&apos;t be read: {cm.error}</div>}
      {!cm.loading && !cm.error && cm.asked > 0 && cm.matched === 0 && <div className="li-msg bad">No card matched a Cardmarket price ({cm.asked} looked up). Hover a — in the CM column to see why.</div>}
      {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}
      {failures.map((x, i) => <div key={i} className="li-msg bad">✗ {x.title} — {x.error}</div>)}

      {/* ---------------- The table ---------------- */}
      <div className="li-card">
        <div className="li-bulk">
          {grouped ? (
            <>
              <button className="li-chip" disabled={!onScreen.length || busy} onClick={() => setPanel(panel === "price" ? null : "price")}>Price ▾</button>
              <button className="li-chip" disabled={!onScreen.length || busy} onClick={() => setPanel(panel === "template" ? null : "template")}>Apply template ▾</button>
              <button className="li-chip" disabled={!onScreen.length || busy} onClick={() => setPanel(panel === "cost" ? null : "cost")}>Cost ▾</button>
              <button className="li-chip danger" disabled={!onScreen.length || busy} onClick={() => endRows(onScreen)}>End listings</button>
              <span className="li-dim">{onScreen.length ? `${onScreen.length} ticked` : "Tick rows to act on them"}</span>
              {hiddenTicks > 0 && <span className="li-warn">{hiddenTicks} ticked off screen — not acted on <button className="li-link" onClick={() => setTicked(new Set())}>untick</button></span>}
            </>
          ) : <span className="li-dim">One row per copy. Switch to Grouped to change listings.</span>}
          <span className="li-spacer" />
          <span className="li-dim li-viewtot" title="What the rows matching your search and filters add up to, across every page">
            {view.total.toLocaleString("en-GB")} {grouped ? "listing" : "cop"}{grouped ? (view.total === 1 ? "" : "s") : view.total === 1 ? "y" : "ies"}
            {grouped && <> · {vt.copies} for sale · <b>{gbpBig(vt.price)}</b> at price · {gbpBig(vt.market)} at market{vt.unmarketed ? "*" : ""}{cols.cm ? <> · {gbpBig(vt.cm)} at Cardmarket{vt.uncm ? "*" : ""}</> : null}{vt.cost ? <span title={`What the copies for sale cost you, over the ${vt.copies - vt.uncosted} that carry a cost${vt.uncosted ? ` — ${vt.uncosted} have none and aren't counted` : ""}. Margin is their price less their cost, before fees and postage.`}> · cost {gbpBig(vt.cost)}{vt.uncosted ? "*" : ""} · margin {gbpBig(vt.margin)}</span> : null}</>}
          </span>
          <Pager />
        </div>

        {panel === "price" && (
          <div className="li-panel inset">
            <label className="li-check"><input type="radio" checked={priceMode === "exact"} onChange={() => setPriceMode("exact")} /> One price for all</label>
            {priceMode === "exact" && <input className="li-num" inputMode="decimal" placeholder="£" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
            <label className="li-check"><input type="radio" checked={priceMode === "market"} onChange={() => setPriceMode("market")} /> Each card&apos;s sold-comps price</label>
            <div className="li-plan">
              {pPlan.map((p) => <div key={p.row.id} className={p.skip ? "skip" : ""}>{p.row.title}: {p.skip ? `skipped — ${p.skip}` : `${gbp(p.from)} → ${gbp(p.to)}`}</div>)}
            </div>
            <button className="li-btn primary" disabled={busy || !pGo.length} onClick={applyPrices}>{busy ? "Changing…" : `Change ${pGo.length} on eBay`}</button>
          </div>
        )}

        {panel === "cost" && (
          <div className="li-panel inset">
            <label className="li-check"><input type="radio" checked={costMode === "each"} onChange={() => setCostMode("each")} /> Each copy cost</label>
            <label className="li-check"><input type="radio" checked={costMode === "lot"} onChange={() => setCostMode("lot")} /> The lot cost, split by price</label>
            <input className="li-num" inputMode="decimal" placeholder="£" value={costText} onChange={(e) => setCostText(e.target.value)} />
            <label className="li-check"><input type="checkbox" checked={costOverwrite} onChange={(e) => setCostOverwrite(e.target.checked)} /> replace costs already set</label>
            <span className="li-dim" style={{ flexBasis: "100%" }}>
              Saved on each card (sold and picked ones too, so their sales can say what they made) — nothing changes on eBay. {costOverwrite ? "" : "Copies that already have a cost keep it."}
            </span>
            <div className="li-plan">
              {cPlan.slice(0, 40).map((p) => <div key={p.copyId}>{p.sku}: {gbp(p.pence)}</div>)}
              {cPlan.length > 40 ? <div className="skip">…and {cPlan.length - 40} more</div> : null}
            </div>
            <button className="li-btn primary" disabled={busy || !cPlan.length} onClick={() => saveCosts(cPlan, costMode === "lot" ? `${gbp(parseCostPence(costText))} split over the lot` : `Cost set to ${gbp(parseCostPence(costText))} a copy`)}>{busy ? "Saving…" : `Save ${cPlan.length} cost${cPlan.length === 1 ? "" : "s"}`}</button>
          </div>
        )}

        {panel === "template" && (
          <div className="li-panel inset">
            {!settingsSaved ? (
              <span className="li-warn">No listing settings saved yet. <a href="/panel/lab/settings">Save them first</a>.</span>
            ) : (
              <>
                <label className="li-check"><input type="checkbox" checked={tplTitle} onChange={(e) => setTplTitle(e.target.checked)} /> Titles</label>
                <label className="li-check"><input type="checkbox" checked={tplDesc} onChange={(e) => setTplDesc(e.target.checked)} /> Descriptions</label>
                <span className="li-dim">From your saved settings. Pictures, prices and quantities aren&apos;t touched.</span>
                <div className="li-plan">
                  {tPlan.map((p) => (
                    <div key={p.row.id} className={p.skip ? "skip" : ""}>
                      {p.skip ? `${p.row.title}: skipped — ${p.skip}` : (
                        <>
                          {p.titleChanges ? <><s>{p.fromTitle}</s> → <b>{p.toTitle}</b>{p.titleCut ? <span className="li-warn"> (cut at 80)</span> : null}</> : <>{p.fromTitle} <span className="li-dim">(title unchanged)</span></>}
                          {p.descriptionHtml ? <span className="li-dim"> · description rewritten</span> : null}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {tGo[0]?.descriptionHtml && (
                  <details>
                    <summary className="li-dim">Description, as the first one will read</summary>
                    <iframe title="Description" sandbox="" className="li-frame"
                      srcDoc={`<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;font-size:14px;color:#111;padding:12px">${tGo[0].descriptionHtml}</body>`} />
                  </details>
                )}
                <button className="li-btn primary" disabled={busy || !tGo.length} onClick={applyTemplates}>{busy ? "Rewriting…" : `Rewrite ${tGo.length} on eBay`}</button>
              </>
            )}
          </div>
        )}

        <div className="li-scroll">
          <table className="li-table">
            <thead>
              <tr>
                <th className="li-cb">{grouped && <input type="checkbox" checked={allOnPage} aria-label="Tick this page" onChange={(e) => setTicked((t) => { const n = new Set(t); for (const r of view.rows) { if (e.target.checked) n.add(String(r.id)); else n.delete(String(r.id)); } return n; })} />}</th>
                <Th field="name">Card</Th>
                <th className="sm-hide">Status</th>
                <Th field="where" title="Each copy's stack and its live position there — the number you count to, which closes up as cards are pulled. Click to sort in walk order.">SKU · where</Th>
                <th className="sm-hide">eBay item</th>
                <Th field="condition">Cond.</Th>
                {cols.variant && <th className="sm-hide">Variant</th>}
                {cols.tcg && <th className="sm-hide">TCG</th>}
                <Th field="price" className="r" firstDir="desc">Price</Th>
                <Th field="market" className="r sm-hide" firstDir="desc">Market</Th>
                <Th field="gappct" className="r sm-hide" title="Your price against the sold-comps figure. Red: under market. Click to sort.">vs mkt</Th>
                <Th field="cost" className="r sm-hide" title="What each copy for sale cost you (the average, where copies differ). * where some copies have no cost.">Cost</Th>
                {cols.cm && <Th field="cm" className="r sm-hide" firstDir="desc" title={`Cardmarket's trend in pounds, from today's price guide${cm.rate ? ` at £${Number(cm.rate.rate).toFixed(4)}/€${cm.rate.fallback ? " (approximate — no ECB rate stored yet)" : cm.rate.asOf ? ` (ECB ${cm.rate.asOf})` : ""}` : ""}`}>CM</Th>}
                {cols.cm && <Th field="cmgap" className="r sm-hide" title="Your price against Cardmarket's trend. Red: under Cardmarket.">vs CM</Th>}
                <Th field="forsale" className="r" firstDir="desc">Qty</Th>
                <Th field="added" className="sm-hide" firstDir="desc">Added</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.rows.length === 0 && (
                <tr><td colSpan={ncols} className="li-empty">{all.length ? <>Nothing matches. {chips.length > 0 && <button className="li-link" onClick={() => setF({ ...EMPTY_FILTERS })}>Clear the search and filters</button>}</> : "No lab listings yet."}</td></tr>
              )}
              {view.rows.map((r) => {
                const c1 = grouped ? null : r.copy;
                const many = grouped && r.copies.length > 1;
                const isOpen = open.has(String(r.id));
                const pic = c1 ? c1.scan_urls?.[0] : r.picture;
                const variant = r.listing?.card?.finish || "—";
                const tcg = gameOf(r) || "—";
                const gap = marketGap(r);
                return (
                  <Fragment key={r.id}>
                  <tr className={r.status === "ended" ? "ended" : ""}>
                    <td className="li-cb">
                      {grouped && <input type="checkbox" checked={ticked.has(String(r.id))} aria-label={`Tick ${r.title}`} onChange={(e) => tick(r.id, e.target.checked)} />}
                    </td>
                    <td>
                      <div className="li-cardcell">
                        {many ? <button className="li-icon" onClick={() => toggleOpen(r.id)} aria-label={isOpen ? "Fold copies" : "Show copies"}>{isOpen ? "▾" : "▸"}</button> : <span className="li-iconpad" />}
                        <span className="li-thumb">
                          {pic ? <img src={pic} alt="" referrerPolicy="no-referrer" /> : null}
                          {!c1 && r.pictureIsDb && <i title="The card's database image, not a photo of one of your copies">stock</i>}
                        </span>
                        <span>
                          <b>{r.name || r.title}</b>
                          <small>{[r.set, r.number, r.subtype].filter(Boolean).join(" · ")}</small>
                          {(() => {
                            const others = dups.get(grouped ? r.id : r.listingRowId);
                            if (!others || !others.length) return null;
                            const names = others.map((id) => all.find((x) => x.id === id)).filter(Boolean).map((x) => `eBay ${x.itemId || "?"}`).join(", ");
                            return <small className="li-warn" title="The same card in the same condition is live on another listing — its copies belong on one listing">⚠ also listed: {names}</small>;
                          })()}
                          <span className={`li-status sm-only s-${c1 ? c1.state : r.status}`}>{c1 ? (c1.onShow ? "On eBay now" : STATE_LABEL[c1.state]) : `${many ? `×${r.copies.length} ` : ""}${STATUS_LABEL[r.status]}`}</span>
                        </span>
                      </div>
                    </td>
                    <td className="sm-hide">
                      {c1 ? <span className={`li-status s-${c1.state}`}>{c1.onShow ? "On eBay now" : STATE_LABEL[c1.state]}</span>
                        : <span className={`li-status s-${r.status}`}>{many ? `×${r.copies.length} ` : ""}{STATUS_LABEL[r.status]}</span>}
                    </td>
                    <td className="mono">
                      {c1 ? <>{c1.sku}<small className="li-where">{c1.state === "picked" ? "picked" : `${c1.pile}${c1.position ? ` #${c1.position}` : ""}`}</small></>
                        : many ? (() => {
                          const ws = whereOf(r);
                          return <>
                            <button className="li-link mono" onClick={() => toggleOpen(r.id)}>×{r.copies.length} copies</button>
                            <small className="li-where" title={ws.map((w) => `${w.sku}: ${whereText(w)}${w.sold ? " (sold, to pick)" : ""}`).join("\n")}>
                              {ws.slice(0, 3).map(whereText).join(", ")}{ws.length > 3 ? ` +${ws.length - 3}` : ""}
                            </small>
                          </>;
                        })()
                        : (() => {
                          const w = whereOf(r)[0];
                          return <>{r.copies[0]?.sku || "—"}{w && <small className="li-where">{whereText(w)}{w.sold ? " · sold, to pick" : ""}</small>}</>;
                        })()}
                    </td>
                    <td className="mono sm-hide">{r.itemId ? <a href={`https://www.ebay.co.uk/itm/${r.itemId}`} target="_blank" rel="noreferrer">{r.itemId}</a> : "—"}</td>
                    <td><b>{r.condition}</b></td>
                    {cols.variant && <td className="sm-hide">{variant}</td>}
                    {cols.tcg && <td className="sm-hide">{tcg}</td>}
                    <td className="r price">{gbp(r.pricePence)}</td>
                    <td className="r sm-hide" title={r.marketAt ? `Sold comps, ${new Date(r.marketAt).toLocaleDateString("en-GB")}` : "No sold-comps price recorded"}>{gbp(r.marketPence)}</td>
                    <td className={`r sm-hide li-gap ${gap ? (Math.abs(gap.pct) <= 10 ? "even" : gap.pence < 0 ? "under" : "over") : ""}`}
                      title={gap ? `${gap.pence < 0 ? "Under" : "Over"} market by £${(Math.abs(gap.pence) / 100).toFixed(2)}` : "No market figure to compare"}>
                      {gap ? `${gap.pct > 0 ? "+" : ""}${gap.pct}%` : "—"}
                    </td>
                    <td className="r sm-hide" title={r.costPence != null ? `${r.costed} of ${r.forSale} for sale carry a cost${r.pricePence != null ? ` · price less cost £${((r.pricePence - r.costPence) / 100).toFixed(2)}` : ""}` : "No cost recorded — Cost ▾ to add one"}>
                      {c1 ? (c1.cost_pence != null ? gbp(c1.cost_pence) : "—") : r.costPence != null ? <>{gbp(r.costPence)}{r.costed < r.forSale ? "*" : ""}</> : "—"}
                    </td>
                    {cols.cm && (() => {
                      const c = r.cm;
                      const cg = cmGap(r);
                      const tip = c?.pence != null
                        ? [`Cardmarket ${c.reverse ? "reverse holo " : ""}trend €${c.eurTrend?.toFixed(2) ?? "?"}`, c.avg7Pence != null ? `7-day ${gbp(c.avg7Pence)}` : "", c.avg30Pence != null ? `30-day ${gbp(c.avg30Pence)}` : "", c.lowPence != null ? `low ${gbp(c.lowPence)}` : "", c.product ? `product: ${c.product}` : "", c.asOf ? `guide of ${c.asOf}` : ""].filter(Boolean).join(" · ")
                        : c?.why || "No Cardmarket figure";
                      return (
                        <>
                          <td className="r sm-hide" title={tip}>{c?.pence != null ? <>{gbp(c.pence)}{c.dir === "up" ? <span className="li-up"> ↑</span> : c.dir === "down" ? <span className="li-down"> ↓</span> : null}</> : "—"}</td>
                          <td className={`r sm-hide li-gap ${cg ? (Math.abs(cg.pct) <= 10 ? "even" : cg.pence < 0 ? "under" : "over") : ""}`}>{cg ? `${cg.pct > 0 ? "+" : ""}${cg.pct}%` : "—"}</td>
                        </>
                      );
                    })()}
                    <td className="r">
                      {c1 ? (c1.state === "next" || c1.state === "queued" ? 1 : 0) : r.forSale}
                      {!c1 && r.waiting > 0 && <small className="li-warn">{r.waiting} to pick</small>}
                    </td>
                    <td className="li-dim sm-hide">{ago(r.addedAt)}</td>
                    <td className="li-menucell">
                      <button className="li-icon li-boxed" onClick={() => setMenu(menu === r.id ? null : r.id)} aria-label="More">⋮</button>
                      {menu === r.id && (
                        <div className="li-menu" ref={menuRef}>
                          {r.itemId && <a href={`https://www.ebay.co.uk/itm/${r.itemId}`} target="_blank" rel="noreferrer">View on eBay</a>}
                          {grouped && r.status !== "ended" && <button onClick={() => { setMenu(null); setTicked(new Set([String(r.id)])); setPanel("price"); }}>Set price…</button>}
                          {grouped && r.status !== "ended" && <button onClick={() => { setMenu(null); setTicked(new Set([String(r.id)])); setPanel("template"); }}>Apply template…</button>}
                          {c1 && <button onClick={() => { setMenu(null); editCopyCost(c1); }}>£ Set cost…</button>}
                          {grouped && <button onClick={() => { setMenu(null); setTicked(new Set([String(r.id)])); setPanel("cost"); }}>£ Set cost…</button>}
                          {c1 && !removeBlocker(c1, r.listing, lab.copies) && <button onClick={() => { setMenu(null); removeCopy(r, c1); }}>✕ Remove this copy</button>}
                          {c1 && c1.state === "sold" && <button onClick={() => { setMenu(null); releaseCopy(c1); }}>Release (order cancelled)</button>}
                          {grouped && r.status !== "ended" && <button className="danger" onClick={() => { setMenu(null); endRows([r]); }}>End listing</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                  {many && isOpen ? r.copies.map((c) => (
                    <tr key={`${r.id}:${c.id}`} className={`li-sub ${c.state === "picked" ? "ended" : ""}`}>
                      <td />
                      <td>
                        <div className="li-cardcell">
                          <span className="li-iconpad" /><span className="li-iconpad" />
                          <a className="li-thumb" href={c.scan_urls?.[0] || "#"} target="_blank" rel="noreferrer">
                            {c.scan_urls?.[0] ? <img src={c.scan_urls[0]} alt="" referrerPolicy="no-referrer" className={c.onShow ? "onshow" : ""} /> : null}
                          </a>
                          <span className="li-dim">{c.state === "sold" && c.reserved_order ? `order ${c.reserved_order}` : ""}</span>
                        </div>
                      </td>
                      <td className="sm-hide"><span className={`li-status s-${c.state}`}>{c.onShow ? "On eBay now" : STATE_LABEL[c.state]}</span></td>
                      <td className="mono">{c.sku}<small className="li-where">{c.state === "picked" ? "picked" : `${c.pile}${c.position ? ` #${c.position}` : ""}`}</small></td>
                      <td className="sm-hide" /><td />{cols.variant && <td className="sm-hide" />}{cols.tcg && <td className="sm-hide" />}<td /><td className="sm-hide" /><td className="sm-hide" />
                      <td className="r sm-hide"><button className="li-link" disabled={busy} onClick={() => editCopyCost(c)} title="What this copy cost you">{c.cost_pence != null ? gbp(c.cost_pence) : "＋ cost"}</button></td>
                      {cols.cm && <><td className="sm-hide" /><td className="sm-hide" /></>}<td /><td className="sm-hide" />
                      <td className="li-menucell">
                        {!removeBlocker(c, r.listing, lab.copies) && <button className="li-chip" disabled={busy} onClick={() => removeCopy(r, c)}>✕ Remove</button>}
                        {c.state === "sold" && <button className="li-chip" disabled={busy} onClick={() => releaseCopy(c)} title="Only for a CANCELLED order: the copy goes back into its queue">Release</button>}
                      </td>
                    </tr>
                  )) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {view.pages > 1 && <div className="li-foot"><span className="li-dim">{view.total} in all</span><Pager /></div>}
      </div>
    </main>
  );
}

const INV_CSS = `
.li-sortable button { font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; background: none; border: 0; padding: 0; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
.li-sortable.r button { justify-content: flex-end; width: 100%; }
.li-sortable.on { color: var(--ink); }
.li-arrow { opacity: .35; font-size: 10px; }
.li-sortable.on .li-arrow { opacity: 1; color: var(--accent); }
.li-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
.li-fchip { font: inherit; font-size: 12px; border: 1px solid var(--accent); color: var(--accent); background: transparent; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.li-fchip:hover { background: var(--accent); color: var(--accent-ink, #000); }
.li-filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; }
.li-range { display: inline-flex; gap: 6px; align-items: center; }
.li-range .li-num { width: 74px; }
.li-small { padding: 3px 6px; font-size: 12px; margin-left: 8px; }
.li-gap { font-variant-numeric: tabular-nums; }
.li-gap.under { color: var(--bad); font-weight: 600; }
.li-gap.over { color: var(--good, #3fb68b); }
.li-gap.even { color: var(--ink-soft); }
.li-viewtot b { color: var(--ink); }
.li-where { color: var(--accent); font-weight: 600; }
.li-up { color: var(--good, #3fb68b); }
.li-down { color: var(--bad); }
`;
