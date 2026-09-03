"use client";

/**
 * The price cell you can type into.
 *
 * One component for all three places a price is shown and can be corrected —
 * the batch table, the batch cards, and a Quick Search deep dive — because
 * this is a control that has to LOOK the same everywhere it appears. A price
 * that reads differently depending on which screen you are on is a price you
 * have to check twice, and the whole point of an override is that you have
 * already decided.
 *
 * It owns the parsing and the error message; the parent only ever hears about
 * a valid number of pence, or null for "put it back". `apps/app/lib/
 * price-override.js` owns everything the number then means.
 *
 * The engine's figure never leaves the screen. An override sits in front of
 * it, marked, with what it replaced beside it and one click back — an edit you
 * cannot see and cannot undo is how a typo becomes 89 listings.
 *
 * A card with no price reads **£0.00**, not a dash. A dash is what the eye
 * skips: it says "nothing to report here", which is the opposite of the truth
 * on a row nothing has priced, and reading it that way is how a card went up
 * on eBay at the placeholder price its CSV arrived with. £0.00 is not a cheap
 * card and cannot be read as one — see `lib/zero-price.js`, which also stops
 * any run carrying one from being exported.
 */
import { useEffect, useRef, useState } from "react";
import {
  effectivePence,
  isOverridden,
  overriddenFromPence,
  parseOverridePence,
  poundsStr
} from "@/lib/price-override.js";
import { UNPRICED_PENCE } from "@/lib/zero-price.js";

export default function PriceOverride({ rec, onSet, compact = false, disabled = false, showValue = true }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const price = effectivePence(rec);
  const mine = isOverridden(rec);
  const was = overriddenFromPence(rec);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  function open() {
    // Seeded with what is on the row, so a small correction is a small edit.
    setText(price != null ? (price / 100).toFixed(2) : "");
    setError("");
    setEditing(true);
  }

  function commit() {
    const { pence, error: err } = parseOverridePence(text);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
    setError("");
    onSet(pence);
  }

  function cancel() {
    setEditing(false);
    setError("");
  }

  if (editing) {
    return (
      <span className={`po po-editing${compact ? " po-compact" : ""}`}>
        <span className="po-input">
          <span className="po-cur" aria-hidden="true">£</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={text}
            aria-label="Price for this card"
            aria-invalid={error ? "true" : undefined}
            onChange={(e) => { setText(e.target.value); setError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
          />
        </span>
        <button type="button" className="po-ok" onClick={commit} title="Use this price (Enter)">✓</button>
        <button type="button" className="po-cancel" onClick={cancel} title="Leave it as it was (Esc)">✕</button>
        {error ? <span className="po-error">{error}</span> : null}
        {!error && mine ? <span className="po-hint">Clear the box to go back to {poundsStr(was)}.</span> : null}
      </span>
    );
  }

  return (
    <span className={`po${compact ? " po-compact" : ""}`}>
      {/* The headline on a deep dive is already the price, in type this
          control can't match — there it renders the flag and the buttons only,
          rather than printing the same number twice on one line. */}
      {showValue ? (
        <span
          className={`po-value${mine ? " po-mine" : ""}${price == null ? " po-zero" : ""}`}
          title={price == null ? "No price — nothing priced this card. Set one by hand, or take it out of the run: exports are blocked while any card sits at £0.00." : undefined}
        >
          {poundsStr(price ?? UNPRICED_PENCE)}
        </span>
      ) : null}
      {mine ? (
        <span className="po-flag" title={was != null ? `The app worked this card out at ${poundsStr(was)}` : "The app couldn't price this card"}>
          yours{was != null ? ` · was ${poundsStr(was)}` : ""}
        </span>
      ) : null}
      {disabled ? null : (
        <>
          <button type="button" className="po-edit" onClick={open} title={mine ? "Change your price" : "Set your own price for this card"}>
            {mine ? "Change" : "Override"}
          </button>
          {mine ? (
            <button
              type="button"
              className="po-revert"
              onClick={() => onSet(null)}
              title={was != null ? `Back to the app's ${poundsStr(was)}` : "Back to no price"}
            >
              ↺
            </button>
          ) : null}
        </>
      )}
    </span>
  );
}
