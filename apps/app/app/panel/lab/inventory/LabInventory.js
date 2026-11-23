"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  inventoryRows, filterRows, sortRows, pageOf, facets, actionable, parsePence, pricePlan, templatePlan,
  copyRows, isEmptyRow, inventoryCsv, EMPTY_FILTERS, STATUSES, PAGE_SIZE
} from "@/lib/lab-inventory.js";
import { removeBlocker } from "@/lib/lab-copies.js";

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
const SORT_FIELDS = [["added", "Date added"], ["price", "Price"], ["name", "Name"], ["forsale", "Quantity"]];

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
  const [open, setOpen] = useState(() => new Set());
  const [ticked, setTicked] = useState(() => new Set());
  const [panel, setPanel] = useState(null); // null | "filter" | "price" | "template"
  const [menu, setMenu] = useState(null); // row id with its ⋮ menu open
  const [priceMode, setPriceMode] = useState("exact");
  const [priceText, setPriceText] = useState("");
  const [tplTitle, setTplTitle] = useState(true);
  const [tplDesc, setTplDesc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [failures, setFailures] = useState([]);
  const q = useDeferredValue(f.q);
  const menuRef = useRef(null);

  const reload = useCallback(async () => setLab(await api()), []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const all = useMemo(() => (lab?.ok ? inventoryRows(lab.listings, lab.copies) : []), [lab]);
  const matched = useMemo(() => {
    let rows = filterRows(all, { ...f, q });
    if (hideEmpty) rows = rows.filter((r) => !isEmptyRow(r));
    rows = sortRows(rows, `${sortField}-${sortDir}`);
    return grouped ? rows : copyRows(rows);
  }, [all, f, q, hideEmpty, grouped, sortField, sortDir]);
  const view = pageOf(matched, page);
  const fc = useMemo(() => facets(all), [all]);
  // Bulk actions are on LISTINGS, and only in grouped view: a copy row stands
  // for one card, and "end listing" from a ticked copy would end its siblings.
  const onScreen = grouped ? actionable(ticked, view.rows) : [];
  const hiddenTicks = grouped ? ticked.size - onScreen.length : 0;
  const settings = lab?.listingSettings || null;
  const settingsSaved = Boolean(lab?.listingSettingsSaved);

  useEffect(() => { setPage(1); }, [q, f.status, f.condition, f.pile, f.language, f.subtype, f.waiting, sortField, sortDir, hideEmpty, grouped]);

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
  const tGo = tPlan.filter((p) => !p.skip);

  const setFilter = (patch) => setF((x) => ({ ...x, ...patch }));
  const tick = (id, on) => setTicked((t) => { const n = new Set(t); if (on) n.add(String(id)); else n.delete(String(id)); return n; });
  const toggleOpen = (id) => setOpen((o) => { const n = new Set(o); if (n.has(String(id))) n.delete(String(id)); else n.add(String(id)); return n; });
  const allOnPage = grouped && view.rows.length > 0 && view.rows.every((r) => ticked.has(String(r.id)));
  const activeFilters = ["status", "condition", "pile", "language", "subtype"].filter((k) => f[k]).length + (f.waiting ? 1 : 0);

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
  if (!lab.ok) return <main className="li-wrap">{lab.missing ? "Run migration 039 first." : `Couldn't load: ${lab.error}`}</main>;

  const Pager = () => (
    <span className="li-pager">
      <button className="li-icon" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} aria-label="Previous page">‹</button>
      Page {view.page} of {view.pages}
      <button className="li-icon" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} aria-label="Next page">›</button>
    </span>
  );

  return (
    <main className="li-wrap">
      <style>{CSS}</style>

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
          </span>
        </div>
        <div className="li-headbtns">
          <a className="li-btn" href="/panel/lab">Lab</a>
          <a className="li-btn" href="/panel/lab/settings">Listing settings</a>
          <button className="li-btn" onClick={exportCsv} disabled={!matched.length}>Export CSV</button>
        </div>
      </div>

      {/* ---------------- Toolbar ---------------- */}
      <div className="li-toolbar">
        <input className="li-search" placeholder="Search name, title, SKU, set, eBay item…" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
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
        <div className="li-panel">
          {fc.conditions.length > 0 && (
            <label>Condition
              <select value={f.condition} onChange={(e) => setFilter({ condition: e.target.value })}>
                <option value="">Any</option>{fc.conditions.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
          {fc.piles.length > 0 && (
            <label>Pile
              <select value={f.pile} onChange={(e) => setFilter({ pile: e.target.value })}>
                <option value="">Any</option>{fc.piles.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
          {fc.languages.length > 0 && (
            <label>Language
              <select value={f.language} onChange={(e) => setFilter({ language: e.target.value })}>
                <option value="">Any</option>{fc.languages.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
          {fc.subtypes.length > 0 && (
            <label>Subtype
              <select value={f.subtype} onChange={(e) => setFilter({ subtype: e.target.value })}>
                <option value="">Any</option>{fc.subtypes.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="li-check"><input type="checkbox" checked={f.waiting} onChange={(e) => setFilter({ waiting: e.target.checked })} /> Sold, waiting to be picked</label>
          {activeFilters > 0 && <button className="li-btn" onClick={() => setF({ ...EMPTY_FILTERS, q: f.q })}>Clear filters</button>}
        </div>
      )}

      {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}
      {failures.map((x, i) => <div key={i} className="li-msg bad">✗ {x.title} — {x.error}</div>)}

      {/* ---------------- The table ---------------- */}
      <div className="li-card">
        <div className="li-bulk">
          {grouped ? (
            <>
              <button className="li-chip" disabled={!onScreen.length || busy} onClick={() => setPanel(panel === "price" ? null : "price")}>Price ▾</button>
              <button className="li-chip" disabled={!onScreen.length || busy} onClick={() => setPanel(panel === "template" ? null : "template")}>Apply template ▾</button>
              <button className="li-chip danger" disabled={!onScreen.length || busy} onClick={() => endRows(onScreen)}>End listings</button>
              <span className="li-dim">{onScreen.length ? `${onScreen.length} ticked` : "Tick rows to act on them"}</span>
              {hiddenTicks > 0 && <span className="li-warn">{hiddenTicks} ticked off screen — not acted on <button className="li-link" onClick={() => setTicked(new Set())}>untick</button></span>}
            </>
          ) : <span className="li-dim">One row per copy. Switch to Grouped to change listings.</span>}
          <span className="li-spacer" />
          <span className="li-dim">{view.total.toLocaleString("en-GB")} {grouped ? "listing" : "cop"}{grouped ? (view.total === 1 ? "" : "s") : view.total === 1 ? "y" : "ies"}</span>
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
                <th>Card</th>
                <th className="sm-hide">Status</th>
                <th>SKU</th>
                <th className="sm-hide">eBay item</th>
                <th>Condition</th>
                <th className="sm-hide">Variant</th>
                <th className="sm-hide">TCG</th>
                <th className="r">Price</th>
                <th className="r sm-hide">Market</th>
                <th className="r">Qty</th>
                <th className="sm-hide">Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.rows.length === 0 && (
                <tr><td colSpan={13} className="li-empty">{all.length ? "Nothing matches." : "No lab listings yet."}</td></tr>
              )}
              {view.rows.map((r) => {
                const c1 = grouped ? null : r.copy;
                const many = grouped && r.copies.length > 1;
                const isOpen = open.has(String(r.id));
                const pic = c1 ? c1.scan_urls?.[0] : r.picture;
                const variant = r.listing?.card?.finish || "—";
                const tcg = [r.listing?.card?.game, r.language].filter(Boolean).join(" ") || "—";
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
                          <span className={`li-status sm-only s-${c1 ? c1.state : r.status}`}>{c1 ? (c1.onShow ? "On eBay now" : STATE_LABEL[c1.state]) : `${many ? `×${r.copies.length} ` : ""}${STATUS_LABEL[r.status]}`}</span>
                        </span>
                      </div>
                    </td>
                    <td className="sm-hide">
                      {c1 ? <span className={`li-status s-${c1.state}`}>{c1.onShow ? "On eBay now" : STATE_LABEL[c1.state]}</span>
                        : <span className={`li-status s-${r.status}`}>{many ? `×${r.copies.length} ` : ""}{STATUS_LABEL[r.status]}</span>}
                    </td>
                    <td className="mono">
                      {c1 ? <>{c1.sku}<small>{c1.position ? `pile ${c1.pile} #${c1.position}` : `pile ${c1.pile}`}</small></>
                        : many ? <button className="li-link mono" onClick={() => toggleOpen(r.id)}>×{r.copies.length} copies</button>
                        : r.copies[0]?.sku || "—"}
                    </td>
                    <td className="mono sm-hide">{r.itemId ? <a href={`https://www.ebay.co.uk/itm/${r.itemId}`} target="_blank" rel="noreferrer">{r.itemId}</a> : "—"}</td>
                    <td><b>{r.condition}</b></td>
                    <td className="sm-hide">{variant}</td>
                    <td className="sm-hide">{tcg}</td>
                    <td className="r price">{gbp(r.pricePence)}</td>
                    <td className="r sm-hide" title={r.marketAt ? `Sold comps, ${new Date(r.marketAt).toLocaleDateString("en-GB")}` : "No sold-comps price recorded"}>{gbp(r.marketPence)}</td>
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
                          {c1 && !removeBlocker(c1, r.listing, lab.copies) && <button onClick={() => { setMenu(null); removeCopy(r, c1); }}>✕ Remove this copy</button>}
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
                      <td className="mono">{c.sku}<small>{c.position ? `pile ${c.pile} #${c.position}` : `pile ${c.pile}`}</small></td>
                      <td className="sm-hide" /><td /><td className="sm-hide" /><td className="sm-hide" /><td /><td className="sm-hide" /><td /><td className="sm-hide" />
                      <td className="li-menucell">
                        {!removeBlocker(c, r.listing, lab.copies) && <button className="li-chip" disabled={busy} onClick={() => removeCopy(r, c)}>✕ Remove</button>}
                      </td>
                    </tr>
                  )) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {view.pages > 1 && <div className="li-foot"><span className="li-dim">{PAGE_SIZE} a page</span><Pager /></div>}
      </div>
    </main>
  );
}

/** Scoped to .li-*, built on the app's own colour tokens so it follows light and dark. */
const CSS = `
.li-wrap { max-width: 1400px; margin: 0 auto; padding: 16px; color: var(--ink); }
.li-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.li-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.li-title h1 { margin: 0; font-size: 24px; }
.li-totals { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--ink-soft); }
.li-totals b { color: var(--ink); }
.li-headbtns, .li-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.li-toolbar { margin-bottom: 10px; }
.li-spacer { flex: 1 1 auto; }
.li-btn, .li-select, .li-chip { font: inherit; font-size: 13px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 7px 12px; cursor: pointer; text-decoration: none; }
.li-btn:disabled, .li-chip:disabled { opacity: .45; cursor: default; }
.li-btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.li-select.on { border-color: var(--accent); }
.li-chip { padding: 4px 10px; font-size: 12px; background: var(--surface-2); }
.li-chip.danger, .li-menu .danger { color: var(--bad); }
.li-search { flex: 1 1 280px; min-width: 0; font: inherit; font-size: 14px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
.li-num { width: 90px; font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
.li-seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
.li-seg button { font: inherit; font-size: 12px; padding: 7px 10px; border: 0; background: var(--surface); color: var(--ink-soft); cursor: pointer; }
.li-seg button.on { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
.li-icon { font: inherit; border: 0; background: transparent; color: var(--ink-soft); cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.li-icon:disabled { opacity: .35; cursor: default; }
.li-boxed { border: 1px solid var(--line-strong); padding: 6px 10px; }
.li-iconpad { display: inline-block; width: 22px; }
.li-panel { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px; margin-bottom: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 13px; }
.li-panel.inset { margin: 0; border-radius: 0; border-width: 0 0 1px; background: var(--surface-2); }
.li-panel label { display: flex; gap: 6px; align-items: center; color: var(--ink-soft); }
.li-check { display: inline-flex; gap: 6px; align-items: center; }
.li-plan { flex-basis: 100%; max-height: 220px; overflow: auto; font-size: 13px; line-height: 1.6; }
.li-plan .skip { color: var(--ink-faint); }
.li-frame { width: 100%; min-height: 220px; background: #fff; border: 1px solid var(--line); border-radius: 8px; margin-top: 6px; }
.li-msg { margin: 0 0 8px; color: var(--good); font-size: 14px; }
.li-msg.bad { color: var(--bad); }
.li-warn { color: var(--warn); }
.li-dim { color: var(--ink-faint); font-size: 12px; }
.li-link { font: inherit; border: 0; background: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; }
.li-card { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
.li-bulk, .li-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.li-foot { border-bottom: 0; border-top: 1px solid var(--line); }
.li-pager { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--ink-soft); }
.li-scroll { overflow-x: auto; }
.li-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.li-table th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; padding: 10px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.li-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; white-space: nowrap; }
.li-table tr:hover td { background: var(--surface-2); }
.li-table tr.ended td { opacity: .5; }
.li-table tr.li-sub td { background: var(--surface-sink); padding-top: 6px; padding-bottom: 6px; }
.li-table .r { text-align: right; }
.li-table .price { color: var(--good); font-weight: 600; }
.li-table .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.li-table small { display: block; color: var(--ink-faint); font-size: 11px; font-family: inherit; }
.li-cb { width: 32px; }
.li-cardcell { display: flex; align-items: center; gap: 8px; white-space: normal; min-width: 240px; }
.li-cardcell b { display: block; }
.li-thumb { position: relative; display: inline-block; width: 36px; height: 50px; flex: none; background: var(--surface-sink); border-radius: 4px; overflow: hidden; }
.li-thumb img { width: 100%; height: 100%; object-fit: contain; }
.li-thumb img.onshow { outline: 2px solid var(--accent); outline-offset: -2px; }
.li-thumb i { position: absolute; left: 0; right: 0; bottom: 0; font-style: normal; font-size: 8px; text-align: center; background: rgba(0,0,0,.65); color: #fff; }
.li-status { display: inline-block; border: 1px solid var(--line-strong); border-radius: 6px; padding: 2px 7px; font-size: 11px; white-space: nowrap; }
.li-status.s-live, .li-status.s-next { border-color: var(--good); color: var(--good); }
.li-status.s-soldout, .li-status.s-sold { border-color: var(--warn); color: var(--warn); }
.li-status.s-ended, .li-status.s-picked { color: var(--ink-faint); }
.li-status.sm-only { display: none; }
@media (max-width: 760px) { .li-table .sm-hide { display: none; } .li-status.sm-only { display: inline-block; margin-top: 3px; } .li-cardcell { min-width: 150px; } .li-wrap { padding: 12px; } .li-table td, .li-table th { padding-left: 6px; padding-right: 6px; } }
.li-empty { text-align: center; color: var(--ink-faint); padding: 32px !important; }
.li-menucell { position: relative; width: 40px; text-align: right; }
.li-menu { position: absolute; right: 8px; top: 36px; z-index: 20; min-width: 180px; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: var(--shadow-2); padding: 4px; text-align: left; }
.li-menu a, .li-menu button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; padding: 8px 10px; border: 0; background: none; color: var(--ink); border-radius: 6px; cursor: pointer; text-decoration: none; }
.li-menu a:hover, .li-menu button:hover { background: var(--surface-2); }
`;
