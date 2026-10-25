"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getShowEvent } from "@/lib/checkout";
import {
  emptyDeal, loadDeal, publishDeal, subscribeDeal, clearDeal,
  addLine, removeLine, setLineOn, setLinePrice, setDealTotal,
  dealSummary, dealPrices, parseDealPence, priceSourceLabel,
  sellDeal, retryEnds, poundsStr, inDeal, FROM_BOX
} from "@/lib/deal.js";

/**
 * The Current Deal — the docked bar and the drawer behind it.
 *
 * What a customer at a table actually does is hand you four cards and ask for
 * one number. This is that, and the rules it obeys all live in lib/deal.js;
 * this file is the screen over them.
 *
 * Two things about the shape of it:
 *
 * - **The bar sticks to the bottom of the viewport.** It shipped merely docked
 *   at the end of the screen, on the reasoning that a fixed bar is a permanent
 *   bite out of a phone — which was wrong twice over. My listings is a long
 *   single column on a phone, so "the end of the screen" is a thousand pixels
 *   below the fold: you added a card, got no acknowledgement, and had to
 *   scroll past two hundred rows to reach the basket. And the bite is not
 *   permanent, because the bar only exists while a deal is open, which is
 *   exactly the moment it needs to be one thumb away. `position: sticky`
 *   rather than `fixed` so it keeps the content column's width and still
 *   comes to rest at the end of the page.
 * - **The drawer is a sheet, and the total and the sell button never scroll
 *   away.** Only the lines scroll: an eight-card basket on a phone must not
 *   push `£ Mark sold` off the bottom of the screen.
 * - **It renders nowhere a customer can see.** The desk gates it on
 *   `customerMode`, the same flag that removes the checkout form and the bulk
 *   bar — see the note in ShowDesk.js. A basket with a `£ Sold` in it is
 *   exactly the sort of thing that must not be one mis-tap away from somebody
 *   holding the tablet.
 */

/**
 * The basket, live. **Called ONCE per screen**, and the pair handed down to
 * the bar and to every ＋ Deal button on the page.
 *
 * Not called inside the button: My listings renders up to PAGE rows, and a
 * hook per row is two hundred localStorage reads on mount and two hundred
 * re-renders every time a card goes in the basket — on the one screen whose
 * whole problem was doing too much per row.
 */
export function useDeal() {
  // Starts empty so the server render and the first client render agree; the
  // stored basket arrives in the effect below.
  const [deal, setDeal] = useState(() => emptyDeal());
  useEffect(() => {
    setDeal(loadDeal());
    return subscribeDeal(setDeal);
  }, []);
  const update = useCallback((next) => {
    publishDeal(next);
    setDeal(next);
  }, []);
  return [deal, update];
}

/**
 * "＋ Deal" — the button that goes on a row.
 *
 * `line` is built by the caller, because only the caller knows which of the
 * two worlds the row is in and what its price should fall back to. Adding is
 * inert: no eBay call, no write, nothing to undo but a tap.
 */
export function DealButton({ deal, update, line, className = "inv-act", title, preventDefault = false }) {
  if (!line || !deal) return null;
  const already = inDeal(deal, line);
  // The first card in a basket stamps the trip on it, so a sale made from My
  // listings lands with the same event the desk would have written.
  const base = deal.lines.length === 0 && !deal.event ? { ...deal, event: getShowEvent() || null } : deal;
  return (
    <button
      className={className}
      aria-pressed={already}
      title={title || (already ? "Already in the current deal" : "Add to the current deal — nothing happens on eBay until it sells")}
      onClick={(e) => {
        // The Show desk's rows are <label>s, so a button inside one activates
        // the row checkbox unless it says otherwise — same as its siblings.
        if (preventDefault) e.preventDefault();
        update(already ? removeLine(deal, line.id) : addLine(base, line));
      }}
    >
      {already ? "✓ In deal" : "＋ Deal"}
    </button>
  );
}

