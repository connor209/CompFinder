"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@compfinder/core/pricing.js";
import EbayActivity from "./EbayActivity";
import MarketLinks from "./MarketLinks";
import ColumnPicker, { useColumns } from "./ColumnPicker";
import { checkoutStackCard, getHideMode } from "@/lib/checkout";

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
// Prefers the catalog resolver (canonical, language-aware); falls back to the
// local buildCardQuery when the listing didn't resolve.
async function priceForTitle(title) {
  let query;
  let nameTokens;
  let number;
  try {
    const rr = await fetch(`/api/catalog/resolve?title=${encodeURIComponent(title || "")}`).then((r) => r.json());
    if (rr.ok && rr.available && rr.result && rr.result.matched) {
      ({ query, nameTokens, number } = rr.result);
    }
  } catch {
    /* fall back below */
  }
  if (!query) {
    const b = CompFinderPricing.buildCardQuery(title || "");
    query = b.query;
    nameTokens = b.nameTokens;
    number = b.number;
  }
  const res = await fetch("/api/soldcomps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, options: { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 } })
  }).then((r) => r.json());
  if (!res || !res.ok) throw new Error((res && res.error) || "Pricing request failed.");
  return CompFinderPricing.recommend(res.comps || [], settings, nameTokens, "sold", number || null, null);
}

// Compare a listing's ask to the recommended market price.
function verdictFor(askPence, recPence) {
  if (recPence == null) return { kind: "none", label: "No recent comps" };
  const delta = askPence - recPence;
  if (askPence > recPence * 1.08) return { kind: "over", label: "Above market", delta };
  if (askPence < recPence * 0.92) return { kind: "under", label: "Below market", delta };
  return { kind: "inline", label: "In line", delta };
}

