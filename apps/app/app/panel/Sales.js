"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@compfinder/core/pricing.js";

const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));
// Shared default eBay final-value fee estimate — kept in step with Accounts.
const DEFAULT_FEE_PCT = 12.8;
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
  const [feePct, setFeePct] = useState(DEFAULT_FEE_PCT);
  const [settings, setSettings] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("ebay_sales")
      .select("line_item_id,ebay_item_id,sku,title,quantity,sold_pence,currency,sold_date")
      .order("sold_date", { ascending: false })
      .limit(500);
    setSales(data || []);
    const { data: costRows } = await supabase.from("listing_costs").select("ebay_item_id,cost_pence");
    setCosts(new Map((costRows || []).map((r) => [r.ebay_item_id, r.cost_pence])));
    // Share the eBay-fee % with the Accounts P&L so the same data reads the same
    // on both screens.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("settings").eq("id", user.id).single();
      const st = profile?.settings || {};
      setSettings(st);
      if (st.accounts?.feePct != null) setFeePct(st.accounts.feePct);
    }
  }

  // Persist the fee back to the shared profile setting (mirrors Accounts).
  async function saveFee(pct) {
    setFeePct(pct);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const next = { ...settings, accounts: { ...(settings.accounts || {}), feePct: pct } };
    setSettings(next);
    await supabase.from("profiles").update({ settings: next }).eq("id", user.id);
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
          <div className="v" style={{ color: totals.profit > 0 ? "var(--good-ink)" : totals.profit < 0 ? "var(--bad-ink)" : "var(--ink)" }}>{pounds(totals.profit)}</div>
        </div>
      </div>

      <div className="inv-bar">
        <label className="inv-sort">eBay fees %
          <input type="number" min="0" max="30" step="0.1" value={feePct} onChange={(e) => saveFee(Number(e.target.value))} style={{ width: 70 }} />
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
                <tr><th>Date</th><th>Item</th><th>SKU</th><th>Qty</th><th>Sold</th><th>Fees</th><th>Cost</th><th>Profit</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line_item_id}>
                    <td className="mono">{fmtDate(r.sold_date)}</td>
                    <td className="itbl-title">{r.title}</td>
                    <td className="mono">{r.sku || "—"}</td>
                    <td>{r.quantity || 1}</td>
                    <td className="mono">{pounds(r.revenue)}</td>
                    <td className="mono">{pounds(r.fees)}</td>
                    <td className="mono">{r.hasCost ? pounds(r.cost) : "—"}</td>
                    <td className={`mono ${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}`}>{r.profit != null ? pounds(r.profit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
