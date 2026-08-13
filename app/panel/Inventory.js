"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;

/**
 * "My listings" stream — the user's active eBay listings (cached in Supabase),
 * with duplicate condensing, sort/filter, portfolio stats, and on-demand
 * repricing intelligence: check a card's recent-sold market price against your
 * ask and flag over/under/in-line. Read-only for now.
 */
function pounds(pence) {
  return pence == null ? "—" : CompFinderPricing.toPoundsStr(pence);
}
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
  { v: "qty-desc", l: "Total quantity" },
  { v: "opportunity", l: "Biggest opportunity (priced)" }
];

// Turn a listing title into a market-price recommendation via SoldComps.
async function priceForTitle(title) {
  const base = CompFinderPricing.simplifyTitle(title || "", settings.stripWords);
  const nameTokens = CompFinderPricing.extractNameTokens(base);
  const m = (title || "").match(/\b([A-Za-z]{0,3}\d{1,4}\s*\/\s*[A-Za-z]{0,3}\d{1,4})\b/);
  const number = m ? m[1].replace(/\s+/g, "") : null;
  const res = await fetch("/api/soldcomps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: base, options: { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 } })
  }).then((r) => r.json());
  if (!res || !res.ok) throw new Error((res && res.error) || "Pricing request failed.");
  return CompFinderPricing.recommend(res.comps || [], settings, nameTokens, "sold", number, null);
}

// Compare a listing's ask to the recommended market price.
function verdictFor(askPence, recPence) {
  if (recPence == null) return { kind: "none", label: "No recent comps" };
  const delta = askPence - recPence;
  if (askPence > recPence * 1.08) return { kind: "over", label: "Above market", delta };
  if (askPence < recPence * 0.92) return { kind: "under", label: "Below market", delta };
  return { kind: "inline", label: "In line", delta };
}

