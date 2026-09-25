"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { liveRanks, stackDepths, positionLabel } from "@/lib/stackpos.js";
import { gameFacets, gameName, UNKNOWN_GAME } from "@/lib/games.js";
import { getSetIndex } from "@/lib/set-index.js";
import { listingState, matchesQuery, compareSku } from "@/lib/showfilter.js";
import { relayUrl } from "@/lib/livestream.js";
import { checkoutLine, sellLine } from "@/lib/deal.js";
import { parseOverridePence } from "@/lib/price-override.js";
import {
  checkoutStackCard, getHideMode, maxPosition, restoreCheckout,
  planReallocation, nextStackName, DEFAULT_STACK_CAPACITY
} from "@/lib/checkout";
import {
  streamCandidates, recommendStream, boxStatus, topUpCount, pullSheet, latestBatch,
  matchAired, streamTally, defaultStreamName, streamHideMode, isMissingPool,
  CONDITIONS, AIRINGS_BEFORE_RETURN, STREAMS_BACKSTOP, DEFAULT_TARGET, COOLDOWN_DAYS
} from "@/lib/streamstock.js";
import {
  loadStreams, loadAirings, createStream, closeStream, reopenStream,
  recordAirings, deleteAiring, setAiringOutcome
} from "@/lib/stream-store.js";
import { storedRelayOrigin } from "./StreamBar";

/**
 * Stream stock — the box of cards pulled for eBay Live.
 *
 * Four jobs, top to bottom, in the order a week goes:
 *
 * 1. **Top up the box.** The recommender picks from what is still in the
 *    stacks — by game, value, character and condition — and checking the
 *    picks out hides their listings and writes them into the stream pool.
 * 2. **Pull them.** The pull sheet numbers each card where it physically IS,
 *    deepest first, so the numbers stay true while you pull.
 * 3. **Pack the stream.** Record what aired (read off the relay, or ticked by
 *    hand), mark what sold — which ends its listing — and close the stream,
 *    which counts every other aired card as one chance used.
 * 4. **Send cards home.** Three airings without a sale and a card is due back
 *    in its stack; the listing comes back with it.
 *
 * The rules themselves are in lib/streamstock.js, and the reason stream cards
 * never appear on the Show Desk, its counter, its binder or the storefront is
 * there too. No crossover, decided 2026-09-25: a card is in one box or the
 * other, never both.
 */

const pounds = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
const TARGET_KEY = "cf-stream-target";

