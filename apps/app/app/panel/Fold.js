"use client";

import { useEffect, useState } from "react";

/**
 * A section that folds shut, and remembers that it did.
 *
 * The screens here grew a panel at a time, and every panel was always open:
 * the Show Desk, Stream stock and the Batch screen each became a long scroll
 * of controls you use once a session between you and the list you came for.
 * Saved runs was the first panel to fold (SavedBatches.js); this is that
 * pattern made reusable so every screen folds the same way.
 *
 * Three rules, the same ones the Batch screen's "Show the working" follows:
 *
 * - **The header never folds.** Title, count, the one-line `summary` and any
 *   `actions` stay on screen shut or open, so a shut section still says what
 *   is in it — a fold that hides how many cards are waiting is a fold that
 *   hides work.
 * - **Warnings and errors go OUTSIDE the fold**, via `alert`. A failed save
 *   or a pending migration folded away is the one thing on a screen you had
 *   to see, which is why `alert` renders whether the section is open or not.
 * - **Shut keeps the children mounted** (`hidden`), so a half-typed form or a
 *   ticked box survives being folded. Pass `lazy` only for children that cost
 *   something to render and hold no state worth keeping.
 *
 * The open/shut choice is a preference about your own screen, so it lives in
 * localStorage under `cf-fold-<id>` and is read in an effect — read during
 * render it would differ between server and client and mismatch hydration.
 */
export default function Fold({
  id,
  title,
  count = null,
  summary = null,
  actions = null,
  alert = null,
  defaultOpen = true,
  lazy = false,
  panel = true,
  className = "",
  children,
}) {
  const key = id ? `cf-fold-${id}` : null;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!key) return;
    try {
      const v = localStorage.getItem(key);
      if (v === "on") setOpen(true);
      else if (v === "off") setOpen(false);
    } catch { /* private mode — the default is fine */ }
  }, [key]);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      if (key) {
        try { localStorage.setItem(key, next ? "on" : "off"); } catch { /* best-effort */ }
      }
      return next;
    });
  }

  const Tag = panel ? "section" : "div";
  const cls = `${panel ? "panel " : ""}fold${panel ? "" : " fold-inline"}${open ? " fold-open" : ""}${className ? ` ${className}` : ""}`;

  return (
    <Tag className={cls}>
      <div className="panel-head fold-head">
        <button type="button" className="fold-toggle" onClick={toggle} aria-expanded={open}>
          <span className="fold-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="fold-title">{title}</span>
          {count != null ? <span className="fold-count">{count}</span> : null}
        </button>
        {actions ? <div className="fold-actions">{actions}</div> : null}
      </div>
      {summary && !open ? <p className="hint hint-small fold-summary">{summary}</p> : null}
      {alert}
      {lazy && !open ? null : (
        <div className="fold-body" hidden={!open}>
          {children}
        </div>
      )}
    </Tag>
  );
}
