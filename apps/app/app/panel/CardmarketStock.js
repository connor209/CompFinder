"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { liveRanks } from "@/lib/stackpos.js";
import {
  parseCardUploaderMtg, planLoad, nextDivider, fileFingerprint, compareDividers,
  parsePaidOrders, matchOrders, walkOrder, pilesOf, pulledCm,
  parseTcgptExport, checkListings, tcgptImportCsv, tcgptImportName, cmCondition, CU_TO_CM, HOUSE_GRADES, DIVIDER_SIZE, CARDMARKET_PREFIX, PLACEHOLDER_PRICE,
  pricesFromExport, stockRows, filterStock, sortStock, stockTotals, dividerTotals, soldRows, locationText
} from "@/lib/cardmarket.js";
import { loadCardmarket, alreadyLoaded, writeLoad, commitPicks, loadPrices, savePrices } from "@/lib/cardmarket-store.js";
import Fold from "./Fold";

/**
 * Cardmarket stock — the Magic chaos sort.
 *
 * Three jobs, in the order a card goes through them:
 *
 * 1. **Load a box.** A CardUploader Magic export, in scan order, dealt 50 at
 *    a time behind fresh dividers (MTG-C, MTG-D …). The screen says which
 *    dividers to write before the cards go in the box.
 * 2. **Today's picks.** Cardmarket's paid-orders export, matched on product,
 *    grade, finish and language, walked divider by divider and deepest first,
 *    then dealt into one pile per order. Commit marks the ticked cards pulled
 *    and records the order on each, so the same file twice picks nothing new.
 * 3. **Check the listings.** A TCG PowerTools stock export against the box:
 *    cards not listed, listed in another grade, or left at the placeholder.
 *    The same upload saves each article's price for the stock list.
 *
 * Above all three, **Stock**: every card in the box, identical copies folded
 * into one row with where each copy is, searchable, valued off the last saved
 * TCG PowerTools prices — and a Sold view of what has been pulled for orders.
 *
 * The rules are in lib/cardmarket.js; the reasons are in CLAUDE.md under
 * "Cardmarket stock".
 */

async function readFile(e) {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return null;
  return { name: f.name, text: await f.text() };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n) => (n == null ? "—" : Number(n).toFixed(2));
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
// A rendering cap, like My listings: nothing on this list spends anything, so
// "Show more" is only about not drawing two thousand rows on a tablet.
const PAGE = 200;

