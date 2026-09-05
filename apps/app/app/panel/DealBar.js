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