function readTarget() {
  try {
    const n = parseInt(localStorage.getItem(TARGET_KEY) || "", 10);
    return n > 0 ? n : DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
}

function toggleIn(set, key) {
  const n = new Set(set);
  if (n.has(key)) n.delete(key); else n.add(key);
  return n;
}

function penceFrom(raw) {
  const t = String(raw || "").replace(/[£,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function StreamStock() {
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState(""); // 016 or 031 not applied
  const [stacks, setStacks] = useState([]);
  const [cards, setCards] = useState([]);           // every unpulled stack card
  const [listings, setListings] = useState([]);
  const [box, setBox] = useState([]);               // open stream checkouts
  const [returned, setReturned] = useState([]);     // stream checkouts come home, for the cooldown
  const [streams, setStreams] = useState([]);
  const [airings, setAirings] = useState([]);
  const [gameIndex, setGameIndex] = useState(null);
  const [capacity, setCapacity] = useState(DEFAULT_STACK_CAPACITY);

  const [target, setTarget] = useState(DEFAULT_TARGET);
  // The recommender's parameters. Not persisted: each top-up is its own
  // question, and a character filter left over from last week would quietly
  // shape this week's box.
  const [recOpen, setRecOpen] = useState(false);
  const [count, setCount] = useState("");
  const [games, setGames] = useState(new Set());
  const [conds, setConds] = useState(new Set());
  const [minP, setMinP] = useState("");
  const [maxP, setMaxP] = useState("");
  const [names, setNames] = useState("");
  const [cooldown, setCooldown] = useState(String(COOLDOWN_DAYS));
  const [recOff, setRecOff] = useState(new Set());

  const [streamId, setStreamId] = useState("");
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [feedback, setFeedback] = useState([]);

  const supabase = () => createClient();

  useEffect(() => { setTarget(readTarget()); }, []);
  function saveTarget(v) {
    const n = Math.max(1, Math.min(1000, parseInt(v, 10) || DEFAULT_TARGET));
    setTarget(n);
    try { localStorage.setItem(TARGET_KEY, String(n)); } catch { /* private mode */ }
  }

  async function load() {
    const sb = supabase();
    // Ask for the pool column on its own first. pagedSelect swallows errors
    // into an empty list, and an empty box is exactly what a missing
    // migration would otherwise look like.
    const probe = await sb.from("stock_checkouts").select("id,pool").limit(0);
    if (probe.error) {
      setSetupError(
        isMissingPool(probe.error)
          ? "Stream stock needs migration 031_stream_stock.sql — run it once in the Supabase SQL editor."
          : /stock_checkouts|does not exist|schema cache/i.test(probe.error.message || "")
            ? "Stream stock needs migrations 016_show_checkouts.sql and 031_stream_stock.sql."
            : `Couldn't read the stream box: ${probe.error.message}`
      );
      setLoading(false);
      return;
    }
    const [st, all, live, pool, ss, as] = await Promise.all([
      sb.from("card_stacks").select("id,name").order("created_at", { ascending: true }),
      pagedSelect(() => sb.from("stack_cards").select("*").is("pulled_at", null)),
      pagedSelect(() => sb.from("ebay_listings").select("ebay_item_id,sku,title,price_value,quantity,extra").not("sku", "is", null)),
      pagedSelect(() => sb.from("stock_checkouts").select("*").eq("pool", "stream").order("checked_out_at", { ascending: true })),
      loadStreams(sb),
      loadAirings(sb)
    ]);
    if (ss.missing || as.missing) {
      setSetupError("Stream stock needs migration 031_stream_stock.sql — run it once in the Supabase SQL editor.");
      setLoading(false);
      return;
    }
    setStacks(st.data || []);
    setCards(all || []);
    setListings(live || []);
    setBox((pool || []).filter((co) => !co.resolved_at));
    setReturned((pool || []).filter((co) => co.resolved_at && co.resolution === "returned"));
    setStreams(ss.rows || []);
    setAirings(as.rows || []);
    setStreamId((prev) => {
      if (prev && (ss.rows || []).some((s) => s.id === prev)) return prev;
      const openOne = (ss.rows || []).find((s) => !s.closed_at);
      return openOne?.id || (ss.rows || [])[0]?.id || "";
    });
    if (ss.error || as.error) setMsg(ss.error || as.error);
    try {
      const { data: { user } } = await sb.auth.getUser();
      const { data: profile } = await sb.from("profiles").select("settings").eq("id", user.id).single();
      if (profile?.settings?.stackCapacity) setCapacity(profile.settings.stackCapacity);
    } catch { /* the default capacity stands */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // The catalogue's set names are the last way to tell one game from another.
  // Never waited on: until they land those cards are simply "unknown".
  useEffect(() => {
    let live = true;
    getSetIndex(supabase()).then((r) => { if (live) setGameIndex(r?.gameIndex || null); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const stackName = useMemo(() => new Map(stacks.map((s) => [s.id, s.name])), [stacks]);

  // ---- the box --------------------------------------------------------------

  const status = useMemo(() => boxStatus(box, airings, streams), [box, airings, streams]);
  const dueCount = status.filter((s) => s.due).length;
  const topUp = topUpCount(target, status);
  const stream = streams.find((s) => s.id === streamId) || null;
  const streamAirings = useMemo(() => airings.filter((a) => a.stream_id === streamId), [airings, streamId]);
  const airedHere = useMemo(() => new Set(streamAirings.map((a) => String(a.checkout_id))), [streamAirings]);
  const tally = streamTally(streamAirings);
  const boxById = useMemo(() => new Map(box.map((co) => [String(co.id), co])), [box]);

  // What is on screen, and therefore what a bulk button acts on — the same
  // rule as selectionFor() on the Show Desk.
  const visible = useMemo(() => {
    const rows = status.filter((s) => (!dueOnly || s.due) && matchesQuery(s.checkout, q));
    return rows.sort((a, b) =>
      (b.due ? 1 : 0) - (a.due ? 1 : 0) || b.aired - a.aired || compareSku(a.checkout.sku, b.checkout.sku)
    );
  }, [status, q, dueOnly]);
  const visibleDue = visible.filter((s) => s.due).map((s) => s.checkout);

  // ---- the recommender ------------------------------------------------------

  const candidates = useMemo(
    () => streamCandidates({ cards, listings, recentStream: returned, gameIndex, cooldownDays: Number(cooldown) || 0 }),
    [cards, listings, returned, gameIndex, cooldown]
  );
  const gameChips = useMemo(() => gameFacets(candidates.rows), [candidates]);
  const condCounts = useMemo(() => {
    const m = new Map();
    for (const r of candidates.rows) m.set(r.condition, (m.get(r.condition) || 0) + 1);
    return m;
  }, [candidates]);
  const wanted = count === "" ? topUp : Math.max(0, parseInt(count, 10) || 0);
  const rec = useMemo(
    () => recommendStream(candidates.rows, {
      count: wanted, games, conditions: conds, names,
      minPence: penceFrom(minP), maxPence: penceFrom(maxP)
    }),
    [candidates, wanted, games, conds, names, minP, maxP]
  );
  const ranks = useMemo(() => liveRanks(cards), [cards]);
  const depths = useMemo(() => stackDepths(cards), [cards]);
  const chosen = rec.picks.filter((r) => !recOff.has(r.card.id));

  async function checkoutPicks() {
    if (chosen.length === 0) return;
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const hideMode = streamHideMode(getHideMode());
    const results = [];
    for (let i = 0; i < chosen.length; i++) {
      const { card } = chosen[i];
      setProgress(`Adding ${i + 1} of ${chosen.length} to the box…`);
      // eslint-disable-next-line no-await-in-loop
      const r = await checkoutStackCard(sb, {
        card, stackName: stackName.get(card.stack_id) || null, event: null, hideMode, pool: "stream"
      });
      if (!r.ok) {
        results.push({ sku: card.sku, ok: false, text: r.error });
        if (r.needsMigration) break;
        continue;
      }
      results.push({
        sku: card.sku,
        ok: !r.hideError,
        text: r.hideError ? `in the box, but ⚠ listing not hidden: ${r.hideError}`
          : r.hideMethod === "quantity" ? "in the box · listing hidden (qty 0)"
          : r.hideMethod === "ended" ? "in the box · listing ended, relists when it comes home"
          : "in the box · no listing found"
      });
    }
    setFeedback(results);
    setProgress("");
    setBusy(false);
    setRecOpen(false);
    setRecOff(new Set());
    const added = results.filter((r) => r.text.startsWith("in the box")).length;
    setMsg(`${added} card${added === 1 ? "" : "s"} added to the stream box. The pull sheet below lists them.`);
    await load();
  }

  // ---- the pull sheet -------------------------------------------------------

  const batch = useMemo(() => latestBatch(box), [box]);
  const sheet = useMemo(() => pullSheet(batch, cards, stackName), [batch, cards, stackName]);

  function downloadSheet() {
    const lines = [["Stack", "Position", "SKU", "Card"].join(",")];
    for (const g of sheet.stacks) {
      for (const r of g.rows) lines.push([g.name, r.rank, r.checkout.sku, r.checkout.title].map(csvCell).join(","));
    }
    for (const co of sheet.unplaced) lines.push(["", "", co.sku, co.title].map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stream-pull-${String(batch[0]?.checked_out_at || "").slice(0, 10) || "sheet"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- streams --------------------------------------------------------------

  async function startStream() {
    setBusy(true);
    setMsg("");
    const r = await createStream(supabase(), { name: newName.trim() || defaultStreamName() });
    setBusy(false);
    if (!r.ok) { setMsg(r.error || "Couldn't start the stream."); return; }
    setNewName("");
    setStreamId(r.row.id);
    await load();
  }

  async function readRelay() {
    if (!stream || stream.closed_at) return;
    setBusy(true);
    setMsg("");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    let ids = null;
    try {
      const res = await fetch(relayUrl("/state", storedRelayOrigin()), { signal: ctl.signal, cache: "no-store" });
      const json = await res.json();
      ids = Array.isArray(json.aired) ? json.aired : null;
    } catch { /* reported below */ }
    clearTimeout(timer);
    if (ids === null) {
      setBusy(false);
      setMsg("The relay isn't answering. It has to be running on this computer — or tick the cards that aired by hand, below.");
      return;
    }
    const { matched, unknown } = matchAired(ids, box);
    const r = await recordAirings(supabase(), stream.id, matched.map((co) => co.id));
    setBusy(false);
    if (!r.ok) { setMsg(r.error || "Couldn't record what aired."); return; }
    setMsg(
      `${ids.length} lot${ids.length === 1 ? "" : "s"} aired on the relay · ${r.added} newly recorded against ${stream.name}` +
      (matched.length - r.added > 0 ? ` · ${matched.length - r.added} already recorded` : "") +
      (unknown.length ? ` · ${unknown.length} not in the box (streamed from My listings, or demo lots) — not counted` : "")
    );
    await load();
  }

  async function markAired(co) {
    if (!stream || stream.closed_at) return;
    setBusy(true);
    const r = await recordAirings(supabase(), stream.id, [co.id]);
    setBusy(false);
    if (!r.ok) setMsg(r.error || "Couldn't record that.");
    await load();
  }

  async function unAir(a) {
    setBusy(true);
    const r = await deleteAiring(supabase(), a.id);
    setBusy(false);
    if (!r.ok) setMsg(r.error || "Couldn't remove that.");
    await load();
  }

  /**
   * Sold on the stream. Resolves the checkout as sold, marks the stack card
   * pulled and ends the listing — sellLine() in lib/deal.js, the one
   * definition of selling a card. The price goes on the AIRING and never on
   * the checkout's sold_price_pence: an eBay Live sale is an eBay order and
   * reaches Accounts through ebay_sales, so writing it into the cash-sale
   * column as well would count it twice.
   */
  async function markSold(a) {
    const co = boxById.get(String(a.checkout_id));
    if (!co) { setMsg("That card isn't in the box any more — sold or returned already."); return; }
    const raw = prompt(`Sold "${co.sku || co.title || "card"}" on the stream for £… (optional, for this stream's tally)`, "");
    if (raw === null) return;
    const { pence, error } = raw.trim() ? parseOverridePence(raw) : { pence: null, error: null };
    if (error) { setMsg(error); return; }
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const r = await sellLine(sb, checkoutLine(co), null, { event: null });
    if (!r.ok) {
      setBusy(false);
      setMsg(`That sale couldn't be recorded: ${r.error}`);
      return;
    }
    const o = await setAiringOutcome(sb, a.id, "sold", pence);
    setBusy(false);
    setMsg(
      `${co.sku || "Card"} marked sold${pence != null ? ` at ${pounds(pence)}` : ""} and taken out of its stack.` +
      (r.warning ? ` ⚠ ${r.warning} — end it on eBay by hand.` : " Listing ended.") +
      (o.ok ? "" : ` ⚠ The stream tally didn't save: ${o.error}`)
    );
    await load();
  }

  async function setOutcome(a, outcome) {
    setBusy(true);
    const r = await setAiringOutcome(supabase(), a.id, outcome);
    setBusy(false);
    if (!r.ok) setMsg(r.error || "Couldn't save that.");
    await load();
  }

  async function finishStream() {
    if (!stream) return;
    const pending = tally.pending;
    if (pending > 0 && !confirm(`${pending} aired card${pending === 1 ? " has" : "s have"} no outcome yet. Closing the stream records ${pending === 1 ? "it" : "them"} as UNSOLD — one airing used toward going home. Close ${stream.name}?`)) return;
    setBusy(true);
    const r = await closeStream(supabase(), stream.id);
    setBusy(false);
    setMsg(r.ok ? `${stream.name} closed.` : r.error || "Couldn't close the stream.");
    await load();
  }

  async function unfinishStream() {
    if (!stream) return;
    setBusy(true);
    const r = await reopenStream(supabase(), stream.id);
    setBusy(false);
    if (!r.ok) setMsg(r.error || "Couldn't re-open the stream.");
    await load();
  }

  // ---- home -----------------------------------------------------------------

  async function sendHome(list, mode) {
    if (list.length === 0) return;
    if (!confirm(`Check ${list.length} card${list.length === 1 ? "" : "s"} back in? Their listings come back on eBay.`)) return;
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const warnings = [];
    let placed = 0;
    if (mode === "spot") {
      for (let i = 0; i < list.length; i++) {
        setProgress(`Checking in ${i + 1} of ${list.length}…`);
        // eslint-disable-next-line no-await-in-loop
        warnings.push(...await restoreCheckout(sb, list[i], {}, "spot", list[i].stack_id));
        placed += 1;
      }
    } else {
      // The fewest stacks touched — the Show Desk's reallocation, unchanged.
      const used = new Map();
      for (const c of cards) if (!c.checked_out_at) used.set(c.stack_id, (used.get(c.stack_id) || 0) + 1);
      const { groups } = planReallocation(list.length, stacks.map((s) => ({ ...s, used: used.get(s.id) || 0 })), capacity);
      const { data: { user } } = await sb.auth.getUser();
      const names = stacks.map((s) => s.name);
      let cursor = 0;
      for (const g of groups) {
        let sid = g.stackId;
        if (!sid) {
          const name = g.name || nextStackName(names);
          names.push(name);
          // eslint-disable-next-line no-await-in-loop
          const { data: created } = await sb.from("card_stacks").insert({ user_id: user.id, name }).select("id").single();
          if (!created) { warnings.push(`couldn't create stack ${name}`); cursor += g.count; continue; }
          sid = created.id;
        }
        // eslint-disable-next-line no-await-in-loop
        const base = await maxPosition(sb, sid);
        const slice = list.slice(cursor, cursor + g.count);
        cursor += g.count;
        for (let i = 0; i < slice.length; i++) {
          setProgress(`Filing ${placed + 1} of ${list.length}…`);
          // eslint-disable-next-line no-await-in-loop
          warnings.push(...await restoreCheckout(sb, slice[i], { stack_id: sid, position: base + 1 + i }, "back", sid));
          placed += 1;
        }
      }
    }
    setProgress("");
    setBusy(false);
    setMsg(`${placed} card${placed === 1 ? "" : "s"} checked back in${mode === "spot" ? " to their old spots" : ""}.${warnings.length ? ` ⚠ ${warnings.join(" · ")}` : ""}`);
    await load();
  }

  // ---- render ---------------------------------------------------------------

  if (loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading stream stock…</div>;
  if (setupError) {
    return (
      <div className="panel">
        <h3>Stream stock</h3>
        <p className="compfinder-error">{setupError}</p>
        <p className="hint hint-small">Nothing else in the app changes until it is run.</p>
      </div>
    );
  }

  const skipped = candidates.skipped;

  return (
    <div className="rise-group">
      <div className="panel">
        <div className="panel-head">
          <h3>The stream box</h3>
          <div className="ss-stats">
            <span className="badge2">{box.length} in the box</span>
            {dueCount > 0 ? <span className="badge2 ss-due">{dueCount} due home</span> : null}
            <span className="badge2">{topUp > 0 ? `${topUp} to add` : "full"}</span>
          </div>
        </div>
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          A card stays in the box until it sells or has aired <b>{AIRINGS_BEFORE_RETURN} times</b> without selling
          (or sat through {STREAMS_BACKSTOP} streams without being reached). Its eBay listing is hidden the whole
          time and comes back when it goes home. Stream cards never show on the Show Desk.
        </p>
        <div className="sd-opts">
          <label className="sd-toggle">
            Box size
            <input className="sd-count" type="number" min="1" max="1000" value={target} onChange={(e) => saveTarget(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={() => { setRecOpen(true); setRecOff(new Set()); }} disabled={busy}>
            ★ Recommend cards to add
          </button>
        </div>
        {feedback.length > 0 ? (
          <div className="sd-feedback">
            {feedback.map((f, i) => (
              <p key={i} className="hint hint-small" style={{ margin: "4px 0", color: f.ok ? "var(--conf-high)" : "var(--bad-ink)" }}>
                {f.ok ? "✓" : "✕"} <b>{f.sku}</b> — {f.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {recOpen ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Recommended for the box — highest value first</span>
            <button className="btn btn-ghost" onClick={() => setRecOpen(false)}>Close</button>
          </div>
          <div className="ss-filters">
            <label>
              How many
              <input type="number" min="0" max="400" value={count} placeholder={String(topUp)} onChange={(e) => setCount(e.target.value)} />
            </label>
            <label>
              Min £
              <input inputMode="decimal" value={minP} placeholder="any" onChange={(e) => setMinP(e.target.value)} />
            </label>
            <label>
              Max £
              <input inputMode="decimal" value={maxP} placeholder="any" onChange={(e) => setMaxP(e.target.value)} />
            </label>
            <label>
              Not back within (days)
              <input type="number" min="0" max="365" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </label>
          </div>
          <div className="ss-filters">
            <label>
              Characters — commas between, whole words
              <input value={names} placeholder="charizard, umbreon vmax, pikachu" onChange={(e) => setNames(e.target.value)} />
            </label>
          </div>
          <div className="sd-games" role="group" aria-label="Filter by game">
            <button type="button" aria-pressed={games.size === 0} onClick={() => setGames(new Set())}>
              All games <span className="sd-games-n">{candidates.rows.length}</span>
            </button>
            {gameChips.map((f) => (
              <button
                type="button"
                key={f.slug}
                aria-pressed={games.has(f.slug)}
                onClick={() => setGames((g) => toggleIn(g, f.slug))}
                title={f.slug === UNKNOWN_GAME ? "Neither the eBay category, the title nor a set name said which game these are." : undefined}
              >
                {gameName(f.slug)} <span className="sd-games-n">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="sd-games" role="group" aria-label="Filter by condition">
            <button type="button" aria-pressed={conds.size === 0} onClick={() => setConds(new Set())}>Any condition</button>
            {CONDITIONS.filter((c) => condCounts.get(c.key)).map((c) => (
              <button type="button" key={c.key} aria-pressed={conds.has(c.key)} onClick={() => setConds((s) => toggleIn(s, c.key))}>
                {c.label} <span className="sd-games-n">{condCounts.get(c.key)}</span>
              </button>
            ))}
          </div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            {rec.matched} card{rec.matched === 1 ? "" : "s"} in the stacks fit; showing the top {rec.picks.length}.
            {" "}Left out: {skipped.away} already out (show or stream) · {skipped.soldOut} sold on eBay (quantity 0 —
            reconcile those) · {skipped.unpriced} with no live listing price · {skipped.cooldown} back from the box
            in the last {Number(cooldown) || 0} days{skipped.noSku ? ` · ${skipped.noSku} with no SKU` : ""}.
          </p>
          {rec.picks.length === 0 ? (
            <p className="dd-empty">Nothing fits those filters.</p>
          ) : (
            <>
              <div className="sd-bulkbar">
                <label className="sd-toggle">
                  <input
                    type="checkbox"
                    checked={chosen.length === rec.picks.length}
                    ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < rec.picks.length; }}
                    onChange={(e) => setRecOff(e.target.checked ? new Set() : new Set(rec.picks.map((r) => r.card.id)))}
                  />
                  {chosen.length === rec.picks.length ? "All" : `${chosen.length} of ${rec.picks.length}`}
                </label>
              </div>
              <div className="stack-list">
                {rec.picks.map((r) => (
                  <label className="ps-row sd-rec-row ss-row" key={r.card.id}>
                    <input type="checkbox" checked={!recOff.has(r.card.id)} onChange={() => setRecOff((s) => toggleIn(s, r.card.id))} />
                    <span className="stack-sku">{r.card.sku}</span>
                    <span className="stack-title">{r.title || <em>—</em>}</span>
                    <span className="badge2" title="Where to walk, and how far to count">
                      {positionLabel(stackName.get(r.card.stack_id), ranks.get(r.card.id) ?? null, depths.get(r.card.stack_id) ?? null)}
                    </span>
                    {r.condition !== "unknown" ? <span className="sd-cond">{CONDITIONS.find((c) => c.key === r.condition)?.label}</span> : null}
                    {r.quantity > 1 ? (
                      <span className="badge2 ss-due" title="Hiding the listing takes every copy on it off sale, not just this one.">
                        ×{r.quantity} on the listing
                      </span>
                    ) : null}
                    <span className="sd-price">{pounds(r.pricePence)}</span>
                  </label>
                ))}
              </div>
              <button className="btn btn-primary" onClick={checkoutPicks} disabled={busy || chosen.length === 0} style={{ marginTop: 10 }}>
                {busy ? progress || "Adding…" : `Add ${chosen.length} to the stream box · ${pounds(chosen.reduce((t, r) => t + r.pricePence, 0))}`}
              </button>
            </>
          )}
        </div>
      ) : null}

      {msg ? <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{msg}</p> : null}

      {batch.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Pull sheet — added {String(batch[0].checked_out_at || "").slice(0, 10)}</span>
            <button className="btn btn-ghost" onClick={downloadSheet}>⬇ CSV</button>
          </div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Numbered where each card <b>is</b> in its stack right now, and listed <b>deepest first</b>: pull from the back
            forward and every number above stays true.
          </p>
          {sheet.stacks.map((g) => (
            <div key={g.stackId}>
              <p className="ss-pull-head">{g.name} · {g.rows.length} card{g.rows.length === 1 ? "" : "s"}{g.depth ? ` of ${g.depth}` : ""}</p>
              <div className="stack-list">
                {g.rows.map((r) => (
                  <div className="ps-row ss-row" key={r.checkout.id}>
                    <span className="stack-pos" title="Count this many from the top of the stack">{r.rank}</span>
                    <span className="stack-sku">{r.checkout.sku}</span>
                    <span className="stack-title">{r.checkout.title || <em>—</em>}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sheet.unplaced.length ? (
            <p className="hint hint-small" style={{ color: "var(--warn-ink)" }}>
              {sheet.unplaced.length} card{sheet.unplaced.length === 1 ? "" : "s"} with no position to give — the stack card
              has moved or gone: {sheet.unplaced.map((co) => co.sku || co.title).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Streams</h3>
          {streams.length ? (
            <select className="sd-select" value={streamId} onChange={(e) => setStreamId(e.target.value)} aria-label="Which stream">
              {streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.closed_at ? " · closed" : ""}</option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="sd-opts">
          <input
            className="stack-title-inp"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={defaultStreamName()}
            aria-label="New stream name"
          />
          <button className="btn btn-ghost" onClick={startStream} disabled={busy}>＋ Start a stream</button>
        </div>
        {stream ? (
          <>
            <div className="ss-stats" style={{ marginBottom: 10 }}>
              <span className="badge2">{tally.aired} aired</span>
              <span className="badge2">{tally.sold} sold{tally.hammerPence ? ` · ${pounds(tally.hammerPence)}` : ""}</span>
              <span className="badge2">{tally.unsold} unsold</span>
              {tally.pending ? <span className="badge2 ss-due">{tally.pending} to pack</span> : null}
            </div>
            {stream.closed_at ? (
              <div className="sd-opts">
                <span className="hint hint-small">Closed — every aired card has its outcome.</span>
                <button className="btn btn-ghost" onClick={unfinishStream} disabled={busy}>Re-open</button>
              </div>
            ) : (
              <div className="sd-opts">
                <button className="btn btn-ghost" onClick={readRelay} disabled={busy} title="Asks the relay on this computer which lots were on air for 10 seconds or more">
                  📺 Read what aired from the relay
                </button>
                <button className="btn btn-primary" onClick={finishStream} disabled={busy}>✓ Packed — close stream</button>
              </div>
            )}
            {streamAirings.length === 0 ? (
              <p className="dd-empty">Nothing recorded against this stream yet. Read the relay, or tick “aired” on a card in the box below.</p>
            ) : (
              <div className="stack-list">
                {streamAirings.map((a) => {
                  const co = boxById.get(String(a.checkout_id));
                  return (
                    <div className="ps-row ss-row" key={a.id}>
                      <span className="stack-sku">{co?.sku || "—"}</span>
                      <span className="stack-title">{co?.title || (a.outcome === "sold" ? "sold" : "no longer in the box")}</span>
                      <span className={a.outcome ? "badge2" : "badge2 ss-due"}>
                        {a.outcome === "sold" ? `sold${a.hammer_pence != null ? ` · ${pounds(a.hammer_pence)}` : ""}` : a.outcome === "unsold" ? "unsold" : "to pack"}
                      </span>
                      {!stream.closed_at && co ? (
                        <span className="sd-rowacts">
                          {a.outcome !== "sold" ? <button className="btn btn-ghost" onClick={() => markSold(a)} disabled={busy}>£ Sold</button> : null}
                          {a.outcome == null ? <button className="btn btn-ghost" onClick={() => setOutcome(a, "unsold")} disabled={busy}>Unsold</button> : null}
                          {a.outcome === "unsold" ? <button className="btn btn-ghost" onClick={() => setOutcome(a, null)} disabled={busy}>Undo</button> : null}
                          {a.outcome == null ? <button className="btn btn-ghost" onClick={() => unAir(a)} disabled={busy} title="Didn't actually air">✕</button> : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="dd-empty">No streams yet. Start one before you go live, so what airs has somewhere to be recorded.</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>In the box</h3>
          <span className="badge2">{box.length}</span>
        </div>
        <div className="sd-find">
          <div className="dd-inp sd-find-inp"><span className="mag" aria-hidden="true">⌕</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU or card name" aria-label="Search the box" />
          </div>
          <label className="sd-toggle">
            <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
            Due home only
          </label>
        </div>
        {visibleDue.length > 0 ? (
          <div className="sd-bulkbar">
            <span className="hint hint-small">{visibleDue.length} due home on screen</span>
            <span className="sd-rowacts">
              <button className="btn btn-ghost" onClick={() => sendHome(visibleDue, "spot")} disabled={busy}>↩ To their old spots</button>
              <button className="btn btn-ghost" onClick={() => sendHome(visibleDue, "back")} disabled={busy}>↩ File with least walking</button>
            </span>
          </div>
        ) : null}
        {progress && busy ? <p className="hint hint-small">{progress}</p> : null}
        {visible.length === 0 ? (
          <p className="dd-empty">{box.length === 0 ? "The box is empty. Recommend some cards to fill it." : "Nothing in the box matches."}</p>
        ) : (
          <div className="stack-list">
            {visible.map((s) => {
              const co = s.checkout;
              const state = listingState(co);
              const canAir = stream && !stream.closed_at && !airedHere.has(String(co.id));
              return (
                <div className="ps-row ss-row" key={co.id}>
                  <span className="stack-sku">{co.sku || "—"}</span>
                  <span className="stack-title">{co.title || <em>—</em>}</span>
                  <span className={s.due ? "badge2 ss-due" : "badge2"} title="Airings without a sale">
                    aired {s.aired}/{AIRINGS_BEFORE_RETURN}{s.pending ? ` +${s.pending} to pack` : ""}
                  </span>
                  {s.due ? (
                    <span className="badge2 ss-due">
                      {s.reason === "backstop" ? `due home · ${s.streams} streams unreached` : "due home"}
                    </span>
                  ) : null}
                  {state === "failed" || state === "live" ? (
                    <span className="badge2 ss-due" title={co.hide_error || "The listing is still up — it can sell online while the card is in the box."}>
                      ⚠ listing not hidden
                    </span>
                  ) : null}
                  <span className="sd-rowacts">
                    {canAir ? <button className="btn btn-ghost" onClick={() => markAired(co)} disabled={busy}>＋ aired</button> : null}
                    <button className="btn btn-ghost" onClick={() => sendHome([co], "spot")} disabled={busy} title="Check this one card back in to its old spot">↩</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
