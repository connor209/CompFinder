"use client";

import { useState } from "react";

/**
 * "Save image" — the answer as a PNG, for pasting into a thread.
 *
 * The job this replaces is the snipping tool. Someone answering "what's this
 * worth?" in a Facebook group screenshots the screen, and a snipped rectangle
 * carries no mark, no date, and whatever else was on screen at the time.
 *
 * On a phone this SHARES rather than downloads where the browser allows it,
 * because a saved file on iOS is three taps from the conversation it was meant
 * for. Desktop gets a normal download. Both come from the same PNG.
 */
export default function ShareButton({ payload, filename }) {
  const [state, setState] = useState("idle");

  async function save() {
    if (state === "working") return;
    setState("working");
    try {
      const res = await fetch(`/card/${encodeURIComponent(payload.query)}/share.png`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        // Say which failure it was. The first production bug here showed as a
        // bare "didn't save" with the reason — a 500 from a font the deploy
        // never traced — visible only in the Vercel log.
        const detail = await res.text().catch(() => "");
        throw new Error(`share.png ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "image/png" });

      // canShare({files}) is the real test — Android Chrome reports navigator
      // .share while refusing files, and calling it then throws.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        setState("idle");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked late: Safari has been known to cancel the download if the URL
      // dies in the same tick as the click.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setState("done");
      setTimeout(() => setState("idle"), 2600);
    } catch (err) {
      // AbortError is the visitor dismissing the share sheet, which is not a
      // failure and must not be reported as one.
      if (err && err.name === "AbortError") {
        setState("idle");
        return;
      }
      console.error("Save image failed:", err);
      setState("error");
      setTimeout(() => setState("idle"), 3200);
    }
  }

  return (
    <button className="sharebtn" type="button" onClick={save} disabled={state === "working"}>
      {state === "working" ? "Making it…"
        : state === "done" ? "Saved ✓"
        : state === "error" ? "Didn't save — try again"
        : "Save image"}
    </button>
  );
}
