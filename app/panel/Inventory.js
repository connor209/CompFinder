"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * "My listings" stream — the user's active eBay listings, pulled in via the
 * connected account and cached in Supabase (ebay_listings, readable per-user
 * under RLS).
 *
 * Duplicate listings of the same card at the same price are condensed into a
 * single row with a ×N count (expandable to the individual listings). Plus
 * text filter, sort, and a "duplicates only" view. Read-only for now.
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
function normTitle(t) {
  return (t || "").trim().replace(/\s+/g, " ").toLowerCase();
}

const SORTS = [
  { v: "title", l: "Title A–Z" },
  { v: "price-desc", l: "Price: high → low" },
  { v: "price-asc", l: "Price: low → high" },
  { v: "count-desc", l: "Most listed" },
  { v: "qty-desc", l: "Total quantity" }
];

export default function Inventory() {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [listings, setListings] = useState([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("title");
  const [group, setGroup] = useState(true);
  const [dupOnly, setDupOnly] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
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

  // text filter → group (same title + same price) → sort → duplicates-only
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const words = f ? f.split(/\s+/).filter(Boolean) : [];
    const shown = words.length
      ? listings.filter((l) => {
          const t = (l.title || "").toLowerCase();
          return words.every((w) => t.includes(w));
        })
      : listings;

    const useGroup = group || dupOnly;
    let groups;
    if (useGroup) {
      const map = new Map();
      for (const l of shown) {
        const key = `${normTitle(l.title)}|${l.price_value}|${l.price_currency}`;
        if (!map.has(key)) {
          map.set(key, { key, ...l, _count: 0, _qty: 0, _items: [] });
        }
        const g = map.get(key);
        g._count += 1;
        g._qty += l.quantity || 0;
        g._items.push(l);
      }
      groups = [...map.values()];
    } else {
      groups = shown.map((l) => ({ key: l.ebay_item_id, ...l, _count: 1, _qty: l.quantity || 0, _items: [l] }));
    }

    const num = (v) => (v == null ? -Infinity : Number(v));
    const sorters = {
      title: (a, b) => (a.title || "").localeCompare(b.title || ""),
      "price-desc": (a, b) => num(b.price_value) - num(a.price_value),
      "price-asc": (a, b) => num(a.price_value) - num(b.price_value),
      "count-desc": (a, b) => b._count - a._count || (a.title || "").localeCompare(b.title || ""),
      "qty-desc": (a, b) => b._qty - a._qty || (a.title || "").localeCompare(b.title || "")
    };
    groups.sort(sorters[sort] || sorters.title);

    return dupOnly ? groups.filter((g) => g._count > 1) : groups;
  }, [listings, filter, sort, group, dupOnly]);

  function toggleExpand(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (status.loading) {
    return <div className="panel"><span className="spinner" /> &nbsp;Loading your eBay listings…</div>;
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

  const totalShownListings = rows.reduce((n, g) => n + g._count, 0);

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

      <div className="inv-controls">
        <label className="inv-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>{s.l}</option>
            ))}
          </select>
        </label>
        <label className="inv-check">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} disabled={dupOnly} />
          Group duplicates
        </label>
        <label className="inv-check">
          <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
          Duplicates only
        </label>
        <span className="inv-summary">
          {rows.length} {group || dupOnly ? "card(s)" : "listing(s)"}
          {(group || dupOnly) && totalShownListings !== rows.length ? ` · ${totalShownListings} listings` : ""}
        </span>
      </div>

      {note && <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p>}

      {rows.length === 0 ? (
        <div className="panel">
          <p className="dd-empty">
            {listings.length === 0
              ? "No active listings cached yet — try Sync."
              : dupOnly
                ? "No duplicate listings — every card is listed once at a unique price."
                : "No listings match that filter."}
          </p>
        </div>
      ) : (
        <div className="inv-grid">
          {rows.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div className="inv-card" key={g.key}>
                <div className="inv-thumb">
                  {g.image_url ? <img src={g.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">🎴</span>}
                  {g._count > 1 ? <span className="inv-count" title={`${g._count} listings at this price`}>×{g._count}</span> : null}
                </div>
                <div className="inv-body">
                  <a className="inv-title" href={g.url || "#"} target="_blank" rel="noopener noreferrer">{g.title}</a>
                  <div className="inv-foot">
                    <span className="inv-price">{priceStr(g.price_value, g.price_currency)}</span>
                    {g._count > 1 ? (
                      <button className="inv-multi" onClick={() => toggleExpand(g.key)}>
                        {g._count} listed {isOpen ? "▾" : "▸"}
                      </button>
                    ) : g.quantity != null ? (
                      <span className="inv-qty">Qty {g.quantity}</span>
                    ) : null}
                  </div>
                  {isOpen && g._count > 1 ? (
                    <div className="inv-sublist">
                      {g._items.map((it, i) => (
                        <a key={it.ebay_item_id} href={it.url || "#"} target="_blank" rel="noopener noreferrer">
                          Listing {i + 1}{it.quantity != null ? ` · qty ${it.quantity}` : ""} →
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
