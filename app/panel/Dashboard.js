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
 * Portfolio value over time — a small SVG area chart of inventory ask value
 * with cost basis as a second line. Uniform-scaled viewBox (CSS width:100%),
 * so strokes stay crisp at any size. Degrades gracefully to a message when
 * there's only a single day of history.
 */
function PortfolioChart({ history }) {
  if (!history || history.length === 0) return null;
  const W = 600;
  const H = 170;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const pts = history.map((h) => ({
    d: h.snapshot_date,
    v: h.inventory_value_pence || 0,
    c: h.cost_basis_pence || 0
  }));
  const maxV = Math.max(1, ...pts.map((p) => Math.max(p.v, p.c)));
  const n = pts.length;
  const x = (i) => (n === 1 ? pad.l + iw / 2 : pad.l + (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / maxV) * ih;

  const last = pts[n - 1];
  const first = pts[0];
  const change = last.v - first.v;
  const fmtShort = (d) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };

  if (n === 1) {
    return (
      <div className="panel dash-card" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-head"><h3>Portfolio value over time</h3></div>
        <p className="hint" style={{ marginTop: 0 }}>
          Today&apos;s value is <b>{pounds(last.v)}</b>. Come back tomorrow — a new point is captured each day so you can watch your inventory trend.
        </p>
      </div>
    );
  }

  const valLine = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${valLine} L${x(n - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;
  const costLine = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const hasCost = pts.some((p) => p.c > 0);

  return (
    <div className="panel dash-card" style={{ gridColumn: "1 / -1" }}>
      <div className="panel-head">
        <h3>Portfolio value over time</h3>
        <span className="badge2" style={{ color: change >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
          {change >= 0 ? "▲" : "▼"} {pounds(Math.abs(change))} since {fmtShort(first.d)}
        </span>
      </div>
      <svg className="pf-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Portfolio value over time">
        <path d={area} className="pf-area" />
        <path d={valLine} className="pf-line" />
        {hasCost ? <path d={costLine} className="pf-cost" /> : null}
        <circle cx={x(n - 1)} cy={y(last.v)} r="3.5" className="pf-dot" />
      </svg>
      <div className="pf-legend">
        <span><i className="pf-sw pf-sw-val" /> Value {pounds(last.v)}</span>
        {hasCost ? <span><i className="pf-sw pf-sw-cost" /> Cost basis {pounds(last.c)}</span> : null}
        <span className="pf-axis">{fmtShort(first.d)} → {fmtShort(last.d)}</span>
      </div>
    </div>
  );
}

/**
 * Business dashboard — the "mission control" home. Portfolio value, cost basis
 * and potential margin, plus at-a-glance counts (aged listings, missing cost)
 * and quick jumps into the tools. Loads inventory + costs itself.
 */
export default function Dashboard({ onNavigate }) {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [stats, setStats] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [history, setHistory] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const show = (k) => !prefs || prefs[k] !== false;

  async function load() {
    let s;
    try {
      s = await fetch("/api/ebay/status").then((r) => r.json());
    } catch {
      s = { connected: false };
    }
    setStatus({ loading: false, ...s });

    const supabase = createClient();
    // Onboarding checks — shown until the essentials are set up.
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      const [{ data: profile }, { count: checks }] = await Promise.all([
        supabase.from("profiles").select("soldcomps_api_key, settings").eq("id", user.id).single(),
        supabase.from("price_checks").select("*", { count: "exact", head: true })
      ]);
      setPrefs(profile?.settings?.dashboard || {});
      setOnboarding({ hasKey: !!(profile && profile.soldcomps_api_key), connected: !!s.connected, firstSearch: (checks || 0) > 0 });
    } catch {
      setOnboarding({ hasKey: false, connected: !!s.connected, firstSearch: false });
    }

    if (!s.connected) return;

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

    // Portfolio value over time: refresh today's snapshot, then read the series.
    try {
      await fetch("/api/portfolio/snapshot", { method: "POST" });
    } catch {
      /* snapshot best-effort — the chart still shows whatever exists */
    }
    try {
      const { data: snaps } = await supabase
        .from("portfolio_snapshots")
        .select("snapshot_date,inventory_value_pence,cost_basis_pence")
        .order("snapshot_date", { ascending: true });
      setHistory(snaps || []);
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (status.loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading dashboard…</div>;

  const steps = onboarding
    ? [
        { key: "key", label: "Add your SoldComps API key", desc: "Powers pricing from real eBay sold listings.", done: onboarding.hasKey, cta: "Add key", act: () => { window.location.href = "/settings"; } },
        { key: "ebay", label: "Connect your eBay account", desc: "Sync listings & sales, and unlock the inventory tools.", done: onboarding.connected, cta: "Connect", act: () => { window.location.href = "/settings"; } },
        { key: "search", label: "Run your first price check", desc: "Search a card for a full deep dive.", done: onboarding.firstSearch, cta: "Search", act: () => onNavigate?.("single") }
      ]
    : [];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = onboarding && doneCount === steps.length;
  const marginPct = stats && stats.costBasis > 0 ? Math.round((stats.potentialMargin / stats.costBasis) * 100) : null;

  return (
    <div className="rise-group">
      {show("onboarding") && onboarding && !allDone ? (
        <div className="panel onb">
          <div className="panel-head">
            <span className="eyebrow">Get started</span>
            <span className="badge2">{doneCount}/{steps.length}</span>
          </div>
          <div className="onb-steps">
            {steps.map((st) => (
              <div className={`onb-step${st.done ? " done" : ""}`} key={st.key}>
                <span className="onb-check">{st.done ? "✓" : "○"}</span>
                <div className="onb-body">
                  <strong>{st.label}</strong>
                  <span>{st.desc}</span>
                </div>
                {!st.done ? <button className="btn btn-primary" onClick={st.act}>{st.cta}</button> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!status.connected ? (
        <div className="panel">
          <div className="eyebrow">Dashboard</div>
          <p className="hint">Connect your eBay account to unlock portfolio value, cost basis and margins here.</p>
        </div>
      ) : (
      <>
      {show("portfolio") ? (
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
      ) : null}

      <div className="dash-grid">
        {show("valueChart") ? <PortfolioChart history={history} /> : null}
        {show("costCoverage") ? (
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
        ) : null}

        {show("aged") ? (
        <div className="panel dash-card">
          <div className="panel-head"><h3>Aged listings</h3></div>
          <p className="hint" style={{ marginTop: 0 }}>
            {stats && stats.aged > 0
              ? <><b>{stats.aged}</b> listing(s) have been live over 90 days — candidates to reprice or relist.</>
              : "No listings older than 90 days."}
          </p>
          <p className="hint hint-small">Last synced {stats?.lastSynced ? new Date(stats.lastSynced).toLocaleString() : "—"}. Auto-syncs daily.</p>
        </div>
        ) : null}

        {show("quickActions") ? (
        <div className="panel dash-card">
          <div className="panel-head"><h3>Quick actions</h3></div>
          <div className="dash-actions">
            <button className="btn btn-primary" onClick={() => onNavigate?.("single")}>🔍 Price a card</button>
            <button className="btn btn-ghost" onClick={() => onNavigate?.("buy")}>🛒 Log a purchase</button>
            <button className="btn btn-ghost" onClick={() => onNavigate?.("arbitrage")}>📊 Find arbitrage</button>
            <button className="btn btn-ghost" onClick={() => onNavigate?.("inventory")}>🏷️ My listings</button>
          </div>
        </div>
        ) : null}
      </div>
      </>
      )}
    </div>
  );
}
