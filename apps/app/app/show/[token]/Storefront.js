"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  storefrontView,
  STOREFRONT_SORTS,
  DEFAULT_STOREFRONT_SORT,
  STOREFRONT_PRICE_FILTERS,
  STOREFRONT_SCOPES,
  SECTION_LABELS,
  ONLINE
} from "@/lib/storefront.js";
import { BLANK_PAGE, clampPage, turnPage, swipeDirection } from "@/lib/binder.js";

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
 */
export default function Storefront({ storefront, stock }) {
  const cards = stock?.cards || [];
  const both = (stock?.box || 0) > 0 && (stock?.online || 0) > 0;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(DEFAULT_STOREFRONT_SORT);
  const [price, setPrice] = useState("any");
  const [scope, setScope] = useState("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);

  const view = useMemo(() => storefrontView(cards, { query: q, sort, price, scope }), [cards, q, sort, price, scope]);
  const at = clampPage(page, view.pageCount);
  const kind = view.pageKinds[at];

  // A new search is a new binder, and it opens at the front.
  useEffect(() => { setPage(0); }, [q, sort, price, scope]);

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
      if (e.key === "Escape") { setOpen(null); return; }
      if (open) return;
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

  return (
    <main className="sf-shell">
      <header className="sf-head">
        <h1 className="sf-title">{title}</h1>
        <p className="hint sf-lede">
          Flip through what we&apos;ve brought. See something you like? Show us this screen at the table and we&apos;ll pull it out for you.
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
                placeholder="Search — name or number"
                aria-label="Search the stock"
                enterKeyHint="search"
              />
              {q ? <button className="sd-clear" onClick={() => setQ("")} aria-label="Clear the search">×</button> : null}
            </div>
            <select className="sd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">
              {STOREFRONT_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="sd-select" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Filter by price">
              {STOREFRONT_PRICE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {both ? (
              <select className="sd-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which stock">
                {STOREFRONT_SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
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

      <footer className="hint hint-small sf-foot">
        Prices are for cash at the table{updated ? ` · as of ${updated}` : ""}. Pull down to refresh.
      </footer>

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
              {open.condition ? <p className="bn-preview-cond">{open.condition}</p> : null}
              <p className={open.pricePence == null ? "bn-preview-price bn-price-ask" : "bn-preview-price"}>
                {open.priceFrom ? "from " : ""}{open.priceText}
              </p>
              <p className="hint hint-small bn-preview-count">
                {open.source === ONLINE
                  ? `${SECTION_LABELS[ONLINE].note}`
                  : open.count === 1 ? "One copy at the table." : `${open.count} copies at the table.`}
                {" "}Show us this screen and we&apos;ll get it out.
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
    </main>
  );
}
