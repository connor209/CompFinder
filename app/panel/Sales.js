"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";
import { resizeImage } from "@/lib/resizeImage";

const RECEIPT_BUCKET = "purchase-photos"; // private per-user bucket, reused for sale receipts
const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}

/**
 * Sales & profit — recent completed eBay sales with real revenue, estimated
 * fees and (where a cost is recorded) true profit. Sales come from the
 * Fulfillment API sync; fees are estimated with a configurable %.
 */
export default function Sales() {
  const [sales, setSales] = useState(null);
  const [costs, setCosts] = useState(new Map());
  const [feePct, setFeePct] = useState(13);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [receiptUrls, setReceiptUrls] = useState({}); // path -> signed URL
  const [attaching, setAttaching] = useState(null); // line_item_id uploading
  const [gallery, setGallery] = useState(null); // { key, index }

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("ebay_sales")
      .select("line_item_id,ebay_item_id,sku,title,quantity,sold_pence,currency,sold_date,receipt_paths")
      .order("sold_date", { ascending: false })
      .limit(500);
    setSales(data || []);
    const { data: costRows } = await supabase.from("listing_costs").select("ebay_item_id,cost_pence");
    setCosts(new Map((costRows || []).map((r) => [r.ebay_item_id, r.cost_pence])));
    const paths = (data || []).flatMap((s) => s.receipt_paths || []);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(paths, 3600);
      const m = {};
      for (const s of signed || []) if (s.signedUrl && !s.error) m[s.path] = s.signedUrl;
      setReceiptUrls(m);
    } else {
      setReceiptUrls({});
    }
  }

  async function attachReceipts(row, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setAttaching(row.line_item_id);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const added = [];
      for (const f of list) {
        const blob = await resizeImage(f);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await sb.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw new Error(upErr.message);
        added.push(path);
      }
      const next = [...(row.receipt_paths || []), ...added];
      await sb.from("ebay_sales").update({ receipt_paths: next }).eq("line_item_id", row.line_item_id);
      await load();
    } catch (e) {
      setNote(e.message || "Couldn't attach the receipt.");
    }
    setAttaching(null);
  }

  async function deleteReceipt(row, path) {
    const sb = createClient();
    const next = (row.receipt_paths || []).filter((p) => p !== path);
    await sb.from("ebay_sales").update({ receipt_paths: next }).eq("line_item_id", row.line_item_id);
    await sb.storage.from(RECEIPT_BUCKET).remove([path]).catch(() => {});
    await load();
    if (next.length === 0) setGallery(null);
    else setGallery((g) => (g ? { ...g, index: Math.min(g.index, next.length - 1) } : g));
  }

  useEffect(() => {
    load();
  }, []);

  async function sync() {
    setSyncing(true);
    setNote("");
    setNeedsReconnect(false);
    try {
      const res = await fetch("/api/ebay/sales/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90 })
      }).then((r) => r.json());
      if (res.ok) {
        setNote(`Synced ${res.count} sale line(s).`);
        await load();
      } else if (res.scopeError) {
        setNeedsReconnect(true);
      } else {
        setNote(res.error || "Sync failed.");
      }
    } catch {
      setNote("Sync failed.");
    }
    setSyncing(false);
  }

  const rows = useMemo(() => {
    return (sales || []).map((s) => {
      const revenue = s.sold_pence ?? null;
      const fees = revenue != null ? Math.round(revenue * (feePct / 100)) : null;
      const unitCost = costs.get(s.ebay_item_id);
      const cost = unitCost != null ? unitCost * (s.quantity || 1) : null;
      const profit = revenue != null && fees != null ? revenue - fees - (cost || 0) : null;
      return { ...s, revenue, fees, cost, profit, hasCost: cost != null };
    });
  }, [sales, costs, feePct]);

  const totals = useMemo(() => {
    let revenue = 0;
    let fees = 0;
    let cost = 0;
    let profit = 0;
    let costed = 0;
    for (const r of rows) {
      revenue += r.revenue || 0;
      fees += r.fees || 0;
      if (r.hasCost) { cost += r.cost; costed += 1; }
      profit += r.profit || 0;
    }
    return { revenue, fees, cost, profit, count: rows.length, costed };
  }, [rows]);

  if (sales === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading sales…</div>;

  return (
    <>
      <div className="stat-row">
        <div className="stat"><div className="k">Revenue (90d)</div><div className="v">{pounds(totals.revenue)}</div></div>
        <div className="stat"><div className="k">Est. fees</div><div className="v">{pounds(totals.fees)}</div></div>
        <div className="stat"><div className="k">Cost of sales</div><div className="v">{pounds(totals.cost)}</div></div>
        <div className="stat">
          <div className="k">Est. profit</div>
          <div className="v" style={{ color: totals.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>{pounds(totals.profit)}</div>
        </div>
      </div>

      <div className="inv-bar">
        <label className="inv-sort">eBay fees %
          <input type="number" min="0" max="30" step="0.5" value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <div className="inv-meta">
          <span className="chip">{totals.count} sale(s)</span>
          <span className="chip">{totals.costed} with cost</span>
          <button className="btn btn-ghost" onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "↻ Sync sales"}</button>
        </div>
      </div>

      {needsReconnect ? (
        <div className="mine-banner">
          <span className="mine-ic" aria-hidden="true">⚠</span>
          <div>
            <strong>Reconnect to enable sales tracking</strong>
            <div className="mine-list">
              <a href="/api/ebay/connect">Reconnect eBay account →</a>
            </div>
            <p className="hint hint-small" style={{ marginTop: 4 }}>Sales tracking needs an extra permission (order history) added after your first connect.</p>
          </div>
        </div>
      ) : null}
      {note ? <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p> : null}

      {rows.length === 0 ? (
        <div className="panel"><p className="dd-empty">No sales cached yet — hit “Sync sales”. (Reconnect first if prompted.)</p></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="itbl">
              <thead>
                <tr><th aria-label="Receipt"></th><th>Date</th><th>Item</th><th>SKU</th><th>Qty</th><th>Sold</th><th>Fees</th><th>Cost</th><th>Profit</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const receipts = r.receipt_paths || [];
                  const cover = receipts.find((p) => receiptUrls[p]);
                  return (
                  <tr key={r.line_item_id}>
                    <td className="buy-photo-cell">
                      {cover ? (
                        <button type="button" className="buy-thumb" onClick={() => setGallery({ key: r.line_item_id, index: 0 })} title={`${receipts.length} receipt(s)`}>
                          <img src={receiptUrls[cover]} alt="Receipt" loading="lazy" />
                          {receipts.length > 1 ? <span className="buy-thumb-badge">{receipts.length}</span> : null}
                        </button>
                      ) : (
                        <label className="buy-thumb-add" title="Attach a receipt / screenshot">
                          {attaching === r.line_item_id ? <span className="spinner" /> : "🧾"}
                          <input type="file" accept="image/*" multiple hidden disabled={attaching === r.line_item_id} onChange={(e) => { const fs = e.target.files; e.target.value = ""; attachReceipts(r, fs); }} />
                        </label>
                      )}
                    </td>
                    <td className="mono">{fmtDate(r.sold_date)}</td>
                    <td className="itbl-title">{r.title}</td>
                    <td className="mono">{r.sku || "—"}</td>
                    <td>{r.quantity || 1}</td>
                    <td className="mono">{pounds(r.revenue)}</td>
                    <td className="mono">{pounds(r.fees)}</td>
                    <td className="mono">{r.hasCost ? pounds(r.cost) : "—"}</td>
                    <td className={`mono ${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}`}>{r.profit != null ? pounds(r.profit) : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(() => {
        if (!gallery) return null;
        const row = rows.find((r) => r.line_item_id === gallery.key);
        const paths = row ? row.receipt_paths || [] : [];
        if (!paths.length) return null;
        const idx = Math.min(gallery.index, paths.length - 1);
        return (
          <div className="buy-lightbox" onClick={() => setGallery(null)} role="dialog" aria-label="Receipts">
            <button className="buy-lightbox-x" onClick={() => setGallery(null)} aria-label="Close">✕</button>
            <div className="buy-lightbox-stage" onClick={(e) => e.stopPropagation()}>
              {paths.length > 1 ? <button className="buy-lb-nav prev" onClick={() => setGallery((g) => ({ ...g, index: (idx - 1 + paths.length) % paths.length }))} aria-label="Previous">‹</button> : null}
              <img src={receiptUrls[paths[idx]]} alt={`Receipt ${idx + 1}`} />
              {paths.length > 1 ? <button className="buy-lb-nav next" onClick={() => setGallery((g) => ({ ...g, index: (idx + 1) % paths.length }))} aria-label="Next">›</button> : null}
            </div>
            <div className="buy-lb-bar" onClick={(e) => e.stopPropagation()}>
              <span className="buy-lb-count">{idx + 1} / {paths.length}</span>
              <label className="btn btn-ghost buy-lb-add">
                {attaching === row.line_item_id ? "Uploading…" : "＋ Add receipt"}
                <input type="file" accept="image/*" multiple hidden disabled={attaching === row.line_item_id} onChange={(e) => { const fs = e.target.files; e.target.value = ""; attachReceipts(row, fs); }} />
              </label>
              <button className="btn btn-ghost buy-lb-del" onClick={() => { if (confirm("Delete this receipt?")) deleteReceipt(row, paths[idx]); }}>🗑 Delete</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
