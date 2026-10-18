"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setPickerGroups, ERA_GAME } from "@/lib/storefront.js";
import { eraLabel } from "@/lib/pokemon-eras.js";

/**
 * The storefront's set filter: a button that opens a searchable list.
 *
 * A native dropdown of two hundred Pokémon sets is a long scroll on a phone
 * with no way to type. This opens a sheet with a search box on top — "base"
 * lists every base set, "wizards" the whole era — and, for Pokémon, the sets
 * grouped under their era, oldest first. An era heading is itself a choice:
 * "everything from Wizards of the Coast" is a reasonable thing to want.
 *
 * It decides nothing about the search: it hands back an era or a set, and the
 * storefront asks the server. Options come from the cards (storefrontFacets),
 * so nothing offered finds nothing.
 */
export default function SetPicker({ sets, game, era, set, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef(null);
  const groups = useMemo(() => setPickerGroups(sets, q, game), [sets, q, game]);

  useEffect(() => {
    if (!open) return undefined;
    // The keyboard comes up with the list: typing is the point of the sheet.
    const t = setTimeout(() => input.current?.focus(), 30);
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open]);

  function pick(next) {
    onPick(next);
    setOpen(false);
    setQ("");
  }

  const label = set || (era ? `All ${eraLabel(era)}` : "All sets");

  return (
    <>
      <button
        type="button"
        className={set || era ? "sd-select sf-setpick-btn sf-setpick-on" : "sd-select sf-setpick-btn"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Set: ${label}`}
      >
        <span className="sf-setpick-label">{label}</span>
      </button>
      {open ? (
        <div className="sf-setpick" role="dialog" aria-modal="true" aria-label="Choose a set">
          <div className="sf-setpick-head">
            <div className="dd-inp sd-find-inp sf-setpick-find">
              <span className="mag" aria-hidden="true">⌕</span>
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={game === ERA_GAME ? "Find a set — e.g. base, jungle, 151" : "Find a set"}
                aria-label="Find a set"
                enterKeyHint="done"
              />
              {q ? <button className="sd-clear" onClick={() => setQ("")} aria-label="Clear">×</button> : null}
            </div>
            <button className="bn-close sf-setpick-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="sf-setpick-list">
            {!q ? (
              <button className={!set && !era ? "sf-setpick-row sf-setpick-cur" : "sf-setpick-row"} onClick={() => pick({ era: "", set: "" })}>
                <span>All sets</span>
              </button>
            ) : null}
            {groups.length === 0 ? <p className="hint sf-setpick-none">No set matches “{q}”.</p> : null}
            {groups.map((g) => (
              <section className="sf-setpick-group" key={g.era || "all"}>
                {g.era ? (
                  <button
                    className={era === g.era && !set ? "sf-setpick-era sf-setpick-cur" : "sf-setpick-era"}
                    onClick={() => pick({ era: g.era, set: "" })}
                  >
                    <span>{g.label}</span>
                    <span className="sf-setpick-n">All · {g.count}</span>
                  </button>
                ) : null}
                {g.sets.map((s) => (
                  <button
                    key={s.name}
                    className={set === s.name ? "sf-setpick-row sf-setpick-cur" : "sf-setpick-row"}
                    onClick={() => pick({ era: "", set: s.name })}
                  >
                    <span>{s.name}</span>
                    <span className="sf-setpick-n">{s.count}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
