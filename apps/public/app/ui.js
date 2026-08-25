"use client";

import { useEffect, useState } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { STEP_MS, stepFor } from "@/lib/progress-steps";
import { DEFAULT_SOLD_WINDOW } from "@/lib/windows";

export const gbp = (pence) => (pence == null ? "—" : CompFinderPricing.toPoundsStr(pence));

/** The whole mark is the two-tone split across two lines. No symbol beside it. */
export function Wordmark({ href = "/", size = 13, id }) {
  const El = href ? "a" : "span";
  return (
    <El className="wordmark" id={id} href={href || undefined} style={{ fontSize: size }}>
      Last<b>Comp</b>
    </El>
  );
}

/** Used anywhere the two-line lockup won't fit. Border thins below 40px. */
export function Tile({ size = 44 }) {
  const radius = size >= 40 ? 11 : size >= 24 ? 7 : 4;
  return (
    <span
      className="tile"
      aria-label="Last Comp"
      style={{
        width: size, height: size, borderRadius: radius,
        borderWidth: size >= 40 ? 1.5 : 1, fontSize: Math.round(size * 0.34)
      }}
    >LC</span>
  );
}

/**
 * Card art, or the hatch that stands in for it.
 *
 * Coverage is 84% of the English cards people search and nothing at all for
 * Japanese sets, so the placeholder is an ordinary state rather than an error
 * one — it holds the same box so a card with art and one without don't shove
 * the layout around each other. A URL that fails to load falls back to it too:
 * the images come from a third party, and a broken-image glyph in the middle
 * of a price is worse than a hatch.
 */
export function CardArt({ src, alt, className = "", width }) {
  const [failed, setFailed] = useState(false);
  const showArt = src && !failed;
  return (
    <span className={`art ${className}`} style={width ? { width } : undefined}>
      {showArt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ? `${alt} card` : ""} loading="lazy" decoding="async"
             onError={() => setFailed(true)} />
      ) : (
        className.includes("xs") ? null : "card art"
      )}
    </span>
  );
}

export function Crumb({ back = "/", label, scope = null }) {
  return (
    <div className="crumb">
      <a className="back" href={back} aria-label="Back">←</a>
      <span className="q">{label}</span>
      {scope ? <span className="scope">{scope}</span> : null}
    </div>
  );
}

/**
 * The cold-card loading state: an indeterminate bar and a line that advances.
 *
 * `stage` comes from useCard and flips on a REAL event (the resolver
 * returning), which is why the first line can promise to be finding the card
 * and be telling the truth. Within a stage the lines are timed, because
 * there is nothing finer to hang them on — see lib/progress-steps.js.
 */
export function SearchProgress({ stage = "resolving", days = DEFAULT_SOLD_WINDOW }) {
  const [elapsed, setElapsed] = useState(0);

  // Restart the clock when the stage changes, so "pricing" begins at its own
  // first line rather than wherever the resolver happened to leave it.
  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed((ms) => ms + STEP_MS), STEP_MS);
    return () => clearInterval(id);
  }, [stage]);

  return (
    <div className="progress" role="status" aria-live="polite">
      <p className="body">{stepFor(stage, days, elapsed)}</p>
      <span className="pbar" aria-hidden="true"><span className="pfill" /></span>
    </div>
  );
}
