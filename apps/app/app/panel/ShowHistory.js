"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { showHistory, totalsOf, outcomeOf, pct, dayOf, historyCsv, costOf, eventKey } from "@/lib/showhistory.js";
import {
  EXPENSE_CATEGORIES, categoryLabel, parseExpensePence, loadExpenses, addExpense, deleteExpense
} from "@/lib/show-expenses-store.js";

/**
 * Show history — how each show went. The card figures are built entirely
 * from the `stock_checkouts` rows the Show Desk already writes, so every show
 * since 016 is already in it, and this screen never writes to that table.
 * The one thing it does write is what a show cost to run (table, travel),
 * through lib/show-expenses-store.js — migration 030, and until that is run
 * the screen says so and shows gross profit. The arithmetic, and the reasons
 * behind it, are in lib/showhistory.js.
 */

const pounds = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

// sticker_pence arrived with migration 024, applied by hand. Asked for first
// and dropped on refusal, so a pending 024 costs the sticker figures and not
// the whole screen.
const COLS = "id,event,sku,title,stack_card_id,ebay_item_id,relisted_item_id,checked_out_at,resolved_at,resolution,sold_price_pence";

function dateRange(m) {
  if (!m.firstAt) return "—";
  const a = shortDate(m.firstAt);
  const b = shortDate(m.lastAt);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * The costs of running one show, and a row to add another. Its own component
 * so each show keeps its own half-typed amount, rather than one draft shared
 * across every block on the screen.
 */
function ExpenseEditor({ show, onAdd, onDelete, missing }) {
  const [category, setCategory] = useState("table");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (missing) {
    return <p className="hint-small">To record table fees and travel against a show, run migration 030_show_expenses.sql in the Supabase SQL editor.</p>;
  }

  async function submit(e) {
    e.preventDefault();
    const pence = parseExpensePence(amount);
    if (pence == null) { setMsg("Enter an amount in pounds, e.g. 45 or 12.50."); return; }
    setBusy(true);
    setMsg("");
    const res = await onAdd({ showKey: show.key, showLabel: show.label, category, pence, note });
    setBusy(false);
    if (res.ok) { setAmount(""); setNote(""); }
    else setMsg(res.error || "Couldn't save that cost.");
  }

  return (
    <div className="sh-costs">
      <span className="eyebrow eyebrow-small">Show costs</span>
      {show.expenses.length === 0 ? <p className="hint-small">None recorded — add the table fee, travel and anything else it cost to be there.</p> : null}
      {show.expenses.map((e) => (
        <div className="stack-row" key={e.id}>
          <span className="stack-title">{categoryLabel(e.category)}{e.note ? ` · ${e.note}` : ""}</span>
          <span className="sh-money">{pounds(e.amount_pence)}</span>
          <button className="stack-pull" onClick={() => onDelete(e.id)} title="Remove this cost">✕</button>
        </div>
      ))}
      <form className="sh-costform" onSubmit={submit}>
        <select className="sd-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="What the cost was">
          {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input className="sd-select" inputMode="decimal" placeholder="£ amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in pounds" />
        <input className="sd-select" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "＋ Add cost"}</button>
      </form>
      {msg ? <p className="hint-small" style={{ color: "var(--bad-ink)" }}>{msg}</p> : null}
    </div>
  );
}

function outcomeText(co) {
  const o = outcomeOf(co);
  if (o === "sold") return { text: `sold${co.sold_price_pence != null ? ` · ${pounds(co.sold_price_pence)}` : " · no price recorded"}`, color: "var(--conf-high)" };
  if (o === "out") return { text: "not checked back in", color: "var(--warn-ink)" };
  return { text: "returned", color: "var(--ink-faint)" };
}

export default function ShowHistory() {
  const [rows, setRows] = useState(null);
  const [costs, setCosts] = useState(null); // eBay item id -> what the card cost us
  const [noStickers, setNoStickers] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [expensesMissing, setExpensesMissing] = useState(false); // migration 030 not applied
  const [expenseErr, setExpenseErr] = useState("");
  const [newShow, setNewShow] = useState("");
  const [pending, setPending] = useState(null); // a show named for costs, nothing recorded yet

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
      // What each card cost, from the same table My listings and Sales read.
      // A failure here costs the profit figures, never the rest of the screen.
      let costRows = [];
      try {
        costRows = await pagedSelect(() => sb.from("listing_costs").select("ebay_item_id,cost_pence"));
      } catch { /* no costs is a gap, not a failure */ }
      const ex = await loadExpenses(sb);
      if (!live) return;
      setExpensesMissing(Boolean(ex.missing));
      if (ex.error) setExpenseErr(ex.error);
      setExpenses(ex.rows || []);
      setNoStickers(Boolean(sticker.error));
      setCosts(new Map(costRows.filter((c) => c.cost_pence != null).map((c) => [String(c.ebay_item_id), c.cost_pence])));
      setRows(all);
    })();
    return () => { live = false; };
  }, []);

  const shows = useMemo(() => (rows ? showHistory(rows, costs, expenses) : []), [rows, costs, expenses]);
  const totals = useMemo(() => totalsOf(shows), [shows]);

  async function onAddExpense(args) {
    const res = await addExpense(createClient(), args);
    if (res.missing) setExpensesMissing(true);
    if (res.ok) setExpenses((xs) => [...xs, res.row]);
    return res;
  }

  async function onDeleteExpense(id) {
    const res = await deleteExpense(createClient(), id);
    if (res.missing) setExpensesMissing(true);
    if (res.ok) setExpenses((xs) => xs.filter((x) => x.id !== id));
    else if (res.error) setExpenseErr(res.error);
  }

  // A show not on the list yet — the table fee is usually paid weeks before
  // anything is checked out. Keyed exactly as its checkouts will be, so the
  // costs land on the same block the day the desk stamps that event name.
  function openNewShow(e) {
    e.preventDefault();
    const name = newShow.replace(/\s+/g, " ").trim();
    const k = eventKey(name);
    if (!k) return;
    const key = `e:${k}`;
    if (!shows.some((s) => s.key === key)) {
      setPending({ key, label: name, named: true, expenses: [] });
    }
    setOpenKey(key);
    setNewShow("");
  }
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

  // A show named in the box above but with nothing recorded yet: shown as an
  // empty block until its first cost lands, at which point it is a real show.
  const pendingShow = pending && !shows.some((s) => s.key === pending.key) ? pending : null;

  const addShowForm = !expensesMissing ? (
    <form className="sh-costform sh-newshow" onSubmit={openNewShow}>
      <input className="sd-select" placeholder="Show name, as you'll type it on the desk" value={newShow} onChange={(e) => setNewShow(e.target.value)} aria-label="Show name" />
      <button className="btn btn-ghost" type="submit">Log costs for a show</button>
    </form>
  ) : null;

  if (shows.length === 0 && !pendingShow) {
    return (
      <div className="panel">
        <p className="dd-empty">No shows yet. Check cards out on the Show desk and each show appears here — grouped by event name, with how many went, how many came back, and what they took.</p>
        {addShowForm}
      </div>
    );
  }

  return (
    <div className="rise-group sh-scope">
      <div className="stat-row">
        <div className="stat"><div className="k">Cards brought</div><div className="v">{totals.brought}</div></div>
        <div className="stat">
          <div className="k">Sell-through</div>
          <div className="v">{pct(totals.sellThrough)}</div>
        </div>
        <div className="stat"><div className="k">Takings</div><div className="v">{pounds(totals.takings)}</div></div>
        {(() => {
          // Net once any show has running costs against it; gross until then.
          const useNet = totals.expensesPence > 0 && totals.net != null;
          const v = useNet ? totals.net : totals.profit;
          return (
            <div className="stat">
              <div className="k">{useNet ? "Net profit" : "Profit"}</div>
              <div className={`v${v == null ? "" : v >= 0 ? " up" : " down"}`}>{v == null ? "—" : pounds(v)}</div>
            </div>
          );
        })()}
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">By show · {totals.shows}</span>
          <button className="btn btn-ghost" onClick={downloadCsv}>Download CSV</button>
        </div>
        <p className="hint-small" style={{ marginTop: 0 }}>
          Sell-through counts every card that didn't come back as sold — that's how the table works. Where
          that differs from what was actually marked sold, the recorded figure is shown beside it.
          {totals.directSold > 0 ? ` Cards sold straight off eBay stock are in the takings but not in "brought", since they were never in the box.` : ""}
          {" "}Profit is takings less what each sold card cost (the cost on its eBay listing), only over sales that have a cost recorded.
          Net profit takes the show's own costs — table, travel — off that. Open a show to add them.
          {noStickers ? " Sticker figures need migration 024." : ""}
          {expensesMissing ? " Show costs need migration 030." : ""}
        </p>
        {expenseErr ? <p className="hint-small" style={{ color: "var(--bad-ink)" }}>Show costs: {expenseErr}</p> : null}
        {addShowForm}

        <div className="sh-list">
          {(pendingShow ? [{ ...pendingShow, summary: null, cards: [], direct: [] }, ...shows] : shows).map((s) => {
            if (!s.summary) {
              return (
                <div className="sh-show" key={s.key}>
                  <div className="sh-head"><span className="sh-name"><strong>{s.label}</strong><span className="hint-small">nothing checked out yet</span></span></div>
                  <ExpenseEditor show={s} onAdd={onAddExpense} onDelete={onDeleteExpense} missing={expensesMissing} />
                </div>
              );
            }
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
                  <div>
                    <span className="k">Profit</span>
                    <span className="v" style={m.profit == null ? undefined : { color: m.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
                      {m.profit == null ? "—" : pounds(m.profit)}
                    </span>
                    {m.margin != null ? <span className="sub">{pct(m.margin)} margin</span> : null}
                  </div>
                  <div>
                    <span className="k">Show costs</span>
                    <span className="v">{m.expenseCount > 0 ? pounds(m.expensesPence) : "—"}</span>
                  </div>
                  <div>
                    <span className="k">Net profit</span>
                    <span className="v" style={m.net == null ? undefined : { color: m.net >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
                      {m.net == null ? "—" : pounds(m.net)}
                    </span>
                    {m.net == null && m.expenseCount > 0 ? <span className="sub">takings less costs {pounds(m.takingsLessExpenses)}</span> : null}
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

                {m.uncosted > 0 ? (
                  <p className="hint-small" style={{ color: "var(--ink-soft)" }}>
                    Profit covers {m.costedSales} of {m.costedSales + m.uncosted} priced sales ({pounds(m.takingsCosted)} of {pounds(m.takings)}) —
                    {" "}{m.uncosted} {m.uncosted === 1 ? "has" : "have"} no cost recorded on {m.uncosted === 1 ? "its" : "their"} listing.
                  </p>
                ) : null}

                {isOpen ? (
                  <ExpenseEditor show={s} onAdd={onAddExpense} onDelete={onDeleteExpense} missing={expensesMissing} />
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
                          {outcomeOf(co) === "sold" && costOf(co, costs) != null ? <span className="badge2">cost {pounds(costOf(co, costs))}</span> : null}
                          <span className="hint-small" style={{ color: o.color, flex: "none", marginTop: 0 }}>{o.text}</span>
                        </div>
                      );
                    })}
                    {s.direct.map((co) => (
                      <div className="stack-row" key={co.id}>
                        <span className="stack-sku">{co.sku || "—"}</span>
                        <span className="stack-title">{co.title || <em>—</em>}</span>
                        {costOf(co, costs) != null ? <span className="badge2">cost {pounds(costOf(co, costs))}</span> : null}
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
