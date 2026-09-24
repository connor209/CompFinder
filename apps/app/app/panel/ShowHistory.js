"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { showHistory, totalsOf, outcomeOf, pct, dayOf, historyCsv } from "@/lib/showhistory.js";

/**
 * Show history — how each show went. Read-only, and built entirely from the
 * `stock_checkouts` rows the Show Desk already writes, so there is no
 * migration: every show since 016 is already in it. The arithmetic, and the
 * reasons behind it, are in lib/showhistory.js.
 */

const pounds = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

// sticker_pence arrived with migration 024, applied by hand. Asked for first
// and dropped on refusal, so a pending 024 costs the sticker figures and not
// the whole screen.
const COLS = "id,event,sku,title,stack_card_id,checked_out_at,resolved_at,resolution,sold_price_pence";

function dateRange(m) {
  if (!m.firstAt) return "—";
  const a = shortDate(m.firstAt);
  const b = shortDate(m.lastAt);
  return a === b ? a : `${a} – ${b}`;
}

function outcomeText(co) {
  const o = outcomeOf(co);
  if (o === "sold") return { text: `sold${co.sold_price_pence != null ? ` · ${pounds(co.sold_price_pence)}` : " · no price recorded"}`, color: "var(--conf-high)" };
  if (o === "out") return { text: "not checked back in", color: "var(--warn-ink)" };
  return { text: "returned", color: "var(--ink-faint)" };
}

export default function ShowHistory() {
  const [rows, setRows] = useState(null);
  const [noStickers, setNoStickers] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const sb = createClient();
      // pagedSelect swallows errors into an empty list, which would read as
      // "no shows yet". Probe once first so a missing table says so instead.
      const probe = await sb.from("stock_checkouts").select("id").limit(1);
      if (probe.error) {
        if (live) { setError(probe.error.message || "Couldn't read the show ledger."); setRows([]); }
        return;
      }
      const sticker = await sb.from("stock_checkouts").select("sticker_pence").limit(0);
      const cols = sticker.error ? COLS : `${COLS},sticker_pence`;
      const all = await pagedSelect(() =>
        sb.from("stock_checkouts").select(cols).order("checked_out_at", { ascending: true })
      );
      if (!live) return;
      setNoStickers(Boolean(sticker.error));
      setRows(all);
    })();
    return () => { live = false; };
  }, []);

  const shows = useMemo(() => (rows ? showHistory(rows) : []), [rows]);
  const totals = useMemo(() => totalsOf(shows), [shows]);

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([historyCsv(shows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `compfinder-show-history-${dayOf(new Date().toISOString())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (rows === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading show history…</div>;

  if (error) {
    return (
      <div className="panel">
        <p className="dd-empty">Couldn't read the show ledger: {error}</p>
        <p className="hint-small">If it says the table is missing, run migration 016_show_checkouts.sql in the Supabase SQL editor.</p>
      </div>
    );
  }

  if (shows.length === 0) {
    return (
      <div className="panel">
        <p className="dd-empty">No shows yet. Check cards out on the Show desk and each show appears here — grouped by event name, with how many went, how many came back, and what they took.</p>
      </div>
    );
  }

  return (
    <div className="rise-group sh-scope">
      <div className="stat-row">
        <div className="stat"><div className="k">Shows</div><div className="v">{totals.shows}</div></div>
        <div className="stat"><div className="k">Cards brought</div><div className="v">{totals.brought}</div></div>
        <div className="stat">
          <div className="k">Sell-through</div>
          <div className="v">{pct(totals.sellThrough)}</div>
        </div>
        <div className="stat"><div className="k">Takings</div><div className="v">{pounds(totals.takings)}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">By show</span>
          <button className="btn btn-ghost" onClick={downloadCsv}>Download CSV</button>
        </div>
        <p className="hint-small" style={{ marginTop: 0 }}>
          Sell-through counts every card that didn't come back as sold — that's how the table works. Where
          that differs from what was actually marked sold, the recorded figure is shown beside it.
          {totals.directSold > 0 ? ` Cards sold straight off eBay stock are in the takings but not in "brought", since they were never in the box.` : ""}
          {noStickers ? " Sticker figures need migration 024." : ""}
        </p>

        <div className="sh-list">
          {shows.map((s) => {
            const m = s.summary;
            const isOpen = openKey === s.key;
            return (
              <div className="sh-show" key={s.key}>
                <button
                  className="sh-head"
                  onClick={() => setOpenKey(isOpen ? null : s.key)}
                  aria-expanded={isOpen}
                >
                  <span className="sh-name">
                    <strong>{s.label}</strong>
                    <span className="hint-small">{dateRange(m)}</span>
                  </span>
                  {!m.settled ? <span className="badge2" title="Cards not checked back in are counted as sold. On a show that's still running, that is every card.">{m.notBack} not back</span> : null}
                  <span className="sh-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                </button>

                <div className="sh-figs">
                  <div><span className="k">Brought</span><span className="v">{m.brought}</span></div>
                  <div><span className="k">Sold</span><span className="v">{m.sold}</span></div>
                  <div><span className="k">Not back</span><span className="v">{m.notBack}</span></div>
                  <div><span className="k">Returned</span><span className="v">{m.returned}</span></div>
                  <div>
                    <span className="k">Sell-through</span>
                    <span className="v">{pct(m.sellThrough)}</span>
                    {!m.settled && m.brought > 0 ? <span className="sub">{pct(m.recordedSellThrough)} recorded</span> : null}
                  </div>
                  <div>
                    <span className="k">Takings</span>
                    <span className="v">{pounds(m.takings)}</span>
                    {m.directSold > 0 ? <span className="sub">{pounds(m.directTakings)} off eBay stock</span> : null}
                  </div>
                  <div><span className="k">Avg sale</span><span className="v">{m.avgSale == null ? "—" : pounds(m.avgSale)}</span></div>
                  {!noStickers ? (
                    <div>
                      <span className="k">vs sticker</span>
                      <span className="v">{pct(m.achievedVsSticker)}</span>
                      {m.stickerBrought > 0 ? <span className="sub">{pounds(m.stickerBrought)} stickered</span> : null}
                    </div>
                  ) : null}
                </div>
                {m.soldUnpriced > 0 ? (
                  <p className="hint-small" style={{ color: "var(--warn-ink)" }}>
                    {m.soldUnpriced} sale{m.soldUnpriced === 1 ? "" : "s"} recorded with no price — the takings are short by whatever {m.soldUnpriced === 1 ? "it" : "they"} fetched.
                  </p>
                ) : null}

                {isOpen ? (
                  <div className="stack-list sh-cards">
                    {s.cards.map((co) => {
                      const o = outcomeText(co);
                      return (
                        <div className="stack-row" key={co.id}>
                          <span className="stack-sku">{co.sku || "—"}</span>
                          <span className="stack-title">{co.title || <em>—</em>}</span>
                          {co.sticker_pence != null ? <span className="badge2">sticker {pounds(co.sticker_pence)}</span> : null}
                          <span className="hint-small" style={{ color: o.color, flex: "none", marginTop: 0 }}>{o.text}</span>
                        </div>
                      );
                    })}
                    {s.direct.map((co) => (
                      <div className="stack-row" key={co.id}>
                        <span className="stack-sku">{co.sku || "—"}</span>
                        <span className="stack-title">{co.title || <em>—</em>}</span>
                        <span className="hint-small" style={{ color: "var(--conf-high)", flex: "none", marginTop: 0 }}>
                          sold off eBay stock{co.sold_price_pence != null ? ` · ${pounds(co.sold_price_pence)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
