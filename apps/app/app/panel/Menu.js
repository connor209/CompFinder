"use client";

import { useEffect, useState } from "react";

/**
 * A button that opens a short list of actions — "File back ▾", "＋ New ▾".
 *
 * Built for the Show Desk, where a bar of a dozen buttons wrapped onto three
 * lines and every one of them was the same visual weight (2026-11-01). Items
 * are grouped behind the thing they are FOR, so the bar reads as three or four
 * choices and the detail is one tap away.
 *
 * `items` is [{ key, label, onClick, disabled?, title?, heading? }]. A
 * `heading` item is a label inside the list, not a button. The menu closes on
 * a choice, on a tap outside, and on Escape. Nothing in it runs until an item
 * is chosen, so opening one is always safe.
 */
export default function Menu({ label, items, primary = false, disabled = false, align = "left", title }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const live = (items || []).filter(Boolean);
  return (
    <div className="col-picker act-menu">
      <button
        className={`btn ${primary ? "btn-primary" : "btn-ghost"}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        title={title}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <>
          <div className="col-menu-backdrop" onClick={() => setOpen(false)} />
          <div className={`col-menu act-menu-list${align === "right" ? " is-right" : ""}`} role="menu">
            {live.map((it) => it.heading ? (
              <p key={it.key} className="eyebrow act-menu-head">{it.heading}</p>
            ) : (
              <button
                key={it.key}
                role="menuitem"
                className="act-menu-item"
                disabled={it.disabled}
                title={it.title}
                onClick={() => { setOpen(false); it.onClick?.(); }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
