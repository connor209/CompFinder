"use client";

import { useEffect, useState } from "react";

/**
 * Segmented appearance control (Auto / Light / Dark) for the context menu.
 * "Auto" follows the OS via prefers-color-scheme (no data-theme attribute); an
 * explicit choice stamps data-theme on <html> and persists to localStorage.
 * A tiny inline script in layout.js re-applies the saved choice before first
 * paint, so there's no flash on load — same mechanism the old toggle used.
 */
const OPTS = [
  { key: "system", label: "Auto", icon: "🌗" },
  { key: "light", label: "Light", icon: "☀️" },
  { key: "dark", label: "Dark", icon: "🌙" }
];

export default function ThemeSeg() {
  const [theme, setTheme] = useState("system");

  useEffect(() => {
    const saved = localStorage.getItem("cf-theme");
    setTheme(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  function choose(next) {
    setTheme(next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("cf-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("cf-theme", next);
    }
  }

  return (
    <div className="theme-seg" role="group" aria-label="Appearance">
      {OPTS.map((o) => (
        <button key={o.key} aria-pressed={theme === o.key} onClick={() => choose(o.key)}>
          <span aria-hidden="true">{o.icon}</span> {o.label}
        </button>
      ))}
    </div>
  );
}
