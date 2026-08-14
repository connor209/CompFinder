"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const CONDITIONS = [
  { l: "Near Mint", v: "400010" },
  { l: "Lightly Played", v: "400011" },
  { l: "Moderately Played", v: "400012" },
  { l: "Heavily Played", v: "400013" },
  { l: "Damaged", v: "400014" }
];
const CONDITION_LABEL = Object.fromEntries(CONDITIONS.map((c) => [c.v, c.l]));
const SHIPPING = [
  { l: "Royal Mail 2nd Class", v: "UK_RoyalMailSecondClassStandard" },
  { l: "Royal Mail 1st Class", v: "UK_RoyalMailFirstClassStandard" },
  { l: "Royal Mail Signed For 1st", v: "UK_RoyalMailFirstClassRecorded" }
];
const DEFAULTS_KEY = "cf-list-defaults";
const DEFAULT_TITLE_TMPL = "{title}";
const DEFAULT_DESC_TMPL =
  "{title}\n\nCondition: {condition}. Genuine card, sent securely in a sleeve and top-loader inside a rigid mailer.\n\nCheck out my other listings — happy to combine postage.";

function loadDefaults() {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") || {}; } catch { return {}; }
}
function fill(tmpl, row, condLabel, keepNewlines) {
  let s = (tmpl || "")
    .split("{title}").join(row.baseTitle || "")
    .split("{name}").join(row.name || "")
    .split("{number}").join(row.number || "")
    .split("{set}").join(row.set || "")
    .split("{sku}").join(row.sku || "")
    .split("{condition}").join(condLabel || "")
    .split("{price}").join(row.price || "");
  if (!keepNewlines) s = s.replace(/\s+/g, " ");
  return s.trim();
}

/**
 * Bulk-list priced cards to eBay in one pass. Shared title template, description
 * boilerplate and shipping/returns defaults are applied to every card (and
 * saved for next time); price, condition, title and photo are editable per row.
 * Stock card art is auto-fetched where we can find it. Lists sequentially via
 * the single-listing API with live per-row status, then syncs once at the end.
 */
