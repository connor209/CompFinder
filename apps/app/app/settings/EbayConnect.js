"use client";

import { useEffect, useState } from "react";
import Fold from "../panel/Fold";
import { syncListings, syncNote } from "@/lib/listing-sync.js";

/**
 * "Connect your eBay account" card for Settings. Shows connection state,
 * lets the user connect (OAuth redirect), re-sync their listings, or
 * disconnect. Reads status from /api/ebay/status.
 */
function fmtWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function EbayConnect({ flash }) {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(flash || "");

  async function loadStatus() {
    try {
      const res = await fetch("/api/ebay/status").then((r) => r.json());
      setStatus({ loading: false, ...res });
    } catch {
      setStatus({ loading: false, connected: false, configured: true, error: "Couldn't load eBay status." });
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setMsg("");
    const res = await syncListings();
    setMsg(syncNote(res));
    if (res.ok) await loadStatus();
    setSyncing(false);
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect your eBay account? Cached listings will be removed.")) return;
    setMsg("");
    try {
      await fetch("/api/ebay/disconnect", { method: "POST" });
      setMsg("Disconnected.");
      await loadStatus();
    } catch {
      setMsg("Disconnect failed.");
    }
  }

  return (
    <Fold
      id="settings-ebay"
      title="eBay account"
      summary={
        status.loading ? "Checking connection…"
          : !status.configured ? "Not configured on the server"
          : status.connected ? `Connected${status.username ? ` as ${status.username}` : ""} · ${status.count} listings · synced ${fmtWhen(status.lastSynced)}`
          : "Not connected"
      }
      alert={msg ? <p className="hint hint-small" style={{ marginTop: 6, color: "var(--accent-2)" }}>{msg}</p> : null}
    >

      {status.loading ? (
        <p className="hint hint-small"><span className="spinner" /> &nbsp;Checking connection…</p>
      ) : !status.configured ? (
        <p className="hint hint-small">
          eBay integration isn&apos;t configured on the server yet (missing API keys or redirect name).
        </p>
      ) : status.connected ? (
        <>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Connected{status.username ? <> as <b>{status.username}</b></> : null}. CompFinder has cached{" "}
            <b>{status.count}</b> active listing{status.count === 1 ? "" : "s"} — last synced {fmtWhen(status.lastSynced)}.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button className="btn btn-ghost" onClick={handleDisconnect} disabled={syncing}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Connect your eBay account so CompFinder can pull in all your active listings — it flags cards you already
            have up and powers the “My listings” view. Read-only; you approve it once on eBay.
          </p>
          <a className="btn btn-primary" href="/api/ebay/connect" style={{ marginTop: 8 }}>Connect eBay account</a>
        </>
      )}
    </Fold>
  );
}
