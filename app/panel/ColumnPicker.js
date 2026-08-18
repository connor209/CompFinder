"use client";

import { useEffect, useState } from "react";

/**
 * Columns ▾ — pick which columns a table shows, on the fly.
 *
 * Every table that uses this describes its columns the same way:
 *   { key, label, always? }   // `always` = structural, can't be hidden
 * and the choice is remembered per table under its own storage key, so
 * Browse and My Listings don't fight over one setting.
 *
 * Pair it with `useColumns(storageKey, defaults)` below, which owns the state
 * and the persistence; the picker itself is just the menu.
 */
export function useColumns(storageKey, defaults) {
  const [cols, setCols] = useState(() => new Set(defaults));

  // Read the saved choice after mount, not during the first render: the server
  // has no localStorage, and reading it inline makes the markup mismatch.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(saved) && saved.length) setCols(new Set(saved));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  function toggle(key) {
    setCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function reset() {
    setCols(new Set(defaults));
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  /** The columns to actually render, in the order they were declared. */
  const visible = (all) => all.filter((c) => c.always || cols.has(c.key));

  return { cols, toggle, reset, visible };
}

export default function ColumnPicker({ columns, cols, onToggle, onReset, label = "Columns" }) {
  const [open, setOpen] = useState(false);
  const shown = columns.filter((c) => c.always || cols.has(c.key)).length;

  return (
    <div className="col-picker">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label} ▾ <span className="col-count">{shown}</span>
      </button>
      {open ? (
        <>
          <div className="col-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="col-menu">
            {columns.map((c) => (
              <label key={c.key} className={c.always ? "is-locked" : ""} title={c.hint || ""}>
                <input
                  type="checkbox"
                  checked={c.always || cols.has(c.key)}
                  disabled={c.always}
                  onChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            ))}
            {onReset ? (
              <button className="col-menu-reset" onClick={() => { onReset(); setOpen(false); }}>
                Reset to default
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
