"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  storefrontView,
  storefrontFacets,
  STOREFRONT_SORTS,
  DEFAULT_STOREFRONT_SORT,
  STOREFRONT_PRICE_FILTERS,
  STOREFRONT_SCOPES,
  SECTION_LABELS,
  ONLINE
} from "@/lib/storefront.js";
import { BLANK_PAGE, clampPage, turnPage, swipeDirection } from "@/lib/binder.js";
import { counterPrice } from "@/lib/showcounter.js";
import {
  hasWish, toggleWish, removeWish, reconcileWishlist,
  loadWishlist, saveWishlist, wishStorageKey, WISHLIST_MAX,
  wishCodes, wishHandoffUrl
} from "@/lib/wishlist.js";
import { qrPath } from "@/lib/qr.js";

/**
 * The binder, on a visitor's own phone.
 *
 * Handed projected cards and nothing else — see lib/storefront.js. This file
 * imports no database client and nothing from the desk: everything it can show arrived
 * in its props, which is what makes "a stranger cannot see our shelf addresses" a fact
 * about the payload rather than about this markup.
 *
 * The markup follows the Show Desk's binder (the bn-* classes) on purpose:
 * the same frame, the same nine pockets, the same page numbers — so "it's on
 * page four" means the same thing on their phone as on the tablet at the
 * table. What it drops is everything the desk resolves on a tap: where a copy
 * is, and adding it to a deal. A visitor points; we fetch.
 *
 * What it adds is the visitor's own list (lib/wishlist.js): ♡ on the cards
 * they like, and one screen to show us at the table. It is kept on their
 * phone and never sent anywhere.
 */
