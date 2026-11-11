"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { liveRanks } from "@/lib/stackpos.js";
import {
  parseCardUploaderMtg, planLoad, nextDivider, fileFingerprint, compareDividers,
  parsePaidOrders, matchOrders, walkOrder, pilesOf, pulledCm,
  parseTcgptExport, checkListings, DIVIDER_SIZE, CARDMARKET_PREFIX, PLACEHOLDER_PRICE
} from "@/lib/cardmarket.js";
import { loadCardmarket, alreadyLoaded, writeLoad, commitPicks } from "@/lib/cardmarket-store.js";
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
    setLastLoad(plan.dividers.filter((d) => !r.failed.includes(d.name)).map((d) => ({ name: d.name, count: d.cards.length })));
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
  const regradedPicks = matched ? matched.picks.filter((p) => p.warn).length : 0;
  const pileNo = useMemo(() => new Map(piles.map((p, i) => [p.orderId, p.seq ?? i + 1])), [piles]);

  async function onOrderFile(e) {
    const f = await readFile(e);
    if (!f) return;
    setOrderFile(f);
    setPulled(new Set());
    setMsg("");
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
        {setupError ? <p className="hint" style={{ color: "var(--warn-ink)" }}>{setupError}</p> : null}
        {msg ? <p className="hint">{msg}</p> : null}
      </div>

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
          <p className="hint">
            Write these on the dividers, in order: <b>{lastLoad.map((d) => `${d.name} (${d.count})`).join(" · ")}</b>
          </p>
        ) : null}
      </Fold>

      <Fold
        id="cm-picks"
        title="2 · Today's picks"
        count={matched ? matched.picks.length : null}
        summary={matched
          ? `${plural(piles.length, "order")} · ${pulled.size} of ${matched.picks.length} in hand${matched.done ? ` · ${matched.done} already pulled` : ""}`
          : "Upload Cardmarket's paid-orders export (ArticlesInPaidOrders.csv)."}
        alert={matched && (matched.unmatched.length || regradedPicks) ? (
          <div>
            {matched.unmatched.length ? (
              <p className="hint hint-small" style={{ color: "var(--warn-ink)" }}>
                ⚠ {plural(matched.unmatched.length, "card")} sold that are not in the box:{" "}
                {matched.unmatched.slice(0, 4).map((u) => `${u.line.name} ${u.line.condition}${u.line.foil ? " foil" : ""} (order ${u.line.orderId})`).join("; ")}
                {matched.unmatched.length > 4 ? ` and ${matched.unmatched.length - 4} more` : ""}.
              </p>
            ) : null}
            {regradedPicks ? (
              <p className="hint hint-small" style={{ color: "var(--warn-ink)" }}>
                ⚠ {plural(regradedPicks, "pick")} sold in a different grade from the one the box has — marked on the row. Check those listings.
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
                        {r.line.name} · {r.line.expansion} · {r.line.condition}{r.line.foil ? " · foil" : ""}{r.line.language !== "English" ? ` · ${r.line.language}` : ""}
                        {r.warn ? <span className="hint-small" style={{ color: "var(--warn-ink)", display: "block" }}>{r.warn}</span> : null}
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
        {check ? (
          <>
            {check.regraded.length ? (
              <>
                <p className="ss-pull-head">Listed in another grade</p>
                <div className="stack-list">
                  {check.regraded.map((r, i) => (
                    <div className="ps-row" key={`g${i}`}>
                      <span className="stack-sku">{r.skus.slice(0, 2).join(", ")}</span>
                      <span className="stack-title">{r.name} — {r.boxCondition} in the box, listed as <b>{r.listedAs}</b>{r.count > 1 ? ` ×${r.count}` : ""}</span>
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
                      <span className="stack-title">{r.name} · {r.condition}{r.count > 1 ? ` ×${r.count}` : ""}</span>
                    </div>
                  ))}
                </div>
              </>
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
