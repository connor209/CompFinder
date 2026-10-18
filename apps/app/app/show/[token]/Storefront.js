"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  STOREFRONT_SORTS,
  DEFAULT_STOREFRONT_SORT,
  STOREFRONT_PRICE_FILTERS,
  SECTION_LABELS,
  SHOP_SECTION_LABELS,
  searchQueryString,
  isSearching,
  BOX,
  ONLINE
} from "@/lib/storefront.js";
import { UNKNOWN_GAME } from "@/lib/games.js";
import { counterPrice } from "@/lib/showcounter.js";
import {
  hasWish, toggleWish, removeWish, reconcileWishlist, wishKey,
  loadWishlist, saveWishlist, wishStorageKey, WISHLIST_MAX,
  wishCodes, wishHandoffUrl
} from "@/lib/wishlist.js";
import { qrPath } from "@/lib/qr.js";

/** How long typing pauses before the search goes. Short: it is one cheap request. */
const SEARCH_DELAY_MS = 250;

/**
 * Our stock, on a visitor's own phone.
 *
 * It opens on our dearest cards (`landing`, built on the server) and the
 * search box drives everything after that: each search asks ./search for one
 * page of matching cards, already projected. It used to be the Show Desk's
 * binder, which needed the whole inventory in the browser to page through —
 * thousands of cards in the first load, which is what made the QR slow.
 *
 * This file imports no database client and nothing from the desk: everything
 * it can show arrived as projected cards, which is what makes "a stranger
 * cannot see our shelf addresses" a fact about the payload rather than about
 * this markup. Its one request is the search, built by searchQueryString(),
 * which carries the search and nothing else.
 *
 * What it adds is the visitor's own list (lib/wishlist.js): ♡ on the cards
 * they like, and one screen to show us at the table. It is kept on their
 * phone and never sent anywhere — so it is matched against the cards this
 * visit has SEEN, and a card not among them keeps its saved price.
 *
 * The two sections — at the table, and in stock at home — are never merged:
 * results come one section then the other, each under its own heading. A
 * SHOP link (storefront.shop) is the same page for somebody who is not at our
 * table, with the stock at home first.
 */
