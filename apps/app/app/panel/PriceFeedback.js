"use client";

/**
 * 👍 / 👎 on a price. One component for the Batch rows and a Quick Search deep
 * dive, for the same reason PriceOverride is one: a control that looks
 * different on each screen gets used differently on each screen, and then the
 * votes from the two cannot be pooled.
 *
 * A down asks WHY before it is sent — a thumbs down with no reason is a vote
 * nobody can act on. Tapping a lit thumb takes the vote back (a 'clear' row:
 * the table is append-only).
 *
 * The parent only supplies `send(verdict, reason)`, which resolves to the
 * store's `{ ok, missing, error }`. Nothing here moves a price — see
 * lib/price-feedback.js.
 */
import { useEffect, useState } from "react";
import { REASONS, reasonLabel } from "@/lib/price-feedback.js";

export default function PriceFeedback({ initial = null, send, disabled = false }) {
  const [vote, setVote] = useState(initial); // { verdict, reason } | null
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState(null); // { kind: "ok" | "warn" | "err", text }

  // A saved run's votes arrive after the rows render; take them when they do,
  // unless a vote has been cast here since.
  useEffect(() => { if (initial && !status) setVote(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cast(verdict, reason = null) {
    const prev = vote;
    const next = verdict === "clear" ? null : { verdict, reason };
    setVote(next);
    setAsking(false);
    const res = await send(verdict, reason);
    if (res?.ok) setStatus({ kind: "ok", text: verdict === "clear" ? "vote taken back" : "thanks — saved" });
    else if (res?.missing) setStatus({ kind: "warn", text: "not saved — migration 046 still to run" });
    else {
      setVote(prev);
      setStatus({ kind: "err", text: `not saved: ${res?.error || "unknown error"}` });
    }
  }

  const up = vote?.verdict === "up";
  const down = vote?.verdict === "down";

  return (
    <div className="pf">
      <div className="pf-row">
        <button
          type="button"
          className={`pf-btn${up ? " on" : ""}`}
          disabled={disabled}
          aria-pressed={up}
          title={up ? "Take back" : "This price is right"}
          onClick={() => cast(up ? "clear" : "up")}
        >👍</button>
        <button
          type="button"
          className={`pf-btn${down ? " on down" : ""}`}
          disabled={disabled}
          aria-pressed={down}
          title={down ? "Take back" : "This price is wrong"}
          onClick={() => (down ? cast("clear") : setAsking((a) => !a))}
        >👎</button>
        {down && vote.reason ? <span className="pf-why">{reasonLabel(vote.reason)}</span> : null}
        {status ? <span className={`pf-status pf-${status.kind}`}>{status.text}</span> : null}
      </div>
      {asking ? (
        <div className="pf-reasons" role="group" aria-label="What was wrong with it?">
          {REASONS.map((r) => (
            <button key={r.key} type="button" className="pf-reason" onClick={() => cast("down", r.key)}>{r.label}</button>
          ))}
          <button type="button" className="pf-reason pf-cancel" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}
