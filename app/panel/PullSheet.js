"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";

/**
 * A sortable card-number key from any string (variation / title / SKU): the
 * numerator of an "X/Y" collector number, else the first number, else a big
 * sentinel so number-less items sort last. Lets loose "variation" picks be
 * ordered by card number for a single pass through numbered storage.
 */
function numKey(s) {
  const t = String(s || "");
  const m = t.match(/(\d{1,4})\s*\/\s*\d{1,4}/) || t.match(/\b(\d{1,4})\b/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

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
  const [loosePicked, setLoosePicked] = useState(new Set()); // ephemeral checklist for loose/variation picks (not stack cards)
  const [committing, setCommitting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [mode, setMode] = useState("pick"); // pick | pack
  const [packItems, setPackItems] = useState([]); // order line items in pull order (piles derived below)
  const [placed, setPlaced] = useState(new Set()); // lineItemIds dealt into their pile
  // Default: last-pulled card on top of the hand (LIFO), so we deal in reverse
  // pull order. Toggle for anyone who holds the stack the other way up.
  const [packReverse, setPackReverse] = useState(true);

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
        // Loose / variation pick — no stack match. Sort these by card number so
        // they're a single pass through numbered storage (2, 4, 17, 101…).
        unm.push({ key: l.lineItemId, sku: l.sku, title: l.title, variation: l.variation, orderId: l.orderId, buyer: l.buyer, nk: numKey(l.variation || l.title || l.sku) });
      }
    }
    active.sort((a, b) => {
      const na = nameMap.get(a.stackId) || "";
      const nb = nameMap.get(b.stackId) || "";
      if (na !== nb) return na.localeCompare(nb);
      return (idxByCard.get(a.cardId) ?? 0) - (idxByCard.get(b.cardId) ?? 0);
    });
    unm.sort((a, b) => a.nk - b.nk);

    // ---- Pack data: every order line in PULL order (stack, then position;
    // loose/variation picks by card number, last). Piles are numbered later
    // from the display sequence, so they form left-to-right as you deal.
    const anyBySku = new Map();
    for (const c of cards) {
      const skl = c.sku ? String(c.sku).toLowerCase() : null;
      if (skl && !anyBySku.has(skl)) anyBySku.set(skl, c);
    }
    const pack = lines.map((l) => {
      const skl = l.sku ? l.sku.toLowerCase() : null;
      const card = skl ? anyBySku.get(skl) : null;
      return {
        key: l.lineItemId,
        orderId: l.orderId,
        sku: l.sku,
        title: l.title,
        variation: l.variation,
        buyer: l.buyer || "",
        stackNm: card ? nameMap.get(card.stack_id) || "" : "",
        position: card ? card.position : null,
        nk: numKey(l.variation || l.title || l.sku),
        matched: !!card
      };
    });
    pack.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1; // loose (no stack) last
      if (a.matched) {
        if (a.stackNm !== b.stackNm) return a.stackNm.localeCompare(b.stackNm);
        return (a.position ?? 0) - (b.position ?? 0);
      }
      return a.nk - b.nk; // loose picks by card number
    });

    setStackName(nameMap);
    setStackOrder(order);
    setIndexByCard(idxByCard);
    setRows(active);
    setUnmatched(unm);
    setDoneCount(done);
    setPicked(new Set());
    setLoosePicked(new Set());
    setPackItems(pack);
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

  function toggleLoose(key) {
    setLoosePicked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
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

  // Pack sequence + piles, derived from the deal order. Piles are numbered by
  // first appearance in that sequence, so they form left-to-right as you deal
  // (Pile 1 = the first order you hit) — no need to pre-label piles by buyer.
  const packView = useMemo(() => {
    const seq = packReverse ? [...packItems].reverse() : packItems;
    const orderPile = new Map();
    const pileList = [];
    for (const it of seq) {
      if (!orderPile.has(it.orderId)) {
        orderPile.set(it.orderId, pileList.length + 1);
        pileList.push({ pileNo: pileList.length + 1, orderId: it.orderId, buyer: it.buyer || "", count: 0 });
      }
    }
    const byOrder = new Map(pileList.map((p) => [p.orderId, p]));
    for (const it of seq) byOrder.get(it.orderId).count += 1;
    const items = seq.map((it) => ({ ...it, pileNo: orderPile.get(it.orderId) }));
    return { items, piles: pileList };
  }, [packItems, packReverse]);

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
  const placedCount = packView.items.filter((i) => placed.has(i.key)).length;
  const placedInPile = (pileNo) => packView.items.filter((i) => i.pileNo === pileNo && placed.has(i.key)).length;

  return (
    <>
      <div className="ps-bar">
        <div className="pills" role="group" aria-label="Pull sheet mode">
          <button aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>1 · Pick</button>
          <button aria-pressed={mode === "pack"} onClick={() => setMode("pack")}>2 · Pack</button>
        </div>
        <div className="ps-actions">
          {mode === "pack" ? (
            <button className="btn btn-ghost" onClick={() => setPackReverse((v) => !v)} title="Which end of your pulled stack you start from">
              ⇅ {packReverse ? "Last pulled on top" : "First pulled on top"}
            </button>
          ) : null}
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
          <div className="panel-head">
            <span className="eyebrow">Loose / variation picks ({unmatched.length})</span>
            <span className="badge2">by card number</span>
          </div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Orders with no stack match (variation listings and one-offs), sorted by card number so you can pick them in one pass through your numbered storage. Tick as you go.
          </p>
          <div className="stack-list">
            {unmatched.map((u) => {
              const isPicked = loosePicked.has(u.key);
              return (
                <label className={`ps-row${isPicked ? " done" : ""}`} key={u.key}>
                  <input type="checkbox" checked={isPicked} onChange={() => toggleLoose(u.key)} />
                  <span className="stack-pos">{u.nk !== Number.MAX_SAFE_INTEGER ? u.nk : "—"}</span>
                  <span className="pack-card">
                    <span className="stack-sku">{u.variation || u.sku || "no SKU"}</span>
                    <span className="stack-title">{u.title || <em>—</em>}</span>
                  </span>
                  {u.buyer ? <span className="pack-dest-buyer" style={{ flex: "none" }}>{u.buyer}</span> : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      </>
      ) : (
      /* ---- PACK MODE ---- */
      <>
      <div className="ps-progress" style={{ marginBottom: 12 }}>
        <b>{placedCount}</b> / {packView.items.length} sorted into orders
      </div>
      {packView.items.length === 0 ? (
        <div className="panel"><p className="dd-empty">Nothing to pack — no open orders. 🎉</p></div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head"><span className="eyebrow">Order piles ({packView.piles.length})</span></div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>
              Work through your stack in order below. Start a new numbered pile each time a new pile number appears — no need to label them; the buyer for each pile is shown here for when you reconcile at the end.
            </p>
            <div className="pack-piles">
              {packView.piles.map((p) => {
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
              <span className="badge2">{packReverse ? "last pulled first" : "first pulled first"}</span>
            </div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>Take each card off the top and drop it into the pile shown. Tick as you go.</p>
            <div className="stack-list">
              {packView.items.map((it, i) => {
                const done = placed.has(it.key);
                return (
                  <label className={`ps-row pack-row${done ? " done" : ""}`} key={it.key}>
                    <input type="checkbox" checked={done} onChange={() => togglePlaced(it.key)} />
                    <span className="stack-pos">{i + 1}</span>
                    <span className="pack-card">
                      <span className="stack-sku">{it.variation || it.sku || "no SKU"}</span>
                      <span className="stack-title">{it.title || <em>—</em>}</span>
                      {it.matched ? null : <span className="loc-flag"> · loose / variation</span>}
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

          {placedCount === packView.items.length ? (
            <div className="panel"><p className="dd-empty" style={{ color: "var(--conf-high)" }}>All {packView.items.length} cards sorted into {packView.piles.length} order pile(s) — ready to pack &amp; ship. 🎉</p></div>
          ) : null}
        </>
      )}
      </>
      )}
    </>
  );
}
