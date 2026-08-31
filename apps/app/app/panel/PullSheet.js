"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { fallbackSetName } from "@compfinder/core/setmatch.js";
import { queuesBySku } from "@/lib/copyqueue";

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
 * Order stack labels like spreadsheet columns rather than a dictionary:
 * A, B, C … Z, then AA, AB … (shorter labels first, then alpha), so a pile
 * "AE" sorts after "Z" instead of jumping in right after "A". Falls back to a
 * plain locale compare for anything that isn't a simple letter label.
 */
function pileCompare(a, b) {
  const na = String(a || "").trim();
  const nb = String(b || "").trim();
  const letterA = /^[A-Za-z]+$/.test(na);
  const letterB = /^[A-Za-z]+$/.test(nb);
  if (letterA && letterB && na.length !== nb.length) return na.length - nb.length;
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
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
  const [away, setAway] = useState([]); // ordered on eBay but checked out to a show
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
  // Pack-mode filters — a 100+ card deal is unreadable as one flat list.
  const [packPile, setPackPile] = useState(null); // pile number, or null for all
  const [packQuery, setPackQuery] = useState(""); // buyer / card / set search
  const [packType, setPackType] = useState("all"); // all | stack | loose
  const [packHideDone, setPackHideDone] = useState(false);

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

    // Resolve each listing title to a catalogue set (name + code). eBay sends
    // no item specifics with an order, so the set is read out of the title —
    // it's what the variation picks get grouped and alphabetised by.
    const titles = [...new Set(lines.map((l) => l.title).filter(Boolean))];
    let setByTitle = new Map();
    if (titles.length) {
      try {
        const res = await fetch("/api/catalog/match-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titles })
        }).then((r) => r.json());
        if (res.ok && res.matches) setByTitle = new Map(Object.entries(res.matches));
      } catch {
        /* set names are a nicety — the sheet still works without them */
      }
    }
    const setInfo = (title) => {
      const hit = setByTitle.get(title || "");
      return hit ? { setName: hit.name, setCode: hit.code || "" } : { setName: fallbackSetName(title), setCode: "" };
    };

    const sb = supabase();
    const { data: stacks } = await sb.from("card_stacks").select("id,name");
    const nameMap = new Map((stacks || []).map((s) => [s.id, s.name]));
    const cards = await pagedSelect(() => sb.from("stack_cards").select("*"));

    // A SKU maps to a QUEUE of copies, not to one card. One card per SKU is
    // still the ordinary case and behaves exactly as before — the queue is one
    // long. A multi-quantity listing is several copies sharing the listing's
    // SKU, and then WHICH copy goes matters: it is the one in the listing's
    // photograph. copyqueue.js owns that order; this used to keep the first row
    // an unordered `select *` happened to return.
    const copyQueues = queuesBySku(cards);
    const takenBySku = new Map(); // sku -> units of its queue already spoken for
    const pulledSkus = new Set();
    const awaySkus = new Set(); // checked out to a show — physically not here
    const order = new Map();
    for (const c of cards) {
      const skl = c.sku ? String(c.sku).toLowerCase() : null;
      if (c.pulled_at) {
        if (skl) pulledSkus.add(skl);
        continue;
      }
      if (c.checked_out_at) {
        if (skl) awaySkus.add(skl);
        continue;
      }
      if (!order.has(c.stack_id)) order.set(c.stack_id, []);
      order.get(c.stack_id).push({ id: c.id, position: c.position });
    }
    for (const arr of order.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const idxByCard = new Map();
    for (const arr of order.values()) arr.forEach((o, i) => idxByCard.set(o.id, i));

    const active = [];
    const unm = [];
    const awayLines = [];
    let done = 0;
    for (const l of lines) {
      const skl = l.sku ? l.sku.toLowerCase() : null;
      // ONE LINE ITEM CAN BE SEVERAL CARDS. fetchPendingOrders has always
      // returned the quantity and this loop always ignored it, which is
      // invisible while every listing is a single card and is a card short the
      // first time one isn't. Each unit is its own row, its own tick and its
      // own card — `commit()` keys on card id, so two units of one order commit
      // as the two cards they are.
      const units = Math.max(1, Number(l.quantity) || 1);
      for (let n = 0; n < units; n++) {
        const seen = takenBySku.get(skl) || 0;
        const card = skl ? (copyQueues.get(skl) || [])[seen] || null : null;
        // A key per UNIT. Sharing the line item id would collapse two cards
        // back into one row and pull half the order.
        const key = units > 1 ? `${l.lineItemId}#${n + 1}` : l.lineItemId;
        const unitOf = units > 1 ? { unit: n + 1, ofUnits: units } : null;
        if (card) {
          takenBySku.set(skl, seen + 1);
          active.push({ key, orderId: l.orderId, sku: l.sku, title: l.title, cardId: card.id, stackId: card.stack_id, buyer: l.buyer, ...unitOf });
        } else if (skl && awaySkus.has(skl)) {
          // Ordered on eBay while the card is checked out to a show — it can't
          // be picked from a stack. Needs a human call (it's in the show case).
          awayLines.push({ key, sku: l.sku, title: l.title });
        } else if (skl && pulledSkus.has(skl)) {
          done += 1;
        } else {
          // Loose / variation pick — no stack match. Sort these by card number so
          // they're a single pass through numbered storage (2, 4, 17, 101…).
          unm.push({ key, sku: l.sku, title: l.title, variation: l.variation, orderId: l.orderId, buyer: l.buyer, deliveryName: l.deliveryName, nk: numKey(l.variation || l.title || l.sku), ...setInfo(l.title), ...unitOf });
        }
      }
    }
    active.sort((a, b) => {
      const na = nameMap.get(a.stackId) || "";
      const nb = nameMap.get(b.stackId) || "";
      if (na !== nb) return pileCompare(na, nb);
      return (idxByCard.get(a.cardId) ?? 0) - (idxByCard.get(b.cardId) ?? 0);
    });
    // Loose picks are walked set-by-set (alphabetically, matching the shelves),
    // then by card number within each set.
    const bySetThenNumber = (a, b) => {
      const s = (a.setName || "").localeCompare(b.setName || "", undefined, { numeric: true, sensitivity: "base" });
      return s !== 0 ? s : a.nk - b.nk;
    };
    unm.sort(bySetThenNumber);

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
        deliveryName: l.deliveryName || "",
        stackNm: card ? nameMap.get(card.stack_id) || "" : "",
        position: card ? card.position : null,
        nk: numKey(l.variation || l.title || l.sku),
        matched: !!card,
        // Pack deals ONE pile per order line — one buyer, one envelope — so a
        // quantity-2 line stays a single entry and carries the count instead.
        // Splitting it here would have you dealing two piles to one address.
        qty: Math.max(1, Number(l.quantity) || 1),
        ...setInfo(l.title)
      };
    });
    pack.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1; // loose (no stack) last
      if (a.matched) {
        if (a.stackNm !== b.stackNm) return pileCompare(a.stackNm, b.stackNm);
        return (a.position ?? 0) - (b.position ?? 0);
      }
      return bySetThenNumber(a, b); // loose picks: same set-by-set walk as the pick list
    });

    setStackName(nameMap);
    setStackOrder(order);
    setIndexByCard(idxByCard);
    setRows(active);
    setUnmatched(unm);
    setAway(awayLines);
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
        pileList.push({ pileNo: pileList.length + 1, orderId: it.orderId, buyer: it.buyer || "", deliveryName: it.deliveryName || "", count: 0 });
      }
    }
    const byOrder = new Map(pileList.map((p) => [p.orderId, p]));
    for (const it of seq) byOrder.get(it.orderId).count += 1;
    // seqNo is the card's place in the FULL deal sequence — it stays stable
    // when filters hide rows, so "card 47" is still card 47 in your hand.
    const items = seq.map((it, i) => ({ ...it, pileNo: orderPile.get(it.orderId), seqNo: i + 1 }));
    return { items, piles: pileList };
  }, [packItems, packReverse]);

  // Filtered view of the deal sequence — with 100+ cards the flat list is
  // unreadable, so you can narrow to one pile, one buyer, or just the loose
  // picks, without disturbing the underlying order.
  const packVisible = useMemo(() => {
    const q = packQuery.trim().toLowerCase();
    return packView.items.filter((it) => {
      if (packPile != null && it.pileNo !== packPile) return false;
      if (packType === "stack" && !it.matched) return false;
      if (packType === "loose" && it.matched) return false;
      if (packHideDone && placed.has(it.key)) return false;
      if (!q) return true;
      return [it.buyer, it.deliveryName, it.variation, it.sku, it.setName, it.setCode, it.title]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [packView.items, packPile, packType, packQuery, packHideDone, placed]);

  const packFiltered = packVisible.length !== packView.items.length;

  // group active rows by stack for display
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of rows) {
      if (!g.has(r.stackId)) g.set(r.stackId, []);
      g.get(r.stackId).push(r);
    }
    return [...g.entries()];
  }, [rows]);

  // Group loose/variation picks by SET, A–Z — shelves are ordered by set name,
  // so the sheet walks them in shelf order (Ascended Heroes → Destined Rivals →
  // Journey Together…), each set's cards then sorted by collector number.
  const looseGroups = useMemo(() => {
    const g = new Map();
    for (const u of unmatched) {
      const key = u.setName || u.title || "Other";
      if (!g.has(key)) g.set(key, { setName: key, setCode: u.setCode || "", items: [] });
      const grp = g.get(key);
      if (!grp.setCode && u.setCode) grp.setCode = u.setCode;
      grp.items.push(u);
    }
    return [...g.values()]
      .sort((a, b) => a.setName.localeCompare(b.setName, undefined, { numeric: true, sensitivity: "base" }))
      .map((grp) => ({ ...grp, items: grp.items.slice().sort((a, b) => a.nk - b.nk) }));
  }, [unmatched]);

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

      {away.length > 0 ? (
        <div className="mine-banner">
          <span className="mine-ic" aria-hidden="true">⚠</span>
          <div>
            <strong>{away.length} ordered card(s) are checked out to a show</strong>
            <p className="hint hint-small" style={{ marginTop: 4 }}>
              {away.map((a) => a.sku || a.title).filter(Boolean).join(" · ")} — sold on eBay but currently in your show case.
              Ship from the case, then mark them sold or pulled from the Show desk.
            </p>
          </div>
        </div>
      ) : null}

      {total === 0 && unmatched.length === 0 && away.length === 0 ? (
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
                  <span className="stack-title">
                    {r.title || <em>—</em>}
                    {/* One order line, several cards. Without this the two rows
                        are identical and look like the sheet listing a card
                        twice by mistake — which is exactly what someone would
                        "fix" by picking one. */}
                    {r.ofUnits ? <span className="badge2"> copy {r.unit} of {r.ofUnits}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {unmatched.length > 0 ? (
        <>
          <div className="ps-section-head">
            <span className="eyebrow">Variation / loose picks — by set, A–Z ({unmatched.length})</span>
            <p className="hint hint-small" style={{ margin: "4px 0 0" }}>Sets in shelf order (A–Z), each set&apos;s cards by collector number — one pass down the shelves.</p>
          </div>
          {looseGroups.map((grp, gi) => (
            <div className="panel loose-set" key={gi}>
              <div className="panel-head">
                <h3 className="loose-set-name">
                  {grp.setName}
                  {grp.setCode ? <span className="loose-set-code">{grp.setCode}</span> : null}
                </h3>
                <span className="badge2">{grp.items.filter((u) => !loosePicked.has(u.key)).length} to pick</span>
              </div>
              <div className="stack-list">
                {grp.items.map((u) => {
                  const isPicked = loosePicked.has(u.key);
                  return (
                    <label className={`ps-row loose-row${isPicked ? " done" : ""}`} key={u.key}>
                      <input type="checkbox" checked={isPicked} onChange={() => toggleLoose(u.key)} />
                      <span className="stack-pos">{u.nk !== Number.MAX_SAFE_INTEGER ? u.nk : "—"}</span>
                      <span className="loose-card">
                        <span className="loose-card-name">{u.variation || u.sku || "no SKU"}</span>
                        {u.deliveryName || u.buyer ? <span className="loose-card-buyer">for {u.deliveryName || u.buyer}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </>
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
                const on = packPile === p.pileNo;
                return (
                  <button
                    type="button"
                    className={`pack-pile${full ? " full" : ""}${on ? " on" : ""}`}
                    key={p.pileNo}
                    aria-pressed={on}
                    onClick={() => setPackPile(on ? null : p.pileNo)}
                    title={on ? "Show all piles" : `Show only pile ${p.pileNo}`}
                  >
                    <div className="pack-pile-no">Pile {p.pileNo}</div>
                    <div className="pack-pile-buyer">{p.deliveryName || p.buyer || "Buyer"}</div>
                    {p.deliveryName && p.buyer ? <div className="pack-pile-user">@{p.buyer}</div> : null}
                    <div className="pack-pile-meta">{got}/{p.count} card{p.count === 1 ? "" : "s"}{full ? " ✓" : ""}</div>
                  </button>
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

            <div className="pack-filters">
              <div className="pills" role="group" aria-label="Card type">
                <button aria-pressed={packType === "all"} onClick={() => setPackType("all")}>All</button>
                <button aria-pressed={packType === "stack"} onClick={() => setPackType("stack")}>Stack</button>
                <button aria-pressed={packType === "loose"} onClick={() => setPackType("loose")}>Variations</button>
              </div>
              <input
                className="pack-search"
                type="search"
                value={packQuery}
                onChange={(e) => setPackQuery(e.target.value)}
                placeholder="Filter by buyer, card or set…"
                aria-label="Filter pack list"
              />
              <label className="sd-toggle">
                <input type="checkbox" checked={packHideDone} onChange={(e) => setPackHideDone(e.target.checked)} />
                Hide sorted
              </label>
              {packFiltered ? (
                <button className="btn btn-ghost" onClick={() => { setPackPile(null); setPackQuery(""); setPackType("all"); setPackHideDone(false); }}>
                  ✕ Clear filters
                </button>
              ) : null}
            </div>
            {packFiltered ? (
              <p className="hint hint-small" style={{ margin: "0 0 6px" }}>
                Showing <b>{packVisible.length}</b> of {packView.items.length}
                {packPile != null ? ` · pile ${packPile} only` : ""} — numbers stay in full deal order.
              </p>
            ) : null}

            {packVisible.length === 0 ? (
              <p className="dd-empty">Nothing matches those filters.</p>
            ) : (
              <div className="stack-list">
                {packVisible.map((it) => {
                  const done = placed.has(it.key);
                  return (
                    <label className={`ps-row pack-row${done ? " done" : ""}`} key={it.key}>
                      <input type="checkbox" checked={done} onChange={() => togglePlaced(it.key)} />
                      <span className="stack-pos">{it.seqNo}</span>
                      <span className="pack-card">
                        <span className="stack-sku">
                          {it.variation || it.sku || "no SKU"}
                          {it.qty > 1 ? <span className="badge2"> ×{it.qty}</span> : null}
                        </span>
                        {it.matched ? (
                          <span className="stack-title">{it.title || <em>—</em>}</span>
                        ) : (
                          <span className="pack-set">
                            {it.setName || <em>—</em>}
                            {it.setCode ? <span className="loose-set-code">{it.setCode}</span> : null}
                          </span>
                        )}
                      </span>
                      <span className="pack-dest" aria-label={`Pile ${it.pileNo}, ${it.deliveryName || it.buyer}`}>
                        <span className="pack-dest-no">Pile {it.pileNo}</span>
                        <span className="pack-dest-buyer">{it.deliveryName || it.buyer || "Buyer"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
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
