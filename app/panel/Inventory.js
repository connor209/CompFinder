"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * "My listings" stream — the user's active eBay listings, pulled in via the
 * connected account and cached in Supabase (ebay_listings, readable per-user
 * under RLS). Read-only for now: browse, filter, jump to the listing on eBay,
 * or re-sync. Market-price comparison / price editing come in a later phase.
 */
function priceStr(value, currency) {
  if (value == null) return "—";
  if (currency === "GBP") return `£${Number(value).toFixed(2)}`;
  return `${Number(value).toFixed(2)} ${currency || ""}`.trim();
}
function fmtWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Inventory() {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [listings, setListings] = useState([]);
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");

  async function loadStatus() {
    try {
      const res = await fetch("/api/ebay/status").then((r) => r.json());
      setStatus({ loading: false, ...res });
      return res;
    } catch {
      setStatus({ loading: false, connected: false, configured: true });
      return { connected: false };
    }
  }

  async function loadListings() {
    const supabase = createClient();
    const { data } = await supabase
      .from("ebay_listings")
      .select("ebay_item_id,title,price_value,price_currency,quantity,image_url,url,synced_at")
      .order("title", { ascending: true });
    setListings(data || []);
  }

  useEffect(() => {
    (async () => {
      const s = await loadStatus();
      if (s.connected) loadListings();
    })();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setNote("");
    try {
      const res = await fetch("/api/ebay/sync", { method: "POST" }).then((r) => r.json());
      if (res.ok) {
        setNote(`Synced ${res.count} listing${res.count === 1 ? "" : "s"}.`);
        await loadStatus();
        await loadListings();
      } else {
        setNote(res.error || "Sync failed.");
      }
    } catch {
      setNote("Sync failed.");
    }
    setSyncing(false);
  }

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return listings;
    const words = f.split(/\s+/).filter(Boolean);
    return listings.filter((l) => {
      const t = (l.title || "").toLowerCase();
      return words.every((w) => t.includes(w));
    });
  }, [listings, filter]);

  if (status.loading) {
    return (
      <div className="panel"><span className="spinner" /> &nbsp;Loading your eBay listings…</div>
    );
  }

  if (!status.configured) {
    return (
      <div className="panel">
        <div className="eyebrow">My listings</div>
        <p className="hint">eBay integration isn&apos;t configured on the server yet.</p>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="panel">
        <div className="eyebrow">My listings</div>
        <p className="hint">
          Connect your eBay account to pull all your active listings into CompFinder. It&apos;s a one-time approval and
          read-only.
        </p>
        <a className="btn btn-primary" href="/settings" style={{ marginTop: 10 }}>Connect in Settings →</a>
      </div>
    );
  }

  return (
    <>
      <div className="inv-bar">
        <div className="inv-inp">
          <span className="mag" aria-hidden="true">🔍</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter your listings…"
            aria-label="Filter your listings"
          />
        </div>
        <div className="inv-meta">
          <span className="chip">{listings.length} active</span>
          <span className="chip">Synced {fmtWhen(status.lastSynced)}</span>
          <button className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
        </div>
      </div>

      {note && <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p>}

      {shown.length === 0 ? (
        <div className="panel">
          <p className="dd-empty">
            {listings.length === 0 ? "No active listings cached yet — try Sync." : "No listings match that filter."}
          </p>
        </div>
      ) : (
        <div className="inv-grid">
          {shown.map((l) => (
            <div className="inv-card" key={l.ebay_item_id}>
              <div className="inv-thumb">
                {l.image_url ? <img src={l.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">🎴</span>}
              </div>
              <div className="inv-body">
                <a className="inv-title" href={l.url || "#"} target="_blank" rel="noopener noreferrer">{l.title}</a>
                <div className="inv-foot">
                  <span className="inv-price">{priceStr(l.price_value, l.price_currency)}</span>
                  {l.quantity != null ? <span className="inv-qty">Qty {l.quantity}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
