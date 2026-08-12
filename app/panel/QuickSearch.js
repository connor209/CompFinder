"use client";

import { useState, useRef, useMemo } from "react";
import CompFinderPricing from "@/lib/pricing.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;

function pounds(pence) {
  return pence == null ? "—" : CompFinderPricing.toPoundsStr(pence);
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Interactive price-trend chart. Sales are grouped by day; each plotted point
 * is that day's median. Hover a point for a callout; click it to list the
 * day's individual sales with links to the actual eBay listings.
 */
function TrendChart({ sales, medianPence }) {
  const [hover, setHover] = useState(-1);
  const [selected, setSelected] = useState(-1);

  const days = useMemo(() => {
    const map = new Map();
    for (const s of sales) {
      if (!s.t) continue;
      const d = new Date(s.t);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, { t: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), items: [] });
      map.get(key).items.push(s);
    }
    return [...map.values()]
      .map((d) => ({ t: d.t, items: d.items.slice().sort((a, b) => a.v - b.v), v: Math.round(median(d.items.map((x) => x.v))) }))
      .sort((a, b) => a.t - b.t);
  }, [sales]);

  if (days.length < 2) {
    return <p className="dd-empty">Not enough dated sales to chart a trend yet — need at least two days with sales.</p>;
  }

  const W = 720, H = 260, padL = 46, padR = 16, padT = 16, padB = 30;
  const times = days.map((d) => d.t), vals = days.map((d) => d.v);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const allV = medianPence != null ? [...vals, medianPence] : vals;
  const vMinRaw = Math.min(...allV), vMaxRaw = Math.max(...allV);
  const pad = (vMaxRaw - vMinRaw) * 0.18 || vMaxRaw * 0.1 || 100;
  const vMin = Math.max(0, vMinRaw - pad), vMax = vMaxRaw + pad;
  const x = (t) => padL + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - padL - padR);
  const y = (v) => padT + (vMax - v) / (vMax - vMin) * (H - padT - padB);
  const line = days.map((d, i) => (i ? "L" : "M") + x(d.t).toFixed(1) + " " + y(d.v).toFixed(1)).join(" ");
  const area = `${line} L ${x(days[days.length - 1].t).toFixed(1)} ${H - padB} L ${x(days[0].t).toFixed(1)} ${H - padB} Z`;
  const grid = [0.2, 0.5, 0.8].map((f) => Math.round(vMin + (vMax - vMin) * f));
  const fmtShort = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="trend-wrap">
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sold price trend">
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((gv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="currentColor" strokeOpacity="0.10" />
            <text x={padL - 8} y={y(gv) + 4} textAnchor="end" fontSize="12" fill="currentColor" opacity="0.45" fontFamily="var(--font-mono)">{pounds(gv)}</text>
          </g>
        ))}
        {medianPence != null && (
          <line x1={padL} x2={W - padR} y1={y(medianPence)} y2={y(medianPence)} stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.5" strokeDasharray="5 4" />
        )}
        <path d={area} fill="url(#tg)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={x(days[0].t)} y={H - 9} textAnchor="start" fontSize="11.5" fill="currentColor" opacity="0.5">{fmtShort(days[0].t)}</text>
        <text x={x(days[days.length - 1].t)} y={H - 9} textAnchor="end" fontSize="11.5" fill="currentColor" opacity="0.5">{fmtShort(days[days.length - 1].t)}</text>

        {days.map((d, i) => (
          <circle key={"p" + i} cx={x(d.t)} cy={y(d.v)} r={i === hover || i === selected ? 5 : 3.4}
            fill="var(--surface)" stroke="var(--accent)" strokeWidth={i === hover || i === selected ? 2.4 : 1.8} />
        ))}
        {days.map((d, i) => d.items.length > 1 && (
          <circle key={"c" + i} cx={x(d.t)} cy={y(d.v)} r="1.5" fill="var(--accent)" pointerEvents="none" />
        ))}
        {days.map((d, i) => (
          <circle key={"h" + i} cx={x(d.t)} cy={y(d.v)} r="15" fill="transparent" style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} onClick={() => setSelected(selected === i ? -1 : i)} />
        ))}

        {hover >= 0 && (() => {
          const d = days[hover];
          const px = x(d.t), py = y(d.v);
          const tw = 132, th = 56;
          let tx = Math.max(padL, Math.min(px - tw / 2, W - padR - tw));
          let ty = py - th - 12;
          if (ty < padT) ty = py + 14;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx="8" fill="var(--surface)" stroke="var(--line-strong)" />
              <text x={tx + 11} y={ty + 18} fontSize="12" fill="var(--ink-soft)">{fmtShort(d.t)}</text>
              <text x={tx + 11} y={ty + 35} fontSize="14" fontWeight="700" fill="var(--ink)" fontFamily="var(--font-mono)">{pounds(d.v)}{d.items.length > 1 ? " median" : ""}</text>
              <text x={tx + 11} y={ty + 49} fontSize="11" fill="var(--accent-2)">{d.items.length > 1 ? `${d.items.length} sales — click` : "1 sale — click"}</text>
            </g>
          );
        })()}
      </svg>

      <div className="trend-legend">
        <span className="lg-line"><i></i>Daily sold (median)</span>
        {medianPence != null && <span className="lg-med"><i></i>Overall median {pounds(medianPence)}</span>}
        <span className="lg-dot"><b></b>Hover / click a point</span>
      </div>

      {selected >= 0 && (
        <div className="day-sales">
          <div className="day-sales-head">
            <strong>{new Date(days[selected].t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong>
            <span>{days[selected].items.length} sale(s) · median {pounds(days[selected].v)}</span>
            <button className="day-close" onClick={() => setSelected(-1)} aria-label="Close">✕</button>
          </div>
          <div className="day-list">
            {days[selected].items.map((s, i) => (
              <div className="day-item" key={i}>
                <span className="sp">{pounds(s.v)}</span>
                <span className="st">{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuickSearch() {
  const [q, setQ] = useState("");
  const [sugs, setSugs] = useState([]);
  const [openSug, setOpenSug] = useState(false);
  const [activeSug, setActiveSug] = useState(-1);
  const [scope, setScope] = useState("uk");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activeState, setActiveState] = useState({ loading: false, rec: null });
  const debounceRef = useRef(null);
  const cacheRef = useRef(new Map());

  function onInput(v) {
    setQ(v);
    setActiveSug(-1);
    clearTimeout(debounceRef.current);
    if (v.trim().length < 2) {
      setSugs([]);
      setOpenSug(false);
      return;
    }
    const key = v.trim().toLowerCase();
    debounceRef.current = setTimeout(async () => {
      if (cacheRef.current.has(key)) {
        const cards = cacheRef.current.get(key);
        setSugs(cards);
        setOpenSug(cards.length > 0);
        return;
      }
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(v.trim())}`).then((r) => r.json());
        if (res.ok) {
          const cards = res.cards || [];
          cacheRef.current.set(key, cards);
          setSugs(cards);
          setOpenSug(cards.length > 0);
        }
        // On a non-ok response (e.g. throttled), leave whatever's showing
        // rather than blanking the dropdown.
      } catch {
        /* typeahead is best-effort */
      }
    }, 250);
  }

  function onKeyDown(e) {
    if (openSug && sugs.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveSug((i) => (i + 1) % sugs.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveSug((i) => (i - 1 + sugs.length) % sugs.length); return; }
      if (e.key === "Escape") { setOpenSug(false); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeSug >= 0) pickSug(sugs[activeSug]);
        else runFromText();
        return;
      }
    } else if (e.key === "Enter") {
      runFromText();
    }
  }

  function pickSug(card) {
    setQ(`${card.name} ${card.number}`.trim());
    setOpenSug(false);
    runDeepDive(card);
  }

  async function runFromText() {
    const text = q.trim();
    if (!text) return;
    setOpenSug(false);
    const m = text.match(/\b([A-Za-z]{0,3}\d{1,4}\s*\/\s*[A-Za-z]{0,3}\d{1,4})\b/);
    const number = m ? m[1].replace(/\s+/g, "") : "";
    const name = m ? text.slice(0, m.index).trim() : text;
    let card = { name, number, set: "", series: "", rarity: "", image: null };
    try {
      const lk = await fetch(`/api/cards/lookup?name=${encodeURIComponent(name)}&number=${encodeURIComponent(number)}`).then((r) => r.json());
      if (lk.ok && lk.card) card = lk.card;
    } catch {
      /* fall back to what we parsed */
    }
    runDeepDive(card);
  }

  async function runDeepDive(card) {
    setLoading(true);
    setError("");
    setData(null);
    setScope("uk");
    setActiveState({ loading: true, rec: null });
    const query = `${card.name} ${card.number}`.trim();
    const nameTokens = CompFinderPricing.extractNameTokens(CompFinderPricing.simplifyTitle(query, settings.stripWords));
    const options = { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 };
    const post = (body) =>
      fetch("/api/soldcomps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

    // Fire sold + active in parallel so active listings don't add to the wait.
    const soldPromise = post({ query, options });
    const activePromise = post({ query, options: { ...options, sold: false } });

    // Active listings fill in on their own once ready — they don't block the
    // main deep dive from rendering.
    activePromise
      .then((actRes) => {
        if (actRes && actRes.ok) {
          const a = CompFinderPricing.recommend(actRes.comps || [], settings, nameTokens, "active", card.number || null, card.set || null);
          setActiveState({ loading: false, rec: a });
        } else {
          setActiveState({ loading: false, rec: null });
        }
      })
      .catch(() => setActiveState({ loading: false, rec: null }));

    try {
      const soldRes = await soldPromise;
      if (!soldRes || !soldRes.ok) throw new Error((soldRes && soldRes.error) || "Pricing request failed.");
      const comps = soldRes.comps || [];
      const rec = CompFinderPricing.recommend(comps, settings, nameTokens, "sold", card.number || null, card.set || null);
      setData({ card, rec, comps });
    } catch (err) {
      setError(err.message || "Something went wrong pricing that card.");
    } finally {
      setLoading(false);
    }
  }

  // ---- derived view data ----
  let view = null;
  if (data) {
    const { card, rec, comps } = data;
    const active = activeState.rec;
    const used = rec.included || [];
    const totals = used.map((c) => c.totalPence);
    const med = totals.length ? Math.round(median(totals)) : null;
    const lo = totals.length ? Math.min(...totals) : null;
    const hi = totals.length ? Math.max(...totals) : null;
    const chartSales = used
      .filter((c) => c._source && c._source.endedAt)
      .map((c) => ({ t: new Date(c._source.endedAt).getTime(), v: c.totalPence, title: c.title, url: c._source.url }))
      .filter((p) => !Number.isNaN(p.t));
    const lastSold = chartSales.length ? chartSales.slice().sort((a, b) => b.t - a.t)[0].v : null;

    const salesAll = comps
      .map((c) => ({
        price: c.itemPricePence,
        t: c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : 0,
        date: c._source && c._source.endedAt,
        title: c.title,
        url: c._source && c._source.url,
        loc: c.itemLocation
      }))
      .sort((a, b) => b.t - a.t);
    const sales = (scope === "uk" ? salesAll.filter((s) => !s.loc) : salesAll).slice(0, 12);

    const confClass = `conf-badge conf-${(rec.confidence || "low").toLowerCase()}`;
    const activePrice = active && active.finalPence != null ? active.finalPence : null;
    view = { card, rec, med, lo, hi, lastSold, chartSales, sales, confClass, activePrice, active, activeLoading: activeState.loading, usedCount: used.length };
  }

  return (
    <>
      <div className="dd-search">
        <div className="dd-combo">
          <div className="dd-inp">
            <span className="mag" aria-hidden="true">🔍</span>
            <input
              value={q}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => { if (q.trim().length >= 2) onInput(q); }}
              onBlur={() => setTimeout(() => setOpenSug(false), 150)}
              placeholder="Search a card — e.g. Charizard 4/102"
              role="combobox"
              aria-expanded={openSug}
              aria-controls="dd-suggest"
              autoComplete="off"
              aria-label="Search a card"
            />
            {q && (
              <button
                type="button"
                className="dd-clear"
                aria-label="Clear search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setQ(""); setSugs([]); setOpenSug(false); }}
              >
                ✕
              </button>
            )}
          </div>
          <div className={`suggest${openSug ? " open" : ""}`} id="dd-suggest" role="listbox">
            {sugs.map((c, i) => (
              <div
                key={c.id || i}
                className="sugg"
                role="option"
                aria-selected={i === activeSug}
                onMouseDown={(e) => { e.preventDefault(); pickSug(c); }}
              >
                {c.image ? <img className="sw" src={c.image} alt="" loading="lazy" /> : <span className="sw" />}
                <span>
                  <div className="nm">{c.name}</div>
                  <div className="mt">{c.set}{c.rarity ? ` · ${c.rarity}` : ""}</div>
                </span>
                <span className="no">{c.number}</span>
              </div>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={runFromText} disabled={loading}>Search</button>
      </div>

      {loading && <div className="panel"><span className="spinner" /> &nbsp;Pricing from recent sold listings…</div>}
      {error && !loading && <div className="panel compfinder-error">{error}</div>}

      {!data && !loading && !error && (
        <div className="panel">
          <div className="eyebrow">Quick Search</div>
          <p className="hint">Search a single card for a full deep dive — recommended price, an interactive price-trend chart, UK vs worldwide sold listings, and current asking prices. Start typing above and pick a card.</p>
        </div>
      )}

      {view && !loading && (
        <>
          <div className="dd-hero">
            <div className="dd-card">
              {view.card.image ? <img src={view.card.image} alt={view.card.name} /> : <span className="ph" aria-hidden="true">🎴</span>}
            </div>
            <div className="dd-meta">
              <span className="dd-set">
                {view.card.set || "Set unknown"}
                {view.card.rarity ? <><span aria-hidden="true">·</span> <span className="rarity">{view.card.rarity}</span></> : null}
              </span>
              <h2 className="dd-title">{view.card.name}</h2>
              <div className="dd-nums">
                {view.card.number ? <span className="badge2"># {view.card.number}</span> : null}
                {view.card.series ? <span className="badge2">{view.card.series}</span> : null}
              </div>
              <div className="dd-headline">
                <div className="dd-price"><span className="cur">£</span>{view.rec.finalPence != null ? (view.rec.finalPence / 100).toFixed(2) : "—"}</div>
                <span className={view.confClass}>{view.rec.confidence} confidence</span>
              </div>
              <p className="dd-sub">
                {view.usedCount > 0
                  ? `Recency-weighted from ${view.usedCount} UK sold comp(s) over the last 90 days${view.med != null ? ` · median ${pounds(view.med)}` : ""}.`
                  : "No UK sold comps in the last 90 days — try the worldwide view below, or the active-listings read."}
                {view.activePrice != null ? ` Currently listed around ${pounds(view.activePrice)} asking.` : ""}
              </p>
            </div>
          </div>

          <div className="stat-row">
            <div className="stat"><div className="k">Median (90d)</div><div className="v">{pounds(view.med)}</div></div>
            <div className="stat"><div className="k">Range</div><div className="v">{view.lo != null ? (view.lo === view.hi ? pounds(view.lo) : `${pounds(view.lo)}–${pounds(view.hi)}`) : "—"}</div></div>
            <div className="stat"><div className="k">Last sold</div><div className="v">{pounds(view.lastSold)}</div></div>
            <div className="stat"><div className="k">Sold comps</div><div className="v">{view.usedCount}</div></div>
          </div>

          <div className="panel">
            <div className="panel-head"><h3>Price trend</h3></div>
            <TrendChart sales={view.chartSales} medianPence={view.med} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Recent sales</h3>
              <div className="scope" role="group" aria-label="Location">
                <button aria-pressed={scope === "uk"} onClick={() => setScope("uk")}>🇬🇧 UK</button>
                <button aria-pressed={scope === "ww"} onClick={() => setScope("ww")}>🌍 Worldwide</button>
              </div>
            </div>
            {view.sales.length === 0 ? (
              <p className="dd-empty">No {scope === "uk" ? "UK" : ""} sold listings in this window.</p>
            ) : (
              <div className="sales">
                {view.sales.map((s, i) => (
                  <div className="sale" key={i}>
                    <span className="sp">{pounds(s.price)}</span>
                    <span className="sd">{fmtDate(s.date)}</span>
                    <span className="st">{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</span>
                    <span className="loc">{s.loc ? s.loc : "🇬🇧 UK"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head"><h3>Active listings</h3><span className="badge2">market read</span></div>
            {view.activeLoading ? (
              <p className="hint" style={{ marginTop: 0 }}><span className="spinner" /> &nbsp;Checking current asking prices…</p>
            ) : view.active && view.active.included && view.active.included.length > 0 ? (
              <p className="hint" style={{ marginTop: 0 }}>
                Currently listed at a median <b>{pounds(view.active.finalPence)}</b> asking ({view.active.included.length} listing(s))
                {view.rec.finalPence != null && view.active.finalPence != null
                  ? view.active.finalPence > view.rec.finalPence * 1.1
                    ? " — sellers asking above recent sold, a sign demand may be firming."
                    : view.active.finalPence < view.rec.finalPence * 0.95
                      ? " — asking at or below recent sold, market may be softening."
                      : " — roughly in line with recent sold."
                  : "."}
              </p>
            ) : (
              <p className="dd-empty">No active listings found for this card.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
