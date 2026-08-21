"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Market prices — status per game and a manual pull.
 *
 * The nightly cron does this unattended, but it's guarded by CRON_SECRET which
 * a browser can't send, so there's no way to kick one off by hand without a
 * terminal. This panel reads `cm_price_sources` for the last run and triggers
 * `/api/prices/sync` with the signed-in session.
 */
function fmtWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function PriceSync() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null); // game slug, or "all"
  const [msg, setMsg] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    const sb = createClient();
    const [{ data: sources, error }, { data: games }] = await Promise.all([
      sb.from("cm_price_sources").select("game,url,enabled,last_run_at,last_as_of,last_rows,last_error"),
      sb.from("cm_games").select("slug,name,sort_order")
    ]);
    if (error) { setUnavailable(true); setRows([]); return; }
    const byGame = new Map((sources || []).map((s) => [s.game, s]));
    const merged = (games || [])
      .map((g) => ({ ...g, src: byGame.get(g.slug) || null }))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    setRows(merged);
  }
  useEffect(() => { load(); }, []);

  async function run(game) {
    setBusy(game || "all");
    setMsg(game ? `Pulling ${game}…` : "Pulling every game — this can take a few minutes…");
    try {
      const res = await fetch("/api/prices/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(game ? { game } : {})
      }).then((r) => r.json());
      if (!res.ok && res.error) setMsg(res.error);
      else {
        const done = (res.results || []).filter((r) => r.ok);
        const bad = (res.results || []).filter((r) => !r.ok);
        const total = done.reduce((t, r) => t + (r.latest || 0), 0);
        setMsg(
          `${done.length} game(s) updated · ${total.toLocaleString()} prices` +
          (bad.length ? ` · ⚠ ${bad.map((b) => `${b.game}: ${b.error}`).join("; ")}` : "")
        );
      }
    } catch {
      setMsg("Couldn't reach the server — if it timed out, try one game at a time.");
    }
    setBusy(null);
    await load();
  }

  if (rows === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading price sources…</div>;

  if (unavailable) {
    return (
      <div className="panel">
        <div className="panel-head"><h3>Market prices</h3></div>
        <p className="hint hint-small">Run <code>017_price_guide.sql</code> to enable the daily Cardmarket price feed.</p>
      </div>
    );
  }

  const configured = rows.filter((r) => r.src);
  const anyRun = configured.some((r) => r.src.last_rows);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Market prices</h3>
        <button className="btn btn-primary" onClick={() => run(null)} disabled={!!busy || configured.length === 0}>
          {busy === "all" ? "Syncing…" : "↻ Sync all"}
        </button>
      </div>
      <p className="hint hint-small" style={{ marginTop: 0 }}>
        Cardmarket publish a price guide each day; these run automatically at 04:30.
        Pull one by hand here after adding a game, or to check a URL works.
        {!anyRun ? " Nothing has been pulled yet — try a single game first." : ""}
      </p>

      <div className="stack-list">
        {rows.map((g) => {
          const s = g.src;
          const state = !s ? "no URL configured"
            : s.last_error ? `⚠ ${s.last_error}`
            : s.last_rows ? `${s.last_rows.toLocaleString()} prices · ${s.last_as_of || "?"} · ${fmtWhen(s.last_run_at)}`
            : "ready to pull";
          return (
            <div className="stack-row" key={g.slug}>
              <span className="stack-title" style={{ fontWeight: 600, color: "var(--ink)", flex: "0 0 140px" }}>{g.name}</span>
              <span className="stack-title" style={{ color: s?.last_error ? "var(--bad-ink)" : "var(--ink-soft)" }}>{state}</span>
              <button
                className="stack-pull"
                style={{ color: "var(--accent-2)", borderColor: "var(--line-strong)" }}
                onClick={() => run(g.slug)}
                disabled={!s || !!busy}
              >
                {busy === g.slug ? "…" : "Sync"}
              </button>
            </div>
          );
        })}
      </div>
      {msg ? <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{msg}</p> : null}
    </div>
  );
}
