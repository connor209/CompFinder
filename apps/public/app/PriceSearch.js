"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import SoldCompsApi from "@compfinder/core/soldcomps.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import { ebaySearchUrl } from "@compfinder/core/marketplace.js";
import { buildCompTokens, dropWrongSetTotal } from "@/lib/tokens";
import { UK, marketsIn, splitByMarket } from "@/lib/markets";
import TrendChart from "./TrendChart";

const settings = CompFinderPricing.DEFAULT_SETTINGS;

// The engine's internal reason codes, said out loud. A visitor deserves to know
// why a listing they can see on eBay isn't in the price.
const EXCLUSION_LABELS = {
  nameMismatch: "different card",
  variantMismatch: "reverse holo",
  graded: "graded slab",
  multiCardLot: "multi-card lot",
  nonUkLocation: "not a UK sale",
  setMismatch: "different set",
  catalogSignal: "different product",
  priceOutlier: "price outlier",
  postageOutlier: "postage outlier",
  bundle: "bundle",
  proxy: "proxy or custom",
  damaged: "damaged"
};
const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export default function PriceSearch() {
  const [q, setQ] = useState("");
  const [sugs, setSugs] = useState([]);
  const [openSug, setOpenSug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [active, setActive] = useState({ loading: false, comps: [] });
  // Region and condition re-filter comps we already hold, so changing them is
  // instant and costs no API call. Only the sold window changes the upstream
  // request, so only that one triggers a re-fetch.
  const [market, setMarket] = useState(UK);
  const [condition, setCondition] = useState("any");
  const [soldWindow, setSoldWindow] = useState(90);
  const [showExcluded, setShowExcluded] = useState(false);
  const comboRef = useRef(null);
  // Guards against a slow earlier search landing after a newer one and
  // overwriting it — easy to hit when someone types, waits, then picks a
  // suggestion instead.
  const runId = useRef(0);

  useEffect(() => {
    function onDocClick(e) {
      if (comboRef.current && !comboRef.current.contains(e.target)) setOpenSug(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function onInput(value) {
    setQ(value);
    if (value.trim().length < 2) {
      setSugs([]);
      setOpenSug(false);
      return;
    }
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(value)}`).then((r) => r.json());
      setSugs(res.cards || []);
      setOpenSug((res.cards || []).length > 0);
    } catch {
      /* suggestions are a convenience; searching still works without them */
    }
  }

  function queryForCard(card) {
    return `${card.name} ${card.number || ""} ${card.code || ""}`.replace(/\s+/g, " ").trim();
  }

  /**
   * Comps the pricing engine should never see, because the visitor has ruled
   * them out. Runs before recommend() rather than after, so the price itself
   * responds to the controls instead of just the list underneath it.
   */
  /**
   * Condition, read from the LISTING TITLE rather than eBay's condition field.
   *
   * eBay only offers sellers "New" / "Pre-Owned" for cards — measured across
   * 197 comps it was 74% Pre-Owned, 26% New (Other), and never once NM or LP.
   * soldcomps.js does `apiItem.condition || inferCondition(title)`, and since
   * eBay always supplies something the title inference never ran, so filtering
   * on it matched nothing at all.
   *
   * The title is the only real signal, and it is sparse: on a typical card
   * about a fifth of sellers state a condition. Enough to offer "sellers who
   * said Near Mint" as a separate figure, nowhere near enough for a full
   * NM/LP/MP/HP ladder — so we don't pretend to one.
   */
  function conditionOf(comp) {
    return SoldCompsApi.inferCondition(comp.title || "");
  }

  /** Condition only — the market split is handled separately, by splitByMarket. */
  function preFilter(comps, { condition }) {
    if (condition === "any") return comps;
    return comps.filter((c) => {
      const k = conditionOf(c);
      if (condition === "nm") return k === "NM";
      if (condition === "nodmg") return k !== "HP" && k !== "DMG";
      return true;
    });
  }

  async function run(searchText, card = null, windowDays = soldWindow) {
    const query = (searchText || "").trim();
    if (!query) return;
    const id = ++runId.current;

    setOpenSug(false);
    setLoading(true);
    setError("");
    setData(null);
    setActive({ loading: true, comps: [] });

    // Active listings fetch alongside but never block the price — they fill in
    // the "Buy one now" module once they land.
    price(query, false, windowDays)
      .then((comps) => { if (id === runId.current) setActive({ loading: false, comps }); })
      .catch(() => { if (id === runId.current) setActive({ loading: false, comps: [] }); });

    try {
      const comps = await price(query, true, windowDays);
      if (id !== runId.current) return;
      // Raw comps are kept as fetched; filtering and scoring happen in the
      // memo below so the controls can re-run them without a new request.
      setData({ card: card || { name: query }, query, comps });
    } catch (err) {
      if (id === runId.current) setError(err.message || "Something went wrong pricing that card.");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }

  async function price(query, sold, soldAfterDays) {
    const res = await fetch("/api/price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sold, soldAfterDays })
    }).then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "Pricing request failed.");
    return res.comps || [];
  }

  const view = useMemo(() => {
    if (!data) return null;
    const { card, comps } = data;

    // Required words come from the card name plus its collector number — NOT
    // from the search query, which carries a set code that no eBay title
    // contains. See lib/tokens.js.
    const nameTokens = buildCompTokens(card, data.query);
    const nameOnlyTokens = buildCompTokens({ name: card.name || data.query }, data.query);
    const cardNumber = card.number || null;
    const cardSet = card.set || null;

    // Numerators repeat across sets, so the set total in a title is what tells
    // 223/165 from 223/197. Applied before the market split so both sides are
    // scored on the same card.
    const conditionCounts = { any: comps.length, nm: 0, nodmg: 0 };
    for (const c of comps) {
      const k = conditionOf(c);
      if (k === "NM") conditionCounts.nm++;
      if (k !== "HP" && k !== "DMG") conditionCounts.nodmg++;
    }

    const filtered = dropWrongSetTotal(preFilter(comps, { condition }), cardNumber);
    const markets = marketsIn(filtered);
    const { chosen, rest } = splitByMarket(filtered, market);

    const priceFor = (pool, tokens = nameTokens, num = cardNumber) =>
      pool.length ? CompFinderPricing.recommend(pool, settings, tokens, "sold", num, cardSet) : null;

    let rec = priceFor(chosen) || CompFinderPricing.recommend([], settings, nameTokens, "sold", cardNumber, cardSet);

    // NUMBER FALLBACK. If requiring the collector number rejects every comp but
    // the name alone matches several, the number is far likelier to be wrong
    // than the market to be empty — a search for "Glaceon ex 145/131" returns
    // plenty of Glaceon ex, all numbered 150/131, because 145 doesn't exist.
    // Reporting "not enough sales" there is the least useful true statement
    // available. Fall back to the name, and say so rather than quietly
    // pretending the number was honoured.
    let numberUnmatched = false;
    if ((rec.included || []).length === 0 && cardNumber) {
      const byNameOnly = CompFinderPricing.recommend(chosen, settings, nameOnlyTokens, "sold", null, cardSet);
      if ((byNameOnly.included || []).length >= 3) {
        rec = byNameOnly;
        numberUnmatched = true;
      }
    }

    // The numbers actually on those listings, so the warning can name them
    // instead of only doubting the one that was searched.
    const seenNumbers = numberUnmatched
      ? [...new Set(
          (rec.included || [])
            .map((c) => (c.title.match(/\b(\d{1,3}\/\d{1,3})\b/) || [])[1])
            .filter(Boolean)
        )].slice(0, 3)
      : [];

    const used = rec.included || [];
    const totals = used.map((c) => c.totalPence);
    const med = totals.length ? median(totals) : null;
    const lo = totals.length ? Math.min(...totals) : null;
    const hi = totals.length ? Math.max(...totals) : null;

    const chart = used
      .filter((c) => c._source && c._source.endedAt)
      .map((c) => ({ t: new Date(c._source.endedAt).getTime(), v: c.totalPence }))
      .filter((p) => !Number.isNaN(p.t));

    const toRow = (c) => ({
      price: c.totalPence ?? c.itemPricePence,
      date: c._source && c._source.endedAt,
      t: c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : 0,
      title: c.title,
      url: c._source && c._source.url,
      loc: c._displayLocation || c.itemLocation,
      grade: CompFinderPricing.parseGrade(c.title),
      reason: c.exclusionReason || null
    });

    // Only comps the price was actually built from. Showing every raw comp
    // here was the bug behind "recent sales don't match" — the list contradicted
    // the "comps used" count sitting directly above it.
    const sales = used.map(toRow).sort((a, b) => b.t - a.t).slice(0, 10);
    const dropped = (rec.excluded || []).map(toRow).sort((a, b) => b.t - a.t).slice(0, 12);

    // Last sold has to come from the comps that were used. Reading it off the
    // raw list is how a £14.99 Giratina VSTAR ended up quoted under a £557 price.
    const lastSold = sales.length ? sales[0].price : null;

    // Active listings get the same name/number/set treatment as sold comps.
    // Scoring them with no tokens at all is why "Buy one now" was offering
    // £2.60 copies of a different card.
    const activeFiltered = splitByMarket(preFilter(active.comps, { condition }), market).chosen;
    const activeRec = activeFiltered.length
      ? CompFinderPricing.recommend(activeFiltered, settings, nameTokens, "active", cardNumber, cardSet)
      : null;
    const buy = (activeRec?.included || [])
      .filter((c) => c._source && c._source.url)
      .slice()
      .sort((a, b) => a.totalPence - b.totalPence)
      .slice(0, 6);

    // The other side of the split: everything NOT in the chosen market. Shown
    // beside the headline rather than hidden behind a toggle, because on most
    // cards it rests on several times more evidence — only a third of eBay UK
    // sold listings are UK-domestic — and the gap between the two is itself
    // worth knowing before you list or buy.
    const restRec = priceFor(rest, numberUnmatched ? nameOnlyTokens : nameTokens, numberUnmatched ? null : cardNumber);
    const restUsed = restRec ? (restRec.included || []).length : 0;
    const restPence = restRec ? restRec.finalPence : null;
    const premium = rec.finalPence && restPence ? rec.finalPence / restPence - 1 : null;

    // --- how much to trust this result -------------------------------------
    // An audit of 50 searches showed three failure shapes worth telling the
    // visitor about rather than quietly pricing through.

    // 1. UK-only starves the sample. Searching ebay.co.uk returns mostly
    //    GBP listings from overseas sellers — across the audit only 29% of
    //    comps were UK-domestic — so a UK-only price can rest on two sales
    //    when a worldwide one would rest on twenty.
    const thinHere = used.length < 3 && restUsed > used.length;

    // 2. A search that matched very different cards. "Pikachu" priced comps
    //    from £1.61 to £269.99 — a median across those is arithmetic, not a
    //    price, and the honest move is to say so and ask for a specific card.
    const span = lo && hi && lo > 0 ? hi / lo : null;
    const tooBroad = span != null && span > 10;

    // 3. Asking prices that bear no relation to sold. On broad searches the
    //    active side fills with cheap listings of other cards, giving
    //    "£7.49 asking" under a £136 sold price. Better to withhold the
    //    figure than to print something that reads as a market signal.
    const askRatio = rec.finalPence && activeRec?.finalPence ? activeRec.finalPence / rec.finalPence : null;
    const askingUnreliable = askRatio != null && (askRatio > 5 || askRatio < 0.2);

    return {
      rec, med, chart, sales, dropped, buy, lastSold,
      thinHere, tooBroad, span, askingUnreliable, numberUnmatched, seenNumbers,
      markets, market, restPence, restUsed, premium, conditionCounts,
      activeMedian: activeRec?.finalPence ?? null,
      activeCount: activeRec?.included?.length ?? 0,
      lo,
      hi,
      used: used.length,
      excludedCount: (rec.excluded || []).length,
      graded: rec.graded || [],
      matchedCard: !!(cardNumber || cardSet)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, active, market, condition]);

  return (
    <>
      <section className="searchcard">
        <div className="searchrow">
          <div className="dd-combo" ref={comboRef} style={{ flex: "1 1 auto", minWidth: 0, position: "relative" }}>
            <label className="inp">
              <span className="mag" aria-hidden="true">🔍</span>
              <input
                value={q}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") run(q); if (e.key === "Escape") setOpenSug(false); }}
                placeholder="Search a card — e.g. Charizard ex 199/165"
                aria-label="Search a card"
                autoComplete="off"
              />
            </label>
            {openSug && (
              <div className="suggest open" role="listbox">
                {sugs.map((c, i) => (
                  <button
                    key={c.id || i}
                    type="button"
                    className="sugg"
                    role="option"
                    aria-selected="false"
                    onClick={() => { setQ(queryForCard(c)); run(queryForCard(c), c); }}
                  >
                    <span className="nm">{c.name}</span>
                    <span className="mt">{c.set}{c.rarity ? ` · ${c.rarity}` : ""}</span>
                    <span className="no">{c.number}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => run(q)} disabled={loading}>
            {loading ? "Checking…" : "Check price"}
          </button>
        </div>

        <div className="filters">
          <div className="filter">
            <span className="flabel">Market</span>
            <div className="seg" role="group" aria-label="Market">
              {(view ? view.markets : [{ market: UK, count: 0 }])
                .filter((m) => m.market === UK || m.count >= 2)
                .slice(0, 4)
                .map((m) => (
                  <button key={m.market} aria-pressed={market === m.market} onClick={() => setMarket(m.market)}>
                    {m.market === UK ? "🇬🇧 UK" : m.market}
                    {m.count ? <span className="segn">{m.count}</span> : null}
                  </button>
                ))}
            </div>
          </div>

          <div className="filter">
            <span className="flabel">Condition</span>
            <div className="seg" role="group" aria-label="Condition">
              {[["any", "Any"], ["nodmg", "Not played"], ["nm", "Says NM"]].map(([v, l]) => {
                // Most sellers don't state a condition, so an option backed by
                // one or two comps would produce a confident-looking price
                // built on nothing. Disable rather than let it be picked.
                const n = view ? view.conditionCounts[v] : 0;
                const thin = view && v !== "any" && n < 3;
                return (
                  <button
                    key={v}
                    aria-pressed={condition === v}
                    disabled={thin}
                    title={thin ? "Too few listings state this to price it" : undefined}
                    onClick={() => setCondition(v)}
                  >
                    {l}{view && v !== "any" ? <span className="segn">{n}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="filter">
            <span className="flabel">Sold within</span>
            <div className="seg" role="group" aria-label="Sold within">
              {[[30, "30 days"], [90, "90 days"]].map(([v, l]) => (
                <button
                  key={v}
                  aria-pressed={soldWindow === v}
                  onClick={() => {
                    if (soldWindow === v) return;
                    setSoldWindow(v);
                    // The only control that changes the upstream request, so
                    // it's the only one that re-runs the search.
                    if (data) run(data.query, data.card, v);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="fhint">
          Region and condition re-filter the results instantly. Pick a card from the suggestions rather than
          typing free text — it lets us match on the collector number and set, which is what keeps a different
          print of the same card out of the price.
        </p>
      </section>

      {loading && <div className="panel"><span className="spinner" /> &nbsp;Pricing from recent sold listings…</div>}
      {error && !loading && <div className="panel"><p className="hint">{error}</p></div>}

      {view && !loading && (
        <>
          {(view.thinHere || view.tooBroad || view.numberUnmatched) && (
            <div className="caveats">
              {view.thinHere && (
                <div className="caveat">
                  <strong>Only {view.used} sale{view.used === 1 ? "" : "s"} from {view.market === UK ? "UK sellers" : view.market}.</strong>{" "}
                  Most eBay UK listings for cards come from overseas sellers, priced in pounds — the rest of the
                  market has {view.restUsed} comps, and that figure sits beside the price above.
                </div>
              )}
              {view.numberUnmatched && (
                <div className="caveat">
                  <strong>No sales matched that card number.</strong>{" "}
                  {view.seenNumbers.length
                    ? <>The listings we found are numbered {view.seenNumbers.join(", ")} — check you have the right one.</>
                    : <>Check the collector number.</>}{" "}
                  The price below ignores the number and matches on the card name alone.
                </div>
              )}
              {view.tooBroad && (
                <div className="caveat">
                  <strong>This search matched very different cards</strong> — from {pounds(view.lo)} to{" "}
                  {pounds(view.hi)}. Pick the exact card from the suggestions to get a price you can rely on.
                </div>
              )}
            </div>
          )}

          <article className="panel">
            <div className="eyebrow">{data.card.set || "Sold comps"}{data.card.rarity ? ` · ${data.card.rarity}` : ""}</div>
            <h2 className="heroname">{data.card.name}</h2>
            <div className="priceline">
              <div className="pricemain">
                <div className="bigprice"><span className="cur">£</span>{view.rec.finalPence != null ? (view.rec.finalPence / 100).toFixed(2) : "—"}</div>
                <div className="pricewho">{view.market === UK ? "UK sellers" : view.market} · {view.used} comp{view.used === 1 ? "" : "s"}</div>
              </div>
              <span className={`conf${view.rec.confidence === "Medium" ? " med" : ""}`}>
                {view.rec.finalPence == null && view.graded.length > 0 ? "graded only" : `${view.rec.confidence} confidence`}
              </span>
              {view.restPence != null && (
                <div className="pricealt">
                  <div className="altlabel">Rest of the market</div>
                  <div className="altprice">{pounds(view.restPence)}</div>
                  <div className="altmeta">
                    {view.restUsed} comp{view.restUsed === 1 ? "" : "s"}
                    {view.premium != null && Math.abs(view.premium) >= 0.05 ? (
                      <> · {view.market === UK ? "UK" : view.market} is{" "}
                        <b className={view.premium > 0 ? "up" : "down"}>
                          {Math.abs(Math.round(view.premium * 100))}% {view.premium > 0 ? "higher" : "lower"}
                        </b>
                      </>
                    ) : view.premium != null ? <> · in line</> : null}
                  </div>
                </div>
              )}
            </div>
            <p className="herosub">
              {view.used > 0 ? (
                <>Recency-weighted from <b>{view.used}</b> sold comps over the last {soldWindow} days · median <b>{pounds(view.med)}</b>.</>
              ) : view.graded.length > 0 ? (
                // Some cards — old promos especially — barely trade raw at all.
                // "No sold comps" is true and useless when we are holding a
                // dozen graded sales for the same card.
                <>No <b>raw</b> sales in the last {soldWindow} days — this card almost always sells graded. See the graded prices below.</>
              ) : (
                "No sold comps found in the last 90 days for that search — try the card name plus its collector number."
              )}
              {view.activeMedian != null && !view.askingUnreliable ? (
                <> Currently listed around <b>{pounds(view.activeMedian)}</b> asking.</>
              ) : null}
            </p>
            {view.used > 0 && (
              <div className="stats">
                <div className="stat"><div className="k">Median 90d</div><div className="v">{pounds(view.med)}</div></div>
                <div className="stat"><div className="k">Range</div><div className="v">{pounds(view.lo)}–{pounds(view.hi)}</div></div>
                <div className="stat"><div className="k">Last sold</div><div className="v">{pounds(view.lastSold)}</div></div>
                <div className="stat"><div className="k">Comps used</div><div className="v">{view.used}</div></div>
              </div>
            )}
          </article>

          {/* Buy leads: it's what a visitor with intent wants, and the only
              links an affiliate commission can come from. */}
          <section className="panel buy">
            <div className="panel-head">
              <h3>{view.buy.length ? "Buy one now" : "Active listings"}</h3>
              <span className="badge">live listings</span>
              <span className="spacer" />
              {view.activeCount ? <span className="hint">{view.activeCount} listed on eBay UK</span> : null}
            </div>
            {active.loading ? (
              <p className="hint"><span className="spinner" /> &nbsp;Checking current asking prices…</p>
            ) : view.buy.length ? (
              <>
                {view.askingUnreliable && (
                  <p className="hint" style={{ marginTop: 0 }}>
                    Asking prices for this search vary too widely to summarise — these are the closest matches we found.
                  </p>
                )}
                <div className="rows">
                  {view.buy.map((c, i) => {
                    const url = c._source.url;
                    const under = view.rec.finalPence != null && c.totalPence < view.rec.finalPence * 0.95;
                    return (
                      <div className={`row${i === 0 ? " best" : ""}`} key={c._source.itemId || i}>
                        <span className="sp">
                          {pounds(c.totalPence)}
                          {under ? <span className="tag">under</span> : null}
                        </span>
                        <span className="sd">{c.condition && c.condition !== "Unknown" ? c.condition : "—"}</span>
                        <span className="st">
                          <a href={epnLink(url, { customId: "buy-active" })} target="_blank" rel={relFor(url, "noopener noreferrer")}>{c.title}</a>
                        </span>
                        <span className="loc">{c.itemLocation ? c.itemLocation : "🇬🇧 UK"}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="buyfoot">
                  <a
                    className="btn"
                    href={ebaySearchUrl(data.query, { sold: false, customId: "buy-see-all" })}
                    target="_blank"
                    rel={relFor("https://www.ebay.co.uk/", "noopener noreferrer")}
                  >
                    See all on eBay →
                  </a>
                  <span className="disc">
                    We may earn a commission on eBay purchases made through these links. It never affects the prices shown.
                  </span>
                </div>
              </>
            ) : (
              <p className="dd-empty">No active listings found for this card.</p>
            )}
          </section>

          {view.sales.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h3>Recent sales</h3>
                <span className="badge">{view.used} used</span>
                <span className="spacer" />
                <span className="hint">
                  Last {soldWindow} days · {view.market === UK ? "UK sellers" : view.market}
                </span>
              </div>
              <div className="rows">
                {view.sales.map((s, i) => (
                  <div className="row" key={i}>
                    <span className="sp">{pounds(s.price)}</span>
                    <span className="sd">{fmtDate(s.date)}</span>
                    <span className="st">
                      {s.grade ? <span className={`grade ${s.grade.company.toLowerCase()}`}>{s.grade.company} {s.grade.grade}</span> : null}
                      {s.url
                        ? <a href={epnLink(s.url, { customId: "sold-comp" })} target="_blank" rel={relFor(s.url, "noopener noreferrer")}>{s.title}</a>
                        : s.title}
                    </span>
                    <span className="loc">{s.loc ? s.loc : "🇬🇧 UK"}</span>
                  </div>
                ))}
              </div>
              {view.excludedCount > 0 && (
                <div className="excluded">
                  <button className="exlink" onClick={() => setShowExcluded((v) => !v)} aria-expanded={showExcluded}>
                    {showExcluded ? "Hide" : "Show"} {view.excludedCount} listing{view.excludedCount === 1 ? "" : "s"} we didn&rsquo;t count
                  </button>
                  {showExcluded && (
                    <div className="rows exrows">
                      {view.dropped.map((s2, i) => (
                        <div className="row" key={i}>
                          <span className="sp">{pounds(s2.price)}</span>
                          <span className="sd">{fmtDate(s2.date)}</span>
                          <span className="st">
                            <span className="why">{EXCLUSION_LABELS[s2.reason] || s2.reason || "filtered"}</span>
                            {s2.title}
                          </span>
                          <span className="loc">{s2.loc ? s2.loc : "🇬🇧 UK"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {view.graded.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Graded</h3><span className="badge">raw {pounds(view.rec.finalPence)}</span></div>
              <div className="rows">
                {view.graded.map((g) => (
                  <div className="row" key={g.key}>
                    <span className="sp">{pounds(g.medianPence)}</span>
                    <span className="sd">{g.count} sale{g.count === 1 ? "" : "s"}</span>
                    <span className="st"><span className={`grade ${g.company.toLowerCase()}`}>{g.company} {g.grade}</span></span>
                    <span className="loc">median</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view.chart.length >= 2 && (
            <section className="panel">
              <div className="panel-head"><h3>Price trend</h3><span className="badge">daily median</span></div>
              <div className="trendwrap"><TrendChart sales={view.chart} medianPence={view.med} /></div>
              <p className="trendnote">Swipe the chart sideways to see the full 90 days.</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
