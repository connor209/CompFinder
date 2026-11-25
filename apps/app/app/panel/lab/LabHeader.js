"use client";

/**
 * One header for every lab page. The four pages each had their own — a row
 * of buttons on two, a "← Lab" link on one, nothing on another — so where you
 * were and how to get elsewhere changed from page to page. Now: the same tabs
 * in the same order, the current one lit, on every lab page.
 */
const TABS = [
  ["overview", "Overview", "/panel/lab"],
  ["batches", "Batches", "/panel/lab/add"],
  ["inventory", "Inventory", "/panel/lab/inventory"],
  ["settings", "Listing settings", "/panel/lab/settings"]
];

export default function LabHeader({ current }) {
  return (
    <nav className="lh" aria-label="Lab">
      {TABS.map(([key, label, href]) => (
        <a key={key} href={href} className={key === current ? "on" : ""} aria-current={key === current ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}

export const LAB_HEADER_CSS = `
.lh { display:flex; flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none; gap:4px; border-bottom:1px solid var(--line); margin:0 0 14px; }
.lh a { white-space:nowrap; padding:8px 12px; font-size:14px; color:var(--ink-soft); text-decoration:none; border-bottom:2px solid transparent; margin-bottom:-1px; }
.lh a:hover { color:var(--ink); }
.lh a.on { color:var(--ink); font-weight:600; border-bottom-color:var(--accent); }
`;
