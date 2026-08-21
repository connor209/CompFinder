"use client";

import { useEffect, useState } from "react";

/**
 * Cycles Auto → Light → Dark. "Auto" follows the OS via prefers-color-scheme
 * (no data-theme attribute); an explicit choice stamps data-theme on <html>
 * and persists to localStorage. A tiny inline script in layout.js re-applies
 * the saved choice before first paint, so there's no flash on load.
 */
const ORDER = ["system", "light", "dark"];
const META = {
  system: { icon: "🌗", label: "Auto" },
  light: { icon: "☀️", label: "Light" },
  dark: { icon: "🌙", label: "Dark" }
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState("system");

  useEffect(() => {
    const saved = localStorage.getItem("cf-theme");
    setTheme(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("cf-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("cf-theme", next);
    }
  }

  const m = META[theme];
  return (
    <button className="btn btn-ghost btn-theme" onClick={cycle} title={`Theme: ${m.label} — click to change`} aria-label={`Theme: ${m.label}. Click to change.`}>
      <span aria-hidden="true">{m.icon}</span> {m.label}
    </button>
  );
}
