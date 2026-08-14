"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Browse — explore the whole card catalogue across every supported game:
 * Games → Sets → Cards. Click a card to deep-dive it in Quick Search (prices
 * it live). Real cards show by default; tokens/code/oversized/tip are hidden
 * behind the "extras" toggle. Data comes from the card_catalog table (the
 * Cardmarket exports) via /api/catalog/*.
 */
const CATEGORY_LABEL = { token: "Token", code: "Code card", oversized: "Oversized", tip: "Tip card" };

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
    if (!q) return cards;
    return cards.filter((c) => c.name.toLowerCase().includes(q) || String(c.number).toLowerCase().includes(q));
  }, [cards, cardQ]);

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
        </div>

        {cardsLoading && cards.length === 0 ? (
          <p className="hint hint-small"><span className="spinner" /> &nbsp;Loading cards…</p>
        ) : cardsError && cards.length === 0 ? (
          <p className="hint hint-small">Couldn’t load cards — <button className="brw-retry" onClick={() => openSet(set, 0)}>try again</button>.</p>
        ) : filteredCards.length === 0 ? (
          <p className="hint hint-small">{filtering ? `No loaded cards match “${cardQ}”.${hasMore ? " Load more below to search the rest." : ""}` : "No cards found in this set."}</p>
        ) : (
          <>
            <div className="brw-cards">
              {filteredCards.map((c) => (
                <button
                  key={c.id}
                  className="brw-card"
                  title={onDeepDive ? "Price this card in Quick Search" : c.name}
                  onClick={() =>
                    onDeepDive &&
                    onDeepDive(`${c.name} ${c.number}`.trim(), {
                      game: game.slug,
                      card: { name: c.name, number: c.number, set: set.name, series: set.code, rarity: c.rarity, image: null }
                    })
                  }
                >
                  <span className="brw-card-no">{c.number || "—"}</span>
                  <span className="brw-card-name">{c.name}</span>
                  <span className="brw-card-tags">
                    {c.category !== "card" ? <span className="brw-card-cat">{CATEGORY_LABEL[c.category] || c.category}</span> : null}
                    {c.rarity ? <span className="brw-card-rar">{c.rarity}</span> : null}
                  </span>
                </button>
              ))}
            </div>
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