export default function CardmarketStock() {
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [userId, setUserId] = useState(null);
  const [stacks, setStacks] = useState([]);
  const [cards, setCards] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [loadFile, setLoadFile] = useState(null);   // { name, text }
  const [start, setStart] = useState("");
  const [lastLoad, setLastLoad] = useState(null);   // dividers just written

  const [orderFile, setOrderFile] = useState(null);
  const [pulled, setPulled] = useState(new Set());  // card ids ticked as in hand

  const [stockFile, setStockFile] = useState(null);

  const [prices, setPrices] = useState(new Map());
  const [pricesNote, setPricesNote] = useState("");
  const [view, setView] = useState("stock");        // stock | sold
  const [q, setQ] = useState("");
  const [divider, setDivider] = useState("");
  const [grade, setGrade] = useState("");
  const [foil, setFoil] = useState("");
  const [sort, setSort] = useState("name");
  const [shown, setShown] = useState(PAGE);

  const supabase = () => createClient();

  async function load() {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setSetupError("Sign in to see Cardmarket stock."); setLoading(false); return; }
    setUserId(user.id);
    const r = await loadCardmarket(sb, user.id);
    if (r.missing) setSetupError("Cardmarket stock needs migration 035_cardmarket_stock.sql — run it once in the Supabase SQL editor.");
    else if (r.error) setSetupError(`Couldn't read the Cardmarket boxes: ${r.error}`);
    else setSetupError("");
    setStacks(r.stacks.slice().sort(compareDividers));
    setCards(r.cards);
    const pr = await loadPrices(sb, user.id);
    setPrices(pr.prices);
    setPricesNote(pr.missing
      ? "Prices need migration 036_cardmarket_prices.sql — until it is run every card shows unpriced."
      : pr.error ? `Couldn't read saved prices: ${pr.error}` : "");
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const inStock = useMemo(() => cards.filter((c) => !c.pulled_at), [cards]);
  const ranks = useMemo(() => liveRanks(cards), [cards]);
  const suggested = useMemo(() => nextDivider(stacks), [stacks]);

  // ---- 1. load ---------------------------------------------------------------

  const parsedLoad = useMemo(() => (loadFile ? parseCardUploaderMtg(loadFile.text) : null), [loadFile]);
  const fingerprint = useMemo(() => (loadFile ? fileFingerprint(loadFile.text) : null), [loadFile]);
  const duplicate = fingerprint ? alreadyLoaded(cards, fingerprint) : false;
  const plan = useMemo(() => {
    if (!parsedLoad || parsedLoad.error) return null;
    return planLoad(parsedLoad.cards, { start: start || suggested, stacks });
  }, [parsedLoad, start, suggested, stacks]);

  async function onLoadFile(e) {
    const f = await readFile(e);
    if (!f) return;
    setLoadFile(f);
    setStart("");
    setLastLoad(null);
    setMsg("");
  }

  async function doLoad() {
    if (!plan || plan.error || !plan.dividers.length || !userId) return;
    const names = plan.dividers.map((d) => d.name);
    if (!confirm(`Load ${plural(parsedLoad.cards.length, "card")} behind ${names.join(", ")}?`)) return;
    setBusy(true);
    const r = await writeLoad(supabase(), userId, plan, fingerprint);
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    // The listing file is only offered for a load that landed whole: a file
    // carrying cards the app does not hold would list cards no pick can find.
    const tcgpt = r.failed.length ? null : tcgptImportCsv(loadFile.text);
    setLastLoad({
      dividers: plan.dividers.filter((d) => !r.failed.includes(d.name)).map((d) => ({ name: d.name, count: d.cards.length })),
      file: tcgpt && !tcgpt.error ? { name: tcgptImportName(loadFile.name), csv: tcgpt.csv, unknown: tcgpt.unknown } : null
    });
    setMsg(r.failed.length
      ? `Loaded ${plural(r.loaded, "card")}. ${r.failed.join(", ")} failed and ${r.failed.length === 1 ? "was" : "were"} not kept — load again from that divider.`
      : `Loaded ${plural(r.loaded, "card")}.`);
    setLoadFile(null);
    await load();
  }

  // ---- 2. picks --------------------------------------------------------------

  const parsedOrders = useMemo(() => (orderFile ? parsePaidOrders(orderFile.text) : null), [orderFile]);
  const matched = useMemo(() => {
    if (!parsedOrders || parsedOrders.error) return null;
    return matchOrders(parsedOrders.lines, cards, stacks);
  }, [parsedOrders, cards, stacks]);
  const walk = useMemo(() => (matched ? walkOrder(matched.picks, stacks, ranks) : []), [matched, stacks, ranks]);
  const piles = useMemo(() => (matched ? pilesOf(matched.picks) : []), [matched]);
  const pileNo = useMemo(() => new Map(piles.map((p, i) => [p.orderId, p.seq ?? i + 1])), [piles]);

  function downloadImport() {
    const f = lastLoad?.file;
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onOrderFile(e) {
    const f = await readFile(e);
    if (!f) return;
    setOrderFile(f);
    setPulled(new Set());
    setMsg("");
  }

  // Tick all is for the day you pulled the lot: everything on the list is
  // ticked, and a card you could not find is unticked before Mark pulled.
  function tickAll() {
    if (matched) setPulled(new Set(matched.picks.map((p) => p.card.id)));
  }
  function untickAll() {
    setPulled(new Set());
  }

  function toggle(id) {
    setPulled((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function commit() {
    if (!matched || pulled.size === 0 || !userId) return;
    const writes = matched.picks.filter((p) => pulled.has(p.card.id)).map((p) => ({ id: p.card.id, cm: pulledCm(p.card, p.line) }));
    const left = matched.picks.length - writes.length;
    if (!confirm(`Mark ${plural(writes.length, "card")} pulled?${left ? ` ${left} not ticked will stay on the list.` : ""}`)) return;
    setBusy(true);
    const r = await commitPicks(supabase(), userId, writes);
    setBusy(false);
    setMsg(r.failed ? `Pulled ${r.done}; ${r.failed} failed to save — commit again.` : `Pulled ${plural(r.done, "card")}.`);
    setPulled(new Set());
    await load();
  }

  // ---- 3. check --------------------------------------------------------------

  const parsedStock = useMemo(() => (stockFile ? parseTcgptExport(stockFile.text) : null), [stockFile]);
  const check = useMemo(() => (parsedStock && !parsedStock.error ? checkListings(cards, parsedStock.rows) : null), [parsedStock, cards]);

  async function onStockFile(e) {
    const f = await readFile(e);
    if (f) setStockFile(f);
  }

  const exportPrices = useMemo(() => (parsedStock && !parsedStock.error ? pricesFromExport(parsedStock.rows) : []), [parsedStock]);

  async function doSavePrices() {
    if (!exportPrices.length || !userId) return;
    setBusy(true);
    const r = await savePrices(supabase(), userId, exportPrices);
    setBusy(false);
    setMsg(r.error ? `Saved ${r.saved} prices, then: ${r.error}` : `Saved ${plural(r.saved, "price")} from ${stockFile?.name || "the export"}.`);
    const pr = await loadPrices(supabase(), userId);
    setPrices(pr.prices);
  }

  // ---- stock -----------------------------------------------------------------

  const allRows = useMemo(() => stockRows(cards, stacks, ranks, prices), [cards, stacks, ranks, prices]);
  const totals = useMemo(() => stockTotals(allRows), [allRows]);
  const perDivider = useMemo(() => dividerTotals(allRows), [allRows]);
  const rows = useMemo(() => sortStock(filterStock(allRows, { q, divider, grade, foil }), sort), [allRows, q, divider, grade, foil, sort]);
  const rowTotals = useMemo(() => stockTotals(rows), [rows]);
  const sold = useMemo(() => soldRows(cards, stacks), [cards, stacks]);
  useEffect(() => { setShown(PAGE); }, [q, divider, grade, foil, sort, view]);

  if (loading) return <div className="panel"><span className="spinner" /> Loading Cardmarket stock…</div>;

  const loadWarnings = parsedLoad && !parsedLoad.error ? [
    duplicate ? "This exact file has been loaded before. Loading it again puts a second copy of every card in the app." : null,
    plan?.error || null,
    parsedLoad.noProduct ? `${plural(parsedLoad.noProduct, "card")} with no Cardmarket product id. Each still takes its place behind the divider, but a sale can never be matched to it.` : null,
    parsedLoad.oddCondition ? `${plural(parsedLoad.oddCondition, "card")} in a condition this screen cannot read.` : null
  ].filter(Boolean) : [];
  const loadAlert = loadWarnings.length ? (
    <div>
      {loadWarnings.map((w) => <p key={w} className="hint hint-small" style={{ color: "var(--warn-ink)" }}>⚠ {w}</p>)}
    </div>
  ) : null;

  const issues = check ? check.unlisted.length + check.regraded.length + check.placeholder.length : 0;

  return (
    <div className="rise-group">
      <div className="panel">
        <div className="panel-head">
          <h3>Cardmarket stock</h3>
          <div className="ss-stats">
            <span className="badge2">{plural(inStock.length, "card")} in stock</span>
            <span className="badge2">{plural(stacks.length, "divider")}</span>
          </div>
        </div>
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          Magic sold on Cardmarket only, stored in scan order behind dividers {CARDMARKET_PREFIX}A, {CARDMARKET_PREFIX}B … {DIVIDER_SIZE} to a
          divider. A position is counted from the divider, so it closes up as cards are pulled. These dividers never appear in
          eBay&apos;s Reconcile or in any filing plan.
        </p>
        <p className="hint hint-small">
          Grades, ours → Cardmarket: {HOUSE_GRADES.map((g) => `${g} → ${CU_TO_CM[g]}`).join(" · ")}. Our LP and Cardmarket&apos;s LP are different grades.
        </p>
        {setupError ? <p className="hint" style={{ color: "var(--warn-ink)" }}>{setupError}</p> : null}
        {msg ? <p className="hint">{msg}</p> : null}
      </div>

      <Fold
        id="cm-stock"
        title={view === "sold" ? "Sold" : "Stock"}
        count={view === "sold" ? sold.length : totals.cards}
        summary={view === "sold"
          ? `${plural(sold.length, "card")} pulled for Cardmarket orders`
          : `${plural(totals.cards, "card")} · ${plural(allRows.length, "line")} · value ${money(totals.value)}${totals.unpriced ? ` with ${totals.unpriced} unpriced` : ""}${totals.oldestPrice ? ` · prices from ${day(totals.oldestPrice)}` : ""}`}
        alert={pricesNote ? <p className="hint hint-small" style={{ color: "var(--warn-ink)" }}>{pricesNote}</p> : null}
        actions={(
          <select className="sd-select" value={view} onChange={(e) => setView(e.target.value)} aria-label="Stock or sold">
            <option value="stock">In stock</option>
            <option value="sold">Sold</option>
          </select>
        )}
      >
        {view === "stock" ? (
          <>
            <div className="sd-opts">
              <input className="stack-title-inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or set" aria-label="Search stock" />
              <select className="sd-select" value={divider} onChange={(e) => setDivider(e.target.value)} aria-label="Divider">
                <option value="">All dividers</option>
                {perDivider.map((d) => (
                  <option key={d.divider} value={d.divider}>{d.divider} · {d.cards} · {money(d.value)}{d.unpriced ? ` (+${d.unpriced} unpriced)` : ""}</option>
                ))}
              </select>
              <select className="sd-select" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Grade">
                <option value="">Any grade</option>
                {HOUSE_GRADES.map((g) => <option key={g} value={g}>{g} (ours) = {CU_TO_CM[g]}</option>)}
              </select>
              <select className="sd-select" value={foil} onChange={(e) => setFoil(e.target.value)} aria-label="Finish">
                <option value="">Foil and plain</option>
                <option value="foil">Foil only</option>
                <option value="plain">Plain only</option>
              </select>
              <select className="sd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                <option value="name">Name</option>
                <option value="value-desc">Value, highest first</option>
                <option value="value-asc">Value, lowest first</option>
                <option value="location">Where it is</option>
                <option value="count">Most copies</option>
              </select>
            </div>
            {rows.length !== allRows.length ? (
              <p className="hint hint-small">Showing {plural(rowTotals.cards, "card")} · value {money(rowTotals.value)}{rowTotals.unpriced ? ` with ${rowTotals.unpriced} unpriced` : ""}</p>
            ) : null}
            {rows.length === 0 ? <p className="hint">{allRows.length ? "Nothing matches." : "Nothing loaded yet."}</p> : null}
            <div className="stack-list">
              {rows.slice(0, shown).map((r) => (
                <div className="ps-row" key={r.key}>
                  <span className="stack-pos" title="Copies in the box">×{r.count}</span>
                  <span className="stack-title">
                    {r.name} · {r.set}{r.cn ? ` ${r.cn}` : ""} · {r.grade} ours / {r.cmGrade || "?"} on Cardmarket{r.foil ? " · foil" : ""}{r.language !== "English" ? ` · ${r.language}` : ""}
                    <span className="hint-small" style={{ display: "block" }}>{locationText(r)}{r.hasKey ? "" : " · no product id, cannot be matched to a sale"}</span>
                  </span>
                  <span className="stack-sku" title={r.pricedAt ? `Priced ${day(r.pricedAt)}` : "No saved price"}>
                    {r.price == null ? "unpriced" : r.count > 1 ? `${money(r.price)} · ${money(r.value)}` : money(r.price)}
                  </span>
                </div>
              ))}
            </div>
            {rows.length > shown ? (
              <button className="btn btn-ghost" onClick={() => setShown((n) => n + PAGE)}>Show more ({rows.length - shown} left)</button>
            ) : null}
          </>
        ) : (
          <>
            {sold.length === 0 ? <p className="hint">Nothing pulled for an order yet.</p> : null}
            <div className="stack-list">
              {sold.slice(0, shown).map((r) => (
                <div className="ps-row" key={r.id}>
                  <span className="stack-pos">{day(r.pulledAt).slice(5)}</span>
                  <span className="stack-title">
                    {r.name} · {r.set} · {r.grade} ours{r.soldGrade ? ` / sold as ${r.soldGrade}` : ""}
                    <span className="hint-small" style={{ display: "block" }}>{r.sku} · {r.orderId ? `order ${r.orderId}` : "pulled by hand"}</span>
                  </span>
                  <span className="stack-sku">{money(r.price)}</span>
                </div>
              ))}
            </div>
            {sold.length > shown ? (
              <button className="btn btn-ghost" onClick={() => setShown((n) => n + PAGE)}>Show more ({sold.length - shown} left)</button>
            ) : null}
          </>
        )}
      </Fold>

      <Fold
        id="cm-load"
        title="1 · Load a box"
        alert={loadAlert}
        summary={stacks.length ? `Last divider ${stacks[stacks.length - 1].name} · next load starts at ${CARDMARKET_PREFIX}${suggested}` : `Nothing loaded yet · the first load starts at ${CARDMARKET_PREFIX}A`}
      >
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          The CardUploader export in Cardmarket format, in the order the cards were scanned. Each load starts on a fresh divider.
        </p>
        <div className="sd-opts">
          <label className="btn btn-ghost">
            ⬆ CardUploader file
            <input type="file" accept=".csv,text/csv" onChange={onLoadFile} hidden disabled={!!setupError} />
          </label>
          {loadFile ? <span className="hint-small">{loadFile.name}</span> : null}
        </div>
        {parsedLoad?.error ? <p className="hint" style={{ color: "var(--warn-ink)" }}>{parsedLoad.error}</p> : null}
        {parsedLoad && !parsedLoad.error ? (
          <>
            <div className="sd-opts">
              <label className="sd-toggle">
                Start at {CARDMARKET_PREFIX}
                <input
                  className="sd-count"
                  value={start || suggested}
                  onChange={(e) => setStart(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                  aria-label="Starting divider"
                />
              </label>
              <button className="btn btn-primary" onClick={doLoad} disabled={busy || !plan || !!plan.error || !plan.dividers.length}>
                Load {plural(parsedLoad.cards.length, "card")}
              </button>
            </div>
            {plan && !plan.error ? (
              <div className="stack-list">
                {plan.dividers.map((d) => (
                  <div className="ps-row" key={d.name}>
                    <span className="stack-sku">{d.name}</span>
                    <span className="stack-title">{plural(d.cards.length, "card")} · {d.cards[0]?.name} … {d.cards[d.cards.length - 1]?.name}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {lastLoad ? (
          <>
            <p className="hint">
              Write these on the dividers, in order: <b>{lastLoad.dividers.map((d) => `${d.name} (${d.count})`).join(" · ")}</b>
            </p>
            {lastLoad.file ? (
              <div className="sd-opts">
                <button className="btn btn-primary" onClick={downloadImport}>⬇ File for TCG PowerTools</button>
                <span className="hint-small">
                  The same file with the grades already in Cardmarket&apos;s terms — import this one, not the CardUploader original.
                  {lastLoad.file.unknown ? ` ${plural(lastLoad.file.unknown, "row")} had a grade the table does not know and went through unchanged.` : ""}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </Fold>

      <Fold
        id="cm-picks"
        title="2 · Today's picks"
        count={matched ? matched.picks.length : null}
        summary={matched
          ? `${plural(piles.length, "order")} · ${pulled.size} of ${matched.picks.length} in hand${matched.done ? ` · ${matched.done} already pulled` : ""}`
          : "Upload Cardmarket's paid-orders export (ArticlesInPaidOrders.csv)."}
        alert={matched && matched.unmatched.length ? (
          <div>
            {matched.unmatched.length ? (
              <p className="hint hint-small" style={{ color: "var(--warn-ink)" }}>
                ⚠ {plural(matched.unmatched.length, "card")} sold that are not in the box:{" "}
                {matched.unmatched.slice(0, 4).map((u) => `${u.line.name} ${u.line.condition}${u.line.foil ? " foil" : ""} (order ${u.line.orderId})${u.boxGrades.length ? ` — the box has it as ${u.boxGrades.join("/")} (ours) — check the grade on that listing` : ""}`).join("; ")}
                {matched.unmatched.length > 4 ? ` and ${matched.unmatched.length - 4} more` : ""}.
              </p>
            ) : null}
          </div>
        ) : null}
        actions={matched?.picks.length ? (
          <button className="btn btn-primary" onClick={commit} disabled={busy || pulled.size === 0}>✓ Mark {pulled.size} pulled</button>
        ) : null}
      >
        <div className="sd-opts">
          <label className="btn btn-ghost">
            ⬆ Paid-orders file
            <input type="file" accept=".csv,text/csv" onChange={onOrderFile} hidden disabled={!!setupError} />
          </label>
          {orderFile ? <span className="hint-small">{orderFile.name}</span> : null}
        </div>
        {parsedOrders?.error ? <p className="hint" style={{ color: "var(--warn-ink)" }}>{parsedOrders.error}</p> : null}
        {matched && matched.picks.length === 0 && !matched.unmatched.length ? (
          <p className="hint">{matched.done ? "Every card in this file has already been pulled." : "Nothing to pick."}</p>
        ) : null}
        {walk.length ? (
          <>
            <div className="sd-opts">
              <button className="btn btn-ghost" onClick={tickAll} disabled={pulled.size === matched.picks.length}>☑ Tick all</button>
              <button className="btn btn-ghost" onClick={untickAll} disabled={pulled.size === 0}>Untick all</button>
            </div>
            <p className="hint hint-small">
              Counted from the divider <b>as it is now</b>, deepest first: pull from the back and every number above stays true. Tick a card as it
              comes out; the pile number is Cardmarket&apos;s order number in the file.
            </p>
            {walk.map((g) => (
              <div key={g.stackId}>
                <p className="ss-pull-head">{g.name} · {plural(g.rows.length, "card")}</p>
                <div className="stack-list">
                  {g.rows.map((r) => (
                    <div className={`ps-row${pulled.has(r.card.id) ? " done" : ""}`} key={r.card.id} onClick={() => toggle(r.card.id)}>
                      <input type="checkbox" checked={pulled.has(r.card.id)} onChange={() => toggle(r.card.id)} onClick={(e) => e.stopPropagation()} aria-label="In hand" />
                      <span className="stack-pos" title="Count this many from the divider">{r.rank ?? "?"}</span>
                      <span className="stack-sku">pile {pileNo.get(r.line.orderId)}</span>
                      <span className="stack-title">
                        {r.line.name} · {r.line.expansion} · {r.line.condition} on Cardmarket ({r.card.cm?.condition} ours){r.line.foil ? " · foil" : ""}{r.line.language !== "English" ? ` · ${r.line.language}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="ss-pull-head">Piles</p>
            <div className="stack-list">
              {piles.map((p, i) => (
                <div className="ps-row" key={p.orderId}>
                  <span className="stack-pos">{p.seq ?? i + 1}</span>
                  <span className="stack-sku">#{p.orderId}</span>
                  <span className="stack-title">{p.picks.map((x) => x.line.name).join(" · ")}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Fold>

      <Fold
        id="cm-check"
        title="3 · Check the listings"
        defaultOpen={false}
        count={check ? issues : null}
        summary={check
          ? issues ? `${plural(issues, "problem")} with what is listed` : "Every card in the box is listed as the card it is."
          : "Upload a TCG PowerTools stock export to check every card in the box is listed, in its own grade, at a real price."}
      >
        <div className="sd-opts">
          <label className="btn btn-ghost">
            ⬆ TCG PowerTools export
            <input type="file" accept=".csv,text/csv" onChange={onStockFile} hidden disabled={!!setupError} />
          </label>
          {stockFile ? <span className="hint-small">{stockFile.name}</span> : null}
        </div>
        {parsedStock?.error ? <p className="hint" style={{ color: "var(--warn-ink)" }}>{parsedStock.error}</p> : null}
        {exportPrices.length ? (
          <div className="sd-opts">
            <button className="btn btn-primary" onClick={doSavePrices} disabled={busy}>💾 Save these {plural(exportPrices.length, "price")}</button>
            <span className="hint-small">For the stock list and its value. The 1000 placeholder and blank prices are not saved.</span>
          </div>
        ) : null}
        {check ? (
          <>
            {check.regraded.length ? (
              <>
                <p className="ss-pull-head">Listed in another grade</p>
                <div className="stack-list">
                  {check.regraded.map((r, i) => (
                    <div className="ps-row" key={`g${i}`}>
                      <span className="stack-sku">{r.skus.slice(0, 2).join(", ")}</span>
                      <span className="stack-title">{r.name} — {r.boxCondition} (ours) should be {cmCondition(r.boxCondition)} on Cardmarket, listed as <b>{r.listedAs}</b>{r.count > 1 ? ` ×${r.count}` : ""}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {check.unlisted.length ? (
              <>
                <p className="ss-pull-head">In the box, not listed</p>
                <div className="stack-list">
                  {check.unlisted.map((r, i) => (
                    <div className="ps-row" key={`u${i}`}>
                      <span className="stack-sku">{r.skus.slice(0, 2).join(", ")}</span>
                      <span className="stack-title">{r.name} · {r.condition} (ours) / {cmCondition(r.condition)} on Cardmarket{r.count > 1 ? ` ×${r.count}` : ""}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {check.damaged.length ? (
              <p className="hint hint-small">
                {plural(check.damaged.reduce((n, d) => n + d.count, 0), "DMG card")} not listed: {check.damaged.slice(0, 6).map((d) => d.name).join(", ")}
                {check.damaged.length > 6 ? "…" : ""}. A DMG card goes up only when it is worth it, so this is the floor price deciding, not a fault.
              </p>
            ) : null}
            {check.placeholder.length ? (
              <>
                <p className="ss-pull-head">No real price (autoprice left {PLACEHOLDER_PRICE})</p>
                <div className="stack-list">
                  {check.placeholder.map((r, i) => (
                    <div className="ps-row" key={`p${i}`}>
                      <span className="stack-title">{r.name} · {r.set} · {r.condition} — {r.price == null ? "no price" : r.price}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {check.elsewhere ? <p className="hint hint-small">{plural(check.elsewhere, "listed copy", "listed copies")} not loaded into these boxes — stock from elsewhere, or loaded before this screen existed.</p> : null}
          </>
        ) : null}
      </Fold>
    </div>
  );
}