/**
 * "＋ Deal ×3" — the button for a row that stands for several copies.
 *
 * A grouped row is "the three Gengars at £34", and a deal line is ONE physical
 * card: the one the customer is holding, with the SKU on its sleeve. Adding
 * whichever copy happened to sort first sells the wrong SKU — ends a listing
 * for a card still in its stack, and leaves the one that went over the table
 * live online to sell twice. So a group opens a list of its copies, each with
 * its SKU and where it lives, and each goes in on its own button.
 *
 * `copies` is `[{ line, sku, where, detail, blocked }]`, built by the caller;
 * `blocked` is a reason a copy cannot go in (the stream box), shown rather
 * than dropped so the count still adds up to what the row says. A single copy
 * is the ordinary button — nothing to choose between.
 *
 * A sheet fixed to the viewport rather than a dropdown, because the table view
 * sits in a scrolling wrapper that clips anything positioned inside it.
 */
export function DealCopyPicker({ deal, update, copies, className = "inv-act", title }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const usable = (copies || []).filter((c) => c && c.line);
  if (!deal || usable.length === 0) return null;
  if (usable.length === 1 && !usable[0].blocked) {
    return <DealButton deal={deal} update={update} line={usable[0].line} className={className} title={title} />;
  }
  const inCount = usable.filter((c) => inDeal(deal, c.line)).length;
  return (
    <>
      <button
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose which copy — by its SKU — goes in the current deal"
        onClick={() => setOpen((v) => !v)}
      >
        {inCount ? `✓ ${inCount} in deal ▾` : `＋ Deal ×${usable.length} ▾`}
      </button>
      {open ? (
        <div className="dcp-back" onClick={() => setOpen(false)}>
          <div className="dcp-sheet" role="dialog" aria-label="Which copy is going in the deal?" onClick={(e) => e.stopPropagation()}>
            <div className="dcp-head">
              <span className="dcp-k">Which copy?</span>
              <button className="deal-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dcp-title">{usable[0].line.title}</div>
            <div className="dcp-list">
              {usable.map((c) => (
                <div className={`dcp-row${c.blocked ? " is-off" : ""}`} key={c.line.id}>
                  <span className="dcp-sku mono">{c.sku || "no SKU"}</span>
                  <span className="dcp-where">
                    {c.where || <span className="muted">no stack position</span>}
                    {c.detail ? <span className="dcp-detail"> · {c.detail}</span> : null}
                  </span>
                  <span className="dcp-price mono">{c.line.price != null ? poundsStr(c.line.price) : "—"}</span>
                  {c.blocked ? (
                    <span className="dcp-blocked">{c.blocked}</span>
                  ) : (
                    <DealButton deal={deal} update={update} line={c.line} className="itbl-check" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The basket, read-only — for a screen a customer may be holding.
 *
 * The binder is one of the two customer screens, so the full bar cannot go on
 * it: `£ Mark sold` there is one mis-tap from a stranger recording a sale.
 * But **adding is inert** (rule 1 in lib/deal.js — no eBay call, no checkout,
 * no write), so `＋ Deal` on a pocket is safe and is the whole reason somebody
 * is flipping the binder with a customer in the first place.
 *
 * So the line is drawn at the write: a customer screen may PUT cards in the
 * basket and see what is in it; the money is moved on the desk, one tap away
 * on the mode toggle. No drawer, no line editing, no sell button — there is
 * nothing here to mis-tap.
 */
export function DealTally({ deal, note = "Sell it at the desk" }) {
  if (!deal || deal.lines.length === 0) return null;
  const summary = dealSummary(deal);
  return (
    <div className="deal-wrap">
      <div className="deal-bar is-quiet">
        <span className="deal-k">Current deal</span>
        <span className="deal-count">
          {summary.count} card{summary.count === 1 ? "" : "s"}
          {summary.count !== summary.total ? ` of ${summary.total}` : ""}
        </span>
        <span className="deal-sum mono">{poundsStr(summary.payablePence)}</span>
        <span className="deal-quiet-note">{note}</span>
      </div>
    </div>
  );
}

function LineRow({ line, pence, onToggle, onPrice, onRemove }) {
  const moved = line.on && pence != null && pence !== line.price;
  return (
    <div className={`deal-line${line.on ? "" : " is-off"}`}>
      <input
        type="checkbox"
        checked={line.on}
        onChange={(e) => onToggle(line.id, e.target.checked)}
        aria-label={`Include ${line.title}`}
      />
      <div className="deal-thumb">
        {line.image ? <img src={line.image} alt="" width="40" height="54" loading="lazy" decoding="async" /> : <span aria-hidden="true">🎴</span>}
      </div>
      <div className="deal-what">
        <div className="deal-name">{line.title}</div>
        <div className="deal-meta">
          {line.sku ? <span className="mono">{line.sku}</span> : null}
          <span className={`deal-chip ${line.from === FROM_BOX ? "is-box" : "is-live"}`}>
            {line.from === FROM_BOX ? "in box" : "live on eBay"}
          </span>
          <span className="deal-src">{priceSourceLabel(line.priceSource)}</span>
        </div>
      </div>
      <div className="deal-right">
        <span className="deal-was">{moved ? `was ${poundsStr(line.price)}` : ""}</span>
        <input
          className={`deal-pin${line.price == null ? " is-empty" : ""}`}
          defaultValue={line.price == null ? "" : ((line.on && pence != null ? pence : line.price) / 100).toFixed(2)}
          // Re-keyed whenever the figure it should show changes, so a lot total
          // typed above actually reaches the boxes below.
          key={`${line.id}:${line.on && pence != null ? pence : line.price}`}
          placeholder="—"
          inputMode="decimal"
          aria-label={`Price for ${line.title}`}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={(e) => onPrice(line.id, e.target.value)}
        />
        <button className="deal-x" onClick={() => onRemove(line.id)} aria-label={`Remove ${line.title}`}>✕</button>
      </div>
    </div>
  );
}

export default function DealBar({ deal, update, onSold }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [receipt, setReceipt] = useState(null); // { results, soldPence, unended }

  const summary = useMemo(() => dealSummary(deal), [deal]);
  const prices = useMemo(() => dealPrices(deal), [deal]);

  // Nothing in the basket and nothing to report: no furniture.
  if (!deal || (deal.lines.length === 0 && !receipt)) return null;

  function setPrice(id, raw) {
    const text = String(raw || "").trim();
    if (text === "") {
      update(setLinePrice(deal, id, null));
      return;
    }
    const { pence, error } = parseDealPence(text);
    if (error) { setMsg(error); return; }
    setMsg("");
    update(setLinePrice(deal, id, pence));
  }

  function setTotal(raw) {
    const text = String(raw || "").trim();
    if (text === "") { update(setDealTotal(deal, null)); return; }
    const { pence, error } = parseDealPence(text);
    if (error) { setMsg(error); return; }
    setMsg("");
    update(setDealTotal(deal, pence));
  }

  async function sell() {
    setBusy(true);
    setMsg("");
    try {
      const res = await sellDeal(createClient(), deal, { event: deal.event || getShowEvent() || null });
      if (!res.ok) { setMsg(res.error); setBusy(false); return; }
      setReceipt(res);
      // The sold lines leave the basket; anything that failed outright stays in
      // it, because the card is still ours and still has to go somewhere.
      const soldIds = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
      const left = deal.lines.filter((l) => !soldIds.has(l.id));
      update(left.length ? { ...deal, totalPence: null, lines: left } : clearDeal());
      // The caller gets the results, not just a nudge: My listings has to drop
      // the rows it just sold, and `ebay_listings` keeps them until the next
      // sync — so re-reading the table would put them straight back.
      if (onSold) onSold(res);
    } catch (err) {
      setMsg(`That deal couldn't be recorded: ${err.message}`);
    }
    setBusy(false);
  }

  async function retry() {
    setBusy(true);
    const still = await retryEnds(createClient(), receipt.unended);
    setReceipt({ ...receipt, unended: still });
    setMsg(still.length ? `${still.length} listing(s) still wouldn't end — end them on eBay by hand.` : "All listings ended.");
    setBusy(false);
  }

  return (
    <div className="deal-wrap">
      {receipt ? (
        <div className="deal-panel">
          <div className="deal-head">
            <h3>Deal recorded — {poundsStr(receipt.soldPence)}</h3>
            <button className="deal-x" onClick={() => setReceipt(null)} aria-label="Close">✕</button>
          </div>
          <div className="deal-receipt">
            {receipt.results.map((r) => (
              <div key={r.id} className={`deal-rc ${r.ok ? (r.warning ? "is-warn" : "is-good") : "is-bad"}`}>
                <span className="deal-tick" aria-hidden="true">{r.ok ? (r.warning ? "!" : "✓") : "✕"}</span>
                <div>
                  <div className="deal-name">{r.title}{r.sku ? <span className="mono"> · {r.sku}</span> : null}</div>
                  <div className="deal-did">{r.ok ? [...r.did, r.warning].filter(Boolean).join(" · ") : r.error}</div>
                </div>
                <span className="deal-amt mono">{poundsStr(r.pence)}</span>
              </div>
            ))}
          </div>
          {receipt.unended.length ? (
            <div className="deal-foot">
              <p className="hint hint-small" style={{ color: "var(--warn-ink)", margin: 0 }}>
                <strong>{receipt.unended.length} listing{receipt.unended.length === 1 ? "" : "s"} still live on eBay.</strong>{" "}
                The money is recorded either way — retry when you have signal, or end them by hand.
              </p>
              <button className="btn btn-ghost" onClick={retry} disabled={busy}>
                {busy ? "Ending…" : `↻ Retry ${receipt.unended.length} listing${receipt.unended.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
          {msg ? <p className="hint hint-small" style={{ padding: "0 16px 12px" }}>{msg}</p> : null}
        </div>
      ) : null}

      {deal.lines.length > 0 && open ? (
        <div className="deal-panel">
          <div className="deal-head">
            <h3>Current deal</h3>
            <span className="deal-who">
              {deal.event || getShowEvent() ? `${deal.event || getShowEvent()} · ` : ""}
              {summary.total} card{summary.total === 1 ? "" : "s"}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => { update(clearDeal()); setOpen(false); }}>Clear</button>
            <button className="deal-x" onClick={() => setOpen(false)} aria-label="Close the deal">✕</button>
          </div>

          <div className="deal-lines">
            {deal.lines.map((l) => (
              <LineRow
                key={l.id}
                line={l}
                pence={prices.get(l.id)}
                onToggle={(id, on) => update(setLineOn(deal, id, on))}
                onPrice={setPrice}
                onRemove={(id) => update(removeLine(deal, id))}
              />
            ))}
          </div>

          <div className="deal-tally">
            <div className="deal-tl">
              <span>Subtotal — {summary.count} card{summary.count === 1 ? "" : "s"} at their own prices</span>
              <span className="mono">{poundsStr(summary.subtotalPence)}</span>
            </div>
            <div className="deal-tl is-big">
              <span>Deal total</span>
              <input
                className="deal-total-in"
                defaultValue={deal.totalPence == null ? "" : (deal.totalPence / 100).toFixed(2)}
                key={`t:${deal.totalPence}`}
                placeholder={(summary.subtotalPence / 100).toFixed(2)}
                inputMode="decimal"
                aria-label="Deal total in pounds"
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onBlur={(e) => setTotal(e.target.value)}
              />
            </div>
            {summary.discountPence !== 0 ? (
              <div className="deal-tl is-disc">
                <span>{summary.discountPence > 0 ? "Discount given" : "Added to the lot"}</span>
                <span className="mono">
                  {poundsStr(Math.abs(summary.discountPence))}
                  {summary.subtotalPence ? ` (${((Math.abs(summary.discountPence) / summary.subtotalPence) * 100).toFixed(1)}%)` : ""}
                </span>
              </div>
            ) : null}

            {summary.blockedReason ? <p className="deal-blocked">⚠ {summary.blockedReason}</p> : null}
            {msg ? <p className="hint hint-small" style={{ margin: 0 }}>{msg}</p> : null}

            <div className="deal-acts">
              <button className="btn btn-primary" onClick={sell} disabled={busy || !summary.canSell}>
                {busy ? "Recording…" : `£ Mark ${summary.count} sold — ${poundsStr(summary.payablePence)}`}
              </button>
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Keep shopping</button>
            </div>
          </div>
        </div>
      ) : null}

      {deal.lines.length > 0 ? (
        <div className="deal-bar">
          <span className="deal-k">Current deal</span>
          <span className="deal-count">
            {summary.count} card{summary.count === 1 ? "" : "s"}
            {summary.count !== summary.total ? ` of ${summary.total}` : ""}
          </span>
          <span className="deal-sum mono">{poundsStr(summary.payablePence)}</span>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide deal" : "Open deal →"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
