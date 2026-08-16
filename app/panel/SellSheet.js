"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import {
  SHEET_FORMATS, CM_CONDITIONS, CM_LANGUAGES, getFormat, formatForGame, flagsForFormat,
  buildSheetCsv, sheetFilename, sheetNumber
} from "@/lib/sellsheet";

/**
 * Sell sheets — build the CSV that Cardmarket-family listing tools import.
 *
 * These sheets are keyed on Cardmarket's product id, which is what the card
 * catalogue is keyed on, so a whole set can be emitted with no manual
 * matching. Two ways to work: export the set as a blank TEMPLATE and fill the
 * quantities in a spreadsheet (how these are usually produced), or type
 * quantities here for a handful of cards and export just those.
 */

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ROW_LIMIT = 400; // keep the entry grid responsive; template export is unaffected

export default function SellSheet() {
  const [formatKey, setFormatKey] = useState(SHEET_FORMATS[0].key);
  const [games, setGames] = useState([]);
  const [game, setGame] = useState("");
  const [sets, setSets] = useState([]);
  const [setQuery, setSetQuery] = useState("");
  const [chosen, setChosen] = useState([]); // set names
  const [cards, setCards] = useState([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [entries, setEntries] = useState({}); // cardmarket_id -> { qty }
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");

  // Defaults applied to every exported row.
  const [condition, setCondition] = useState("NM");
  const [language, setLanguage] = useState("English");
  const [price, setPrice] = useState("0.2");
  // Optional per-format flags (foil / playset / signed / first ed / reverse holo).
  const [flags, setFlags] = useState({});

  const fmt = getFormat(formatKey);
  const fmtFlags = flagsForFormat(fmt);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalog/games").then((r) => r.json());
        if (!res.available) { setUnavailable(true); return; }
        setGames(res.games || []);
      } catch { setUnavailable(true); }
    })();
  }, []);

  async function pickGame(slug) {
    setGame(slug);
    setChosen([]);
    setCards([]);
    setEntries({});
    setSets([]);
    setFlags({});
    // Each game has its own column set, so follow it automatically.
    if (slug) setFormatKey(formatForGame(slug).key);
    if (!slug) return;
    setLoadingSets(true);
    try {
      const res = await fetch(`/api/catalog/sets?game=${encodeURIComponent(slug)}`).then((r) => r.json());
      setSets(res.sets || []);
    } catch { setSets([]); }
    setLoadingSets(false);
  }

  function toggleSet(name) {
    setChosen((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  // Load the singles in the chosen sets. Two exclusions, both deliberate:
  // tokens/code cards (category), and anything with no collector number —
  // that's how sealed bundles ("Origins: Epic Set") appear in the catalogue.
  // Checked against a real Riftbound export: this reproduces its row set
  // exactly, 352/352 for Origins and 302/302 for Spiritforged.
  async function loadCards() {
    if (!game || chosen.length === 0) return;
    setLoadingCards(true);
    setMsg("");
    const sb = createClient();
    const rows = await pagedSelect(() =>
      sb.from("card_catalog")
        .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,category")
        .eq("game", game)
        .in("expansion", chosen)
    );
    const real = rows.filter((r) => (r.category || "card") === "card" && String(r.collector_number || "").trim());
    real.sort((a, b) => {
      if (a.expansion !== b.expansion) return String(a.expansion).localeCompare(String(b.expansion));
      const na = parseInt(a.collector_number, 10), nb = parseInt(b.collector_number, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.collector_number || "").localeCompare(String(b.collector_number || ""), undefined, { numeric: true });
    });
    setCards(real);
    setLoadingCards(false);
  }

  const setQty = (id, v) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    setEntries((prev) => ({ ...prev, [id]: { qty: n } }));
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.collector_number || "").toLowerCase().includes(q)
    );
  }, [cards, filter]);

  const withQty = useMemo(() => cards.filter((c) => (entries[c.cardmarket_id]?.qty || 0) > 0), [cards, entries]);

  function download(onlyWithQty) {
    const items = cards.map((card) => ({
      card,
      entry: { qty: entries[card.cardmarket_id]?.qty || 0, condition, language, price, comment: "", ...flags }
    }));
    const csv = buildSheetCsv(items, formatKey, { onlyWithQty });
    const count = onlyWithQty ? withQty.length : items.length;
    if (count === 0) { setMsg("Nothing to export — enter a quantity on at least one card, or export the full template."); return; }
    const gameName = games.find((g) => g.slug === game)?.name || game;
    // The BOM is already in the string; a plain text/csv blob keeps it intact.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sheetFilename(gameName, chosen, todayStr());
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Exported ${count} row(s) for ${fmt.name}.`);
  }

  if (unavailable) {
    return (
      <div className="mine-banner">
        <span className="mine-ic" aria-hidden="true">⚠</span>
        <div>
          <strong>Card catalogue not loaded</strong>
          <p className="hint hint-small" style={{ marginTop: 4 }}>Sell sheets are built from the catalogue. Import it first (see <code>supabase/HEALTH_CHECK.sql</code> to check).</p>
        </div>
      </div>
    );
  }

  const filteredSets = sets.filter((s) => !setQuery.trim() || s.name.toLowerCase().includes(setQuery.trim().toLowerCase()));

  return (
    <div className="rise-group">
      <div className="panel">
        <div className="panel-head"><h3>Sell sheet</h3></div>
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          Builds the CSV your listing tool imports, straight from the catalogue — every row already
          carries the right Cardmarket product id, so nothing needs matching by hand.
        </p>

        <div className="ss-row">
          <label className="buy-field">
            <span>Format</span>
            <select value={formatKey} onChange={(e) => setFormatKey(e.target.value)}>
              {SHEET_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
            </select>
          </label>
          <label className="buy-field">
            <span>Game</span>
            <select value={game} onChange={(e) => pickGame(e.target.value)}>
              <option value="">Choose a game…</option>
              {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
            </select>
          </label>
        </div>
        <p className="hint hint-small">
          Columns follow the game — <code>{fmt.columns.join(", ")}</code>.
          {" "}UTF-8 with BOM, CRLF line endings.
          {!fmt.verified ? " ⚠ No example export for this game yet — send one and I'll pin the columns down." : ""}
        </p>
      </div>

      {game ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Sets {chosen.length ? `· ${chosen.length} selected` : ""}</span>
            {chosen.length ? <button className="btn btn-ghost" onClick={() => setChosen([])}>Clear</button> : null}
          </div>
          {loadingSets ? (
            <p className="hint hint-small"><span className="spinner" /> &nbsp;Loading sets…</p>
          ) : (
            <>
              <input className="pack-search" type="search" value={setQuery} onChange={(e) => setSetQuery(e.target.value)} placeholder={`Search ${sets.length} sets…`} aria-label="Search sets" />
              <div className="ss-sets">
                {filteredSets.slice(0, 200).map((s) => (
                  <button key={s.name} className={`stack-tab${chosen.includes(s.name) ? " on" : ""}`} onClick={() => toggleSet(s.name)}>
                    {s.name}
                    {s.code ? <span className="loose-set-code">{s.code}</span> : null}
                    <span className="stack-count">{s.cards}</span>
                  </button>
                ))}
                {filteredSets.length > 200 ? <span className="hint-small">…{filteredSets.length - 200} more — narrow the search</span> : null}
              </div>
              <button className="btn btn-primary" onClick={loadCards} disabled={chosen.length === 0 || loadingCards} style={{ marginTop: 12 }}>
                {loadingCards ? "Loading cards…" : `Load ${chosen.length || 0} set(s)`}
              </button>
            </>
          )}
        </div>
      ) : null}

      {cards.length > 0 ? (
        <>
          <div className="panel">
            <div className="panel-head"><span className="eyebrow">Applies to every row</span></div>
            <div className="ss-row">
              <label className="buy-field">
                <span>Condition</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CM_CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </select>
              </label>
              <label className="buy-field">
                <span>Language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {CM_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="buy-field">
                <span>Price</span>
                <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
              {fmtFlags.map((fl) => (
                <label className="sd-toggle" key={fl.key} style={{ alignSelf: "end", paddingBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={!!flags[fl.key]}
                    onChange={(e) => setFlags((p) => ({ ...p, [fl.key]: e.target.checked }))}
                  />
                  {fl.label}
                </label>
              ))}
            </div>
            <div className="ps-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => download(false)}>
                ⤓ Export template ({cards.length} rows)
              </button>
              <button className="btn btn-ghost" onClick={() => download(true)} disabled={withQty.length === 0}>
                ⤓ Export counted only ({withQty.length})
              </button>
            </div>
            <p className="hint hint-small">
              <b>Template</b> = every card with blank quantities, to fill in a spreadsheet.
              <b> Counted only</b> = just the cards you've given a quantity below.
            </p>
            {msg ? <p className="hint hint-small" style={{ color: "var(--conf-high)" }}>{msg}</p> : null}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Cards</h3>
              <span className="badge2">{withQty.length} counted</span>
            </div>
            <input className="pack-search" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or number…" aria-label="Filter cards" />
            {visible.length > ROW_LIMIT ? (
              <p className="hint hint-small">Showing the first {ROW_LIMIT} of {visible.length} — filter to narrow, or use the template export for the full set.</p>
            ) : null}
            <div className="table-wrap">
              <table className="itbl">
                <thead>
                  <tr><th>No</th><th>Name</th><th>Set</th><th>Rarity</th><th style={{ width: 90 }}>Qty</th></tr>
                </thead>
                <tbody>
                  {visible.slice(0, ROW_LIMIT).map((c) => (
                    <tr key={c.cardmarket_id}>
                      <td className="mono">{sheetNumber(c.collector_number)}</td>
                      <td className="itbl-title">{c.name}</td>
                      <td>{c.expansion}</td>
                      <td className="muted">{c.rarity || "—"}</td>
                      <td>
                        <input
                          className="ss-qty"
                          type="number"
                          min="0"
                          value={entries[c.cardmarket_id]?.qty || ""}
                          onChange={(e) => setQty(c.cardmarket_id, e.target.value)}
                          aria-label={`Quantity for ${c.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
