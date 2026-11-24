"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import CardUploaderCsv from "@/lib/carduploader.js";
import { groupsFromItems, listingForGroup, priceFromComps } from "@/lib/lab-copies.js";
import { renderListing, TITLE_MAX } from "@/lib/listing-template.js";
import {
  DRAFT_KEY, mergeGroups, liveCopies, groupToSend, rowStatus, STATUS_TEXT, LISTABLE, applyBulk, parsePrice,
  FILTERS, filterRows, sortRows, tickedOnScreen, draftTotals, serialiseDraft, restoreDraft, isThin,
  LANGUAGES, DECISION_TEXT, unreadableRows
} from "@/lib/lab-draft.js";
import { LAB_TABLE_CSS } from "../labTableCss";
import { evidenceFrom, evidenceSummary, evidencePrice, chosenSales, picksDiffer } from "@/lib/lab-evidence.js";

/**
 * Add copies: the working list between a CardUploader export and eBay.
 * Load one or more exports, price them from sold comps, edit prices, titles,
 * subtypes and which copies go — singly or in bulk — then list. The list is
 * kept on this device until it is cleared, so a reload loses nothing.
 * Rules in lib/lab-draft.js; every bulk action and every List acts on rows
 * ticked AND on screen.
 */

const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const SORTS = [["attention", "Needs attention first"], ["name", "Name"], ["sku", "SKU"], ["price-desc", "Your price, high first"], ["comps-desc", "Sold comps, high first"]];
const STATUS_CLASS = { ready: "s-live", thin: "s-soldout", needsprice: "s-sold", toolow: "s-sold", failed: "s-sold", listed: "s-next", excluded: "s-ended", nocopies: "s-ended" };

async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

function loadDraft() {
  try { return restoreDraft(localStorage.getItem(DRAFT_KEY)); } catch { return []; }
}

