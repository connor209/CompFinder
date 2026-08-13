"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";

const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

function ageDays(startTime) {
  if (!startTime) return null;
  const t = new Date(startTime).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Business dashboard — the "mission control" home. Portfolio value, cost basis
 * and potential margin, plus at-a-glance counts (aged listings, missing cost)
 * and quick jumps into the tools. Loads inventory + costs itself.
 */
export default function Dashboard({ onNavigate }) {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [stats, setStats] = useState(null);

  async function load() {
    let s;
    try {
      s = await fetch("/api/ebay/status").then((r) => r.json());
    } catch {
      s = { connected: false };
    }
    setStatus({ loading: false, ...s });
    if (!s.connected) return;

    const supabase = createClient();
    // Page through listings.
    let from = 0;
    let all = [];
    for (;;) {
      const { data, error } = await supabase
        .from("ebay_listings")
        .select("ebay_item_id,price_value,price_currency,quantity,extra")
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    const { data: costRows } = await supabase.from("listing_costs").select("ebay_item_id,cost_pence");
    const costMap = new Map((costRows || []).map((r) => [r.ebay_item_id, r.cost_pence]));

    let value = 0;
    let costBasis = 0;
    let costedValue = 0;
    let costedCount = 0;
    let aged = 0;
    for (const l of all) {
      const qty = l.quantity || 1;
      const askP = l.price_value != null ? Math.round(l.price_value * 100) : 0;
      value += askP * qty;
      const c = costMap.get(l.ebay_item_id);
      if (c != null) {
        costBasis += c * qty;
        costedValue += askP * qty;
        costedCount += 1;
      }
      const a = ageDays(l.extra?.startTime);
      if (a != null && a > 90) aged += 1;
    }
    setStats({
      count: all.length,
      value,
      costBasis,
      costedValue,
      costedCount,
      missingCost: all.length - costedCount,
      potentialMargin: costedValue - costBasis,
      aged,
      lastSynced: s.lastSynced
    });
  }

  useEffect(() => {
    load();
  }, []);

  if (status.loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading dashboard…</div>;

  if (!status.connected) {
    return (
      <div className="panel">
        <div className="eyebrow">Dashboard</div>
        <p className="hint">
          Connect your eBay account to see your portfolio value, cost basis and margins here.
        </p>
        <a className="btn btn-primary" href="/settings" style={{ marginTop: 10 }}>Connect in Settings →</a>
      </div>
    );
  }

  const marginPct = stats && stats.costBasis > 0 ? Math.round((stats.potentialMargin / stats.costBasis) * 100) : null;

  return (
    <div className="rise-group">
      <div className="stat-row">
        <div className="stat"><div className="k">Portfolio value</div><div className="v">{stats ? pounds(stats.value) : "—"}</div></div>
        <div className="stat"><div className="k">Cost basis</div><div className="v">{stats ? pounds(stats.costBasis) : "—"}</div></div>
        <div className="stat">
          <div className="k">Potential margin</div>
          <div className="v" style={{ color: stats && stats.potentialMargin >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
            {stats ? pounds(stats.potentialMargin) : "—"}{marginPct != null ? ` (${marginPct}%)` : ""}
          </div>
        </div>
        <div className="stat"><div className="k">Active listings</div><div className="v">{stats ? stats.count : "—"}</div></div>
      </div>

      <div className="dash-grid">
        <div className="panel dash-card">
          <div className="panel-head"><h3>Cost coverage</h3></div>
          {stats && stats.missingCost > 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              <b>{stats.costedCount}</b> of {stats.count} listings have a cost recorded — <b>{stats.missingCost}</b> still missing.
              Add costs in the My listings <b>table view</b> (Cost £ column) to unlock true margin.
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 0 }}>All {stats?.count || 0} listings have a cost recorded. 🎉</p>
          )}
          <button className="btn btn-ghost" onClick={() => onNavigate?.("inventory")} style={{ marginTop: 8 }}>Open My listings →</button>
        </div>

        <div className="panel dash-card">
          <div className="panel-head"><h3>Aged listings</h3></div>
          <p className="hint" style={{ marginTop: 0 }}>
            {stats && stats.aged > 0
              ? <><b>{stats.aged}</b> listing(s) have been live over 90 days — candidates to reprice or relist.</>
              : "No listings older than 90 days."}
          </p>
          <p className="hint hint-small">Last synced {stats?.lastSynced ? new Date(stats.lastSynced).toLocaleString() : "—"}.</p>
        </div>

        <div className="panel dash-card">
          <div className="panel-head"><h3>Quick actions</h3></div>
          <div className="dash-actions">
            <button className="btn btn-primary" onClick={() => onNavigate?.("single")}>🔍 Price a card</button>
            <button className="btn btn-ghost" onClick={() => onNavigate?.("arbitrage")}>📊 Find arbitrage</button>
            <button className="btn btn-ghost" onClick={() => onNavigate?.("inventory")}>🏷️ My listings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
