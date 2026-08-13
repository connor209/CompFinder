"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Recent eBay write-back activity — the price-change / end-listing log. Lets
 * you revert a price change or relist an ended item. Reads ebay_price_changes
 * directly (RLS-scoped to the user); actions call the write-back routes.
 */
function money(v, c) {
  if (v == null) return "—";
  return !c || c === "GBP" ? `£${Number(v).toFixed(2)}` : `${Number(v).toFixed(2)} ${c}`;
}
function fmt(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function EbayActivity({ onChange }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("ebay_price_changes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      setErr("Change log unavailable — run migration 003 to enable price-change history, revert and relist.");
      setRows([]);
      return;
    }
    setErr("");
    setRows(data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function revert(r) {
    if (r.old_price == null) return;
    if (!confirm(`Revert "${r.title}" back to ${money(r.old_price, r.currency)} on eBay?`)) return;
    setBusy(r.id);
    setNote("");
    try {
      const res = await fetch("/api/ebay/revise-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: r.ebay_item_id, price: Number(r.old_price), force: true })
      }).then((x) => x.json());
      if (!res.ok) throw new Error(res.error || "Revert failed");
      setNote(`Reverted to ${money(r.old_price, r.currency)}.`);
      onChange?.();
      await load();
    } catch (e) {
      setNote(e.message);
    }
    setBusy("");
  }

  async function relist(r) {
    if (!confirm(`Relist "${r.title}" on eBay?`)) return;
    setBusy(r.id);
    setNote("");
    try {
      const res = await fetch("/api/ebay/relist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: r.ebay_item_id })
      }).then((x) => x.json());
      if (!res.ok) throw new Error(res.error || "Relist failed");
      setNote(`Relisted${res.newItemId ? ` (new id ${res.newItemId})` : ""}.`);
      onChange?.();
      await load();
    } catch (e) {
      setNote(e.message);
    }
    setBusy("");
  }

  if (rows === null) {
    return <div className="panel"><span className="spinner" /> &nbsp;Loading activity…</div>;
  }

  return (
    <div className="panel">
      <div className="panel-head"><span className="eyebrow">Recent eBay changes</span></div>
      {err ? (
        <p className="hint hint-small">{err}</p>
      ) : rows.length === 0 ? (
        <p className="dd-empty">No price changes or ended listings yet.</p>
      ) : (
        <div className="act-list rise-group">
          {rows.map((r) => (
            <div className="act-row" key={r.id}>
              <div className="act-main">
                <span className="act-title">{r.title || r.ebay_item_id}</span>
                <span className="act-detail">
                  {r.source === "ended"
                    ? `Ended · was ${money(r.old_price, r.currency)}`
                    : `${money(r.old_price, r.currency)} → ${money(r.new_price, r.currency)}`}
                  <em> · {fmt(r.created_at)}</em>
                </span>
              </div>
              {r.source === "ended" ? (
                <button className="btn btn-ghost" disabled={busy === r.id} onClick={() => relist(r)}>
                  {busy === r.id ? "…" : "↺ Relist"}
                </button>
              ) : r.old_price != null ? (
                <button className="btn btn-ghost" disabled={busy === r.id} onClick={() => revert(r)}>
                  {busy === r.id ? "…" : "↶ Revert"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {note && <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p>}
    </div>
  );
}
