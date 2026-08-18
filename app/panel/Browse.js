"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cleanSearchName } from "@/lib/cardname.js";
import { ebaySearchUrl, cardmarketBestUrl } from "@/lib/marketplace.js";
import { premiumLabel as premiumLabelFor, priceWarning } from "@/lib/priceguide.js";
import ColumnPicker, { useColumns } from "./ColumnPicker";

/**
 * Browse — explore the whole card catalogue across every supported game:
 * Games → Sets → Cards. Click a card to deep-dive it in Quick Search (prices
 * it live). Real cards show by default; tokens/code/oversized/tip are hidden
 * behind the "extras" toggle. Data comes from the card_catalog table (the
 * Cardmarket exports) via /api/catalog/*.
 */
const CATEGORY_LABEL = { token: "Token", code: "Code card", oversized: "Oversized", tip: "Tip card" };

// Which columns exist, and which are on to start with. `always` = structural.
// The price columns only appear once the set actually has prices.
const BROWSE_COLS = [
  { key: "number", label: "No", always: true },
  { key: "name", label: "Name", always: true },
  { key: "rarity", label: "Rarity" },
  { key: "market", label: "Market", price: true, hint: "Cardmarket trend price" },
  { key: "marketPremium", label: "Premium", price: true, hint: "Cardmarket's premium series for this game" },
  { key: "low", label: "Cheapest", price: true, hint: "Lowest current listing on Cardmarket" },
  { key: "avg7", label: "7-day avg", price: true, hint: "Average sale price over the last 7 days" },
  { key: "avg30", label: "30-day avg", price: true, hint: "Average sale price over the last 30 days" },
  { key: "links", label: "Links" }
];
const BROWSE_DEFAULT_COLS = ["rarity", "market", "marketPremium", "links"];