export default function Storefront({ storefront, stock }) {
  const cards = stock?.cards || [];
  const both = (stock?.box || 0) > 0 && (stock?.online || 0) > 0;
  const facets = useMemo(() => storefrontFacets(cards), [cards]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(DEFAULT_STOREFRONT_SORT);
  const [price, setPrice] = useState("any");
  const [scope, setScope] = useState("all");
  const [set, setSet] = useState("");
  const [condition, setCondition] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const [wish, setWish] = useState([]);
  const [showList, setShowList] = useState(false);
  const [note, setNote] = useState("");
  const storeKey = useRef("");

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

  const view = useMemo(
    () => storefrontView(cards, { query: q, sort, price, scope, set, condition }),
    [cards, q, sort, price, scope, set, condition]
  );
  const list = useMemo(() => reconcileWishlist(wish, cards), [wish, cards]);
  // The QR our phone scans: the list itself, in the URL, opening the desk.
  // Nothing is sent anywhere — it is drawn here and read off this screen.
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const handoff = useMemo(() => {
    const codes = wishCodes(list.rows);
    if (!origin || codes.length === 0) return null;
    return qrPath(wishHandoffUrl(origin, codes));
  }, [origin, list.rows]);
  const at = clampPage(page, view.pageCount);
  const kind = view.pageKinds[at];

  // A new search is a new binder, and it opens at the front.
  useEffect(() => { setPage(0); }, [q, sort, price, scope, set, condition]);

  function clearFilters() {
    setQ(""); setPrice("any"); setScope("all"); setSet(""); setCondition("");
  }

  function turn(dir) {
    setPage((cur) => turnPage(cur, dir, view.pageCount));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // A ref, not state: it changes every frame of a drag, and re-rendering nine
  // pictures mid-swipe is how the gesture judders on the phone it is for.
  const touchAt = useRef(null);
  function touchStart(e) {
    const t = e.touches?.[0];
    touchAt.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function touchEnd(e) {
    const from = touchAt.current;
    const t = e.changedTouches?.[0];
    touchAt.current = null;
    if (!from || !t) return;
    const dir = swipeDirection(t.clientX - from.x, t.clientY - from.y);
    if (dir) turn(dir);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { setOpen(null); setShowList(false); return; }
      if (open || showList) return;
      if (e.key === "ArrowLeft") turn("prev");
      if (e.key === "ArrowRight") turn("next");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = storefront?.title || "Our stock";
  const updated = storefront?.at
    ? new Date(storefront.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;
  const totalText = list.totalPence > 0 ? `${list.totalFrom ? "from " : ""}${counterPrice(list.totalPence)}` : null;

  return (
    <main className={list.count > 0 ? "sf-shell sf-shell-listed" : "sf-shell"}>
      <header className="sf-head">
        <h1 className="sf-title">{title}</h1>
        <p className="hint sf-lede">
          Flip through what we&apos;ve brought. Tap ♡ on anything you like, then show us your list at the table.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="dd-empty bn-blank">Nothing to show just yet — ask at the table.</p>
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
            {facets.sets.length > 1 ? (
              <select className="sd-select" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Set">
                <option value="">All sets</option>
                {facets.sets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
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
            {both ? (
              <select className="sd-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which stock">
                {STOREFRONT_SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            ) : null}
            <select className="sd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">
              {STOREFRONT_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {view.filtering ? (
              <button className="sd-clear-all" onClick={clearFilters}>Clear filters</button>
            ) : null}
          </div>

          <div className="bn-wrap">
            {view.pageCount > 0 ? (
              <div className={kind === ONLINE ? "bn-section bn-section-online" : "bn-section"}>
                <span className="eyebrow">{SECTION_LABELS[kind]?.title}</span>
                <span className="hint-small">{SECTION_LABELS[kind]?.note}</span>
              </div>
            ) : null}
            <div
              className="bn-book"
              onTouchStart={touchStart}
              onTouchEnd={touchEnd}
              role="group"
              aria-label={view.pageCount === 0 ? "The binder, empty" : `Page ${at + 1} of ${view.pageCount}`}
            >
              {view.pageCount === 0 ? (
                <p className="dd-empty bn-blank">Nothing matches that — ask at the table, we may still have one.</p>
              ) : (
                <>
                  <span className="bn-rings" aria-hidden="true" />
                  <div className="bn-sheet">
                    <div className="bn-page">
                      {(view.pages[at] || BLANK_PAGE).map((c, i) => (c ? (
                        <button
                          className={c.source === ONLINE ? "bn-pocket bn-card bn-card-online" : "bn-pocket bn-card"}
                          key={c.key}
                          onClick={() => setOpen(c)}
                          title={`${c.name} — ${c.priceText}`}
                        >
                          {c.image ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img className="bn-art" src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            /* An empty sleeve rather than catalogue art: a
                               mint scan of a played card is a promise about
                               the copy we'd hand over. */
                            <span className="bn-art bn-noart" aria-hidden="true">no photo</span>
                          )}
                          {hasWish(wish, c) ? <span className="sf-heart" aria-label="On your list">♥</span> : null}
                          {c.source === ONLINE ? (
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
                      ) : (
                        <span className="bn-pocket bn-pocket-empty" key={`pocket-${i}`} aria-hidden="true" />
                      )))}
                    </div>
                    <span className="bn-sheetno">{at + 1}</span>
                  </div>
                </>
              )}
            </div>
            <div className="bn-nav">
              <button className="btn btn-ghost bn-turn" onClick={() => turn("prev")} disabled={at === 0} aria-label="Previous page">◀</button>
              <span className="bn-pageno">
                {view.pageCount === 0 ? "No pages" : `Page ${at + 1} of ${view.pageCount}`}
                <span className="hint-small">
                  {view.box} at the table{view.online > 0 ? ` · ${view.online} more in stock` : ""}
                  {view.filtering ? ` · of ${view.total}` : ""}
                </span>
              </span>
              <button className="btn btn-ghost bn-turn" onClick={() => turn("next")} disabled={at >= view.pageCount - 1} aria-label="Next page">▶</button>
            </div>
            <p className="hint hint-small bn-hint">Swipe the page, or use the arrows.</p>
          </div>
        </>
      )}

      {note ? <p className="hint hint-small sf-note">{note}</p> : null}

      <footer className="hint hint-small sf-foot">
        Prices are for cash at the table{updated ? ` · as of ${updated}` : ""}. Pull down to refresh.
        {" "}Your list stays on this phone — we never see it until you show us.
      </footer>

      {/* The list bar. Only while there is a list, and pinned to the bottom so
          it is one thumb away from any page of the binder. */}
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
                {open.source === ONLINE
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
              <p className="sf-list-sub">Show this to us at the table</p>
            </div>
            <button className="bn-close sf-list-close" onClick={() => setShowList(false)} aria-label="Back to the binder">×</button>
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
                      {[r.set, r.condition, r.source === ONLINE ? "ask — may be at home" : null].filter(Boolean).join(" · ")}
                    </span>
                    {r.gone ? <span className="sf-list-meta sf-list-warn">No longer in the binder — ask us</span> : null}
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
              {list.gone > 0 ? <p className="sf-list-note">{list.gone} no longer in the binder</p> : null}
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
