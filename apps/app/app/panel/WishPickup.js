"use client";

import { useMemo } from "react";
import { DealButton } from "./DealBar";
import { addLine } from "@/lib/deal.js";
import { getShowEvent } from "@/lib/checkout";
import { matchWishCodes } from "@/lib/wishlist.js";
import { ONLINE } from "@/lib/binder.js";

/**
 * A visitor's wish list, scanned off their phone.
 *
 * The storefront's list screen shows a QR carrying the list (lib/wishlist.js);
 * our phone scans it and lands here, on the Show Desk, behind our login. The
 * storefront could only say WHAT they picked. The desk knows where each copy
 * is and can put it in a deal, which is the whole point of scanning it rather
 * than reading their screen.
 *
 * Desk chrome: ShowDesk renders it only when nobody but us is looking. Each
 * copy's location comes from the desk's own maps through `placesFor`, the same
 * lookup the binder's ⌖ uses — the pocket still carries an id and nothing else.
 *
 * Adding is inert (rule 1 in lib/deal.js), so "Add all to deal" moves no money
 * and touches no listing: it fills the basket, and the sale still happens on
 * the bar with its total in front of you.
 */
export default function WishPickup({ codes, cards, loading, placesFor, lineFor, deal, updateDeal, onClose }) {
  const { matched, missing } = useMemo(() => matchWishCodes(codes, cards), [codes, cards]);

  // The cheapest copy of each card — the one the pocket's headline price is.
  const firstLines = matched.map((c) => lineFor(c.copies?.[0]?.id)).filter(Boolean);
  function addAll() {
    let next = deal.lines.length === 0 && !deal.event ? { ...deal, event: getShowEvent() || null } : deal;
    for (const line of firstLines) next = addLine(next, line);
    updateDeal(next);
  }

  return (
    <div className="panel wp-panel">
      <div className="panel-head">
        <span className="eyebrow">
          A visitor&apos;s list — {codes.length} card{codes.length === 1 ? "" : "s"}
        </span>
        <span className="wp-actions">
          {firstLines.length > 0 ? (
            <button className="btn btn-primary" onClick={addAll}>＋ Add all to deal</button>
          ) : null}
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close the visitor's list">Done</button>
        </span>
      </div>

      {loading ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}>Loading the stock to match their list against…</p>
      ) : (
        <>
          {matched.length === 0 ? (
            <p className="hint hint-small" style={{ marginTop: 0 }}>
              Nothing on their list matches what&apos;s checked out or listed now.
            </p>
          ) : (
            <div className="wp-rows">
              {matched.map((c) => {
                const places = placesFor(c);
                return (
                  <div className="wp-card" key={`${c.source}-${c.key}`}>
                    {c.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="wp-art" src={c.image} alt="" loading="lazy" />
                    ) : (
                      <span className="wp-art wp-noart" aria-hidden="true" />
                    )}
                    <div className="wp-info">
                      <strong className="wp-name">{c.name}</strong>
                      <span className="hint-small wp-where">
                        {c.source === ONLINE ? "Listed online — not checked out" : c.count === 1 ? "In the box" : `${c.count} copies in the box`}
                      </span>
                      {(c.copies || []).map((cp, i) => (
                        <div className="wp-copy" key={cp.id ?? i}>
                          <span className="wp-copy-cond">{cp.condition || "condition not stated"}</span>
                          <span className="wp-copy-price">{cp.priceText}</span>
                          <span className="wp-copy-loc">{places.get(cp.id) || "not placed"}</span>
                          <DealButton className="stack-pull sd-locate" deal={deal} update={updateDeal} line={lineFor(cp.id)} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {missing.length > 0 ? (
            <p className="hint hint-small">
              {missing.length} card{missing.length === 1 ? " on their list is" : "s on their list are"} no longer in stock — sold, returned, or renamed since they picked {missing.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