export default function Inventory({ onDeepDive }) {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [listings, setListings] = useState([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("title");
  const [group, setGroup] = useState(true);
  const [dupOnly, setDupOnly] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [priced, setPriced] = useState(() => new Map()); // key -> { loading, recPence, error }
  const [syncing, setSyncing] = useState(false);
  const [pricingAll, setPricingAll] = useState(false);
  const [note, setNote] = useState("");
  const pricedRef = useRef(priced);
  pricedRef.current = priced;

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
    // PostgREST caps a single select at 1000 rows — page through with .range().
    const pageSize = 1000;
    let from = 0;
    let all = [];
    for (;;) {
      const { data, error } = await supabase
        .from("ebay_listings")
        .select("ebay_item_id,title,sku,price_value,price_currency,quantity,image_url,url,synced_at")
        .order("title", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setListings(all);
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
        setPriced(new Map());
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

  // --- portfolio stats (over the full, unfiltered inventory) ---
  const stats = useMemo(() => {
    let value = 0;
    let gbp = true;
    for (const l of listings) {
      if (l.price_currency && l.price_currency !== "GBP") gbp = false;
      value += (Number(l.price_value) || 0) * (l.quantity || 1);
    }
    const uniqueCards = new Set(listings.map((l) => normTitle(l.title))).size;
    return { count: listings.length, value, uniqueCards, gbp };
  }, [listings]);

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
        if (!map.has(key)) map.set(key, { key, ...l, _count: 0, _qty: 0, _items: [] });
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
    const oppOf = (g) => {
      const p = priced.get(g.key);
      if (!p || p.recPence == null || g.price_value == null) return -1;
      return Math.abs(Math.round(g.price_value * 100) - p.recPence);
    };
    const sorters = {
      title: (a, b) => (a.title || "").localeCompare(b.title || ""),
      "price-desc": (a, b) => num(b.price_value) - num(a.price_value),
      "price-asc": (a, b) => num(a.price_value) - num(b.price_value),
      "count-desc": (a, b) => b._count - a._count || (a.title || "").localeCompare(b.title || ""),
      "qty-desc": (a, b) => b._qty - a._qty || (a.title || "").localeCompare(b.title || ""),
      opportunity: (a, b) => oppOf(b) - oppOf(a) || (a.title || "").localeCompare(b.title || "")
    };
    groups.sort(sorters[sort] || sorters.title);

    return dupOnly ? groups.filter((g) => g._count > 1) : groups;
  }, [listings, filter, sort, group, dupOnly, priced]);

  function toggleExpand(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function checkPrice(g) {
    setPriced((prev) => new Map(prev).set(g.key, { loading: true }));
    try {
      const rec = await priceForTitle(g.title);
      setPriced((prev) => new Map(prev).set(g.key, { loading: false, recPence: rec.finalPence ?? null, used: rec.included?.length || 0 }));
    } catch (err) {
      setPriced((prev) => new Map(prev).set(g.key, { loading: false, error: err.message || "Failed" }));
    }
  }

  // Price every visible card, with a small concurrency limit to respect the
  // SoldComps quota and avoid hammering the API.
  async function priceAllVisible() {
    const targets = rows.filter((g) => !pricedRef.current.get(g.key) || pricedRef.current.get(g.key)?.error);
    if (targets.length === 0) return;
    if (!confirm(`Price ${targets.length} card${targets.length === 1 ? "" : "s"}? This uses ${targets.length} SoldComps request${targets.length === 1 ? "" : "s"}.`)) return;
    setPricingAll(true);
    setNote("");
    let i = 0;
    const CONCURRENCY = 3;
    async function worker() {
      while (i < targets.length) {
        const g = targets[i++];
        // eslint-disable-next-line no-await-in-loop
        await checkPrice(g);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setPricingAll(false);
    setNote(`Priced ${targets.length} card${targets.length === 1 ? "" : "s"}.`);
  }

  function exportCsv() {
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Title", "SKU", "Ask", "Currency", "Qty", "Listings", "Market", "Delta", "Verdict", "URL"];
    const lines = [header.join(",")];
    for (const g of rows) {
      const p = priced.get(g.key);
      const askPence = g.price_value != null ? Math.round(g.price_value * 100) : null;
      let market = "";
      let deltaStr = "";
      let verdictLabel = "";
      if (p && !p.loading && !p.error) {
        if (p.recPence != null) {
          market = (p.recPence / 100).toFixed(2);
          if (askPence != null) {
            const d = askPence - p.recPence;
            deltaStr = (d >= 0 ? "+" : "-") + (Math.abs(d) / 100).toFixed(2);
            verdictLabel = verdictFor(askPence, p.recPence).label;
          }
        } else {
          verdictLabel = "No recent comps";
        }
      }
      const skus = g._items.map((i) => i.sku).filter(Boolean).join(" | ");
      const row = [
        g.title,
        skus,
        g.price_value != null ? Number(g.price_value).toFixed(2) : "",
        g.price_currency || "",
        g._qty,
        g._count,
        market,
        deltaStr,
        verdictLabel,
        g.url || ""
      ];
      lines.push(row.map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "compfinder-inventory.csv";
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="stat-row">
        <div className="stat"><div className="k">Active listings</div><div className="v">{stats.count}</div></div>
        <div className="stat"><div className="k">Unique cards</div><div className="v">{stats.uniqueCards}</div></div>
        <div className="stat">
          <div className="k">Inventory value</div>
          <div className="v">{stats.gbp ? pounds(Math.round(stats.value * 100)) : `~£${stats.value.toFixed(0)}`}</div>
        </div>
        <div className="stat"><div className="k">Last synced</div><div className="v" style={{ fontSize: 13 }}>{fmtWhen(status.lastSynced)}</div></div>
      </div>

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
          <button className="btn btn-ghost" onClick={priceAllVisible} disabled={pricingAll || rows.length === 0}>
            {pricingAll ? "Pricing…" : "💷 Price visible"}
          </button>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={rows.length === 0}>⤓ CSV</button>
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
            const p = priced.get(g.key);
            const askPence = g.price_value != null ? Math.round(g.price_value * 100) : null;
            const verdict = p && !p.loading && !p.error && askPence != null ? verdictFor(askPence, p.recPence) : null;
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
                  {g._count === 1 && g.sku ? <div className="inv-sku">SKU {g.sku}</div> : null}

                  {/* Repricing intelligence */}
                  {p?.loading ? (
                    <div className="inv-reprice loading"><span className="spinner" /> &nbsp;Checking market…</div>
                  ) : p?.error ? (
                    <div className="inv-reprice err">{p.error}</div>
                  ) : verdict ? (
                    <div className={`inv-reprice v-${verdict.kind}`}>
                      {verdict.kind === "none" ? (
                        <span>No recent sold comps</span>
                      ) : (
                        <>
                          <span className="rp-badge">{verdict.kind === "over" ? "▲" : verdict.kind === "under" ? "▼" : "＝"} {verdict.label}</span>
                          <span className="rp-detail">
                            Market {pounds(p.recPence)}
                            {verdict.delta ? ` · you ${verdict.delta > 0 ? "+" : "−"}${pounds(Math.abs(verdict.delta))}` : ""}
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}

                  <div className="inv-actions">
                    <button className="inv-act" onClick={() => checkPrice(g)} disabled={p?.loading}>
                      {p && !p.loading ? "↻ Re-check" : "Check price"}
                    </button>
                    {onDeepDive ? (
                      <button className="inv-act" onClick={() => onDeepDive(g.title)}>Deep dive ↗</button>
                    ) : null}
                  </div>

                  {isOpen && g._count > 1 ? (
                    <div className="inv-sublist">
                      {g._items.map((it, i) => (
                        <a key={it.ebay_item_id} href={it.url || "#"} target="_blank" rel="noopener noreferrer">
                          {it.sku ? `SKU ${it.sku}` : `Listing ${i + 1}`}{it.quantity != null ? ` · qty ${it.quantity}` : ""} →
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
