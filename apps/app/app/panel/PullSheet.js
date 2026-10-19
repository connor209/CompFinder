"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { fallbackSetName } from "@compfinder/core/setmatch.js";
import { queuesBySku } from "@/lib/copyqueue";
import { buildPiles, currentPileNo, handPositions, pileLivePositions, pileOverview, pilePullOrder } from "@/lib/piles";
import { LABELLED_WINDOW_DAYS, loadPackedOrderIds, markOrdersPacked, sheetLines, unmarkOrdersPacked } from "@/lib/packed-store";
import { isToploaderStack, isUnorderedStack, compareByTitle } from "@/lib/toploader.js";

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
 * Stacks in walking order, with the toploader box and the Show Binders after
 * every stack: they have no positions, so each is one flick through by name at
 * the end of the walk.
 * Pick and Pack both sort through this, because the hand you deal from is the
 * order you picked in — two orders would number the hand wrong.
 */
function stackWalkCompare(a, b) {
  const ta = isUnorderedStack(a);
  const tb = isUnorderedStack(b);
  if (ta !== tb) return ta ? 1 : -1;
  return pileCompare(a, b);
}

const DONE_KEY = "cf-pullsheet-done";
const DEAL_TTL_MS = 12 * 60 * 60 * 1000;

function readDoneLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || "null");
    if (!raw || !Array.isArray(raw.log) || Date.now() - (raw.at || 0) > DEAL_TTL_MS) return [];
    return raw.log.filter((k) => Array.isArray(k));
  } catch {
    return [];
  }
}

