"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import {
  SHEET_FORMATS, CM_CONDITIONS, CM_LANGUAGES, FLAG_COLUMNS,
  getFormat, formatForGame, flagsForFormat,
  buildSheetCsv, sheetFilename, sheetNumber
} from "@/lib/sellsheet";
import {
  EBAY_DEFAULTS, CONDITION_IDS, buildEbayVariationCsv, variationValue
} from "@/lib/ebayvariation";

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
  const [target, setTarget] = useState("cardmarket"); // cardmarket | ebay
  const [ebay, setEbay] = useState(EBAY_DEFAULTS);
  const [ebayOpen, setEbayOpen] = useState(false);
  const [rarityPrice, setRarityPrice] = useState({});
  const profileSettings = useRef({});

  // Defaults applied to every exported row.
  const [condition, setCondition] = useState("NM");
  const [language, setLanguage] = useState("English");
  const [price, setPrice] = useState("0.2");
  // Optional per-format flags (foil / playset / signed / first ed / reverse holo).
  const [flags, setFlags] = useState({});

  const fmt = getFormat(formatKey);
  // The "premium" variant differs by game — Magic/Lorcana/DBZ/Riftbound call it
  // foil, Pokémon calls it reverse holo. Whichever the format has becomes a
  // SECOND quantity column, since one card can be listed both ways; the rest
  // of the flags stay as whole-export defaults.
  // Only for Cardmarket sheets: an eBay variation listing is all one finish
  // (the title says so), so a second count column there would mislead.
  const foilCol = target === "cardmarket"
    ? fmt.columns.find((c) => c === "isFoil" || c === "isReverseHolo") || null
    : null;
  const foilMeta = foilCol ? FLAG_COLUMNS[foilCol] : null;
  const fmtFlags = flagsForFormat(fmt).filter((f) => f.column !== foilCol);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalog/games").then((r) => r.json());
        if (!res.available) { setUnavailable(true); return; }
        setGames(res.games || []);
      } catch { setUnavailable(true); }
      // Listing boilerplate (location, policies, description…) is the same
      // every time, so it's stored once rather than retyped.
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const { data: profile } = await sb.from("profiles").select("settings").eq("id", user.id).single();
        profileSettings.current = profile?.settings || {};
        if (profile?.settings?.ebayVariation) setEbay((p) => ({ ...p, ...profile.settings.ebayVariation }));
      } catch { /* defaults are fine */ }
    })();
  }, []);

  async function saveEbaySettings() {
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      // Title and set name change per listing — everything else is boilerplate.
      const { title, setName, setSize, ...keep } = ebay;
      const next = { ...profileSettings.current, ebayVariation: keep };
      profileSettings.current = next;
      await sb.from("profiles").update({ settings: next }).eq("id", user.id);
      setMsg("Listing settings saved — they'll be prefilled next time.");
    } catch (e) { setMsg(e.message || "Couldn't save settings."); }
  }
  const setEbayField = (k, v) => setEbay((p) => ({ ...p, [k]: v }));

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
    // Seed the rarity price table and the eBay set fields from what loaded.
    const rarities = [...new Set(real.map((r) => r.rarity).filter(Boolean))];
    setRarityPrice((prev) => Object.fromEntries(rarities.map((r) => [r, prev[r] ?? ""])));
    const first = real[0];
    setEbay((p) => ({
      ...p,
      setName: p.setName || chosen[0] || "",
      setCode: p.setCode || first?.expansion_code || "",
      setSize: p.setSize || String(real.length)
    }));
    setLoadingCards(false);
  }

  const setQty = (id, field, v) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], [field]: n } }));
  };

  /**
   * Counting a set means running down one column, so Down (and Enter) moves to
   * the SAME box one row lower rather than scrolling the page — and on a number
   * input it would otherwise decrement the value, which is worse than useless
   * here. Up goes back; Tab still steps sideways as normal.
   */
  function onCellKey(e, rowIdx, col) {
    const dir = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = document.querySelector(`[data-cell="${rowIdx + dir}-${col}"]`);
    if (next) { next.focus(); next.select(); }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      String(c.name || "").toLowerCase().includes(q) ||
      String(c.collector_number || "").toLowerCase().includes(q)
    );
  }, [cards, filter]);

  // A card counted in both boxes becomes two listings, so count rows not cards.
  const countedRows = useMemo(() => {
    let n = 0;
    for (const c of cards) {
      const e = entries[c.cardmarket_id] || {};
      if ((e.qty || 0) > 0) n += 1;
      if (foilCol && (e.foilQty || 0) > 0) n += 1;
    }
    return n;
  }, [cards, entries, foilCol]);

  // ---- eBay variation listing ------------------------------------------
  // One listing, one row per card. Zero-stock cards stay in as greyed-out
  // variations, so only cards you deliberately leave out are excluded.
  function downloadEbay(onlyCounted) {
    const source = onlyCounted
      ? cards.filter((c) => (entries[c.cardmarket_id]?.qty || 0) > 0)
      : cards;
    if (source.length === 0) { setMsg("No cards to list."); return; }
    if (!ebay.title.trim()) { setMsg("Give the listing a title first."); return; }
    const items = source.map((card) => ({ card, qty: entries[card.cardmarket_id]?.qty || 0 }));
    const { csv, rows } = buildEbayVariationCsv(
      items,
      (card) => rarityPrice[card.rarity] || price,
      ebay,
      Date.now()
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sheetFilename("eBay-variation", [ebay.setName || chosen[0] || "set"], todayStr());
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Exported an eBay variation listing — 1 parent + ${rows - 1} variations.`);
  }

  function download(onlyWithQty) {
    const base = { condition, language, price, comment: "", ...flags };
    const items = [];
    for (const card of cards) {
      const e = entries[card.cardmarket_id] || {};
      // Standard row. The template is one row per card (matching a real
      // export); foil rows only appear once you've actually counted some.
      items.push({ card, entry: { ...base, qty: e.qty || 0, ...(foilCol ? { [foilMeta.key]: false } : {}) } });
      if (foilCol && (e.foilQty || 0) > 0) {
        items.push({ card, entry: { ...base, qty: e.foilQty, [foilMeta.key]: true } });
      }
    }
    const csv = buildSheetCsv(items, formatKey, { onlyWithQty });
    const count = onlyWithQty ? countedRows : cards.length;
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

        <div className="pills" role="group" aria-label="Destination" style={{ marginBottom: 12 }}>
          <button aria-pressed={target === "cardmarket"} onClick={() => setTarget("cardmarket")}>Cardmarket tools</button>
          <button aria-pressed={target === "ebay"} onClick={() => setTarget("ebay")}>eBay variation listing</button>
        </div>

        <div className="ss-row">
          {target === "cardmarket" ? (
            <label className="buy-field">
              <span>Format</span>
              <select value={formatKey} onChange={(e) => setFormatKey(e.target.value)}>
                {SHEET_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="buy-field">
            <span>Game</span>
            <select value={game} onChange={(e) => pickGame(e.target.value)}>
              <option value="">Choose a game…</option>
              {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
            </select>
          </label>
        </div>
        {target === "cardmarket" ? (
          <p className="hint hint-small">
            Columns follow the game — <code>{fmt.columns.join(", ")}</code>.
            {" "}UTF-8 with BOM, CRLF line endings.
            {!fmt.verified ? " ⚠ No example export for this game yet — send one and I'll pin the columns down." : ""}
          </p>
        ) : (
          <p className="hint hint-small">
            One eBay File Exchange listing: a parent row plus a variation per card, priced by
            rarity. Matches the <code>fx_category_template_EBAY_GB</code> layout exactly.
          </p>
        )}
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
          {target === "ebay" ? (
            <div className="panel">
              <div className="panel-head">
                <span className="eyebrow">Listing</span>
                <button className="btn btn-ghost" onClick={() => setEbayOpen((v) => !v)}>
                  {ebayOpen ? "Hide settings" : "Listing settings…"}
                </button>
              </div>
              <div className="ss-row">
                <label className="buy-field" style={{ flex: "1 1 100%" }}>
                  <span>Title <span className="buy-opt">(80 chars max on eBay)</span></span>
                  <input type="text" maxLength={80} value={ebay.title}
                    onChange={(e) => setEbayField("title", e.target.value)}
                    placeholder="e.g. Perfect Order Reverse Holo Mix &amp; Match - BUY 5 GET 5 FREE - Pokemon TCG" />
                </label>
                <label className="buy-field">
                  <span>Set name <span className="buy-opt">(C:Set)</span></span>
                  <input type="text" value={ebay.setName || ""} onChange={(e) => setEbayField("setName", e.target.value)} />
                </label>
                <label className="buy-field">
                  <span>Set size <span className="buy-opt">— the /88</span></span>
                  <input type="number" min="1" value={ebay.setSize || ""} onChange={(e) => setEbayField("setSize", e.target.value)} />
                </label>
                <label className="buy-field">
                  <span>Variation label</span>
                  <input type="text" value={ebay.variationLabel} onChange={(e) => setEbayField("variationLabel", e.target.value)} />
                </label>
              </div>

              <div className="ss-row">
                <label className="buy-field" style={{ flex: "1 1 320px" }}>
                  <span>Gallery photo URL <span className="buy-opt">(the listing's main image)</span></span>
                  <input type="url" value={ebay.parentImageUrl} onChange={(e) => setEbayField("parentImageUrl", e.target.value)} placeholder="https://…" />
                </label>
                <label className="buy-field" style={{ flex: "1 1 320px" }}>
                  <span>Card image URL template <span className="buy-opt">— per variation</span></span>
                  <input type="text" value={ebay.imageTemplate} onChange={(e) => setEbayField("imageTemplate", e.target.value)}
                    placeholder="https://…/{setcode}_en_{num3}_std.jpg" />
                </label>
              </div>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                Template tokens: <code>{"{num}"}</code> as printed, <code>{"{num2}"}</code>/<code>{"{num3}"}</code> zero-padded,
                {" "}<code>{"{setcode}"}</code>, <code>{"{setcode_lower}"}</code>, <code>{"{name}"}</code>.
                {" "}Set code for this set: <b>{ebay.setCode || "—"}</b>. Leave blank to let every variation use the gallery photo.
              </p>

              {ebayOpen ? (
                <>
                  <div className="ss-row" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
                    <label className="buy-field"><span>Category ID</span>
                      <input type="text" value={ebay.categoryId} onChange={(e) => setEbayField("categoryId", e.target.value)} /></label>
                    <label className="buy-field" style={{ flex: "1 1 260px" }}><span>Category name</span>
                      <input type="text" value={ebay.categoryName} onChange={(e) => setEbayField("categoryName", e.target.value)} /></label>
                    <label className="buy-field"><span>Condition</span>
                      <select value={ebay.conditionId} onChange={(e) => setEbayField("conditionId", e.target.value)}>
                        {CONDITION_IDS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select></label>
                    <label className="buy-field" style={{ flex: "1 1 220px" }}><span>Card condition descriptor</span>
                      <input type="text" value={ebay.cardCondition} onChange={(e) => setEbayField("cardCondition", e.target.value)} /></label>
                  </div>
                  <div className="ss-row">
                    <label className="buy-field"><span>Franchise</span>
                      <input type="text" value={ebay.franchise} onChange={(e) => setEbayField("franchise", e.target.value)} placeholder="Pokémon" /></label>
                    <label className="buy-field"><span>TV show <span className="buy-opt">(optional)</span></span>
                      <input type="text" value={ebay.tvShow} onChange={(e) => setEbayField("tvShow", e.target.value)} placeholder="Pokemon" /></label>
                    <label className="buy-field"><span>Location</span>
                      <input type="text" value={ebay.location} onChange={(e) => setEbayField("location", e.target.value)} placeholder="Town,County" /></label>
                    <label className="buy-field"><span>Dispatch days</span>
                      <input type="number" min="0" value={ebay.dispatchDays} onChange={(e) => setEbayField("dispatchDays", e.target.value)} /></label>
                  </div>
                  <div className="ss-row">
                    <label className="buy-field" style={{ flex: "1 1 260px" }}><span>Shipping service</span>
                      <input type="text" value={ebay.shippingService} onChange={(e) => setEbayField("shippingService", e.target.value)} /></label>
                    <label className="buy-field"><span>Shipping cost</span>
                      <input type="number" min="0" step="0.01" value={ebay.shippingCost} onChange={(e) => setEbayField("shippingCost", e.target.value)} /></label>
                    <label className="buy-field"><span>Returns within</span>
                      <input type="text" value={ebay.returnsWithin} onChange={(e) => setEbayField("returnsWithin", e.target.value)} /></label>
                    <label className="buy-field"><span>Return postage</span>
                      <select value={ebay.returnShippingPaidBy} onChange={(e) => setEbayField("returnShippingPaidBy", e.target.value)}>
                        <option value="Seller">Seller</option><option value="Buyer">Buyer</option>
                      </select></label>
                  </div>
                  <label className="buy-field buy-desc">
                    <span>Description HTML</span>
                    <textarea rows={4} value={ebay.description} onChange={(e) => setEbayField("description", e.target.value)}
                      placeholder="Paste the HTML description used on your listings" />
                  </label>
                  <button className="btn btn-ghost" onClick={saveEbaySettings} style={{ marginTop: 10 }}>Save these settings</button>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">{target === "ebay" ? "Price by rarity" : "Applies to every row"}</span>
            </div>
            {target === "ebay" ? (
              <>
                <div className="ss-row">
                  {Object.keys(rarityPrice).sort().map((r) => (
                    <label className="buy-field" key={r} style={{ flex: "0 1 150px" }}>
                      <span>{r}</span>
                      <input type="number" min="0" step="0.01" value={rarityPrice[r]}
                        onChange={(e) => setRarityPrice((p) => ({ ...p, [r]: e.target.value }))}
                        placeholder={price} />
                    </label>
                  ))}
                </div>
                <p className="hint hint-small" style={{ marginTop: 0 }}>
                  Each rarity in this set gets its own price. Blank falls back to the default below ({price}).
                </p>
              </>
            ) : null}
            <div className="ss-row">
              {target === "cardmarket" ? (
                <>
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
                </>
              ) : null}
              <label className="buy-field">
                <span>{target === "ebay" ? "Fallback price" : "Price"}</span>
                <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
              {(target === "cardmarket" ? fmtFlags : []).map((fl) => (
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
              {target === "ebay" ? (
                <>
                  <button className="btn btn-primary" onClick={() => downloadEbay(false)}>
                    ⤓ Export listing ({cards.length} variations)
                  </button>
                  <button className="btn btn-ghost" onClick={() => downloadEbay(true)} disabled={countedRows === 0}>
                    ⤓ Only cards in stock ({cards.filter((c) => (entries[c.cardmarket_id]?.qty || 0) > 0).length})
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={() => download(false)}>
                    ⤓ Export template ({cards.length} rows)
                  </button>
                  <button className="btn btn-ghost" onClick={() => download(true)} disabled={countedRows === 0}>
                    ⤓ Export counted only ({countedRows})
                  </button>
                </>
              )}
            </div>
            <p className="hint hint-small">
              {target === "ebay" ? (
                <>Every card becomes a variation; zero-stock ones stay in the listing greyed out, ready to restock.
                  {" "}First variation reads <code>{cards[0] ? `${ebay.variationLabel}=${variationValue(cards[0], ebay.setSize)}` : ""}</code>.</>
              ) : (
                <><b>Template</b> = every card with blank quantities, to fill in a spreadsheet.
                  <b> Counted only</b> = just the cards you&apos;ve given a quantity below.</>
              )}
            </p>
            {msg ? <p className="hint hint-small" style={{ color: "var(--conf-high)" }}>{msg}</p> : null}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Cards</h3>
              <span className="badge2">{countedRows} row{countedRows === 1 ? "" : "s"} counted</span>
            </div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>
              {foilCol
                ? <>Count normals in <b>Qty</b> and {foilMeta.label.toLowerCase()}s in the second box — a card with both exports as two listings. </>
                : null}
              <b>↓</b> / <b>Enter</b> moves to the same box in the next row, <b>↑</b> back up.
            </p>
            <input className="pack-search" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or number…" aria-label="Filter cards" />
            {visible.length > ROW_LIMIT ? (
              <p className="hint hint-small">Showing the first {ROW_LIMIT} of {visible.length} — filter to narrow, or use the template export for the full set.</p>
            ) : null}
            <div className="table-wrap">
              <table className="itbl">
                <thead>
                  <tr>
                    <th>No</th><th>Name</th><th>Set</th><th>Rarity</th>
                    <th style={{ width: 90 }}>Qty</th>
                    {foilCol ? <th style={{ width: 100 }}>{foilMeta.label}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, ROW_LIMIT).map((c, i) => (
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
                          data-cell={`${i}-qty`}
                          value={entries[c.cardmarket_id]?.qty || ""}
                          onChange={(e) => setQty(c.cardmarket_id, "qty", e.target.value)}
                          onKeyDown={(e) => onCellKey(e, i, "qty")}
                          aria-label={`Quantity for ${c.name}`}
                        />
                      </td>
                      {foilCol ? (
                        <td>
                          <input
                            className="ss-qty ss-qty-foil"
                            type="number"
                            min="0"
                            data-cell={`${i}-foil`}
                            value={entries[c.cardmarket_id]?.foilQty || ""}
                            onChange={(e) => setQty(c.cardmarket_id, "foilQty", e.target.value)}
                            onKeyDown={(e) => onCellKey(e, i, "foil")}
                            aria-label={`${foilMeta.label} quantity for ${c.name}`}
                          />
                        </td>
                      ) : null}
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
