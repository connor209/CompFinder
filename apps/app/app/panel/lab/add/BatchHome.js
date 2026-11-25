"use client";

/**
 * Batches: every upload, as a grid of tiles — the shape CardUploader's
 * "Previous batches" taught everyone who uses this: a scan of the first card,
 * what the batch is, what it is worth, how far it has got, and View.
 *
 * Read from the batch list's own columns (lib/lab-batches.js), never the
 * rows, so a few hundred batches is one cheap read. Search, stage, language
 * and sort are on this device only; nothing here writes except Rename and
 * Delete, which go through the parent.
 */
import { useMemo, useState } from "react";
import { BATCH_SORTS, BATCH_STAGES, batchKind, batchStage, batchesTotals, viewBatches } from "@/lib/lab-batches.js";

const gbp = (p) => `£${((p || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export default function BatchHome({ batches, tiles = true, pricingIds = new Set(), legacy = null, onRename, onDelete }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [stage, setStage] = useState("");
  const [language, setLanguage] = useState("");
  const [menu, setMenu] = useState(null);

  const languages = useMemo(() => [...new Set(batches.map((b) => b.language).filter(Boolean))].sort(), [batches]);
  const shown = useMemo(() => viewBatches(batches, { q, stage, language, sort, pricingIds }), [batches, q, stage, language, sort, pricingIds]);
  const t = batchesTotals(shown);
  const filtered = shown.length !== batches.length;

  return (
    <section className="bh">
      <div className="bh-head">
        <div>
          <h1>Batches</h1>
          <p className="li-dim">Each CardUploader export you load is a batch. Open one to price it, check it and list it.</p>
        </div>
        <a className="li-btn primary bh-new" href="?new=1">＋ New batch</a>
      </div>

      {legacy}

      {batches.length > 0 ? (
        <>
          <div className="bh-tools">
            <input className="li-search" placeholder="Search batches…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="li-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              {BATCH_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className={`li-select${stage ? " on" : ""}`} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
              {BATCH_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {languages.length > 1 ? (
              <select className={`li-select${language ? " on" : ""}`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
                <option value="">Every language</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : null}
          </div>
          <div className="bh-totals">
            <span><b>{t.batches}</b> batch{t.batches === 1 ? "" : "es"}{filtered ? ` of ${batches.length}` : ""}</span>
            <span><b>{t.cards.toLocaleString("en-GB")}</b> cards</span>
            <span><b>{t.listed.toLocaleString("en-GB")}</b> listed</span>
            {tiles ? <span className="bh-money">{gbp(t.value)} total</span> : null}
            {tiles ? <span className="bh-money">{gbp(t.listedValue)} listed</span> : null}
          </div>
        </>
      ) : null}

      {batches.length === 0 ? (
        <div className="bh-empty">
          <div className="bh-empty-art" aria-hidden="true">🗂</div>
          <b>No batches yet</b>
          <p className="li-dim">Export a load from CardUploader (with Automatic eBay Inventory off, so the file carries your SKUs) and start a batch from it.</p>
          <a className="li-btn primary" href="?new=1">＋ New batch</a>
        </div>
      ) : shown.length === 0 ? (
        <div className="bh-empty"><b>No batch matches that.</b> <button className="li-btn" onClick={() => { setQ(""); setStage(""); setLanguage(""); }}>Clear filters</button></div>
      ) : (
        <div className="bh-grid">
          {shown.map((b) => {
            const s = batchStage(b, { pricing: pricingIds.has(b.id) });
            return (
              <article key={b.id} className="bh-tile">
                <a className="bh-cover" href={`?batch=${b.id}`} aria-label={`Open ${b.name}`}>
                  {b.cover_url ? <img src={b.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="bh-noscan">no scan</span>}
                  <span className={`bh-stage st-${s.key}`}>{s.label}</span>
                </a>
                <div className="bh-body">
                  <div className="bh-kind">
                    <span>{batchKind(b)}</span>
                    <button className="li-icon" aria-label="More" onClick={() => setMenu(menu === b.id ? null : b.id)}>⋯</button>
                  </div>
                  {menu === b.id ? (
                    <div className="bh-menu" role="menu">
                      <button onClick={() => { setMenu(null); onRename(b); }}>✎ Rename</button>
                      <a href={`?batch=${b.id}`} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>↗ Open in a new tab</a>
                      <button className="danger" onClick={() => { setMenu(null); onDelete(b); }}>🗑 Delete</button>
                    </div>
                  ) : null}
                  <a className="bh-name" href={`?batch=${b.id}`} title={b.name}>{b.name}</a>
                  <div className="bh-meta">
                    {tiles ? <span className="bh-money">{gbp(b.value_pence)}</span> : null}
                    <span>{b.card_count} card{b.card_count === 1 ? "" : "s"}</span>
                    <span>{day(b.created_at)}</span>
                  </div>
                  <div className="bh-bar" title={`${b.listed_count} of ${b.card_count} listed`}>
                    <div style={{ width: `${b.card_count ? Math.round((b.listed_count / b.card_count) * 100) : 0}%` }} />
                  </div>
                  <a className="li-btn primary bh-view" href={`?batch=${b.id}`}>View</a>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!tiles && batches.length ? <p className="li-dim">Run migration 049 to see each batch&apos;s first scan and value on its tile.</p> : null}
    </section>
  );
}

export const BATCH_HOME_CSS = `
.bh { display:flex; flex-direction:column; gap:12px; }
.bh-head { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; justify-content:space-between; }
.bh-head h1 { margin:0 0 2px; font-size:24px; }
.bh-head p { margin:0; }
.bh-new { font-weight:600; }
.bh-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.bh-totals { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:13px; color:var(--ink-soft); padding-bottom:8px; border-bottom:1px solid var(--line); }
.bh-totals b { color:var(--ink); }
.bh-money { color:var(--good); font-weight:600; }
.bh-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:14px; }
.bh-tile { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:12px; background:var(--surface); overflow:hidden; min-width:0; }
.bh-tile:hover { border-color:var(--line-strong); }
.bh-cover { text-decoration:none; position:relative; display:flex; align-items:center; justify-content:center; aspect-ratio: 5 / 6; background:var(--surface-2); padding:10px; overflow:hidden; }
.bh-cover img { max-width:100%; max-height:100%; object-fit:contain; border-radius:6px; }
.bh-noscan { color:var(--ink-faint); font-size:12px; }
.bh-stage { position:absolute; left:8px; bottom:8px; font-size:11px; font-weight:700; padding:3px 8px; border-radius:999px; background:var(--surface); border:1px solid var(--line-strong); color:var(--ink-soft); }
.bh-stage.st-listed { color:var(--good); border-color:var(--good); }
.bh-stage.st-ready { color:var(--accent); border-color:var(--accent); }
.bh-stage.st-pricing { color:var(--accent); }
.bh-stage.st-pricing-needed { color:var(--warn); border-color:var(--warn); }
.bh-body { display:flex; flex-direction:column; gap:6px; padding:10px 12px 12px; position:relative; }
.bh-kind { display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:11px; color:var(--ink-faint); }
.bh-name { font-weight:700; color:var(--ink); text-decoration:none; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; min-height:2.5em; }
.bh-meta { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:12px; color:var(--ink-soft); }
.bh-bar { height:4px; border-radius:999px; background:var(--surface-2); overflow:hidden; }
.bh-bar > div { height:100%; background:var(--good); }
.bh-view { text-align:center; margin-top:2px; }
.bh-menu { position:absolute; right:10px; top:30px; z-index:5; display:flex; flex-direction:column; min-width:170px; background:var(--surface); border:1px solid var(--line-strong); border-radius:10px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.25); }
.bh-menu button, .bh-menu a { font:inherit; font-size:13px; text-align:left; background:none; border:0; color:var(--ink); padding:8px 10px; border-radius:6px; cursor:pointer; text-decoration:none; }
.bh-menu button:hover, .bh-menu a:hover { background:var(--surface-2); }
.bh-menu .danger { color:var(--bad); }
.bh-empty { display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; padding:40px 16px; border:1px dashed var(--line-strong); border-radius:12px; }
.bh-empty p { max-width:420px; margin:0; }
.bh-empty-art { font-size:36px; }
@media (max-width: 520px) { .bh-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; } }
`;