export default function Storefront({ storefront, landing }) {
  const featured = landing?.featured || [];
  const facets = landing?.facets || { games: [], sets: {}, conditions: [] };
  const total = (landing?.box || 0) + (landing?.online || 0);
  const shop = Boolean(storefront?.shop);
  const labels = shop ? SHOP_SECTION_LABELS : SECTION_LABELS;
  const [q, setQ] = useState("");
  const [game, setGame] = useState("");
  const [set, setSet] = useState("");
  const [price, setPrice] = useState("any");
  const [condition, setCondition] = useState("");
  const [sort, setSort] = useState(DEFAULT_STOREFRONT_SORT);
  const [browse, setBrowse] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(featured);
  const [open, setOpen] = useState(null);
  const [wish, setWish] = useState([]);
  const [showList, setShowList] = useState(false);
  const [note, setNote] = useState("");
  const storeKey = useRef("");
  const searchSeq = useRef(0);

  // A set only means something inside a game. With one game in stock there is
  // nothing to choose, and its sets are offered straight away.
  const soleGame = facets.games.length === 1 ? facets.games[0].slug : "";
  const setGameKey = game || soleGame;
  const gameSets = setGameKey ? facets.sets[setGameKey] || [] : [];
  const criteria = { query: q, game: game || (set ? soleGame : ""), set, price, condition, sort };
  const searching = browse || isSearching(criteria);

  // The list is read after mount: localStorage does not exist on the server,
  // and reading it during render would hydrate differently from the HTML.
  useEffect(() => {
    storeKey.current = wishStorageKey(window.location.pathname);
    setWish(loadWishlist(window.localStorage, storeKey.current));
  }, []);
  function updateWish(next) {
    setWish(next);
    if (storeKey.current) saveWishlist(window.localStorage, storeKey.current, next);
  }
  function toggle(card) {
    const r = toggleWish(wish, card);
    if (r.full) { setNote(`Your list is full at ${WISHLIST_MAX} cards — show us what you've got so far.`); return; }
    setNote("");
    updateWish(r.list);
  }

  // Every card this visit has been shown, newest answer first, for the list
  // to match against. Keyed on what the card IS, like the list itself.
  function remember(cards) {
    setSeen((cur) => {
      const byId = new Map(cur.map((c) => [wishKey(c), c]));
      for (const c of cards || []) byId.set(wishKey(c), c);
      return [...byId.values()];
    });
  }

  async function runSearch(offset) {
    const seq = ++searchSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${window.location.pathname.replace(/\/+$/, "")}/search?${searchQueryString(criteria, offset)}`, { cache: "no-store", referrerPolicy: "no-referrer" });
      const body = await res.json();
      if (seq !== searchSeq.current) return;
      if (!res.ok || !body?.ok) { setFailed(true); return; }
      remember(body.cards);
      setResults((cur) => (offset > 0 && cur ? { ...body, cards: [...cur.cards, ...body.cards] } : body));
    } catch {
      if (seq === searchSeq.current) setFailed(true);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }

  // A new search starts from the top. Typing waits for a pause; everything
  // else goes at once.
  const criteriaKey = searchQueryString(criteria);
  useEffect(() => {
    if (!searching) { searchSeq.current++; setResults(null); setLoading(false); setFailed(false); return undefined; }
    const t = setTimeout(() => runSearch(0), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
    // runSearch reads the criteria this key was built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKey, searching]);

  const list = useMemo(() => reconcileWishlist(wish, seen, { complete: false }), [wish, seen]);
  // The QR our phone scans: the list itself, in the URL, opening the desk.
  // Nothing is sent anywhere — it is drawn here and read off this screen.
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const handoff = useMemo(() => {
    const codes = wishCodes(list.rows);
    if (!origin || codes.length === 0) return null;
    return qrPath(wishHandoffUrl(origin, codes));
  }, [origin, list.rows]);

  function clearFilters() {
    setQ(""); setGame(""); setSet(""); setPrice("any"); setCondition(""); setBrowse(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { setOpen(null); setShowList(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = storefront?.title || "Our stock";
  const updated = storefront?.at
    ? new Date(storefront.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;
  const totalText = list.totalPence > 0 ? `${list.totalFrom ? "from " : ""}${counterPrice(list.totalPence)}` : null;
  const shown = searching ? results?.cards || [] : featured;

  function pocket(c) {
    return (
      <button
        className={c.source === ONLINE ? "bn-pocket bn-card bn-card-online" : "bn-pocket bn-card"}
        key={c.key}
        onClick={() => setOpen(c)}
        title={`${c.name} — ${c.priceText}`}
      >
        {c.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="bn-art" src={c.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          /* An empty sleeve rather than catalogue art: a mint scan of a
             played card is a promise about the copy we'd hand over. */
          <span className="bn-art bn-noart" aria-hidden="true">no photo</span>
        )}
        {hasWish(wish, c) ? <span className="sf-heart" aria-label="On your list">♥</span> : null}
        {/* The flag marks the section that is NOT the visitor's: "ask" at
            the table, "at a show" in the shop. */}
        {shop && c.source === BOX ? (
          <span className="bn-copies bn-flag">{c.count > 1 ? `at a show ×${c.count}` : "at a show"}</span>
        ) : !shop && c.source === ONLINE ? (
          <span className="bn-copies bn-flag">{c.count > 1 ? `ask ×${c.count}` : "ask"}</span>
        ) : c.count > 1 ? (
          <span className="bn-copies">×{c.count}</span>
        ) : null}
        <span className="bn-label">
          <span className="bn-name">{c.name}</span>
          <span className={c.pricePence == null ? "bn-price bn-price-ask" : "bn-price"}>
            {c.priceFrom ? "from " : ""}{c.priceText}
          </span>
        </span>
      </button>
    );
  }

  // One grid per run of a section, under that section's heading, so a card
  // that may be at home never sits unlabelled beside one on the table.
  function sections(cards) {
    const runs = [];
    for (const c of cards) {
      if (!runs.length || runs[runs.length - 1].source !== c.source) runs.push({ source: c.source, cards: [] });
      runs[runs.length - 1].cards.push(c);
    }
    return runs.map((r, i) => (
      <section className="sf-results" key={`${r.source}-${i}`}>
        <div className={r.source === ONLINE ? "bn-section bn-section-online" : "bn-section"}>
          <span className="eyebrow">{labels[r.source]?.title}</span>
          <span className="hint-small">{labels[r.source]?.note}</span>
        </div>
        <div className="sf-grid">{r.cards.map(pocket)}</div>
      </section>
    ));
  }

  return (
    <main className={list.count > 0 ? "sf-shell sf-shell-listed" : "sf-shell"}>
      <header className="sf-head">
        <h1 className="sf-title">{title}</h1>
        <p className="hint sf-lede">
          {shop
            ? "Search for a card, tap ♡ on anything you like, and show us your list — at a show, or send us a screenshot."
            : "Search for a card, tap ♡ on anything you like, then show us your list at the table."}
        </p>
      </header>

      {total === 0 ? (
        <p className="dd-empty bn-blank">{shop ? "Nothing to show just yet — check back soon." : "Nothing to show just yet — ask at the table."}</p>
      ) : (
        <>
          <div className="sd-find">
            <div className="dd-inp sd-find-inp">
              <span className="mag" aria-hidden="true">⌕</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search — name, number or set"
                aria-label="Search the stock"
                enterKeyHint="search"
              />
              {q ? <button className="sd-clear" onClick={() => setQ("")} aria-label="Clear the search">×</button> : null}
            </div>
          </div>
          {/* Built from the cards themselves, so an option that finds nothing
              is never offered, and a filter with one choice is not a filter. */}
          <div className="sf-filters">
            {facets.games.length > 1 ? (
              <select className="sd-select" value={game} onChange={(e) => { setGame(e.target.value); setSet(""); }} aria-label="Game">
                <option value="">All games</option>
                {facets.games.map((g) => (
                  <option key={g.slug} value={g.slug}>{g.slug === UNKNOWN_GAME ? "Other cards" : g.name} ({g.count})</option>
                ))}
              </select>
            ) : null}
            {gameSets.length > 1 ? (
              <select className="sd-select" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Set">
                <option value="">All sets</option>
                {gameSets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
              </select>
            ) : null}
            <select className="sd-select" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price">
              {STOREFRONT_PRICE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {facets.conditions.length > 1 ? (
              <select className="sd-select" value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="Condition">
                <option value="">Any condition</option>
                {facets.conditions.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            ) : null}
            {searching ? (
              <select className="sd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">
                {STOREFRONT_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            ) : null}
            {searching ? (
              <button className="sd-clear-all" onClick={clearFilters}>Clear</button>
            ) : null}
          </div>

          {searching ? (
            <p className="hint hint-small sf-count" aria-live="polite">
              {failed
                ? "Couldn't search just now — venue wifi, probably. Try again in a moment."
                : results == null || (loading && !results)
                  ? "Searching…"
                  : results.shown === 0
                    ? (shop ? "Nothing matches that — ask us, we may still have one." : "Nothing matches that — ask at the table, we may still have one.")
                    : `${results.shown} card${results.shown === 1 ? "" : "s"}${shop
                        ? ` · ${results.online} in stock${results.box ? ` · ${results.box} out at a show` : ""}`
                        : ` · ${results.box} at the table${results.online ? ` · ${results.online} more in stock` : ""}`}`}
            </p>
          ) : (
            <div className="sf-featured-head">
              <span className="eyebrow">Our top cards</span>
              <button className="sd-clear-all" onClick={() => setBrowse(true)}>See all {total} ›</button>
            </div>
          )}

          {shown.length > 0 ? sections(shown) : null}

          {searching && results?.next != null ? (
            <button className="btn btn-ghost sf-more" onClick={() => runSearch(results.next)} disabled={loading}>
              {loading ? "Loading…" : `Show more (${results.shown - results.cards.length} left)`}
            </button>
          ) : null}
        </>
      )}

      {note ? <p className="hint hint-small sf-note">{note}</p> : null}

      <footer className="hint hint-small sf-foot">
        {shop
          ? "Prices are what we ask online; a card out at a show carries its table price"
          : "Prices are for cash at the table"}{updated ? ` · as of ${updated}` : ""}. Pull down to refresh.
        {" "}Your list stays on this phone — we never see it until you show us.
      </footer>

      {/* The list bar. Only while there is a list, and pinned to the bottom so
          it is one thumb away wherever they have scrolled to. */}
      {list.count > 0 && !showList && !open ? (
        <button className="sf-listbar" onClick={() => setShowList(true)}>
          <span>♥ My list · {list.count} card{list.count === 1 ? "" : "s"}{totalText ? ` · ${totalText}` : ""}</span>
          <span className="sf-listbar-go">Show us ›</span>
        </button>
      ) : null}

      {open ? (
        <div className="bn-preview" role="dialog" aria-modal="true" aria-label={open.name}>
          <button className="bn-close" onClick={() => setOpen(null)} aria-label="Close">×</button>
          <div className="bn-preview-inner">
            <div className="bn-preview-art">
              {open.imageLarge ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={open.imageLarge} alt={open.name} referrerPolicy="no-referrer" />
              ) : (
                <span className="bn-noart bn-noart-big">No photo of this copy</span>
              )}
            </div>
            <div className="bn-preview-info">
              <h4 className="bn-preview-name">{open.name}</h4>
              {open.set ? <p className="bn-preview-cond">{open.set}</p> : null}
              {open.condition ? <p className="bn-preview-cond">{open.condition}</p> : null}
              <p className={open.pricePence == null ? "bn-preview-price bn-price-ask" : "bn-preview-price"}>
                {open.priceFrom ? "from " : ""}{open.priceText}
              </p>
              <button
                className={hasWish(wish, open) ? "btn btn-ghost sf-wish sf-wish-on" : "btn btn-primary sf-wish"}
                onClick={() => toggle(open)}
              >
                {hasWish(wish, open) ? "♥ On your list — remove" : "♡ Add to my list"}
              </button>
              <p className="hint hint-small bn-preview-count">
                {shop
                  ? `${open.count === 1 ? "One copy" : `${open.count} copies`}${open.source === BOX ? " out at a show right now" : " in stock"}. ${labels[ONLINE].note}`
                  : open.source === ONLINE
                    ? `${SECTION_LABELS[ONLINE].note}`
                    : open.count === 1 ? "One copy at the table." : `${open.count} copies at the table.`}
              </p>
              {open.count > 1 ? (
                <div className="bn-copylist">
                  {open.copies.map((c, i) => (
                    <div className="bn-copy" key={i}>
                      <span className="bn-copy-n">#{i + 1}</span>
                      <span className="bn-copy-cond">{c.condition || "condition not stated"}</span>
                      <span className={c.pricePence == null ? "bn-copy-price bn-price-ask" : "bn-copy-price"}>{c.priceText}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* The screen they hand across the table. Light and large on purpose:
          it is read upside down, at arm's length, by somebody else. */}
      {showList ? (
        <div className="sf-list" role="dialog" aria-modal="true" aria-label="My list">
          <div className="sf-list-head">
            <div>
              <h2 className="sf-list-title">My list</h2>
              <p className="sf-list-sub">{shop ? "Show us at a show, or send us a screenshot" : "Show this to us at the table"}</p>
            </div>
            <button className="bn-close sf-list-close" onClick={() => setShowList(false)} aria-label="Back to the stock">×</button>
          </div>
          {list.count === 0 ? (
            <p className="sf-list-empty">Nothing on your list yet — tap ♡ on a card to add it.</p>
          ) : (
            <ol className="sf-list-rows">
              {list.rows.map((r) => (
                <li className={r.gone ? "sf-list-row sf-list-gone" : "sf-list-row"} key={r.id}>
                  {r.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="sf-list-art" src={r.image} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="sf-list-art sf-list-noart" aria-hidden="true" />
                  )}
                  <span className="sf-list-info">
                    <span className="sf-list-name">{r.name}</span>
                    <span className="sf-list-meta">
                      {[r.set, r.condition, shop ? (r.source === BOX ? "out at a show" : null) : r.source === ONLINE ? "ask — may be at home" : null].filter(Boolean).join(" · ")}
                    </span>
                    {r.gone ? <span className="sf-list-meta sf-list-warn">No longer in stock — ask us</span> : null}
                    {r.unchecked ? <span className="sf-list-meta">Price when you saved it</span> : null}
                  </span>
                  <span className="sf-list-price">{r.gone ? "—" : `${r.priceFrom ? "from " : ""}${r.priceText}`}</span>
                  <button className="sf-list-x" onClick={() => updateWish(removeWish(wish, r.id))} aria-label={`Remove ${r.name}`}>×</button>
                </li>
              ))}
            </ol>
          )}
          {list.count > 0 ? (
            <div className="sf-list-foot">
              <div className="sf-list-total">
                <span>{list.available} card{list.available === 1 ? "" : "s"}</span>
                <strong>{totalText || "—"}</strong>
              </div>
              {list.ask > 0 ? <p className="sf-list-note">+ {list.ask} to ask about</p> : null}
              {list.gone > 0 ? <p className="sf-list-note">{list.gone} no longer in stock</p> : null}
              {handoff ? (
                <div className="sf-handoff">
                  <svg viewBox={`0 0 ${handoff.size} ${handoff.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the stall to scan">
                    <rect width={handoff.size} height={handoff.size} fill="#fff" />
                    <path d={handoff.d} fill="#000" />
                  </svg>
                  <p className="sf-list-note sf-handoff-note">Staff: scan this to pull your cards</p>
                </div>
              ) : null}
              <button
                className="sd-clear-all sf-list-clear"
                onClick={() => { if (window.confirm("Clear your whole list?")) { updateWish([]); setShowList(false); } }}
              >
                Clear list
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