export default function LabAdd() {
  const [lab, setLab] = useState(null);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refused, setRefused] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [file, setFile] = useState("");
  const [sort, setSort] = useState("attention");
  const [ticked, setTicked] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());
  const [panel, setPanel] = useState(null); // "price" | "subtype"
  const [priceText, setPriceText] = useState("");
  const [pctText, setPctText] = useState("0");
  const [subtypePick, setSubtypePick] = useState("");
  // The language of the NEXT file loaded. Batches are one language each, so
  // it is chosen before loading and stamped on every card in the file.
  const [batchLang, setBatchLang] = useState("English");
  const [anyLang, setAnyLang] = useState(false);
  const [langPick, setLangPick] = useState("English");
  const [anyPick, setAnyPick] = useState(false);
  // Sales from sellers outside the UK: per batch, like the language.
  const [overseas, setOverseas] = useState(false);
  const [overseasPick, setOverseasPick] = useState(false);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [msg, setMsg] = useState(null);
  // The view (which rows, in what order) is worked out when you ASK for it —
  // a filter, a search, a sort, a load, a bulk action — never because a price
  // was typed. Re-sorting on every keystroke moved a row out from under the
  // next price box (caught testing, 2026-11-24): the second price went on the
  // wrong card.
  const [viewKey, setViewKey] = useState(0);
  const refreshView = () => setViewKey((k) => k + 1);

  const reloadLab = useCallback(async () => setLab(await api()), []);
  useEffect(() => { reloadLab(); setRows(loadDraft()); setLoaded(true); }, [reloadLab]);
  // Kept on this device as you go: a typed price survives a reload.
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT_KEY, serialiseDraft(rows)); } catch { /* full or blocked: the list still works */ }
  }, [rows, loaded]);

  const listings = lab?.listings || [];
  const settings = lab?.listingSettings || null;
  const subtypes = settings?.subtypes || [];
  const joinsOf = useCallback((r) => (r.result?.ok ? null : listingForGroup(listings, r)), [listings]);
  const shownIds = useMemo(
    () => sortRows(filterRows(rows, { filter, q, file }, joinsOf), sort, joinsOf).map((r) => r.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, q, file, sort, viewKey, rows.length, joinsOf]
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const shown = useMemo(() => shownIds.map((id) => byId.get(id)).filter(Boolean), [shownIds, byId]);
  const onScreen = tickedOnScreen(ticked, shown);
  const hiddenTicks = ticked.size - onScreen.length;
  const totals = useMemo(() => draftTotals(rows, joinsOf), [rows, joinsOf]);
  const files = useMemo(() => [...new Set(rows.map((r) => r.file))], [rows]);
  const allOnScreen = shown.length > 0 && shown.every((r) => ticked.has(String(r.id)));

  const titleOf = (r) => {
    if (r.titleOverride) return { text: r.titleOverride.slice(0, TITLE_MAX), cut: r.titleOverride.length > TITLE_MAX, own: true };
    const j = joinsOf(r);
    if (j) return { text: j.title, cut: false, joined: true };
    const out = renderListing(settings || {}, { ...r, copies: liveCopies(r) }, { subtype: r.subtype });
    return { text: out.title, cut: out.titleCut };
  };
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const tick = (id, on) => setTicked((t) => { const n = new Set(t); if (on) n.add(String(id)); else n.delete(String(id)); return n; });

  // ---- files -------------------------------------------------------------
  async function onFiles(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    let next = rows;
    const newRefused = [];
    let added = 0;
    let rowsRead = 0;
    for (const f of picked) {
      try {
        const text = await f.text();
        // The batch's language beats whatever the file or a title said.
        const items = CardUploaderCsv.extractItems(text, { allowNoNumber: true }).map((it) => ({ ...it, language: batchLang }));
        const allRows = CardUploaderCsv.rowsToObjects(CardUploaderCsv.parseCsv(text));
        const skipped = unreadableRows(allRows, { needNumber: false });
        rowsRead += allRows.length - allRows.filter((r) => !Object.values(r || {}).some((v) => String(v ?? "").trim())).length;
        // Same rows extractItems kept (a name; a number is optional here), so the extras line up.
        const raw = allRows.filter((r) => (r["*C:Card Name"] || "").trim());
        const extras = raw.map((r) => ({ finish: (r["*C:Finish"] || "").trim(), setCode: (r["*C:Set Code"] || r["C:Set Code"] || "").trim() }));
        const { groups, refused: rf } = groupsFromItems(items, extras.length === items.length ? extras : []);
        const merged = mergeGroups(next, groups, f.name, { anyLanguage: anyLang, overseas });
        next = merged.rows;
        added += merged.added;
        newRefused.push(...skipped.map((x) => ({ ...x, file: f.name })), ...rf.map((x) => ({ ...x, file: f.name })), ...merged.refused.map((x) => ({ ...x, file: f.name })));
      } catch (err) {
        newRefused.push({ sku: f.name, title: "", why: err.message || "couldn't read that file", file: f.name });
      }
    }
    setRows(next);
    refreshView();
    setRefused((r) => [...r, ...newRefused]);
    setMsg({ text: `${rowsRead} row${rowsRead === 1 ? "" : "s"} read, ${added} cop${added === 1 ? "y" : "ies"} loaded from ${picked.length} file${picked.length === 1 ? "" : "s"} as ${batchLang}${anyLang ? " (sold comps in every language)" : ""}${overseas ? " (overseas sellers counted)" : ""}${newRefused.length ? `, ${newRefused.length} refused (below)` : ""}.` });
  }

  // ---- pricing -----------------------------------------------------------
  /** Sold comps for the ticked rows on screen, or — nothing ticked — every row not yet priced from comps. */
  async function priceFromSold() {
    const base = onScreen.length ? onScreen : rows.filter((r) => !r.comps && !r.result?.ok && !r.excluded);
    const todo = base.filter((r) => !joinsOf(r) && !r.result?.ok);
    if (!todo.length) { setMsg({ text: "Nothing to price — every row has sold comps, joins a live listing or is listed." }); return; }
    setBusy("price");
    setMsg(null);
    const got = new Map();
    // The full search ladder (depth 3) is up to seven searches a card, paced at
    // SoldComps' 60 a minute — so a few cards a request, well inside the
    // server's five minutes.
    const PER_REQUEST = 6;
    for (let i = 0; i < todo.length; i += PER_REQUEST) {
      setProgress({ label: "Pricing from sold comps (every search)", done: i, total: todo.length });
      const chunk = todo.slice(i, i + PER_REQUEST);
      const cards = chunk.map((r) => ({
        sku: r.copies[0].sku, name: r.cardName, number: r.cardNumber, set: r.set, title: r.title, condition: r.condition,
        language: r.language || "English", any_language: Boolean(r.anyLanguage), overseas: Boolean(r.overseas), game: r.card?.game || "", variant: r.card?.finish || "",
        set_code: r.card?.setCode || ""
      }));
      try {
        const res = await fetch("/api/batch-comps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards, depth: 3 }) });
        const j = await res.json();
        if (!res.ok || !j.results) throw new Error(j.error || `Pricing answered ${res.status}.`);
        const bySku = new Map(j.results.map((x) => [String(x.sku), x]));
        for (const r of chunk) {
          const x = bySku.get(String(r.copies[0].sku));
          got.set(r.id, {
            pence: priceFromComps(x), confidence: x?.confidence || null, n: x?.n_comps ?? null,
            flags: x?.flags ? Object.keys(x.flags).filter((k) => x.flags[k]) : [],
            decision: x?.decision || (x?.error ? "hold" : null), reason: x?.decision_reason || x?.error || "",
            searches: Array.isArray(x?.search) ? x.search.length : null,
            fetched: Array.isArray(x?.search) ? x.search.reduce((t, s) => t + (s.added || 0), 0) : null,
            // Every sale fetched, counted or not and why — the Sales found table.
            evidence: evidenceFrom(x), setCode: x?.set_code || null,
            search: Array.isArray(x?.search) ? x.search.map((s) => ({ rung: s.rung, query: s.query, fetched: s.fetched ?? null, added: s.added ?? null, error: s.error || null })) : [],
            condition: r.condition, game: r.card?.game || "",
            ...(x?.error ? { error: x.error } : {})
          });
        }
      } catch (e) {
        for (const r of chunk) got.set(r.id, { pence: null, error: e.message });
      }
    }
    // A price already typed is never overwritten by comps.
    setRows((rs) => rs.map((r) => {
      const c = got.get(r.id);
      if (!c) return r;
      // New sales, so any sales you had picked from the old ones are gone.
      return { ...r, comps: c, picks: null, pricePence: r.pricePence != null ? r.pricePence : c.pence };
    }));
    setProgress(null);
    setBusy(null);
    refreshView();
    setMsg({ text: `Priced ${got.size} card${got.size === 1 ? "" : "s"} from sold comps. Typed prices were kept.` });
  }

  // ---- bulk edits ----------------------------------------------------------
  function bulk(action, label) {
    if (!onScreen.length) return;
    setRows((rs) => applyBulk(rs, onScreen.map((r) => r.id), action));
    refreshView();
    setMsg({ text: `${label} — ${onScreen.length} row${onScreen.length === 1 ? "" : "s"}.` });
    setPanel(null);
  }

  // ---- listing -----------------------------------------------------------
  async function listRows(candidates) {
    const go = candidates.filter((r) => LISTABLE.has(rowStatus(r, joinsOf(r))));
    const skipped = candidates.length - go.length;
    if (!go.length) { setMsg({ bad: true, text: "Nothing ticked is ready to list — give it a price, or put it back in." }); return; }
    const joins = go.filter((r) => joinsOf(r));
    const fresh = go.filter((r) => !joinsOf(r));
    const copies = go.reduce((t, r) => t + liveCopies(r).length, 0);
    const value = fresh.reduce((t, r) => t + r.pricePence * liveCopies(r).length, 0);
    const checkFirst = fresh.filter((r) => isThin(r)).length;
    if (!window.confirm(
      `List ${go.length} card${go.length === 1 ? "" : "s"} on eBay — LIVE.\n\n` +
      `${fresh.length} new listing${fresh.length === 1 ? "" : "s"}, ${gbp(value)} in all\n` +
      `${joins.length} joining a listing already live (its price stays)\n${copies} copies` +
      (checkFirst ? `\n\n⚠ ${checkFirst} of the new listings ${checkFirst === 1 ? "is" : "are"} marked Check first (a Terapeak check, a thin or wide price, or a failed lookup).` : "") +
      (skipped ? `\n\n${skipped} ticked row${skipped === 1 ? " isn't" : "s aren't"} ready and will be left alone.` : "") + "\n\nGo?"
    )) return;
    setBusy("list");
    setMsg(null);
    let okCount = 0;
    for (let i = 0; i < go.length; i++) {
      const r = go[i];
      setProgress({ label: "Listing", done: i, total: go.length });
      const res = await api({
        action: "create", group: groupToSend(r), pricePence: r.pricePence, subtype: r.subtype || "",
        marketPence: r.comps?.pence ?? null, titleOverride: r.titleOverride || "", settings: {}
      });
      if (res.ok) okCount += 1;
      setRow(r.id, { result: res.ok ? { ok: true, itemId: res.itemId, joined: Boolean(res.joined) } : { ok: false, error: res.error || "Failed." } });
    }
    setProgress(null);
    setBusy(null);
    setTicked(new Set());
    refreshView();
    setMsg(okCount === go.length ? { text: `All ${okCount} listed.` } : { bad: true, text: `${okCount} listed, ${go.length - okCount} failed — they're marked Failed and stay here to retry.` });
    reloadLab();
  }

  if (!lab) return <main className="li-wrap"><style>{LAB_TABLE_CSS}</style>Loading…</main>;
  if (!lab.ok) {
    return <main className="li-wrap"><style>{LAB_TABLE_CSS}</style>{lab.needsMove || lab.foldPending ? <>{lab.error} <a href="/panel/lab">Open the lab</a></> : `Couldn't load the lab: ${lab.error}`}</main>;
  }

  const s = totals.byStatus;

  return (
    <main className="li-wrap">
      <style>{LAB_TABLE_CSS + EXTRA_CSS}</style>

      <div className="li-head">
        <div className="li-title">
          <h1>Add copies</h1>
          <span className="li-totals">
            {totals.rows} card{totals.rows === 1 ? "" : "s"} · {totals.copies} cop{totals.copies === 1 ? "y" : "ies"}
            <span>New listings <b>{gbp(totals.value)}</b></span>
            {s.needsprice ? <span className="li-warn">{s.needsprice} need a price</span> : null}
            {s.thin ? <span className="li-warn">{s.thin} thin</span> : null}
            {s.failed ? <span style={{ color: "var(--bad)" }}>{s.failed} failed</span> : null}
            {s.listed ? <span style={{ color: "var(--good)" }}>{s.listed} listed</span> : null}
          </span>
        </div>
        <div className="li-headbtns">
          <a className="li-btn" href="/panel/lab">Lab</a>
          <a className="li-btn" href="/panel/lab/inventory">Inventory</a>
          <a className="li-btn" href="/panel/lab/settings">Listing settings</a>
        </div>
      </div>

      {/* ---------------- Load ---------------- */}
      <div className="li-panel">
        <label className="li-dim" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Batch language
          <select className="li-select" value={batchLang} disabled={!!busy} onChange={(e) => setBatchLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="li-check li-dim" title="Count sold listings of this card in any language (CardCropper's All languages). Graded, other printings and lots stay out.">
          <input type="checkbox" checked={anyLang} disabled={!!busy} onChange={(e) => setAnyLang(e.target.checked)} /> count sales in every language
        </label>
        <label className="li-check li-dim" title="Count sales from sellers outside the UK. Postage is capped at £4 in the price either way. Mostly worth it for Japanese cards with little UK supply.">
          <input type="checkbox" checked={overseas} disabled={!!busy} onChange={(e) => setOverseas(e.target.checked)} /> count overseas sellers
        </label>
        <label className="li-btn primary" style={{ cursor: "pointer" }}>
          ＋ Load {batchLang} export(s)
          <input type="file" accept=".csv,text/csv" multiple style={{ display: "none" }} onChange={onFiles} disabled={!!busy} />
        </label>
        <span className="li-dim">
          Several files at once is fine. Automatic eBay Inventory must be OFF in CardUploader so the export carries your SKUs. Nothing is listed until you press List.
        </span>
        <span className="li-spacer" />
        {rows.some((r) => r.result?.ok) && <button className="li-btn" disabled={!!busy} onClick={() => setRows((rs) => rs.filter((r) => !r.result?.ok))}>Clear listed rows</button>}
        {rows.length > 0 && <button className="li-btn" disabled={!!busy} onClick={() => {
          if (window.confirm(`Clear the whole list (${rows.length} rows)? Typed prices go with it. Nothing on eBay changes.`)) { setRows([]); setRefused([]); setTicked(new Set()); }
        }}>Clear list</button>}
      </div>

      {refused.length > 0 && (
        <details className="li-panel" open={refused.length <= 8}>
          <summary className="li-warn">{refused.length} cop{refused.length === 1 ? "y" : "ies"} refused — not in the list</summary>
          <div className="li-plan">
            {refused.map((r, i) => <div key={i}>✗ <b>{r.sku}</b> {r.title ? `· ${r.title}` : ""} — {r.why} <span className="li-dim">({r.file})</span></div>)}
          </div>
          <button className="li-btn" onClick={() => setRefused([])}>Dismiss</button>
        </details>
      )}

      {/* ---------------- Toolbar ---------------- */}
      <div className="li-toolbar">
        <input className="li-search" placeholder="Search name, set, SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="li-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{k !== "all" && k !== "joins" && s[k] ? ` (${s[k]})` : ""}</option>)}
        </select>
        {files.length > 1 && (
          <select className="li-select" value={file} onChange={(e) => setFile(e.target.value)}>
            <option value="">All files</option>
            {files.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <span className="li-spacer" />
        <select className="li-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}

      <div className="li-card">
        {/* ---------------- Bulk bar ---------------- */}
        <div className="li-bulk">
          <button className="li-chip" disabled={!!busy || !rows.length} onClick={priceFromSold} title="Ticked rows on screen; with nothing ticked, every row not yet priced from sold comps">
            {busy === "price" ? "Pricing…" : "£ Price from sold comps"}
          </button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "price" ? null : "price")}>Set price ▾</button>
          {subtypes.length > 0 && <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "subtype" ? null : "subtype")}>Subtype ▾</button>}
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "language" ? null : "language")}>Language &amp; sellers ▾</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => bulk({ op: "exclude" }, "Left out")}>Leave out</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => bulk({ op: "include" }, "Put back")}>Put back</button>
          <button className="li-chip primary-chip" disabled={!onScreen.length || !!busy} onClick={() => listRows(onScreen)}>
            {busy === "list" ? "Listing…" : `List ticked (${onScreen.length})`}
          </button>
          <span className="li-dim">{onScreen.length ? `${onScreen.length} ticked` : "Tick rows to edit or list them"}</span>
          {hiddenTicks > 0 && <span className="li-warn">{hiddenTicks} ticked off screen — not acted on <button className="li-link" onClick={() => setTicked(new Set())}>untick</button></span>}
          {progress && <span className="li-dim">{progress.label}: {progress.done} of {progress.total}…</span>}
          <span className="li-spacer" />
          <button className="li-chip" onClick={refreshView} title="Apply your edits to the filter and sort. Rows don't move while you type.">↻ Re-sort</button>
          <span className="li-dim">{shown.length} of {rows.length} shown</span>
        </div>

        {panel === "price" && (
          <div className="li-panel inset">
            <span>Set price on {onScreen.length}:</span>
            <input className="li-num" inputMode="decimal" placeholder="£" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            <button className="li-btn" disabled={parsePrice(priceText) == null} onClick={() => bulk({ op: "price", pence: parsePrice(priceText) }, `Price set to ${gbp(parsePrice(priceText))}`)}>Set</button>
            <span className="li-dim">or</span>
            <button className="li-btn" onClick={() => bulk({ op: "comps" }, "Sold-comps price used")}>Use sold comps</button>
            <span className="li-dim">or sold comps</span>
            <input className="li-num" inputMode="numeric" value={pctText} onChange={(e) => setPctText(e.target.value)} style={{ width: 60 }} />
            <span>%</span>
            <button className="li-btn" disabled={!Number.isFinite(Number(pctText))} onClick={() => bulk({ op: "compsPct", pct: Number(pctText) }, `Sold comps ${Number(pctText) >= 0 ? "+" : ""}${Number(pctText)}%, laddered`)}>Apply</button>
            <span className="li-dim">or</span>
            <button className="li-btn" onClick={() => bulk({ op: "ladder" }, "Rounded up onto .49/.99")}>Round up to .49/.99</button>
            <button className="li-btn" onClick={() => bulk({ op: "clear" }, "Prices cleared")}>Clear prices</button>
            <span className="li-dim" style={{ flexBasis: "100%" }}>
              A row with no sold-comps price is left as it is by the sold-comps options. Rows joining a live listing keep that listing&apos;s price whatever is set here.
            </span>
          </div>
        )}
        {panel === "language" && (
          <div className="li-panel inset">
            <span>Language for {onScreen.length}:</span>
            <select className="li-select" value={langPick} onChange={(e) => setLangPick(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="li-check"><input type="checkbox" checked={anyPick} onChange={(e) => setAnyPick(e.target.checked)} /> count sales in every language</label>
            <label className="li-check"><input type="checkbox" checked={overseasPick} onChange={(e) => setOverseasPick(e.target.checked)} /> count overseas sellers</label>
            <button className="li-btn" onClick={() => bulk({ op: "language", language: langPick, anyLanguage: anyPick, overseas: overseasPick }, `Language set to ${langPick}${anyPick ? ", every language counted" : ""}${overseasPick ? ", overseas sellers counted" : ""}`)}>Set</button>
            <span className="li-dim" style={{ flexBasis: "100%" }}>
              Changing it drops those rows&apos; sold comps (they were for the other language) and any price that only came from them. Price them again after.
            </span>
          </div>
        )}
        {panel === "subtype" && (
          <div className="li-panel inset">
            <span>Subtype for {onScreen.length}:</span>
            <select className="li-select" value={subtypePick} onChange={(e) => setSubtypePick(e.target.value)}>
              <option value="">— none —</option>
              {subtypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="li-btn" onClick={() => bulk({ op: "subtype", value: subtypePick }, subtypePick ? `Subtype set to ${subtypePick}` : "Subtype cleared")}>Set</button>
          </div>
        )}

        {/* ---------------- The table ---------------- */}
        <div className="li-scroll">
          <table className="li-table">
            <thead>
              <tr>
                <th className="li-cb"><input type="checkbox" checked={allOnScreen} aria-label="Tick everything shown" onChange={(e) => setTicked((t) => { const n = new Set(t); for (const r of shown) { if (e.target.checked) n.add(String(r.id)); else n.delete(String(r.id)); } return n; })} /></th>
                <th>Card</th>
                <th className="sm-hide">Status</th>
                <th className="sm-hide">Copies</th>
                <th className="sm-hide">Condition</th>
                <th className="r sm-hide">Sold comps</th>
                <th className="r">Your price</th>
                <th className="sm-hide">File</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={8} className="li-empty">{rows.length ? "Nothing matches." : "Load a CardUploader export to start."}</td></tr>
              )}
              {shown.map((r) => {
                const j = joinsOf(r);
                const st = rowStatus(r, j);
                const t = titleOf(r);
                const live = liveCopies(r);
                const isOpen = open.has(r.id);
                const done = st === "listed";
                return (
                  <Fragment key={r.id}>
                    <tr className={st === "excluded" || done ? "ended" : ""}>
                      <td className="li-cb"><input type="checkbox" checked={ticked.has(String(r.id))} aria-label={`Tick ${r.title}`} onChange={(e) => tick(r.id, e.target.checked)} /></td>
                      <td>
                        <div className="li-cardcell">
                          <button className="li-icon" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-label={isOpen ? "Fold" : "Open"}>{isOpen ? "▾" : "▸"}</button>
                          <span className="li-thumb">{live[0]?.scans?.[0] || r.copies[0]?.scans?.[0] ? <img src={live[0]?.scans?.[0] || r.copies[0].scans[0]} alt="" referrerPolicy="no-referrer" /> : null}</span>
                          <span>
                            <b>{t.text}</b>
                            <small>
                              {[r.set, r.cardNumber, r.subtype, r.language && r.language !== "English" ? r.language : "", r.anyLanguage ? "every language" : "", r.overseas ? "overseas sellers" : ""].filter(Boolean).join(" · ")}
                              {t.own ? " · your title" : ""}{t.cut ? <span className="li-warn"> · cut at 80</span> : null}
                            </small>
                            <small className="sm-only">
                              <span className={`li-status ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span> ×{live.length} · {r.condition}
                              {r.comps?.pence != null ? ` · comps ${gbp(r.comps.pence)}` : ""}{r.comps?.decision && r.comps.decision !== "apply" ? ` · ${DECISION_TEXT[r.comps.decision]}` : ""}{j && !done ? " · joins a listing" : ""}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="sm-hide">
                        <span className={`li-status ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span>
                        {j && !done && <small style={{ color: "var(--accent)" }}>joins eBay {j.ebay_item_id}</small>}
                        {done && r.result.itemId && <small><a href={`https://www.ebay.co.uk/itm/${r.result.itemId}`} target="_blank" rel="noreferrer">{r.result.joined ? "added to" : "eBay"} {r.result.itemId}</a></small>}
                        {st === "failed" && <small style={{ color: "var(--bad)", whiteSpace: "normal", maxWidth: 260 }}>{r.result.error}</small>}
                      </td>
                      <td className="mono sm-hide">{live.length}{live.length !== r.copies.length ? <small>of {r.copies.length}</small> : null}</td>
                      <td className="sm-hide"><b>{r.condition}</b></td>
                      <td className="r sm-hide" title={r.comps?.error || (r.comps ? `${r.comps.n ?? "?"} sales counted${r.comps.searches ? ` of ${r.comps.fetched ?? "?"} found across ${r.comps.searches} searches` : ""} · ${r.comps.confidence || "?"} confidence${r.comps.decision ? ` · ${DECISION_TEXT[r.comps.decision] || r.comps.decision}${r.comps.reason ? ` (${r.comps.reason})` : ""}` : ""}${r.comps.flags?.length ? ` · ${r.comps.flags.join(", ").replace(/_/g, " ")}` : ""}` : "Not priced from sold comps yet")}>
                        {r.comps?.error ? <span style={{ color: "var(--bad)" }}>error</span> : gbp(r.comps?.pence ?? null)}
                        {r.comps && !r.comps.error && <small className={isThin(r) ? "li-warn" : ""}>{r.comps.n ?? "?"} sale{r.comps.n === 1 ? "" : "s"}{r.comps.decision ? ` · ${DECISION_TEXT[r.comps.decision] || r.comps.decision}` : ` · ${r.comps.confidence || "?"}`}</small>}
                        {r.comps?.decision && r.comps.decision !== "apply" && r.comps.reason && <small className="li-warn" style={{ whiteSpace: "normal", maxWidth: 200 }}>{r.comps.reason}</small>}
                        {r.comps?.flags?.includes("in_hand_check") && <small className="li-warn">check in hand</small>}
                        {r.comps?.evidence && <small className="li-dim" style={{ whiteSpace: "normal", maxWidth: 220 }}>{evidenceSummary(r.comps.evidence)}</small>}
                        {r.comps?.evidence?.length > 0 && (
                          <button className="li-link" onClick={() => setOpen((o) => new Set(o).add(r.id))}>
                            {picksDiffer(r.comps.evidence, r.picks) ? "🔍 your picks" : "🔍 see sales"}
                          </button>
                        )}
                        {r.comps && !r.comps.error && r.language && r.language !== "English" && !r.comps.setCode && <small className="li-dim">no set code</small>}
                      </td>
                      <td className="r">
                        {j ? <span className="li-dim">{gbp(j.price_pence)}<small>listing&apos;s price</small></span> : (
                          <PriceBox value={r.pricePence} disabled={done || !!busy} onSet={(p) => setRow(r.id, { pricePence: p })} />
                        )}
                      </td>
                      <td className="li-dim sm-hide" style={{ whiteSpace: "normal", maxWidth: 140 }}>{r.file}</td>
                    </tr>
                    {isOpen && (
                      <tr className="li-sub">
                        <td />
                        <td colSpan={7}>
                          <div className="la-open">
                            <div className="la-fields">
                              <label>Title for this card <span className="li-dim">(blank = your template)</span>
                                <input value={r.titleOverride} disabled={done} maxLength={120} placeholder={t.own ? "" : titleOf({ ...r, titleOverride: "" }).text}
                                  onChange={(e) => setRow(r.id, { titleOverride: e.target.value })} />
                                <span className={(r.titleOverride || "").length > TITLE_MAX ? "li-warn" : "li-dim"}>{(r.titleOverride || "").length || t.text.length} / {TITLE_MAX}</span>
                              </label>
                              {subtypes.length > 0 && (
                                <label>Subtype
                                  <select value={r.subtype} disabled={done} onChange={(e) => setRow(r.id, { subtype: e.target.value })}>
                                    <option value="">—</option>
                                    {subtypes.map((x) => <option key={x} value={x}>{x}</option>)}
                                  </select>
                                </label>
                              )}
                              <label className="li-check"><input type="checkbox" checked={!r.excluded} disabled={done} onChange={(e) => setRow(r.id, { excluded: !e.target.checked })} /> List this card</label>
                            </div>
                            {r.comps?.evidence?.length > 0 && (
                              <SalesFound row={r} disabled={done || !!busy}
                                onPicks={(picks) => setRow(r.id, { picks })}
                                onUse={(pence) => { setRow(r.id, { pricePence: pence }); setMsg({ text: `${r.title}: price set to ${gbp(pence)} from the sales you picked.` }); }} />
                            )}
                            <div className="la-copies">
                              {r.copies.map((c, i) => {
                                const skip = (r.skippedSkus || []).map((x) => x.toLowerCase()).includes(String(c.sku).toLowerCase());
                                return (
                                  <label key={c.sku} className={`la-copy ${skip ? "off" : ""}`}>
                                    <a href={c.scans?.[0] || "#"} target="_blank" rel="noreferrer"><img src={c.scans?.[0]} alt="" referrerPolicy="no-referrer" /></a>
                                    <span className="mono">{c.sku}</span>
                                    <span className="li-dim">{i === 0 && !skip ? "photo on the listing" : skip ? "left out" : "queued"}</span>
                                    <span className="li-check"><input type="checkbox" checked={!skip} disabled={done} onChange={(e) => {
                                      const set = new Set((r.skippedSkus || []).map((x) => x.toLowerCase()));
                                      if (e.target.checked) set.delete(String(c.sku).toLowerCase()); else set.add(String(c.sku).toLowerCase());
                                      setRow(r.id, { skippedSkus: [...set] });
                                    }} /> list</span>
                                  </label>
                                );
                              })}
                            </div>
                            {!done && <button className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy || !LISTABLE.has(st)} onClick={() => listRows([r])}>List this card</button>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

/**
 * Every sale a card's searches found, counted or left out and why, to pick
 * from. Ticks start on what the filter counted; tick a left-out sale that is
 * plainly the card, untick a counted one that isn't, and the price below is
 * worked out from your picks by the same house rules as the server's. Nothing
 * changes until "Use this price".
 */
function SalesFound({ row, onPicks, onUse, disabled }) {
  const [showOut, setShowOut] = useState(false);
  const [showSearches, setShowSearches] = useState(false);
  const ev = row.comps.evidence;
  const chosen = new Set(chosenSales(ev, row.picks).map((e) => String(e.id)));
  const toggle = (id, on) => {
    const next = new Set(chosen);
    if (on) next.add(String(id)); else next.delete(String(id));
    onPicks([...next]);
  };
  const p = evidencePrice(ev, row.picks, { condition: row.comps.condition || row.condition, game: row.comps.game || row.card?.game || "" });
  const changed = picksDiffer(ev, row.picks);
  const shown = ev.filter((e) => showOut || e.counted || chosen.has(String(e.id)));
  const outCount = ev.filter((e) => !e.counted).length;
  return (
    <div className="la-sales">
      <div className="la-sales-head">
        <b>Sales found</b>
        <span className="li-dim">{evidenceSummary(ev)}</span>
        <span className="li-spacer" />
        {outCount > 0 && <label className="li-check"><input type="checkbox" checked={showOut} onChange={(e) => setShowOut(e.target.checked)} /> show the {outCount} left out</label>}
        {row.comps.search?.length > 0 && <button className="li-link" onClick={() => setShowSearches((v) => !v)}>{showSearches ? "hide" : "show"} the {row.comps.search.length} searches</button>}
      </div>
      {showSearches && (
        <div className="li-plan">
          {row.comps.search.map((s, i) => <div key={i}><span className="mono">{s.query}</span> <span className="li-dim">— {s.error ? `failed: ${s.error}` : `found ${s.fetched ?? "?"}, new ${s.added ?? "?"}`}</span></div>)}
        </div>
      )}
      <div className="li-scroll" style={{ maxHeight: 360 }}>
        <table className="li-table la-sales-table">
          <thead><tr><th className="li-cb">Use</th><th>Sold listing</th><th className="r">Total</th><th className="sm-hide">Sold</th><th className="sm-hide">Filter</th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className={chosen.has(String(e.id)) ? "" : "ended"}>
                <td className="li-cb"><input type="checkbox" disabled={disabled} checked={chosen.has(String(e.id))} onChange={(x) => toggle(e.id, x.target.checked)} aria-label={`Use ${e.title}`} /></td>
                <td style={{ whiteSpace: "normal" }}>
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                  <small className="sm-only">{e.date ? String(e.date).slice(0, 10) : ""} · {e.counted ? "counted" : e.reason}</small>
                </td>
                <td className="r mono">£{Number(e.total).toFixed(2)}<small>£{Number(e.price).toFixed(2)} + £{Number(e.postage || 0).toFixed(2)}</small></td>
                <td className="mono sm-hide">{e.date ? String(e.date).slice(0, 10) : "—"}</td>
                <td className={`sm-hide ${e.counted ? "" : "li-dim"}`} style={{ whiteSpace: "normal", maxWidth: 200 }}>{e.counted ? (e.reason || "counted") : e.reason}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="li-empty">Nothing counted. Tick &quot;show the left out&quot; to pick from what was found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="la-sales-foot">
        <span>{changed ? "Your picks" : "As counted"}: <b>{p.n}</b> sale{p.n === 1 ? "" : "s"}
          {p.suggestedPence != null ? <> → {p.method === "lowest" ? "the lowest" : "40th percentile"} £{(p.basisPence / 100).toFixed(2)} → <b>£{(p.suggestedPence / 100).toFixed(2)}</b>{row.comps.condition && row.comps.condition !== "NM" ? ` (${row.comps.condition})` : ""}</> : " — nothing to price from"}
        </span>
        <span className="li-spacer" />
        {changed && <button className="li-btn" disabled={disabled} onClick={() => onPicks(null)}>Reset picks</button>}
        {p.suggestedPence != null && p.suggestedPence === row.pricePence
          ? <span className="li-dim">✓ already the price</span>
          : <button className="li-btn primary" disabled={disabled || p.suggestedPence == null} onClick={() => onUse(p.suggestedPence)}>Use this price</button>}
      </div>
    </div>
  );
}

/** A price box that commits on blur or Enter, so typing "1" on the way to "12.49" doesn't flash a status. */
function PriceBox({ value, onSet, disabled }) {
  const [text, setText] = useState(value == null ? "" : (value / 100).toFixed(2));
  useEffect(() => { setText(value == null ? "" : (value / 100).toFixed(2)); }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) { if (value != null) onSet(null); return; }
    const p = parsePrice(t);
    if (p == null) { setText(value == null ? "" : (value / 100).toFixed(2)); return; }
    if (p !== value) onSet(p);
  };
  return (
    <input className="li-num" style={{ width: 84, textAlign: "right" }} inputMode="decimal" placeholder="£" value={text} disabled={disabled}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

const EXTRA_CSS = `
.li-chip.primary-chip { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.la-open { display: flex; flex-direction: column; gap: 12px; white-space: normal; padding: 4px 0; }
.la-fields { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.la-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-soft); }
.la-fields input:not([type=checkbox]), .la-fields select { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); min-width: 320px; max-width: 100%; }
.la-fields .li-check { flex-direction: row; }
.la-copies { display: flex; flex-wrap: wrap; gap: 10px; }
.la-sales { border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); }
.la-sales-head, .la-sales-foot { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 13px; }
.la-sales-table td, .la-sales-table th { font-size: 12.5px; }
.la-sales-table tr.ended td { opacity: .55; }
.la-copy { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 104px; font-size: 12px; text-align: center; }
.la-copy img { width: 84px; height: 116px; object-fit: contain; background: var(--surface-sink); border-radius: 6px; }
.la-copy.off img { opacity: .35; }
small.sm-only { display: none; }
@media (max-width: 760px) {
  .la-fields input:not([type=checkbox]) { min-width: 0; width: 100%; }
  small.sm-only { display: block; margin-top: 3px; }
  small.sm-only .li-status { display: inline-block; margin-right: 4px; }
  .li-cardcell { min-width: 0; }
}
`;
