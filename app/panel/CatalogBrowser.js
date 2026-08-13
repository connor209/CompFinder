"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Browse the catalog by expansion (set) and pick a card manually. Type to find
 * a set, select it, then click a card to deep-dive it. onPick receives a card
 * shaped like a typeahead suggestion ({ name, number, set, series }).
 */
export default function CatalogBrowser({ onPick, onClose }) {
  const [expQ, setExpQ] = useState("");
  const [exps, setExps] = useState([]);
  const [expLoading, setExpLoading] = useState(false);
  const [sel, setSel] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [available, setAvailable] = useState(true);
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    if (expQ.trim().length < 2) {
      setExps([]);
      return;
    }
    debRef.current = setTimeout(async () => {
      setExpLoading(true);
      try {
        const res = await fetch(`/api/catalog/expansions?q=${encodeURIComponent(expQ.trim())}`).then((r) => r.json());
        setAvailable(res.available !== false);
        setExps(res.expansions || []);
      } catch {
        setExps([]);
      }
      setExpLoading(false);
    }, 220);
    return () => clearTimeout(debRef.current);
  }, [expQ]);

  async function selectExpansion(exp) {
    setSel(exp);
    setCards([]);
    setCardsLoading(true);
    try {
      const res = await fetch(`/api/catalog/cards?expansion=${encodeURIComponent(exp.name)}`).then((r) => r.json());
      setCards(res.cards || []);
    } catch {
      setCards([]);
    }
    setCardsLoading(false);
  }

  return (
    <div className="panel brw">
      <div className="panel-head">
        <span className="eyebrow">Browse by set</span>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>

      {!sel ? (
        <>
          <div className="dd-inp brw-inp">
            <span className="mag" aria-hidden="true">🔍</span>
            <input value={expQ} onChange={(e) => setExpQ(e.target.value)} placeholder="Find a set — e.g. Base, Obsidian, Korean…" aria-label="Find a set" autoFocus />
          </div>
          {!available ? (
            <p className="hint hint-small">Catalog not loaded yet — import the card_catalog data to browse.</p>
          ) : expLoading ? (
            <p className="hint hint-small"><span className="spinner" /> &nbsp;Searching sets…</p>
          ) : expQ.trim().length < 2 ? (
            <p className="hint hint-small">Type at least two letters to find a set.</p>
          ) : exps.length === 0 ? (
            <p className="hint hint-small">No sets match “{expQ}”.</p>
          ) : (
            <div className="brw-exps">
              {exps.map((e) => (
                <button key={e.name} className="brw-exp" onClick={() => selectExpansion(e)}>
                  <span className="brw-exp-name">{e.name}</span>
                  <span className="brw-exp-meta">
                    {e.code ? <span className="brw-code">{e.code}</span> : null}
                    {e.language !== "English" ? <span className="badge2 badge-lang">{e.language}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="brw-sel">
            <button className="btn btn-ghost" onClick={() => { setSel(null); setCards([]); }}>← Sets</button>
            <div className="brw-sel-name">{sel.name}{sel.language !== "English" ? <span className="badge2 badge-lang" style={{ marginLeft: 8 }}>{sel.language}</span> : null}</div>
          </div>
          {cardsLoading ? (
            <p className="hint hint-small"><span className="spinner" /> &nbsp;Loading cards…</p>
          ) : cards.length === 0 ? (
            <p className="hint hint-small">No cards found for this set.</p>
          ) : (
            <div className="brw-cards">
              {cards.map((c) => (
                <button
                  key={c.id}
                  className="brw-card"
                  onClick={() => onPick({ name: c.name, number: c.number, set: sel.name, series: sel.code, rarity: c.rarity, image: null })}
                >
                  <span className="brw-card-no">{c.number || "—"}</span>
                  <span className="brw-card-name">{c.name}</span>
                  {c.rarity ? <span className="brw-card-rar">{c.rarity}</span> : null}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
