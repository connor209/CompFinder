"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";

/**
 * Pull sheet — the daily picking workflow. Lists unshipped eBay orders matched
 * to their stack + live position. You pick a card, tick it, and any other
 * sheet items in the same stack re-rank live (a working preview). Nothing hits
 * the database until you Commit, which marks them pulled for real.
 */
export default function PullSheet() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // active pick rows
  const [doneCount, setDoneCount] = useState(0); // already-pulled (picked earlier)
  const [unmatched, setUnmatched] = useState([]);
  const [stackName, setStackName] = useState(new Map());
  const [stackOrder, setStackOrder] = useState(new Map()); // stackId -> [{id,position}]
  const [indexByCard, setIndexByCard] = useState(new Map());
  const [picked, setPicked] = useState(new Set());
  const [committing, setCommitting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const supabase = () => createClient();

  async function load() {
    setLoading(true);
    setError("");
    setNeedsReconnect(false);
    let ordersRes;
    try {
      ordersRes = await fetch("/api/ebay/orders/pending").then((r) => r.json());
    } catch {
      setError("Couldn't load orders.");
      setLoading(false);
      return;
    }
    if (!ordersRes.ok) {
      if (ordersRes.scopeError) setNeedsReconnect(true);
      else setError(ordersRes.error || "Couldn't load orders.");
      setLoading(false);
      return;
    }
    const lines = ordersRes.lines || [];

    const sb = supabase();
    const { data: stacks } = await sb.from("card_stacks").select("id,name");
    const nameMap = new Map((stacks || []).map((s) => [s.id, s.name]));
    const cards = await pagedSelect(() => sb.from("stack_cards").select("id,sku,stack_id,position,pulled_at"));

    const unpulledBySku = new Map();
    const pulledSkus = new Set();
    const order = new Map();
    for (const c of cards) {
      const skl = c.sku ? String(c.sku).toLowerCase() : null;
      if (c.pulled_at) {
        if (skl) pulledSkus.add(skl);
        continue;
      }
      if (skl && !unpulledBySku.has(skl)) unpulledBySku.set(skl, c);
      if (!order.has(c.stack_id)) order.set(c.stack_id, []);
      order.get(c.stack_id).push({ id: c.id, position: c.position });
    }
    for (const arr of order.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const idxByCard = new Map();
    for (const arr of order.values()) arr.forEach((o, i) => idxByCard.set(o.id, i));

    const active = [];
    const unm = [];
    let done = 0;
    for (const l of lines) {
      const skl = l.sku ? l.sku.toLowerCase() : null;
      const card = skl ? unpulledBySku.get(skl) : null;
      if (card) {
        active.push({ key: l.lineItemId, orderId: l.orderId, sku: l.sku, title: l.title, cardId: card.id, stackId: card.stack_id, buyer: l.buyer });
      } else if (skl && pulledSkus.has(skl)) {
        done += 1;
      } else {
        unm.push({ sku: l.sku, title: l.title, orderId: l.orderId });
      }
    }
    active.sort((a, b) => {
      const na = nameMap.get(a.stackId) || "";
      const nb = nameMap.get(b.stackId) || "";
      if (na !== nb) return na.localeCompare(nb);
      return (idxByCard.get(a.cardId) ?? 0) - (idxByCard.get(b.cardId) ?? 0);
    });

    setStackName(nameMap);
    setStackOrder(order);
    setIndexByCard(idxByCard);
    setRows(active);
    setUnmatched(unm);
    setDoneCount(done);
    setPicked(new Set());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function liveRank(row) {
    const arr = stackOrder.get(row.stackId) || [];
    const idx = indexByCard.get(row.cardId);
    if (idx == null) return null;
    const pickedAhead = arr.slice(0, idx).filter((o) => picked.has(o.id)).length;
    return idx + 1 - pickedAhead;
  }

  function togglePick(cardId) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(cardId)) n.delete(cardId);
      else n.add(cardId);
      return n;
    });
  }

  async function commit() {
    const ids = [...picked];
    if (ids.length === 0) return;
    if (!confirm(`Commit ${ids.length} pull(s)? This marks them pulled in your stacks.`)) return;
    setCommitting(true);
    setNote("");
    const sb = supabase();
    for (let i = 0; i < ids.length; i += 200) {
      await sb.from("stack_cards").update({ pulled_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
    }
    setCommitting(false);
    setNote(`Committed ${ids.length} pull(s). Done for the day 🎉`);
    await load();
  }

  // group active rows by stack for display
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of rows) {
      if (!g.has(r.stackId)) g.set(r.stackId, []);
      g.get(r.stackId).push(r);
    }
    return [...g.entries()];
  }, [rows]);

  if (loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading pull sheet…</div>;

  if (needsReconnect) {
    return (
      <div className="mine-banner">
        <span className="mine-ic" aria-hidden="true">⚠</span>
        <div>
          <strong>Reconnect to enable order picking</strong>
          <div className="mine-list"><a href="/api/ebay/connect">Reconnect eBay account →</a></div>
          <p className="hint hint-small" style={{ marginTop: 4 }}>The pull sheet reads your order history, which needs the extra permission added after your first connect.</p>
        </div>
      </div>
    );
  }

  const total = rows.length;
  const pickedInSheet = rows.filter((r) => picked.has(r.cardId)).length;

  return (
    <>
      <div className="ps-bar">
        <div className="ps-progress">
          <b>{pickedInSheet}</b> / {total} picked{doneCount ? ` · ${doneCount} already pulled` : ""}
        </div>
        <div className="ps-actions">
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-ghost" onClick={load} disabled={committing}>↻ Refresh</button>
          <button className="btn btn-primary" onClick={commit} disabled={committing || pickedInSheet === 0}>
            {committing ? "Committing…" : `Commit ${pickedInSheet} pull(s)`}
          </button>
        </div>
      </div>
      <div className="print-title">Pull sheet — {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {total} to pick</div>
      {note ? <p className="hint hint-small" style={{ color: "var(--conf-high)" }}>{note}</p> : null}
      {error ? <p className="compfinder-error">{error}</p> : null}

      {total === 0 && unmatched.length === 0 ? (
        <div className="panel"><p className="dd-empty">No orders waiting to be picked. 🎉</p></div>
      ) : null}

      {groups.map(([stackId, gr]) => (
        <div className="panel" key={stackId}>
          <div className="panel-head">
            <h3>{stackName.get(stackId) || "Stack"}</h3>
            <span className="badge2">{gr.filter((r) => !picked.has(r.cardId)).length} to pick</span>
          </div>
          <div className="stack-list">
            {gr.map((r) => {
              const isPicked = picked.has(r.cardId);
              const rank = liveRank(r);
              return (
                <label className={`ps-row${isPicked ? " done" : ""}`} key={r.key}>
                  <input type="checkbox" checked={isPicked} onChange={() => togglePick(r.cardId)} />
                  <span className="stack-pos">{isPicked ? "✓" : rank}</span>
                  <span className="stack-sku">{r.sku}</span>
                  <span className="stack-title">{r.title || <em>—</em>}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {unmatched.length > 0 ? (
        <div className="panel">
          <div className="panel-head"><span className="eyebrow">Not in a stack ({unmatched.length})</span></div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>These sold orders don&apos;t match a card in any stack (SKU not found). Pick them manually.</p>
          <div className="stack-list">
            {unmatched.map((u, i) => (
              <div className="stack-row" key={i}>
                <span className="stack-sku">{u.sku || "no SKU"}</span>
                <span className="stack-title">{u.title || <em>—</em>}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
