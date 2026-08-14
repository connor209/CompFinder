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
  const [mode, setMode] = useState("pick"); // pick | pack
  const [packItems, setPackItems] = useState([]); // order line items in pull order, each tagged with its pile
  const [piles, setPiles] = useState([]); // [{pileNo, orderId, buyer, count}]
  const [placed, setPlaced] = useState(new Set()); // lineItemIds dealt into their pile

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

    // ---- Pack data: every order line in PULL order, tagged with its pile ----
    // Pull order = the sequence cards come off the stacks (stack name, then
    // position) — the same order you physically pull them. Each distinct order
    // becomes a "pile" you deal cards into; piles are numbered by the order they
    // arrived (eBay's order), so the pull sequence naturally scrambles across
    // piles — which is exactly the sorting job packing solves.
    const anyBySku = new Map();
    for (const c of cards) {
      const skl = c.sku ? String(c.sku).toLowerCase() : null;
      if (skl && !anyBySku.has(skl)) anyBySku.set(skl, c);
    }
    const orderPile = new Map();
    const pileList = [];
    for (const l of lines) {
      if (!orderPile.has(l.orderId)) {
        orderPile.set(l.orderId, pileList.length + 1);
        pileList.push({ pileNo: pileList.length + 1, orderId: l.orderId, buyer: l.buyer || "", count: 0 });
      }
    }
    const pileByOrder = new Map(pileList.map((p) => [p.orderId, p]));
    const pack = lines.map((l) => {
      const skl = l.sku ? l.sku.toLowerCase() : null;
      const card = skl ? anyBySku.get(skl) : null;
      const p = pileByOrder.get(l.orderId);
      if (p) p.count += 1;
      return {
        key: l.lineItemId,
        orderId: l.orderId,
        sku: l.sku,
        title: l.title,
        buyer: l.buyer || "",
        pileNo: orderPile.get(l.orderId),
        stackId: card ? card.stack_id : null,
        stackNm: card ? nameMap.get(card.stack_id) || "" : "",
        position: card ? card.position : null,
        matched: !!card
      };
    });
    pack.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1; // unmatched (no stack) last
      if (a.stackNm !== b.stackNm) return a.stackNm.localeCompare(b.stackNm);
      return (a.position ?? 0) - (b.position ?? 0);
    });

    setStackName(nameMap);
    setStackOrder(order);
    setIndexByCard(idxByCard);
    setRows(active);
    setUnmatched(unm);
    setDoneCount(done);
    setPicked(new Set());
    setPackItems(pack);
    setPiles(pileList);
    setPlaced(new Set());
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

  function togglePlaced(key) {
    setPlaced((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
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
  const placedCount = packItems.filter((i) => placed.has(i.key)).length;
  const placedInPile = (pileNo) => packItems.filter((i) => i.pileNo === pileNo && placed.has(i.key)).length;

  return (
    <>
      <div className="ps-bar">
        <div className="pills" role="group" aria-label="Pull sheet mode">
          <button aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>1 · Pick</button>
          <button aria-pressed={mode === "pack"} onClick={() => setMode("pack")}>2 · Pack</button>
        </div>
        <div className="ps-actions">
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-ghost" onClick={load} disabled={committing}>↻ Refresh</button>
          {mode === "pick" ? (
            <button className="btn btn-primary" onClick={commit} disabled={committing || pickedInSheet === 0}>
              {committing ? "Committing…" : `Commit ${pickedInSheet} pull(s)`}
            </button>
          ) : null}
        </div>
      </div>

      {mode === "pick" ? (
      <>
      <div className="ps-progress" style={{ marginBottom: 12 }}>
        <b>{pickedInSheet}</b> / {total} picked{doneCount ? ` · ${doneCount} already pulled` : ""}
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
      ) : (
      /* ---- PACK MODE ---- */
      <>
      <div className="ps-progress" style={{ marginBottom: 12 }}>
        <b>{placedCount}</b> / {packItems.length} sorted into orders
      </div>
      {packItems.length === 0 ? (
        <div className="panel"><p className="dd-empty">Nothing to pack — no open orders. 🎉</p></div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head"><span className="eyebrow">Order piles ({piles.length})</span></div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>
              Lay out a pile for each order below. Then work through your pulled stack in order — each card tells you which pile it goes in.
            </p>
            <div className="pack-piles">
              {piles.map((p) => {
                const got = placedInPile(p.pileNo);
                const full = got >= p.count;
                return (
                  <div className={`pack-pile${full ? " full" : ""}`} key={p.pileNo}>
                    <div className="pack-pile-no">Pile {p.pileNo}</div>
                    <div className="pack-pile-buyer">{p.buyer || "Buyer"}</div>
                    <div className="pack-pile-meta">{got}/{p.count} card{p.count === 1 ? "" : "s"}{full ? " ✓" : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Your pulled stack — in order</h3>
              <span className="badge2">top → bottom</span>
            </div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>Take each card off the top and drop it into the pile shown. Tick as you go.</p>
            <div className="stack-list">
              {packItems.map((it, i) => {
                const done = placed.has(it.key);
                return (
                  <label className={`ps-row pack-row${done ? " done" : ""}`} key={it.key}>
                    <input type="checkbox" checked={done} onChange={() => togglePlaced(it.key)} />
                    <span className="stack-pos">{i + 1}</span>
                    <span className="pack-card">
                      <span className="stack-sku">{it.sku || "no SKU"}</span>
                      <span className="stack-title">{it.title || <em>—</em>}</span>
                      {it.matched ? null : <span className="loc-flag"> · not in a stack</span>}
                    </span>
                    <span className="pack-dest" aria-label={`Pile ${it.pileNo}, ${it.buyer}`}>
                      <span className="pack-dest-no">Pile {it.pileNo}</span>
                      <span className="pack-dest-buyer">{it.buyer || "Buyer"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {placedCount === packItems.length ? (
            <div className="panel"><p className="dd-empty" style={{ color: "var(--conf-high)" }}>All {packItems.length} cards sorted into {piles.length} order pile(s) — ready to pack &amp; ship. 🎉</p></div>
          ) : null}
        </>
      )}
      </>
      )}
    </>
  );
}