export default function BulkListModal({ cards, onClose, onDone }) {
  const d = loadDefaults();
  const [titleTmpl, setTitleTmpl] = useState(d.titleTemplate || DEFAULT_TITLE_TMPL);
  const [descTmpl, setDescTmpl] = useState(d.descriptionTemplate || DEFAULT_DESC_TMPL);
  const [conditionId, setConditionId] = useState(d.conditionId || "400010");
  const [categoryId, setCategoryId] = useState(d.categoryId || "183454");
  const [postcode, setPostcode] = useState(d.postcode || "");
  const [shippingService, setShippingService] = useState(d.shippingService || SHIPPING[0].v);
  const [shippingCost, setShippingCost] = useState(d.shippingCost || "1.50");
  const [returnsDays, setReturnsDays] = useState(d.returnsDays ?? "30");
  const [dispatchDays, setDispatchDays] = useState(d.dispatchDays || "3");

  const [rows, setRows] = useState(() =>
    cards.map((c, i) => ({
      key: i,
      baseTitle: c.baseTitle,
      name: c.name,
      number: c.number,
      set: c.set,
      sku: c.sku,
      title: fill(d.titleTemplate || DEFAULT_TITLE_TMPL, c, CONDITION_LABEL[d.conditionId || "400010"], false).slice(0, 80),
      price: c.pricePence != null ? (c.pricePence / 100).toFixed(2) : "",
      quantity: 1,
      conditionId: d.conditionId || "400010",
      image: "",
      include: true,
      status: "idle", // idle | listing | done | error
      itemId: null,
      error: ""
    }))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [linkedPolicy, setLinkedPolicy] = useState(null); // {fulfillmentName,...} when the seller linked eBay policies
  const artDone = useRef(false);

  // Reflect linked eBay Business Policies — when set, eBay applies the policy's
  // shipping/return terms and the inline postage fields below are ignored.
  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const { data: profile } = await sb.from("profiles").select("settings").eq("id", user.id).single();
        const p = profile?.settings?.ebayPolicies;
        if (p && p.fulfillmentPolicyId) setLinkedPolicy(p);
      } catch { /* best-effort */ }
    })();
  }, []);

  // Auto-fetch stock art per card (best-effort, small concurrency pool).
  useEffect(() => {
    if (artDone.current) return;
    artDone.current = true;
    let cancelled = false;
    (async () => {
      const queue = cards.map((c, i) => ({ i, c }));
      let cursor = 0;
      async function worker() {
        while (cursor < queue.length && !cancelled) {
          const { i, c } = queue[cursor++];
          try {
            const q = `name=${encodeURIComponent(c.name || c.baseTitle || "")}&number=${encodeURIComponent(c.number || "")}&set=${encodeURIComponent(c.set || "")}`;
            const lk = await fetch(`/api/cards/lookup?${q}`).then((r) => r.json());
            const img = lk?.ok && lk.card && lk.card.image;
            if (img && !cancelled) setRows((rs) => rs.map((r) => (r.key === i && !r.image ? { ...r, image: img } : r)));
          } catch { /* art is best-effort */ }
        }
      }
      await Promise.all([worker(), worker(), worker()]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRow(key, patch) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function applyTemplateToAll() {
    const label = CONDITION_LABEL[conditionId];
    setRows((rs) => rs.map((r) => ({ ...r, title: fill(titleTmpl, { ...r }, CONDITION_LABEL[r.conditionId] || label, false).slice(0, 80) })));
  }
  function setAllConditions(v) {
    setConditionId(v);
    setRows((rs) => rs.map((r) => ({ ...r, conditionId: v })));
  }

  function persistDefaults() {
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify({
        titleTemplate: titleTmpl, descriptionTemplate: descTmpl, conditionId, categoryId, postcode, shippingService, shippingCost, returnsDays, dispatchDays
      }));
    } catch { /* ignore */ }
  }

  async function listAll() {
    persistDefaults();
    setRunning(true);
    const targets = rows.filter((r) => r.include && r.status !== "done" && r.title && Number(r.price) > 0);
    for (const t of targets) {
      setRow(t.key, { status: "listing", error: "" });
      const payload = {
        title: t.title,
        price: Number(t.price),
        quantity: t.quantity,
        conditionId: t.conditionId,
        categoryId,
        postcode,
        location: postcode || "United Kingdom",
        shippingService,
        shippingCost: Number(shippingCost) || 0,
        returnsDays,
        dispatchDays,
        description: fill(descTmpl, { ...t }, CONDITION_LABEL[t.conditionId], true),
        imageUrls: t.image ? [t.image] : [],
        specifics: [
          { name: "Game", value: "Pokémon TCG" },
          { name: "Set", value: t.set || "" },
          { name: "Card Number", value: t.number || "" },
          { name: "Language", value: "English" },
          { name: "Character", value: t.name || "" }
        ],
        skipSync: true
      };
      try {
        const res = await fetch("/api/ebay/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
        if (res.ok) setRow(t.key, { status: "done", itemId: res.itemId || null });
        else setRow(t.key, { status: "error", error: res.error || "Listing failed." });
      } catch (e) {
        setRow(t.key, { status: "error", error: e.message || "Listing failed." });
      }
    }
    // Single sync at the end to pull the new listings into the cache.
    await fetch("/api/ebay/sync", { method: "POST" }).catch(() => {});
    setRunning(false);
    setDone(true);
    onDone?.();
  }

  const includeCount = rows.filter((r) => r.include && r.status !== "done").length;
  const listedCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  return (
    <div className="bulk-overlay" role="dialog" aria-label="List on eBay">
      <div className="bulk-modal">
        <div className="bulk-head">
          <div>
            <span className="eyebrow">List {cards.length} card(s) on eBay <span className="badge2" style={{ marginLeft: 6 }}>beta</span></span>
            <p className="hint hint-small" style={{ margin: "4px 0 0" }}>Shared settings apply to every card; edit price, condition, title or photo per row. Settings are saved for next time.</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        {/* Shared settings */}
        <div className="bulk-shared">
          <label className="field bulk-wide">
            <span>Title template <span className="buy-opt">tokens: {"{title} {name} {number} {set} {sku} {condition}"}</span></span>
            <input type="text" value={titleTmpl} onChange={(e) => setTitleTmpl(e.target.value)} />
          </label>
          <label className="field bulk-wide">
            <span>Description boilerplate</span>
            <textarea rows={3} value={descTmpl} onChange={(e) => setDescTmpl(e.target.value)} />
          </label>
          {linkedPolicy ? (
            <p className="hint hint-small" style={{ margin: 0, color: "var(--accent-2)" }}>
              📦 Using your linked eBay policies — shipping: <b>{linkedPolicy.fulfillmentName || "selected"}</b>
              {linkedPolicy.returnName ? <>, returns: <b>{linkedPolicy.returnName}</b></> : null}. Postage fields hidden.
            </p>
          ) : null}
          <div className="bulk-shared-grid">
            <label className="field"><span>Default condition</span>
              <select value={conditionId} onChange={(e) => setAllConditions(e.target.value)}>
                {CONDITIONS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </label>
            <label className="field"><span>Category ID</span><input type="text" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} /></label>
            <label className="field"><span>Postcode</span><input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="SW1A 1AA" /></label>
            {linkedPolicy ? null : (
              <>
                <label className="field"><span>Dispatch (days)</span><input type="number" min="0" value={dispatchDays} onChange={(e) => setDispatchDays(e.target.value)} /></label>
                <label className="field"><span>Postage</span>
                  <select value={shippingService} onChange={(e) => setShippingService(e.target.value)}>
                    {SHIPPING.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </select>
                </label>
                <label className="field"><span>Postage £</span><input type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} /></label>
                <label className="field"><span>Returns</span>
                  <select value={returnsDays} onChange={(e) => setReturnsDays(e.target.value)}>
                    <option value="30">30 days</option>
                    <option value="14">14 days</option>
                    <option value="">No returns</option>
                  </select>
                </label>
              </>
            )}
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" type="button" onClick={applyTemplateToAll} style={{ marginTop: "auto" }}>↻ Re-apply title template</button>
            </div>
          </div>
        </div>

        {/* Per-row table */}
        <div className="table-wrap bulk-rows">
          <table className="itbl">
            <thead>
              <tr><th></th><th></th><th>Title (max 80)</th><th>Condition</th><th>£ Price</th><th>Qty</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.include ? "" : "bulk-row-off"}>
                  <td><input type="checkbox" checked={r.include} disabled={running || r.status === "done"} onChange={(e) => setRow(r.key, { include: e.target.checked })} /></td>
                  <td className="buy-photo-cell">
                    {r.image ? (
                      <span className="buy-thumb" title="Stock photo"><img src={r.image} alt="" loading="lazy" /></span>
                    ) : (
                      <span className="buy-thumb-add" title="No photo found — paste a URL below">📷</span>
                    )}
                  </td>
                  <td>
                    <input className="bulk-title-inp" type="text" maxLength={80} value={r.title} disabled={running} onChange={(e) => setRow(r.key, { title: e.target.value })} />
                    <input className="bulk-img-inp" type="text" value={r.image} disabled={running} placeholder="Image URL (optional)" onChange={(e) => setRow(r.key, { image: e.target.value })} />
                  </td>
                  <td>
                    <select value={r.conditionId} disabled={running} onChange={(e) => setRow(r.key, { conditionId: e.target.value })}>
                      {CONDITIONS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                    </select>
                  </td>
                  <td><input className="bulk-price-inp" type="number" min="0" step="0.01" value={r.price} disabled={running} onChange={(e) => setRow(r.key, { price: e.target.value })} /></td>
                  <td><input className="bulk-qty-inp" type="number" min="1" value={r.quantity} disabled={running} onChange={(e) => setRow(r.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></td>
                  <td className="bulk-status">
                    {r.status === "listing" ? <span className="spinner" /> :
                      r.status === "done" ? <a href={`https://www.ebay.co.uk/itm/${r.itemId}`} target="_blank" rel="noopener noreferrer" className="bulk-ok">✓ Listed</a> :
                      r.status === "error" ? <span className="bulk-err" title={r.error}>✕ {r.error.slice(0, 40)}</span> :
                      <span className="bulk-idle">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bulk-foot">
          <div className="hint hint-small">
            {done ? `Done — ${listedCount} listed${errorCount ? `, ${errorCount} failed` : ""}.` : `${includeCount} selected to list.`}
            {" "}Category & condition IDs are eBay-validated (defaults suit UK Pokémon singles).
          </div>
          <div className="bulk-foot-actions">
            <button className="btn btn-ghost" onClick={onClose}>{done ? "Close" : "Cancel"}</button>
            <button className="btn btn-primary" onClick={listAll} disabled={running || includeCount === 0}>
              {running ? "Listing…" : done ? "List remaining" : `List ${includeCount} on eBay`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
