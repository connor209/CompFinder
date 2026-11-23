"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  inventoryRows, filterRows, sortRows, pageOf, facets, actionable, parsePence, pricePlan,
  EMPTY_FILTERS, STATUSES, SORTS, PAGE_SIZE
} from "@/lib/lab-inventory.js";
import { removeBlocker } from "@/lib/lab-copies.js";

/**
 * The lab's inventory: one row per card in a condition, its copies
 * underneath. For looking things up and for bulk changes; listing and
 * checking stay on the lab page. Rules in lib/lab-inventory.js.
 */

const box = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16 };
const row = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const small = { fontSize: 13, color: "var(--ink-soft)" };
const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const STATUS_COLOUR = { live: "var(--good)", soldout: "var(--warn)", ended: "var(--ink-faint)" };
const STATE_TEXT = { next: "next to sell", queued: "queued", sold: "sold · to pick", picked: "picked" };

function ago(iso) {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

export default function LabInventory() {
  const [lab, setLab] = useState(null);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("added-desc");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(() => new Set());
  const [ticked, setTicked] = useState(() => new Set());
  const [bulk, setBulk] = useState(null); // null | "price"
  const [priceMode, setPriceMode] = useState("exact");
  const [priceText, setPriceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [failures, setFailures] = useState([]);
  const q = useDeferredValue(f.q);

  const reload = useCallback(async () => setLab(await api()), []);
  useEffect(() => { reload(); }, [reload]);

  const all = useMemo(() => (lab?.ok ? inventoryRows(lab.listings, lab.copies) : []), [lab]);
  const matched = useMemo(() => sortRows(filterRows(all, { ...f, q }), sort), [all, f, q, sort]);
  const view = pageOf(matched, page);
  const fc = useMemo(() => facets(all), [all]);
  const onScreen = actionable(ticked, view.rows);
  const hiddenTicks = ticked.size - onScreen.length;

  // A new search or filter starts at page one.
  useEffect(() => { setPage(1); }, [q, f.status, f.condition, f.pile, f.language, f.subtype, f.waiting, sort]);

  const totals = useMemo(() => ({
    listings: all.filter((r) => r.status !== "ended").length,
    forSale: all.reduce((t, r) => t + (r.status === "ended" ? 0 : r.forSale), 0),
    waiting: all.reduce((t, r) => t + r.waiting, 0),
    value: all.reduce((t, r) => t + (r.status === "ended" || r.pricePence == null ? 0 : r.pricePence * r.forSale), 0)
  }), [all]);

  const plan = useMemo(() => (bulk === "price" ? pricePlan(onScreen, { mode: priceMode, pence: parsePence(priceText) }) : []), [bulk, onScreen, priceMode, priceText]);
  const planGo = plan.filter((p) => !p.skip);

  const setFilter = (patch) => setF((x) => ({ ...x, ...patch }));
  const tick = (id, on) => setTicked((t) => { const n = new Set(t); if (on) n.add(String(id)); else n.delete(String(id)); return n; });
  const allOnPageTicked = view.rows.length > 0 && view.rows.every((r) => ticked.has(String(r.id)));

  async function applyPrices() {
    if (!planGo.length) return;
    if (!window.confirm(`Change the price of ${planGo.length} listing${planGo.length === 1 ? "" : "s"} on eBay?\n\n` +
      planGo.slice(0, 8).map((p) => `${p.row.title}: ${gbp(p.from)} → ${gbp(p.to)}`).join("\n") +
      (planGo.length > 8 ? `\n…and ${planGo.length - 8} more` : ""))) return;
    setBusy(true);
    setMsg(null);
    const r = await api({ action: "setPrices", changes: planGo.map((p) => ({ listingId: p.row.id, pence: p.to })) });
    setBusy(false);
    done(r, "repriced");
  }

  async function endTicked() {
    const live = onScreen.filter((r) => r.status !== "ended");
    if (!live.length) return;
    if (!window.confirm(`End ${live.length} listing${live.length === 1 ? "" : "s"} on eBay?\n\n${live.slice(0, 8).map((r) => r.title).join("\n")}${live.length > 8 ? `\n…and ${live.length - 8} more` : ""}\n\nCopies not yet sold stay in their piles.`)) return;
    setBusy(true);
    setMsg(null);
    const r = await api({ action: "endMany", listingIds: live.map((x) => x.id) });
    setBusy(false);
    done(r, "ended");
  }

  function done(r, verb) {
    if (!r.ok) { setMsg({ bad: true, text: r.error || "That didn't work." }); return; }
    const failed = (r.results || []).filter((x) => !x.ok);
    setFailures(failed.map((x) => ({ title: all.find((a) => String(a.id) === String(x.listingId))?.title || x.listingId, error: x.error })));
    setMsg(failed.length ? { bad: true, text: `${r.changed} ${verb}, ${failed.length} failed — see below.` } : { text: `${r.changed} ${verb}.` });
    setBulk(null);
    setTicked(new Set());
    reload();
  }

  async function removeCopy(row, c) {
    if (!window.confirm(`Take ${c.sku} off "${row.title}"?\n\neBay quantity ${row.forSale} → ${row.forSale - 1}.\n\nThe card is still in its pile — take it out once this is done.`)) return;
    setBusy(true);
    const r = await api({ action: "remove", copyId: c.id });
    setBusy(false);
    setMsg(r.ok ? { text: `${r.sku} removed: eBay quantity ${r.from} → ${r.to}. Take it out of pile ${c.pile}.` } : { bad: true, text: r.error });
    reload();
  }

  if (!lab) return <main style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>Loading the inventory…</main>;
  if (!lab.ok) return <main style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>{lab.missing ? "Run migration 039 first." : `Couldn't load: ${lab.error}`}</main>;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: 16, color: "var(--ink)" }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <a href="/panel/lab" style={small}>← Lab</a>
          <h1 style={{ margin: "4px 0" }}>Inventory</h1>
          <div style={small}>
            {totals.listings} live listing{totals.listings === 1 ? "" : "s"} · {totals.forSale} cop{totals.forSale === 1 ? "y" : "ies"} for sale · {gbp(totals.value)} asked in all
            {totals.waiting ? <> · <span style={{ color: "var(--warn)" }}>{totals.waiting} sold, waiting to be picked</span></> : null}
          </div>
        </div>
        <a className="btn btn-ghost" href="/panel/lab/settings">⚙ Listing settings</a>
      </div>

      {/* ---------------- Search, filters, sort ---------------- */}
      <section style={{ ...box, marginTop: 12 }}>
        <div style={row}>
          <input style={{ flex: "1 1 260px", minWidth: 0 }} placeholder="Search name, set, SKU or eBay item number…" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
          <select value={f.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="">Any status</option>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {fc.conditions.length > 1 && (
            <select value={f.condition} onChange={(e) => setFilter({ condition: e.target.value })}>
              <option value="">Any condition</option>
              {fc.conditions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {fc.piles.length > 1 && (
            <select value={f.pile} onChange={(e) => setFilter({ pile: e.target.value })}>
              <option value="">Any pile</option>
              {fc.piles.map((c) => <option key={c} value={c}>Pile {c}</option>)}
            </select>
          )}
          {fc.languages.length > 1 && (
            <select value={f.language} onChange={(e) => setFilter({ language: e.target.value })}>
              <option value="">Any language</option>
              {fc.languages.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {fc.subtypes.length > 0 && (
            <select value={f.subtype} onChange={(e) => setFilter({ subtype: e.target.value })}>
              <option value="">Any subtype</option>
              {fc.subtypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label style={{ ...row, fontSize: 14 }}><input type="checkbox" checked={f.waiting} onChange={(e) => setFilter({ waiting: e.target.checked })} /> Waiting to be picked</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS) && <button className="btn btn-ghost" onClick={() => setF(EMPTY_FILTERS)}>Clear</button>}
        </div>
        <div style={{ ...small, marginTop: 8 }}>
          {view.total} of {all.length} listing{all.length === 1 ? "" : "s"}
          {view.pages > 1 ? ` · page ${view.page} of ${view.pages}` : ""}
          {hiddenTicks > 0 && <> · <span style={{ color: "var(--warn)" }}>{hiddenTicks} ticked but not on screen — they won&apos;t be acted on</span> <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => setTicked(new Set())}>Untick all</button></>}
        </div>
      </section>

      {/* ---------------- Bulk bar: only what is ticked AND on screen ---------------- */}
      {onScreen.length > 0 && (
        <section style={{ ...box, position: "sticky", top: 8, zIndex: 5, boxShadow: "var(--shadow-2)" }}>
          <div style={row}>
            <strong>{onScreen.length} ticked</strong>
            <button className="btn" disabled={busy} onClick={() => setBulk(bulk === "price" ? null : "price")}>£ Set price…</button>
            <button className="btn btn-ghost" disabled={busy} onClick={endTicked}>End listings</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setTicked(new Set())}>Untick</button>
          </div>
          {bulk === "price" && (
            <div style={{ marginTop: 10 }}>
              <div style={row}>
                <label style={row}><input type="radio" checked={priceMode === "exact"} onChange={() => setPriceMode("exact")} /> One price for all</label>
                {priceMode === "exact" && <input style={{ width: 100 }} inputMode="decimal" placeholder="£" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
                <label style={row}><input type="radio" checked={priceMode === "market"} onChange={() => setPriceMode("market")} /> Each card&apos;s sold-comps price</label>
              </div>
              <div style={{ ...small, marginTop: 8 }}>
                {plan.map((p) => (
                  <div key={p.row.id} style={{ color: p.skip ? "var(--ink-faint)" : undefined }}>
                    {p.row.title}: {p.skip ? `skipped — ${p.skip}` : `${gbp(p.from)} → ${gbp(p.to)}`}
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || !planGo.length} onClick={applyPrices}>
                {busy ? "Changing…" : `Change ${planGo.length} on eBay`}
              </button>
            </div>
          )}
        </section>
      )}
      {msg && <p style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }}>{msg.text}</p>}
      {failures.map((x, i) => <div key={i} style={{ fontSize: 13, color: "var(--bad)" }}>✗ {x.title} — {x.error}</div>)}

      {/* ---------------- Rows ---------------- */}
      <section style={{ ...box, padding: 0 }}>
        <div style={{ ...row, padding: "8px 16px", borderBottom: "1px solid var(--line)", ...small }}>
          <label style={row}><input type="checkbox" checked={allOnPageTicked} onChange={(e) => setTicked((t) => { const n = new Set(t); for (const r of view.rows) { if (e.target.checked) n.add(String(r.id)); else n.delete(String(r.id)); } return n; })} /> Tick this page</label>
          <span style={{ marginLeft: "auto" }}>Copies: for sale · sold, to pick · picked</span>
        </div>
        {view.rows.length === 0 && <p style={{ ...small, padding: 16 }}>{all.length ? "Nothing matches." : "No lab listings yet."}</p>}
        {view.rows.map((r) => {
          const isOpen = open.has(String(r.id));
          return (
            <div key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <div style={{ ...row, padding: "10px 16px", alignItems: "center" }}>
                <input type="checkbox" checked={ticked.has(String(r.id))} onChange={(e) => tick(r.id, e.target.checked)} aria-label={`Tick ${r.title}`} />
                <div style={{ position: "relative" }}>
                  {r.picture
                    ? <img src={r.picture} alt="" referrerPolicy="no-referrer" style={{ width: 48, height: 66, objectFit: "contain", background: "var(--surface-sink)", borderRadius: 4 }} />
                    : <div style={{ width: 48, height: 66, background: "var(--surface-sink)", borderRadius: 4 }} />}
                  {r.pictureIsDb && <span title="The card's database image, not a photo of one of your copies" style={{ position: "absolute", bottom: 0, left: 0, right: 0, fontSize: 9, textAlign: "center", background: "rgba(0,0,0,.6)", color: "#fff" }}>stock</span>}
                </div>
                <button className="btn btn-ghost" style={{ textAlign: "left", flex: "1 1 260px", minWidth: 0, padding: 0 }} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(String(r.id))) n.delete(String(r.id)); else n.add(String(r.id)); return n; })}>
                  <span style={{ display: "block", fontWeight: 600, whiteSpace: "normal" }}>{isOpen ? "▾" : "▸"} {r.name || r.title}</span>
                  <span style={{ display: "block", ...small, whiteSpace: "normal" }}>{[r.set, r.number, r.language, r.subtype].filter(Boolean).join(" · ") || r.title}</span>
                </button>
                <span style={{ width: 36, fontWeight: 600 }}>{r.condition}</span>
                <span style={{ width: 70, color: STATUS_COLOUR[r.status], fontSize: 13 }}>{STATUSES.find(([k]) => k === r.status)?.[1]}</span>
                <span style={{ width: 80, fontVariantNumeric: "tabular-nums" }} title="for sale · sold, to pick · picked">
                  <strong>{r.forSale}</strong> · <span style={{ color: r.waiting ? "var(--warn)" : undefined }}>{r.waiting}</span> · {r.picked}
                </span>
                <span style={{ width: 70, textAlign: "right", fontWeight: 600 }}>{gbp(r.pricePence)}</span>
                <span style={{ width: 90, textAlign: "right", ...small }} title={r.marketAt ? `Sold comps, ${new Date(r.marketAt).toLocaleDateString()}` : "No sold-comps price recorded"}>
                  {r.marketPence != null ? `mkt ${gbp(r.marketPence)}` : "mkt —"}
                </span>
                <span style={{ width: 110, ...small }}>
                  {r.itemId ? <a href={`https://www.ebay.co.uk/itm/${r.itemId}`} target="_blank" rel="noreferrer">eBay ↗</a> : "—"} · {ago(r.addedAt)}
                </span>
              </div>
              {isOpen && (
                <div style={{ ...row, alignItems: "flex-start", padding: "0 16px 12px 56px" }}>
                  {r.copies.map((c) => (
                    <div key={c.id} style={{ width: 110, textAlign: "center", fontSize: 12, opacity: c.state === "picked" ? 0.45 : 1 }}>
                      <a href={c.scan_urls?.[0] || "#"} target="_blank" rel="noreferrer">
                        <img src={c.scan_urls?.[0]} alt="" referrerPolicy="no-referrer" style={{ width: 90, height: 124, objectFit: "contain", background: "var(--surface-sink)", borderRadius: 6, outline: c.onShow ? "3px solid var(--accent)" : "none" }} />
                      </a>
                      <div><strong>{c.sku}</strong></div>
                      <div style={{ color: "var(--ink-soft)" }}>{c.position ? `pile ${c.pile} #${c.position}` : `pile ${c.pile}`}</div>
                      <div style={{ color: c.state === "sold" ? "var(--warn)" : c.onShow ? "var(--accent)" : "var(--ink-soft)" }}>
                        {c.onShow ? "on eBay now" : STATE_TEXT[c.state]}
                        {c.state === "sold" && c.reserved_order ? <div>order {c.reserved_order}</div> : null}
                      </div>
                      {!removeBlocker(c, r.listing, lab.copies) && (
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 6px", marginTop: 2 }} disabled={busy} onClick={() => removeCopy(r, c)}>✕ Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {view.pages > 1 && (
        <div style={{ ...row, justifyContent: "center" }}>
          <button className="btn" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>‹ Previous</button>
          <span style={small}>Page {view.page} of {view.pages} · {PAGE_SIZE} a page</span>
          <button className="btn" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>Next ›</button>
        </div>
      )}
    </main>
  );
}