function writeDoneLog(log) {
  try {
    if (log.length) localStorage.setItem(DONE_KEY, JSON.stringify({ at: Date.now(), log }));
    else localStorage.removeItem(DONE_KEY);
  } catch {
    /* private window — the deal still works, it just won't survive a reload */
  }
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
  const [showAllPiles, setShowAllPiles] = useState(false); // the every-pile list on Pack
  // Completed piles, one array of line keys per Pile complete, oldest first.
  // Kept on this device so a reload mid-deal doesn't renumber the hand as if
  // the finished piles were still in it — that would send you to the wrong
  // card. Gone after DEAL_TTL_MS: a deal is one sitting, not tomorrow's.
  const [doneLog, setDoneLog] = useState(() => readDoneLog());
  // eBay calls an order dispatched the moment its label is printed, so those
  // come back marked labelPrinted and stay until their pile is complete here.
  const [labelled, setLabelled] = useState([]); // order ids: label printed, not yet packed
  const [packedMissing, setPackedMissing] = useState(false); // migration 033 not run
  const [packedNote, setPackedNote] = useState(""); // a packed read/write that failed

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
    // Which label-printed orders have we already packed? A failed read leaves
    // them OFF the sheet (sheetLines with null) — the old behaviour — rather
    // than putting a week of sent orders back on it.
    const rawLines = ordersRes.lines || [];
    const labelledIds = [...new Set(rawLines.filter((l) => l.labelPrinted).map((l) => l.orderId))];
    let packedIds = new Set();
    setPackedMissing(false);
    setPackedNote(ordersRes.labelledError ? `Couldn't read orders with a label printed: ${ordersRes.labelledError}` : "");
    if (labelledIds.length) {
      const res = await loadPackedOrderIds(supabase(), labelledIds);
      if (res.ok) packedIds = res.ids;
      else {
        packedIds = null;
        if (res.missing) setPackedMissing(true);
        else setPackedNote(`Couldn't check which label-printed orders are packed: ${res.error}`);
      }
    }
    // Read off storage, not state: on mount this closure holds the first
    // render's log, and a pile completed this sitting must stay on the deal.
    const lines = sheetLines(rawLines, packedIds, new Set(readDoneLog().flat()));
    setLabelled([...new Set(lines.filter((l) => l.labelPrinted && !packedIds?.has(String(l.orderId))).map((l) => l.orderId))]);

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
      const skl = c.sku ? String(c.sku).trim().toLowerCase() || null : null;
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
      const skl = l.sku ? l.sku.trim().toLowerCase() || null : null;
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
      if (na !== nb) return stackWalkCompare(na, nb);
      if (isUnorderedStack(na)) return compareByTitle(a, b);
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
      const skl = c.sku ? String(c.sku).trim().toLowerCase() || null : null;
      if (skl && !anyBySku.has(skl)) anyBySku.set(skl, c);
    }
    const pack = lines.map((l) => {
      const skl = l.sku ? l.sku.trim().toLowerCase() || null : null;
      const card = skl ? anyBySku.get(skl) : null;
      return {
        key: l.lineItemId,
        orderId: l.orderId,
        sku: l.sku,
        title: l.title,
        variation: l.variation,
        buyer: l.buyer || "",
        deliveryName: l.deliveryName || "",
        shipKey: l.shipKey || "",
        stackNm: card ? nameMap.get(card.stack_id) || "" : "",
        position: card ? card.position : null,
        nk: numKey(l.variation || l.title || l.sku),
        matched: !!card,
        // Pack deals ONE entry per order line — one buyer, one envelope — so a
        // quantity-2 line stays a single entry and carries the count instead.
        // Splitting it here would have you dealing two piles to one address.
        qty: Math.max(1, Number(l.quantity) || 1),
        labelPrinted: !!l.labelPrinted,
        ...setInfo(l.title)
      };
    });
    pack.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1; // loose (no stack) last
      if (a.matched) {
        if (a.stackNm !== b.stackNm) return stackWalkCompare(a.stackNm, b.stackNm);
        if (isUnorderedStack(a.stackNm)) return compareByTitle(a, b);
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
  // (Pile 1 = the first buyer you hit) — no need to pre-label piles by buyer.
  // A pile is one buyer at one address, not one order: a buyer's separate
  // checkouts land in the same envelope. lib/piles.js owns the rule.
  const packView = useMemo(() => {
    const seq = packReverse ? [...packItems].reverse() : packItems;
    return buildPiles(seq);
  }, [packItems, packReverse]);

  // The hand, pile by pile. A completed pile's cards are out of the hand, so
  // every number is a live rank among what is still held (lib/piles.js).
  const doneKeys = useMemo(() => new Set(doneLog.flat()), [doneLog]);
  const hand = useMemo(() => handPositions(packView.items, doneKeys), [packView.items, doneKeys]);
  const pileNo = useMemo(() => currentPileNo(packView.items, doneKeys), [packView.items, doneKeys]);
  const pile = pileNo != null ? packView.piles[pileNo - 1] : null;
  const pileCards = useMemo(
    () => (pileNo != null ? pilePullOrder(packView.items, pileNo, hand.pos) : []),
    [packView.items, pileNo, hand]
  );
  const pileLive = useMemo(() => pileLivePositions(pileCards, hand.pos, placed), [pileCards, hand, placed]);
  const overview = useMemo(() => pileOverview(packView.items, packView.piles, doneKeys), [packView, doneKeys]);
  const pilesLeft = useMemo(() => new Set(packView.items.filter((i) => !doneKeys.has(i.key)).map((i) => i.pileNo)).size, [packView.items, doneKeys]);

  function completePile() {
    if (!pile || pileCards.length === 0) return;
    const missing = pileCards.filter((c) => !placed.has(c.key));
    if (missing.length) {
      const names = missing.slice(0, 3).map((c) => c.variation || c.sku || c.title || "a card").join(", ");
      const more = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
      if (!confirm(`${missing.length} card(s) in Pile ${pile.pileNo} aren't ticked: ${names}${more}.\n\nComplete the pile anyway? They come out of the hand and the rest renumbers.`)) return;
    }
    const next = [...doneLog, pileCards.map((c) => c.key)];
    setDoneLog(next);
    writeDoneLog(next);
    // A completed pile is a packed parcel — the one thing eBay can't tell us,
    // since to eBay a printed label already means dispatched.
    recordPacked(markOrdersPacked, pile.orderIds);
    setLabelled((prev) => prev.filter((id) => !pile.orderIds.includes(id)));
  }

  // One tap for a pile already dealt by hand; a second unticks it all again.
  function tickWholePile() {
    const allIn = pileCards.every((c) => placed.has(c.key));
    setPlaced((prev) => {
      const n = new Set(prev);
      for (const c of pileCards) {
        if (allIn) n.delete(c.key);
        else n.add(c.key);
      }
      return n;
    });
  }

  function ordersOfKeys(keys) {
    const want = new Set(keys);
    return [...new Set(packItems.filter((i) => want.has(i.key)).map((i) => i.orderId))];
  }

  async function recordPacked(fn, orderIds) {
    const res = await fn(supabase(), orderIds);
    if (res.ok) return;
    if (res.missing) setPackedMissing(true);
    else setPackedNote(`Couldn't record which orders are packed: ${res.error}`);
  }

  function reopenLastPile() {
    if (!doneLog.length) return;
    recordPacked(unmarkOrdersPacked, ordersOfKeys(doneLog[doneLog.length - 1]));
    const next = doneLog.slice(0, -1);
    setDoneLog(next);
    writeDoneLog(next);
  }

  function startOver() {
    if (!confirm("Start the deal again from Pile 1? Every completed pile goes back into the hand.")) return;
    recordPacked(unmarkOrdersPacked, ordersOfKeys(doneLog.flat()));
    setDoneLog([]);
    writeDoneLog([]);
    setPlaced(new Set());
  }

  // For orders that went out before this sheet kept a record — or were packed
  // some other way. Names the count, and confirms, because they leave the sheet.
  async function markLabelledSent() {
    if (!labelled.length) return;
    if (!confirm(`Mark ${labelled.length} label-printed order(s) as already packed and sent? They leave the pull sheet.`)) return;
    const res = await markOrdersPacked(supabase(), labelled);
    if (!res.ok) {
      if (res.missing) setPackedMissing(true);
      else setPackedNote(`Couldn't record which orders are packed: ${res.error}`);
      return;
    }
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
  const pileTicked = pileCards.filter((c) => placed.has(c.key)).length;

  return (
    <>
      <div className="ps-bar">
        <div className="pills" role="group" aria-label="Pull sheet mode">
          <button aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>1 · Pick</button>
          <button aria-pressed={mode === "pack"} onClick={() => setMode("pack")}>2 · Pack</button>
        </div>
        <div className="ps-actions">
          {mode === "pack" ? (
            <button
              className="btn btn-ghost"
              onClick={() => setPackReverse((v) => !v)}
              disabled={doneLog.length > 0}
              title={doneLog.length ? "Locked once a pile is complete — flipping now would renumber the hand under you" : "Which end of your pulled stack you start from"}
            >
              ⇅ {packReverse ? "Last pulled on top" : "First pulled on top"}
            </button>
          ) : null}
          {mode === "pack" && packView.piles.length ? (
            <button className="btn btn-ghost" aria-pressed={showAllPiles} onClick={() => setShowAllPiles((v) => !v)}>
              ☰ {showAllPiles ? "Hide piles" : `All piles (${packView.piles.length})`}
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

      {packedMissing ? (
        <div className="mine-banner">
          <span className="mine-ic" aria-hidden="true">⚠</span>
          <div>
            <strong>Orders with a label printed drop off this sheet</strong>
            <p className="hint hint-small" style={{ marginTop: 4 }}>
              eBay counts a printed label as dispatched. Run migration 033 (packed_orders) in Supabase and they stay here until their pile is complete.
            </p>
          </div>
        </div>
      ) : null}
      {packedNote ? <p className="compfinder-error">{packedNote}</p> : null}
      {labelled.length > 0 ? (
        <div className="mine-banner">
          <span className="mine-ic" aria-hidden="true">🏷</span>
          <div>
            <strong>{labelled.length} order(s) have a label printed but aren&apos;t packed yet</strong>
            <p className="hint hint-small" style={{ marginTop: 4 }}>
              eBay already calls these dispatched. They stay on the sheet until you complete their pile on Pack
              (labels printed in the last {LABELLED_WINDOW_DAYS} days).
            </p>
            <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={markLabelledSent}>These are already sent</button>
          </div>
        </div>
      ) : null}

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
            <strong>{away.length} ordered card(s) are checked out — in the show case or the stream box</strong>
            <p className="hint hint-small" style={{ marginTop: 4 }}>
              {away.map((a) => a.sku || a.title).filter(Boolean).join(" · ")} — sold on eBay but not in a stack.
              Ship from the case or the box, then mark them sold on the Show desk or on Stream stock.
            </p>
          </div>
        </div>
      ) : null}

      {total === 0 && unmatched.length === 0 && away.length === 0 ? (
        <div className="panel"><p className="dd-empty">No orders waiting to be picked. 🎉</p></div>
      ) : null}

      {groups.map(([stackId, gr]) => {
        // The toploader box and the Show Binders have no positions: they are
        // listed by name, and the column a stack uses for "count to" says so
        // instead of a number.
        const box = isUnorderedStack(stackName.get(stackId));
        const tl = isToploaderStack(stackName.get(stackId));
        return (
        <div className="panel" key={stackId}>
          <div className="panel-head">
            <h3>{box ? `${tl ? "🗂" : "📒"} ${stackName.get(stackId)}` : stackName.get(stackId) || "Stack"}</h3>
            <span className="badge2">{gr.filter((r) => !picked.has(r.cardId)).length} to pick</span>
          </div>
          {box ? (
            <p className="hint hint-small" style={{ marginTop: 0 }}>{tl ? "In the toploader box" : "In the Show Binder"}, by name — no positions to count.</p>
          ) : null}
          <div className="stack-list">
            {gr.map((r) => {
              const isPicked = picked.has(r.cardId);
              const rank = box ? "🗂" : liveRank(r);
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
        );
      })}

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
      /* ---- PACK MODE: one pile at a time ---- */
      <>
      {showAllPiles && overview.length ? (
        <div className="panel ps-allpiles">
          <div className="panel-head">
            <h3>All piles</h3>
            <span className="badge2">
              {overview.filter((p) => p.state === "done").length} done · {overview.filter((p) => p.state !== "done").length} to go
            </span>
          </div>
          <ol className="ps-allpiles-list">
            {overview.map((p) => (
              <li key={p.pileNo} className={`ps-allpile ${p.state}`}>
                <span className="ps-allpile-no">{p.pileNo}</span>
                <span className="ps-allpile-who">
                  <span className="ps-allpile-name">{p.name}</span>
                  <span className="pack-pile-user">
                    {p.buyer && p.name !== p.buyer ? `@${p.buyer}` : ""}
                    {p.orders > 1 ? `${p.buyer && p.name !== p.buyer ? " · " : ""}${p.orders} orders` : ""}
                  </span>
                </span>
                <span className="ps-allpile-cards">{p.cards} card{p.cards === 1 ? "" : "s"}</span>
                <span className="ps-allpile-state">{p.state === "done" ? "✓ Done" : p.state === "current" ? "▶ Now" : "To do"}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {packView.items.length === 0 ? (
        <div className="panel"><p className="dd-empty">Nothing to pack — no open orders. 🎉</p></div>
      ) : pile == null ? (
        <div className="panel">
          <p className="dd-empty" style={{ color: "var(--conf-high)" }}>All {packView.piles.length} pile(s) complete — ready to pack &amp; ship. 🎉</p>
          <div className="ps-pile-nav">
            <button className="btn btn-ghost" onClick={reopenLastPile}>‹ Reopen last pile</button>
            <button className="btn btn-ghost" onClick={startOver}>↺ Start over</button>
          </div>
        </div>
      ) : (
        <div className="panel ps-pile">
          <div className="ps-progress" style={{ marginBottom: 10 }}>
            Pile <b>{pile.pileNo}</b> of {packView.piles.length} · {pilesLeft} to go · {hand.depth} card{hand.depth === 1 ? "" : "s"} left in your hand
          </div>
          <div className="panel-head">
            <div className="ps-pile-who">
              <h3>Pile {pile.pileNo} — {pile.deliveryName || pile.buyer || "Buyer"}</h3>
              <span className="pack-pile-user">
                {pile.deliveryName && pile.buyer ? `@${pile.buyer}` : ""}
                {pile.orderIds.length > 1 ? `${pile.deliveryName && pile.buyer ? " · " : ""}${pile.orderIds.length} orders, one envelope` : ""}
              </span>
            </div>
            <span className="badge2">{pileTicked}/{pileCards.length} in pile</span>
            <button className="btn btn-ghost" onClick={tickWholePile}>
              {pileTicked === pileCards.length ? "↺ Untick all" : "✓ All in pile"}
            </button>
            {pileCards.some((c) => c.labelPrinted) ? <span className="badge2" title="eBay already has a label for this parcel">🏷 label printed</span> : null}
          </div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Card 1 is the top of your hand. Tick each card as it goes in the pile — the numbers below it move up straight away.
          </p>
          <div className="stack-list">
            {pileCards.map((it) => {
              const done = placed.has(it.key);
              const at = pileLive.get(it.key);
              return (
                <label className={`ps-row pack-row${done ? " done" : ""}`} key={it.key}>
                  <input type="checkbox" checked={done} onChange={() => togglePlaced(it.key)} />
                  <span className="stack-pos" title="Position in your hand, counting from the top">
                    {done ? "✓" : at.from === at.to ? at.from : `${at.from}–${at.to}`}
                  </span>
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
                </label>
              );
            })}
          </div>
          <div className="ps-pile-nav">
            {doneLog.length ? <button className="btn btn-ghost" onClick={reopenLastPile}>‹ Reopen last pile</button> : null}
            <button className="btn btn-primary" onClick={completePile}>✓ Pile {pile.pileNo} complete</button>
          </div>
        </div>
      )}
      </>
      )}
    </>
  );
}