function ageDays(startTime) {
  if (!startTime) return null;
  const t = new Date(startTime).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
function skusOf(g) {
  const s = g._items.map((i) => i.sku).filter(Boolean);
  return s.length ? s.join(", ") : "—";
}

// Table columns for the "pick columns" view. Each cell gets (g, ctx) where
// ctx.priced is the repricing map. `always` columns can't be hidden.
const ALL_COLUMNS = [
  { key: "image", label: "Image", always: false, cell: (g) => (g.image_url ? <img className="itbl-img" src={g.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">🎴</span>) },
  { key: "title", label: "Title", always: true, cell: (g) => <a href={g.url || "#"} target="_blank" rel="noopener noreferrer">{g.title}</a> },
  { key: "sku", label: "SKU", cell: (g) => <span className="mono">{skusOf(g)}</span> },
  { key: "price", label: "Ask", cell: (g) => <span className="mono">{priceStr(g.price_value, g.price_currency)}</span> },
  { key: "qty", label: "Qty", cell: (g) => g._qty },
  { key: "listings", label: "Listings", cell: (g) => g._count },
  {
    key: "market",
    label: "Market",
    cell: (g, ctx) => {
      const p = ctx.priced.get(g.key);
      if (p?.loading) return <span className="itbl-progress" aria-label="Checking price"><i /></span>;
      if (p?.error) return <span className="mono neg" title={p.error}>err</span>;
      if (p && p.recPence != null) return <span className="mono">{pounds(p.recPence)}</span>;
      if (p && p.recPence == null) return <span className="mono muted">no comps</span>;
      return <button className="itbl-check" onClick={() => ctx.onCheck(g)}>Check</button>;
    }
  },
  {
    key: "delta",
    label: "Δ vs ask",
    cell: (g, ctx) => {
      const p = ctx.priced.get(g.key);
      const ask = g.price_value != null ? Math.round(g.price_value * 100) : null;
      if (!p || p.recPence == null || ask == null) return "—";
      const d = ask - p.recPence;
      return <span className={`mono ${d > 0 ? "pos" : d < 0 ? "neg" : ""}`}>{d > 0 ? "+" : ""}{pounds(d)}</span>;
    }
  },
  {
    key: "verdict",
    label: "Verdict",
    cell: (g, ctx) => {
      const p = ctx.priced.get(g.key);
      const ask = g.price_value != null ? Math.round(g.price_value * 100) : null;
      if (!p || p.recPence == null || ask == null) return "—";
      return verdictFor(ask, p.recPence).label;
    }
  },
  {
    key: "cost",
    label: "Cost £",
    cell: (g, ctx) => {
      const cp = ctx.costs.get(g.ebay_item_id);
      return (
        <input
          className="itbl-cost"
          type="number"
          step="0.01"
          min="0"
          placeholder="—"
          defaultValue={cp != null ? (cp / 100).toFixed(2) : ""}
          key={cp == null ? "e" : cp}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={(e) => ctx.onSetCost(g, e.target.value)}
        />
      );
    }
  },
  {
    key: "margin",
    label: "Margin",
    cell: (g, ctx) => {
      const cost = ctx.costs.get(g.ebay_item_id);
      if (cost == null) return "—";
      const p = ctx.priced.get(g.key);
      const basis = p && p.recPence != null ? p.recPence : g.price_value != null ? Math.round(g.price_value * 100) : null;
      if (basis == null) return "—";
      const m = basis - cost;
      return <span className={`mono ${m > 0 ? "pos" : m < 0 ? "neg" : ""}`}>{m > 0 ? "+" : ""}{pounds(m)}</span>;
    }
  },
  { key: "condition", label: "Condition", cell: (g) => g.extra?.condition || "—" },
  { key: "format", label: "Format", cell: (g) => g.extra?.format || "—" },
  { key: "sold", label: "Sold", cell: (g) => (g.extra?.quantitySold ?? "—") },
  { key: "watchers", label: "Watchers", cell: (g) => (g.extra?.watchCount ?? "—") },
  { key: "age", label: "Age (days)", cell: (g) => { const d = ageDays(g.extra?.startTime); return d == null ? "—" : d; } },
  { key: "itemId", label: "Item ID", cell: (g) => <span className="mono">{g.ebay_item_id}</span> },
  {
    key: "actions",
    label: "Actions",
    cell: (g, ctx) => {
      const u = ctx.updating.get(g.key);
      const p = ctx.priced.get(g.key);
      const ask = g.price_value != null ? Math.round(g.price_value * 100) : null;
      const canUpdate = p && !p.loading && !p.error && p.recPence != null && ask != null && Math.abs(p.recPence - ask) >= 1;
      return (
        <span className="itbl-acts">
          {u?.loading ? (
            <span className="itbl-progress" aria-label="Updating"><i /></span>
          ) : u?.done ? (
            <span className="pos">✓ set</span>
          ) : canUpdate ? (
            <button className="itbl-set" onClick={() => ctx.onUpdate(g)} title="Update eBay price to market">↳ {pounds(p.recPence)}</button>
          ) : null}
          <button className="itbl-end" onClick={() => ctx.onEnd(g)} title="End (delist) on eBay">End</button>
        </span>
      );
    }
  }
];
const DEFAULT_COLS = ["image", "title", "sku", "price", "cost", "market", "margin", "actions"];

export default function Inventory({ onDeepDive }) {
  const [status, setStatus] = useState({ loading: true, connected: false, configured: true });
  const [listings, setListings] = useState([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("title");
  const [group, setGroup] = useState(true);
  const [dupOnly, setDupOnly] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [priced, setPriced] = useState(() => new Map()); // key -> { loading, recPence, error }
  const [costs, setCosts] = useState(() => new Map()); // ebay_item_id -> cost_pence
  const [updating, setUpdating] = useState(() => new Map()); // key -> { loading, done, error }
  const [syncing, setSyncing] = useState(false);
  const [pricingAll, setPricingAll] = useState(false);
  const [note, setNote] = useState("");
  const [view, setView] = useState("cards");
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const { cols, toggle: toggleCol, reset: resetCols, visible: visibleCols } = useColumns("cf-inv-cols", DEFAULT_COLS);
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
        .select("*")
        .order("title", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setListings(all);
  }

  async function loadCosts() {
    const supabase = createClient();
    const { data } = await supabase.from("listing_costs").select("ebay_item_id,cost_pence");
    const m = new Map();
    (data || []).forEach((r) => m.set(r.ebay_item_id, r.cost_pence));
    setCosts(m);
  }

  async function setCost(g, value) {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const ids = g._items.map((it) => it.ebay_item_id);
    const raw = String(value == null ? "" : value).trim();
    if (raw === "") {
      await supabase.from("listing_costs").delete().eq("user_id", user.id).in("ebay_item_id", ids);
      setCosts((prev) => { const n = new Map(prev); ids.forEach((id) => n.delete(id)); return n; });
      return;
    }
    const pence = Math.round(parseFloat(raw) * 100);
    if (!Number.isFinite(pence) || pence < 0) return;
    const rows = ids.map((id) => ({ user_id: user.id, ebay_item_id: id, cost_pence: pence, updated_at: new Date().toISOString() }));
    await supabase.from("listing_costs").upsert(rows, { onConflict: "user_id,ebay_item_id" });
    setCosts((prev) => { const n = new Map(prev); ids.forEach((id) => n.set(id, pence)); return n; });
  }

  useEffect(() => {
    (async () => {
      const s = await loadStatus();
      if (s.connected) {
        loadListings();
        loadCosts();
      }
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
        await loadCosts();
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

  // Write-back: set the listing(s) in a group to the recommended market price
  // on eBay. Confirms first; handles the server's drastic-change guard.
  async function updateToMarket(g) {
    const p = priced.get(g.key);
    if (!p || p.recPence == null) return;
    const newPrice = Math.round(p.recPence) / 100;
    const from = g.price_value != null ? `£${Number(g.price_value).toFixed(2)}` : "current";
    const n = g._items.length;
    if (!confirm(`Update ${n} live eBay listing${n === 1 ? "" : "s"} of "${g.title}" from ${from} to £${newPrice.toFixed(2)}?\n\nThis changes your real listing${n === 1 ? "" : "s"} on eBay.`)) return;

    setUpdating((prev) => new Map(prev).set(g.key, { loading: true }));
    try {
      for (const it of g._items) {
        let res = await fetch("/api/ebay/revise-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: it.ebay_item_id, price: newPrice })
        }).then((r) => r.json());
        if (res.needsConfirm) {
          if (!confirm(`${res.warning}\n\nProceed with £${newPrice.toFixed(2)}?`)) {
            setUpdating((prev) => new Map(prev).set(g.key, { loading: false, error: "Cancelled" }));
            return;
          }
          res = await fetch("/api/ebay/revise-price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: it.ebay_item_id, price: newPrice, force: true })
          }).then((r) => r.json());
        }
        if (!res.ok) throw new Error(res.error || "Update failed");
      }
      // Reflect new price locally (re-groups under the new price).
      const ids = new Set(g._items.map((it) => it.ebay_item_id));
      setListings((prev) => prev.map((l) => (ids.has(l.ebay_item_id) ? { ...l, price_value: newPrice } : l)));
      setUpdating((prev) => new Map(prev).set(g.key, { loading: false, done: true }));
      setNote(`Updated ${n} listing${n === 1 ? "" : "s"} to £${newPrice.toFixed(2)} on eBay.`);
    } catch (err) {
      setUpdating((prev) => new Map(prev).set(g.key, { loading: false, error: err.message || "Update failed" }));
    }
  }

  // Delist (end) all listings in a group on eBay.
  async function endOne(g) {
    const n = g._items.length;
    if (!confirm(`END ${n} live eBay listing${n === 1 ? "" : "s"} of "${g.title}"?\n\nThis permanently removes the listing${n === 1 ? "" : "s"} from eBay. This cannot be undone here.`)) return;
    setUpdating((prev) => new Map(prev).set(g.key, { loading: true }));
    try {
      for (const it of g._items) {
        const res = await fetch("/api/ebay/end-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: it.ebay_item_id })
        }).then((r) => r.json());
        if (!res.ok) throw new Error(res.error || "End failed");
      }
      const ids = new Set(g._items.map((it) => it.ebay_item_id));
      setListings((prev) => prev.filter((l) => !ids.has(l.ebay_item_id)));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(g.key);
        return next;
      });
      setNote(`Ended ${n} listing${n === 1 ? "" : "s"} on eBay.`);
    } catch (err) {
      setUpdating((prev) => new Map(prev).set(g.key, { loading: false, error: err.message || "End failed" }));
    }
  }

  // Check a group's cards out to a show (Show desk) — matched by SKU.
  async function showOut(g) {
    const skus = g._items.map((it) => it.sku).filter(Boolean);
    if (skus.length === 0) {
      setNote("No SKU on this listing — check it out from Stacks or the Show desk instead.");
      return;
    }
    const what = skus.length === 1 ? `"${skus[0]}"` : `${skus.length} cards`;
    if (!confirm(`Check ${what} out to a show?\n\nEach card leaves its stack's live numbering and the listing is taken off sale (per your Show desk hide setting). Manage them from the Show desk.`)) return;
    setUpdating((prev) => new Map(prev).set(g.key, { loading: true }));
    const sb = createClient();
    const { data: stacks } = await sb.from("card_stacks").select("id,name");
    const stackNm = new Map((stacks || []).map((s) => [s.id, s.name]));
    let ok = 0;
    const errs = [];
    for (const sku of skus) {
      const { data: matches } = await sb.from("stack_cards").select("*").ilike("sku", sku);
      const card = (matches || []).find((c) => !c.pulled_at && !c.checked_out_at);
      if (!card) { errs.push(`${sku}: not in your stacks`); continue; }
      const r = await checkoutStackCard(sb, { card, stackName: stackNm.get(card.stack_id) || null, event: null, hideMode: getHideMode() });
      if (r.ok) ok += 1;
      else { errs.push(`${sku}: ${r.error}`); if (r.needsMigration) break; }
    }
    setUpdating((prev) => { const n = new Map(prev); n.delete(g.key); return n; });
    setNote(`Checked out ${ok} card(s) to the Show desk.${errs.length ? ` ⚠ ${errs.join(" · ")}` : ""}`);
  }

  // Bulk write-back: update every selected (priced) card to its market price,
  // with a single confirm and drastic-change items skipped rather than forced.
  async function updateSelectedToMarket() {
    const targets = rows.filter((g) => {
      if (!selected.has(g.key)) return false;
      const p = priced.get(g.key);
      const ask = g.price_value != null ? Math.round(g.price_value * 100) : null;
      return p && !p.loading && !p.error && p.recPence != null && ask != null && Math.abs(p.recPence - ask) >= 1;
    });
    if (targets.length === 0) {
      setNote("No selected cards have a market price to apply — run a price check first.");
      return;
    }
    if (!confirm(`Update ${targets.length} selected listing${targets.length === 1 ? "" : "s"} to their market prices on eBay?\n\nThis changes your real listings. Drastic changes (>5× / <20%) are skipped.`)) return;

    setPricingAll(true);
    setNote("");
    let applied = 0;
    let skipped = 0;
    for (const g of targets) {
      const newPrice = Math.round(priced.get(g.key).recPence) / 100;
      setUpdating((prev) => new Map(prev).set(g.key, { loading: true }));
      try {
        for (const it of g._items) {
          const res = await fetch("/api/ebay/revise-price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: it.ebay_item_id, price: newPrice })
          }).then((r) => r.json());
          if (res.needsConfirm) {
            skipped++;
            throw new Error("Skipped — big change");
          }
          if (!res.ok) throw new Error(res.error || "Update failed");
        }
        const ids = new Set(g._items.map((it) => it.ebay_item_id));
        setListings((prev) => prev.map((l) => (ids.has(l.ebay_item_id) ? { ...l, price_value: newPrice } : l)));
        setUpdating((prev) => new Map(prev).set(g.key, { loading: false, done: true }));
        applied++;
      } catch (err) {
        setUpdating((prev) => new Map(prev).set(g.key, { loading: false, error: err.message || "Failed" }));
      }
    }
    setPricingAll(false);
    setNote(`Updated ${applied} listing${applied === 1 ? "" : "s"} to market${skipped ? ` · ${skipped} skipped (too big a change — update individually)` : ""}.`);
  }

  // Price a set of cards, concurrency-limited to respect the SoldComps quota.
  async function priceMany(targets, labelWhat) {
    const todo = targets.filter((g) => !pricedRef.current.get(g.key) || pricedRef.current.get(g.key)?.error);
    if (todo.length === 0) return;
    if (!confirm(`Price ${todo.length} ${labelWhat}? This uses ${todo.length} SoldComps request${todo.length === 1 ? "" : "s"}.`)) return;
    setPricingAll(true);
    setNote("");
    let i = 0;
    const CONCURRENCY = 3;
    async function worker() {
      while (i < todo.length) {
        const g = todo[i++];
        // eslint-disable-next-line no-await-in-loop
        await checkPrice(g);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    setPricingAll(false);
    setNote(`Priced ${todo.length} card${todo.length === 1 ? "" : "s"}.`);
  }
  const priceAllVisible = () => priceMany(rows, `card${rows.length === 1 ? "" : "s"}`);
  const priceSelected = () => priceMany(rows.filter((g) => selected.has(g.key)), "selected card(s)");

  function toggleSel(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelAll(allSelected) {
    setSelected(allSelected ? new Set() : new Set(rows.map((g) => g.key)));
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
          {view === "table" && selected.size > 0 ? (
            <>
              <button className="btn btn-primary" onClick={priceSelected} disabled={pricingAll}>
                {pricingAll ? "Pricing…" : `💷 Price selected (${selected.size})`}
              </button>
              <button className="btn btn-ghost" onClick={updateSelectedToMarket} disabled={pricingAll} title="Update selected listings to market price on eBay">
                ⤴ Update selected
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={priceAllVisible} disabled={pricingAll || rows.length === 0}>
              {pricingAll ? "Pricing…" : "💷 Price visible"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={exportCsv} disabled={rows.length === 0}>⤓ CSV</button>
          <button className="btn btn-ghost" aria-pressed={showActivity} onClick={() => setShowActivity((s) => !s)}>🕘 Activity</button>
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
        <div className="view-toggle" role="group" aria-label="Inventory view">
          <button aria-pressed={view === "cards"} onClick={() => setView("cards")}>▦ Cards</button>
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>☰ Table</button>
        </div>
        {view === "table" ? (
          <ColumnPicker columns={ALL_COLUMNS} cols={cols} onToggle={toggleCol} onReset={resetCols} />
        ) : null}
      </div>

      {note && <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p>}

      {showActivity ? <EbayActivity onChange={() => { loadStatus(); loadListings(); }} /> : null}

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
      ) : view === "table" ? (
        <div className="table-wrap">
          <table className="itbl">
            <thead>
              <tr>
                <th className="itbl-selcol">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && rows.every((g) => selected.has(g.key))}
                    onChange={() => toggleSelAll(rows.length > 0 && rows.every((g) => selected.has(g.key)))}
                  />
                </th>
                {visibleCols(ALL_COLUMNS).map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key} className={selected.has(g.key) ? "is-sel" : ""}>
                  <td className="itbl-selcol">
                    <input type="checkbox" aria-label="Select row" checked={selected.has(g.key)} onChange={() => toggleSel(g.key)} />
                  </td>
                  {visibleCols(ALL_COLUMNS).map((c) => (
                    <td key={c.key} className={`itbl-${c.key}`}>
                      {c.cell(g, { priced, onCheck: checkPrice, updating, onUpdate: updateToMarket, onEnd: endOne, costs, onSetCost: setCost })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="inv-grid rise-grid">
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
                    <button className="inv-act" onClick={() => showOut(g)} title="Check out to a show — hides the listing, stack numbering re-flows">⤴ Show</button>
                    <MarketLinks query={g.title} gameSlug="pokemon" label={g.title} />
                  </div>
                  {(() => {
                    const u = updating.get(g.key);
                    const canUpdate =
                      p && !p.loading && !p.error && p.recPence != null && askPence != null && Math.abs(p.recPence - askPence) >= 1;
                    if (u?.loading) return <div className="inv-upd busy"><span className="spinner" /> &nbsp;Updating eBay…</div>;
                    if (u?.done) return <div className="inv-upd ok">✓ Live price updated</div>;
                    if (u?.error && u.error !== "Cancelled") return <div className="inv-upd err">{u.error}</div>;
                    if (canUpdate)
                      return (
                        <button className="inv-update" onClick={() => updateToMarket(g)}>
                          ⤴ Set eBay price to {pounds(p.recPence)}
                        </button>
                      );
                    return null;
                  })()}

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