// Sort by collector number numerically (the DB paginates on the text column, so
// merged pages must be re-sorted here for a stable "2 before 10" order).
function numKey(n) {
  const s = String(n || "");
  const m = s.match(/\d+/);
  return { num: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, s };
}
function byNumber(a, b) {
  const ka = numKey(a.number), kb = numKey(b.number);
  return ka.num - kb.num || ka.s.localeCompare(kb.s) || a.name.localeCompare(b.name);
}
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function Browse({ onDeepDive }) {
  const [games, setGames] = useState(null);
  const [available, setAvailable] = useState(true);
  const [game, setGame] = useState(null);

  // sets for the chosen game
  const [sets, setSets] = useState(null);
  const [setsError, setSetsError] = useState(false);
  const [setQ, setSetQ] = useState("");

  // cards for the chosen set
  const [set, setSet] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [cardQ, setCardQ] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [pricedAsOf, setPricedAsOf] = useState(null);
  // Collector order is how a set is normally read; the price columns are there
  // for "what's actually worth something in here".
  const [sort, setSort] = useState({ key: "number", dir: "asc" });
  const gameSeq = useRef(0);
  const cardSeq = useRef(0);

  // ---- load games once ----
  useEffect(() => {
    (async () => {
      try {
        const res = await getJson("/api/catalog/games");
        setAvailable(res.available !== false);
        setGames(res.games || []);
      } catch {
        setGames([]);
      }
    })();
  }, []);

  // ---- pick a game -> load its sets ----
  async function openGame(g) {
    const mine = ++gameSeq.current;
    setGame(g);
    setSet(null);
    setSets(null);
    setSetsError(false);
    setSetQ("");
    try {
      const res = await getJson(`/api/catalog/sets?game=${encodeURIComponent(g.slug)}`);
      if (mine !== gameSeq.current) return; // superseded by a newer game click
      if (res.available === false) { setSetsError(true); setSets([]); return; }
      setSets(res.sets || []);
    } catch {
      if (mine === gameSeq.current) { setSetsError(true); setSets([]); }
    }
  }

  // ---- pick a set -> load its cards (page 0) ----
  async function openSet(s, pageNum = 0, extras = showExtras) {
    const mine = ++cardSeq.current;
    setSet(s);
    setCardsLoading(true);
    setCardsError(false);
    if (pageNum === 0) setCards([]);
    try {
      const url = `/api/catalog/cards?expansion=${encodeURIComponent(s.name)}&code=${encodeURIComponent(s.code || "")}` +
        `&game=${encodeURIComponent(game.slug)}&category=${extras ? "all" : "card"}&page=${pageNum}`;
      const res = await getJson(url);
      if (mine !== cardSeq.current) return; // a newer request superseded this one
      if (res.available === false) { setCardsError(true); return; }
      setCards((prev) => (pageNum === 0 ? res.cards || [] : [...prev, ...(res.cards || [])]).slice().sort(byNumber));
      setHasMore(!!res.hasMore);
      setPage(pageNum);
      if (res.pricedAsOf) setPricedAsOf(res.pricedAsOf);
    } catch {
      if (mine === cardSeq.current) setCardsError(true);
    }
    if (mine === cardSeq.current) setCardsLoading(false);
  }

  function toggleExtras(next) {
    setShowExtras(next);
    if (set) openSet(set, 0, next);
  }

  const filteredSets = useMemo(() => {
    if (!sets) return [];
    const q = setQ.trim().toLowerCase();
    return q ? sets.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : sets;
  }, [sets, setQ]);

  const filteredCards = useMemo(() => {
    const q = cardQ.trim().toLowerCase();
    const base = q
      ? cards.filter((c) => c.name.toLowerCase().includes(q) || String(c.number).toLowerCase().includes(q))
      : cards;
    const { key, dir } = sort;
    if (key === "number") return dir === "asc" ? base : [...base].reverse();
    const mul = dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (key === "name") return mul * a.name.localeCompare(b.name);
      if (key === "rarity") return mul * String(a.rarity || "").localeCompare(String(b.rarity || "")) || byNumber(a, b);
      // Unpriced cards always sit at the bottom, whichever way you sort.
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return byNumber(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return mul * (av - bv);
    });
  }, [cards, cardQ, sort]);

  const anyPrices = useMemo(() => cards.some((c) => c.market != null || c.marketPremium != null), [cards]);
  const premiumKind = useMemo(() => cards.find((c) => c.premiumKind)?.premiumKind || null, [cards]);
  const premiumLabel = premiumLabelFor(premiumKind);
  const premiumHint = premiumLabelFor(premiumKind, "long");
  const setValue = useMemo(
    () => cards.reduce((t, c) => t + (c.market || 0), 0),
    [cards]
  );

  function sortBy(key) {
    setSort((p) => (p.key === key
      ? { key, dir: p.dir === "asc" ? "desc" : "asc" }
      // Money reads best highest-first; names and numbers ascending.
      : { key, dir: BROWSE_COLS.find((c) => c.key === key)?.price ? "desc" : "asc" }));
  }
  const sortIcon = (key) => (sort.key !== key ? "" : sort.dir === "asc" ? " ▲" : " ▼");
  const money = (v) => (v == null ? "—" : `£${Number(v).toFixed(2)}`);

  // Columns: the price ones are only offered once the set has prices, and the
  // premium header is named after whatever this game's premium series is.
  const columns = useMemo(
    () =>
      BROWSE_COLS.filter((c) => !c.price || anyPrices).map((c) =>
        c.key === "marketPremium" ? { ...c, label: premiumLabel, hint: premiumHint } : c
      ),
    [anyPrices, premiumLabel, premiumHint]
  );
  const { cols, toggle, reset, visible } = useColumns("cf-brw-cols", BROWSE_DEFAULT_COLS);
  const shownCols = visible(columns);
  const showing = (key) => shownCols.some((c) => c.key === key);

  // -------------------- render --------------------
  if (games === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading catalogue…</div>;

  if (!available || games.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head"><span className="eyebrow">Browse catalogue</span></div>
        <p className="dd-empty">
          The card catalogue isn’t loaded yet. Run migration <code>015_catalog_multigame.sql</code> and import the
          per-game CSVs into <code>card_catalog</code>, then reload.
        </p>
      </div>
    );
  }

  // LEVEL 1 — games grid
  if (!game) {
    return (
      <div className="rise-group">
        <div className="panel">
          <div className="panel-head"><span className="eyebrow">Browse catalogue</span></div>
          <p className="hint">Pick a game to explore its sets and cards. Click any card to price it in Quick Search.</p>
          <div className="brw-games">
            {games.map((g) => (
              <button key={g.slug} className="brw-game" onClick={() => openGame(g)}>
                <span className="brw-game-ic" aria-hidden="true">{g.icon}</span>
                <span className="brw-game-name">{g.name}</span>
                <span className="brw-game-count">{g.cardCount.toLocaleString()} cards</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // LEVEL 2 — sets for the chosen game
  if (!set) {
    return (
      <div className="rise-group">
        <div className="panel">
          <div className="brw-crumbs">
            <button className="brw-crumb-link" onClick={() => setGame(null)}>Games</button>
            <span className="brw-crumb-sep">›</span>
            <span className="brw-crumb-cur"><span aria-hidden="true">{game.icon} </span>{game.name}</span>
          </div>
          <div className="dd-inp brw-inp">
            <span className="mag" aria-hidden="true">🔍</span>
            <input value={setQ} onChange={(e) => setSetQ(e.target.value)} placeholder={`Find a set in ${game.shortName || game.name}…`} aria-label="Find a set" />
          </div>
          {sets === null ? (
            <p className="hint hint-small"><span className="spinner" /> &nbsp;Loading sets…</p>
          ) : setsError ? (
            <p className="hint hint-small">Couldn’t load sets — <button className="brw-retry" onClick={() => openGame(game)}>try again</button>.</p>
          ) : filteredSets.length === 0 ? (
            <p className="hint hint-small">{setQ ? `No sets match “${setQ}”.` : "No sets found."}</p>
          ) : (
            <>
              <p className="hint hint-small">{filteredSets.length} set{filteredSets.length === 1 ? "" : "s"}</p>
              <div className="brw-exps">
                {filteredSets.map((s) => (
                  <button key={`${s.name}|${s.code}`} className="brw-exp" onClick={() => { setCardQ(""); openSet(s, 0); }}>
                    <span className="brw-exp-name">{s.name}</span>
                    <span className="brw-exp-meta">
                      {s.code ? <span className="brw-code">{s.code}</span> : null}
                      {s.language && s.language !== "English" ? <span className="badge2 badge-lang">{s.language}</span> : null}
                      <span className="brw-exp-count">{s.cards.toLocaleString()}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // LEVEL 3 — cards in the chosen set
  const filtering = cardQ.trim().length > 0;
  return (
    <div className="rise-group">
      <div className="panel">
        <div className="brw-crumbs">
          <button className="brw-crumb-link" onClick={() => setGame(null)}>Games</button>
          <span className="brw-crumb-sep">›</span>
          <button className="brw-crumb-link" onClick={() => { setSet(null); setCards([]); }}>{game.shortName || game.name}</button>
          <span className="brw-crumb-sep">›</span>
          <span className="brw-crumb-cur">{set.name}</span>
        </div>

        <div className="brw-cardbar">
          <div className="dd-inp brw-inp">
            <span className="mag" aria-hidden="true">🔍</span>
            <input value={cardQ} onChange={(e) => setCardQ(e.target.value)} placeholder="Filter cards by name or number…" aria-label="Filter cards" />
          </div>
          <label className="checkbox-field brw-extras">
            <input type="checkbox" checked={showExtras} onChange={(e) => toggleExtras(e.target.checked)} />
            <span>Include tokens &amp; extras</span>
          </label>
          <ColumnPicker columns={columns} cols={cols} onToggle={toggle} onReset={reset} />
        </div>

        {cardsLoading && cards.length === 0 ? (
          <p className="hint hint-small"><span className="spinner" /> &nbsp;Loading cards…</p>
        ) : cardsError && cards.length === 0 ? (
          <p className="hint hint-small">Couldn’t load cards — <button className="brw-retry" onClick={() => openSet(set, 0)}>try again</button>.</p>
        ) : filteredCards.length === 0 ? (
          <p className="hint hint-small">{filtering ? `No loaded cards match “${cardQ}”.${hasMore ? " Load more below to search the rest." : ""}` : "No cards found in this set."}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="itbl brw-tbl">
                <thead>
                  <tr>
                    {shownCols.map((c) =>
                      c.key === "links" ? (
                        <th key={c.key} aria-label="Links"></th>
                      ) : (
                        <th
                          key={c.key}
                          className={`brw-th${c.price ? " brw-num" : ""}`}
                          onClick={() => sortBy(c.key)}
                          role="button"
                          tabIndex={0}
                          title={c.hint || ""}
                        >
                          {c.label}{sortIcon(c.key)}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredCards.map((c) => {
                    const ebayUrl = ebaySearchUrl(`${cleanSearchName(c.name, game.slug)} ${c.number}`.trim(), { sold: true });
                    const cmUrl = cardmarketBestUrl({ cardmarketId: c.cardmarketId, query: `${c.name} ${c.number}`.trim(), gameSlug: game.slug });
                    // Trend can sit an order of magnitude from the cheapest
                    // listing and the 30-day average — usually a graded copy
                    // sold under the same product. Mark it rather than hide it.
                    const warn = priceWarning({ trend: c.trend, avg7: c.avg7, avg30: c.avg30, low: c.low });
                    const warnP = priceWarning({ trend: c.marketPremium, avg7: c.premiumAvg7, avg30: c.premiumAvg30, low: c.premiumLow });
                    const cell = {
                      number: <td key="number" className="mono brw-td-no">{c.number || "—"}</td>,
                      name: (
                        <td key="name" className="itbl-title">
                          <button
                            className="brw-name-btn"
                            title={onDeepDive ? "Price this card in Quick Search" : c.name}
                            onClick={() =>
                              onDeepDive &&
                              onDeepDive(`${c.name} ${c.number}`.trim(), {
                                game: game.slug,
                                card: { name: c.name, number: c.number, set: set.name, series: set.code, rarity: c.rarity, image: null, cardmarketId: c.cardmarketId }
                              })
                            }
                          >
                            {c.name}
                          </button>
                          {c.category !== "card" ? <span className="brw-card-cat">{CATEGORY_LABEL[c.category] || c.category}</span> : null}
                        </td>
                      ),
                      rarity: <td key="rarity" className="muted">{c.rarity || "—"}</td>,
                      market: (
                        <td key="market" className="mono brw-num brw-price" title={warn ? `Odd figure — ${warn.reasons.join("; ")}` : ""}>
                          {money(c.market)}{warn ? <span className="brw-warn" aria-label="Check this price">⚠</span> : null}
                        </td>
                      ),
                      marketPremium: (
                        <td key="marketPremium" className="mono brw-num brw-price-p" title={warnP ? `Odd figure — ${warnP.reasons.join("; ")}` : premiumHint}>
                          {money(c.marketPremium)}{warnP ? <span className="brw-warn" aria-label="Check this price">⚠</span> : null}
                        </td>
                      ),
                      low: <td key="low" className="mono brw-num muted">{money(c.low)}</td>,
                      avg7: <td key="avg7" className="mono brw-num muted">{money(c.avg7)}</td>,
                      avg30: <td key="avg30" className="mono brw-num muted">{money(c.avg30)}</td>,
                      links: (
                        <td key="links">
                          <div className="brw-card-acts">
                            <a className="brw-act" href={ebayUrl} target="_blank" rel="noopener noreferrer" title="eBay sold listings ↗" aria-label={`${c.name} — eBay sold listings`}>🔍</a>
                            {cmUrl ? <a className="brw-act" href={cmUrl} target="_blank" rel="noopener noreferrer" title="Cardmarket page ↗" aria-label={`${c.name} — Cardmarket page`}>🛒</a> : null}
                          </div>
                        </td>
                      )
                    };
                    return <tr key={c.id}>{shownCols.map((col) => cell[col.key])}</tr>;
                  })}
                </tbody>
              </table>
            </div>
            {anyPrices ? (
              <p className="hint hint-small brw-pricenote">
                Cardmarket trend prices{pricedAsOf ? ` · ${pricedAsOf}` : ""} · {cards.length.toLocaleString()} loaded card{cards.length === 1 ? "" : "s"} total <b>{money(setValue)}</b>
                {hasMore ? " (so far)" : ""}
                {showing("marketPremium") ? <> · <b>{premiumLabel}</b> is {premiumHint.toLowerCase()}</> : null}
                {" "}· ⚠ marks a trend that doesn’t match the cheapest listing or the 30-day average — usually graded copies sold under the same product. Add the <b>Cheapest</b> and <b>30-day avg</b> columns to see why.
              </p>
            ) : null}
            {filtering ? (
              <p className="hint hint-small brw-filter-note">Filtering {cards.length.toLocaleString()} loaded card{cards.length === 1 ? "" : "s"}{hasMore ? " — load more to search the whole set." : "."}</p>
            ) : null}
            {hasMore ? (
              <div className="brw-more">
                <button className="btn btn-ghost" disabled={cardsLoading} onClick={() => openSet(set, page + 1)}>
                  {cardsLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
