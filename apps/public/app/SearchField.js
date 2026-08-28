"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { queryForCard } from "@/lib/card-query";
import { remember } from "@/lib/card-handoff";
import { readRecent, clearRecent } from "@/lib/recent-searches";
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
  const [recent, setRecent] = useState([]);
  const [showRecent, setShowRecent] = useState(false);
  const box = useRef(null);
  const timer = useRef(null);

  // Read after mount, never during render: the list lives on the device, the
  // first paint is server HTML, and reading it any earlier is a hydration
  // mismatch waiting to happen.
  useEffect(() => { setRecent(readRecent()); }, []);

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

  /**
   * A card the visitor actually picked. We already hold everything the next
   * screen needs, so hand it over rather than making it ask /api/resolve for
   * the card it was just given — half a second on the critical path.
   * queryForCard rather than joining the fields here: that string is what the
   * cache key hashes, and it wants one definition.
   */
  function goToCard(card) {
    remember(card);
    go(queryForCard(card));
  }

  /**
   * A card off the recents list. It carries enough of itself to be handed
   * over, so coming back to a card you looked at a minute ago skips the
   * resolve exactly the way picking it from the dropdown does.
   */
  function goToRecent(row) {
    if (row.id || row.number) remember(row);
    go(row.q);
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
      if (pick) goToCard(pick); else go(q);
    }
  }

  // The chips are the seeded examples, always. They used to be replaced by
  // the visitor's own recents — but nothing ever wrote that list, so no
  // visitor saw it, and now that there IS a history it has a control of its
  // own. Two rows saying the same thing would be noise, and a first-time
  // visitor still needs something to tap.
  const chips = seeds;

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
                onClick={() => goToCard(c)}
              >
                <span className="nm">{c.name}</span>
                <span className="mt">{[c.number, c.set].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="recentrow">
          <button
            type="button"
            className="pill"
            data-on={showRecent}
            aria-expanded={showRecent}
            onClick={() => setShowRecent((v) => !v)}
          >
            <b>Recent</b>
            <span>{recent.length}</span>
          </button>
          {showRecent && (
            <button type="button" className="link" onClick={() => { setRecent(clearRecent()); setShowRecent(false); }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Inline rather than a dropdown over the page: on a phone an overlay
          anchored to the field can open off the bottom of the screen, and
          there is nothing underneath here worth covering. */}
      {showRecent && recent.length > 0 && (
        <div className="sugs inline">
          {recent.map((r) => (
            <button key={r.q} type="button" onClick={() => goToRecent(r)}>
              <span className="nm">{r.name}</span>
              <span className="mt">{[r.number, r.set].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="eyebrow">People are checking</span>
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
