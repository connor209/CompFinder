"use client";

import { useEffect, useState } from "react";

/**
 * Theme (skin) picker — swatch row in the context menu. A skin repaints the
 * whole token palette via data-skin on <html>, independent of the Auto/Light/
 * Dark control (every skin has full light + dark palettes). Persists to
 * localStorage; the layout.js boot script re-applies it before first paint.
 */
// `round` mirrors each theme's button shape so the swatch previews its FORM,
// not just its colour — the soft themes read as soft before you pick them.
export const SKINS = [
  { key: "", name: "Terminal", light: "#F1F5F4", accent: "#0C7B6E", round: 10 },
  { key: "cotton", name: "Cotton", light: "#FAF6F4", accent: "#D9718A", round: 16 },
  { key: "moss", name: "Moss", light: "#F2F3EF", accent: "#6C7F5B", round: 8 },
  { key: "vintage", name: "Vintage", light: "#F5EFE2", accent: "#B4622D", round: 9 },
  { key: "tabletop", name: "Tabletop", light: "#EEF2E9", accent: "#2F7D4E", round: 16 },
  { key: "glacier", name: "Glacier", light: "#EEF3F8", accent: "#1C6DD0", round: 6 },
  { key: "holo", name: "Holo", light: "#F4F2FB", accent: "#7A4FE0", round: 10 }
];

export default function SkinPicker() {
  const [skin, setSkin] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("cf-skin") || "";
    setSkin(SKINS.some((s) => s.key === saved) ? saved : "");
  }, []);

  function choose(next) {
    setSkin(next);
    if (!next) {
      document.documentElement.removeAttribute("data-skin");
      localStorage.removeItem("cf-skin");
    } else {
      document.documentElement.setAttribute("data-skin", next);
      localStorage.setItem("cf-skin", next);
    }
  }

  return (
    <div className="skin-row" role="group" aria-label="Theme">
      {SKINS.map((s) => (
        <button key={s.key} className="skin-btn" aria-pressed={skin === s.key} onClick={() => choose(s.key)} title={s.name}>
          <span
            className="skin-sw"
            aria-hidden="true"
            style={{ background: `linear-gradient(135deg, ${s.light} 0 50%, ${s.accent} 50% 100%)`, borderRadius: s.round }}
          />
          {s.name}
        </button>
      ))}
    </div>
  );
}
