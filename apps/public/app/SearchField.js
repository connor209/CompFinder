"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp } from "./ui";

/**
 * One field, and the whole of screen one's job: get a name and a number out of
 * someone who has just found a card.
 *
 * The dropdown is the catalogue, not a guess — /api/suggest ranks with the
 * same scorer the resolver uses, so what Enter does and what the list shows
 * can't diverge. Picking a suggestion navigates to that exact card; typing
 * free text hands the string to the resolver and lets it ask.
 */
export default function SearchField({ seeds = [] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sugs, setSugs] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState(null);
  const box = useRef(null);
  const timer = useRef(null);

  // The visitor's own recent lookups beat the seeded examples when they exist.
  // Kept in localStorage: there are no accounts here and nothing is sent
  // anywhere.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("lc-recent");
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list) && list.length) setRecent(list.slice(0, 3));
    } catch { /* private mode, or nothing stored yet */ }
  }, []);

  useEffect(() => {
    function onDocClick(e) {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function go(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    router.push(`/card/${encodeURIComponent(trimmed)}`);
  }

  function onType(value) {
    setQ(value);
    setActive(-1);
    clearTimeout(timer.current);
    if (value.trim().length < 2) { setSugs([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(value.trim())}`).then((r) => r.json());
        const cards = (res && res.cards) || [];
        setSugs(cards);
        setOpen(cards.length > 0);
      } catch { /* the dropdown is best-effort */ }
    }, 180);
  }

  function onKeyDown(e) {
    if (!open || !sugs.length) {
      if (e.key === "Enter") go(q);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % sugs.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + sugs.length) % sugs.length); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = active >= 0 ? sugs[active] : null;
      go(pick ? [pick.name, pick.number, pick.set].filter(Boolean).join(" ") : q);
    }
  }

  const chips = recent && recent.length ? recent : seeds;

  return (
    <>
      <div className="searchwrap" ref={box}>
        <div className="searchfield">
          <span className="glyph" aria-hidden="true">⌕</span>
          <input
            value={q}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => sugs.length && setOpen(true)}
            placeholder="e.g. Charizard ex 223"
            aria-label="Search for a card by name and number"
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        {open && sugs.length > 0 && (
          <div className="sugs" role="listbox">
            {sugs.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go([c.name, c.number, c.set].filter(Boolean).join(" "))}
              >
                <span className="nm">{c.name}</span>
                <span className="mt">{[c.number, c.set].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="eyebrow">{recent && recent.length ? "You looked at" : "People are checking"}</span>
          <div className="pills">
            {chips.map((c) => (
              <button key={c.q || c.name} type="button" className="pill" onClick={() => go(c.q || c.name)}>
                <b>{c.name}</b>
                <span>{typeof c.pence === "number" ? gbp(c.pence) : c.price}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
