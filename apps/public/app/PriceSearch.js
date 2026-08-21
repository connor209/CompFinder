"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import { ebaySearchUrl } from "@compfinder/core/marketplace.js";
import TrendChart from "./TrendChart";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
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

  async function run(searchText, card = null) {
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
    price(query, false)
      .then((comps) => { if (id === runId.current) setActive({ loading: false, comps }); })
      .catch(() => { if (id === runId.current) setActive({ loading: false, comps: [] }); });

    try {
      const comps = await price(query, true);
      if (id !== runId.current) return;
      const nameTokens = CompFinderPricing.extractNameTokens(
        CompFinderPricing.simplifyTitle(query, settings.stripWords)
      );
      const rec = CompFinderPricing.recommend(comps, settings, nameTokens, "sold", null, null);
      setData({ card: card || { name: query }, query, rec, comps });
    } catch (err) {
      if (id === runId.current) setError(err.message || "Something went wrong pricing that card.");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }

  async function price(query, sold) {
    const res = await fetch("/api/price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sold })
    }).then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "Pricing request failed.");
    return res.comps || [];
  }

  const view = useMemo(() => {
    if (!data) return null;
    const { rec, comps } = data;
    const used = rec.included || [];
    const totals = used.map((c) => c.totalPence);
    const med = totals.length ? median(totals) : null;

    const chart = used
      .filter((c) => c._source && c._source.endedAt)
      .map((c) => ({ t: new Date(c._source.endedAt).getTime(), v: c.totalPence }))
      .filter((p) => !Number.isNaN(p.t));

    const sales = comps
      .map((c) => ({
        price: c.totalPence ?? c.itemPricePence,
        date: c._source && c._source.endedAt,
        t: c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : 0,
        title: c.title,
        url: c._source && c._source.url,
        loc: c.itemLocation,
        grade: CompFinderPricing.parseGrade(c.title)
      }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 8);

    // Only listings we can actually link to are worth showing as buyable.
    const activeRec = active.comps.length
      ? CompFinderPricing.recommend(active.comps, settings, [], "active", null, null)
      : null;
    const buy = (activeRec?.included || [])
      .filter((c) => c._source && c._source.url)
      .slice()
      .sort((a, b) => a.totalPence - b.totalPence)
      .slice(0, 6);

    return {
      rec, med, chart, sales, buy,
      activeMedian: activeRec?.finalPence ?? null,
      activeCount: activeRec?.included?.length ?? 0,
      lastSold: sales.length ? sales[0].price : null,
      lo: totals.length ? Math.min(...totals) : null,
      hi: totals.length ? Math.max(...totals) : null,
      used: used.length,
      graded: rec.graded || []
    };
  }, [data, active]);

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
      </section>

      {loading && <div className="panel"><span className="spinner" /> &nbsp;Pricing from recent sold listings…</div>}
      {error && !loading && <div className="panel"><p className="hint">{error}</p></div>}

      {view && !loading && (
        <>
          <article className="panel">
            <div className="eyebrow">{data.card.set || "Sold comps"}{data.card.rarity ? ` · ${data.card.rarity}` : ""}</div>
            <h2 className="heroname">{data.card.name}</h2>
            <div className="priceline">
              <div className="bigprice"><span className="cur">£</span>{view.rec.finalPence != null ? (view.rec.finalPence / 100).toFixed(2) : "—"}</div>
              <span className={`conf${view.rec.confidence === "Medium" ? " med" : ""}`}>{view.rec.confidence} confidence</span>
            </div>
            <p className="herosub">
              {view.used > 0
                ? <>Recency-weighted from <b>{view.used}</b> UK sold comps over the last 90 days · median <b>{pounds(view.med)}</b>.</>
                : "No sold comps found in the last 90 days for that search — try the card name plus its collector number."}
              {view.activeMedian != null ? <> Currently listed around <b>{pounds(view.activeMedian)}</b> asking.</> : null}
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
                <span className="badge">{view.used} comps</span>
                <span className="spacer" />
                <span className="hint">Last 90 days · eBay UK</span>
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
