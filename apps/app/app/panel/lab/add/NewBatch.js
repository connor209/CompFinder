"use client";

/**
 * New batch: what a load IS, decided before the file goes in — the shape of
 * CardUploader's own "Ungraded cards" setup. Everything here used to be a
 * tickbox beside the file button, so it was decided after the fact or not at
 * all, and a Japanese file loaded as English stayed English.
 *
 * Nothing is read or written until Create: the parent reads the files, makes
 * the batch with these settings on every row, and (if asked) queues it for
 * pricing in the same step.
 */
import { useRef, useState } from "react";
import { LANGUAGES } from "@/lib/lab-draft.js";
import { parseCostPence } from "@/lib/card-costs.js";

export default function NewBatch({ subtypes = [], busy = false, queueAvailable = true, onCreate }) {
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [anyLanguage, setAnyLanguage] = useState(false);
  const [overseas, setOverseas] = useState(false);
  const [subtype, setSubtype] = useState("");
  const [costText, setCostText] = useState("");
  const [priceNow, setPriceNow] = useState(true);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  const cost = costText.trim() ? parseCostPence(costText) : null;
  const costBad = costText.trim() !== "" && cost == null;
  const pick = (list) => setFiles([...list].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv"));

  return (
    <section className="nb">
      <a className="nb-back" href="/panel/lab/add">← Batches</a>
      <h1>New batch</h1>
      <p className="li-dim">Say what the cards are, choose the CardUploader export, and create. You can add more files to the batch afterwards.</p>

      <div className="nb-card">
        <div className="nb-h">Setup</div>
        <div className="nb-grid">
          <label className="nb-field nb-wide">
            <span>Batch name <i>(optional)</i></span>
            <input className="li-search" placeholder="Named after the file if left blank" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
          <label className="nb-field">
            <span>Language</span>
            <select className="li-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <small>Every card in the file is this language. Japanese cards are priced off Japanese sales only.</small>
          </label>
          <div className="nb-field">
            <span>Which sales count</span>
            <label className="li-check"><input type="checkbox" checked={anyLanguage} onChange={(e) => setAnyLanguage(e.target.checked)} /> Sales in every language</label>
            <label className="li-check"><input type="checkbox" checked={overseas} onChange={(e) => setOverseas(e.target.checked)} /> Sellers outside the UK</label>
            <small>Both off is UK sales of this language only. Overseas helps Japanese cards with little UK supply; postage is capped at £4 either way.</small>
          </div>
        </div>
      </div>

      <div className="nb-card">
        <div className="nb-h">Listing defaults</div>
        <div className="nb-grid">
          <label className="nb-field">
            <span>Subtype <i>(optional)</i></span>
            <select className="li-select" value={subtype} onChange={(e) => setSubtype(e.target.value)} disabled={!subtypes.length}>
              <option value="">{subtypes.length ? "None" : "No subtypes set up"}</option>
              {subtypes.map((s) => <option key={s.key || s.name || s} value={s.key || s.name || s}>{s.label || s.name || s}</option>)}
            </select>
            {!subtypes.length ? <small>Add them in <a href="/panel/lab/settings">Listing settings</a>.</small> : null}
          </label>
          <label className="nb-field">
            <span>Cost per card <i>(optional)</i></span>
            <input className={`li-num${costBad ? " nb-bad" : ""}`} inputMode="decimal" placeholder="£ e.g. 0.20" value={costText} onChange={(e) => setCostText(e.target.value)} />
            <small>{costBad ? "That isn't an amount." : "What each copy cost you, so a sale says what it made. A cost for the whole lot can be split later."}</small>
          </label>
          <div className="nb-field">
            <span>Pricing</span>
            <label className="li-check"><input type="checkbox" checked={priceNow && queueAvailable} disabled={!queueAvailable} onChange={(e) => setPriceNow(e.target.checked)} /> Price it as soon as it&apos;s loaded</label>
            <small>{queueAvailable ? "Joins the pricing queue: one batch at a time, under SoldComps' limit. You can close the tab." : "The pricing queue isn't set up (migration 048), so price it from inside the batch."}</small>
          </div>
        </div>
      </div>

      <div
        className={`nb-drop${drag ? " on" : ""}${files.length ? " has" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      >
        <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        {files.length ? (
          <>
            <b>{files.length} file{files.length === 1 ? "" : "s"} chosen</b>
            <span className="li-dim">{files.map((f) => f.name).join(", ")}</span>
            <span className="li-dim">Tap to choose different files</span>
          </>
        ) : (
          <>
            <b>Choose the CardUploader export</b>
            <span className="li-dim">or drop the CSV here — several files make one batch</span>
            <span className="li-dim">Automatic eBay Inventory must be OFF in CardUploader, so the file carries your SKUs.</span>
          </>
        )}
      </div>

      <div className="nb-go">
        <button
          className="li-btn primary"
          disabled={busy || !files.length || costBad}
          onClick={() => onCreate({ files, name: name.trim(), language, anyLanguage, overseas, subtype, costPence: cost, priceNow: priceNow && queueAvailable })}
        >
          {busy ? "Creating…" : files.length ? `Create batch${priceNow && queueAvailable ? " and price it" : ""} →` : "Choose a file first"}
        </button>
      </div>
    </section>
  );
}

export const NEW_BATCH_CSS = `
.nb { max-width: 760px; display:flex; flex-direction:column; gap:12px; }
.nb h1 { margin:0; font-size:24px; }
.nb > p { margin:0; }
.nb-back { color:var(--ink-soft); text-decoration:none; font-size:13px; }
.nb-card { border:1px solid var(--line); border-radius:12px; background:var(--surface); }
.nb-h { padding:10px 14px; border-bottom:1px solid var(--line); font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); }
.nb-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:14px; padding:14px; }
.nb-field { display:flex; flex-direction:column; gap:6px; font-size:13px; min-width:0; }
.nb-field > span { font-weight:600; color:var(--ink); }
.nb-field i { font-style:normal; font-weight:400; color:var(--ink-faint); }
.nb-field small { color:var(--ink-faint); line-height:1.4; }
.nb-wide { grid-column: 1 / -1; }
.nb-field .li-num, .nb-field .li-search, .nb-field .li-select { width:100%; flex:none; box-sizing:border-box; }
.nb-bad { border-color:var(--bad) !important; }
.nb-drop { display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; padding:28px 16px; border:2px dashed var(--line-strong); border-radius:12px; cursor:pointer; background:var(--surface); }
.nb-drop.on { border-color:var(--accent); background:var(--accent-soft); }
.nb-drop.has { border-style:solid; border-color:var(--accent); }
.nb-go { display:flex; justify-content:flex-end; }
.nb-go .li-btn { font-size:15px; padding:10px 18px; font-weight:600; }
`;
