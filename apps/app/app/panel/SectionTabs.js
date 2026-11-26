"use client";

/**
 * The tab strip over a screen: every section of the module you are in, the
 * current one lit, and a line saying what this screen is for.
 *
 * The lab had this (LabHeader) and nothing else did. Pricing, eBay and
 * Cardmarket hold four, seven and two screens, and moving between them meant
 * opening the side menu every time, while the screen itself never said where
 * you were. Same strip, same classes, on every module with more than one
 * screen; LabHeader is now this component given the lab's four tabs.
 *
 * Links are ordinary anchors: the panel switches a plain click on a /panel
 * link in place (lib/client-nav.js), and a middle-click still opens a tab.
 */
export default function SectionTabs({ label, tabs, current, desc }) {
  return (
    <div className="section-head">
      <nav className="lh" aria-label={label}>
        {tabs.map((t) => (
          <a key={t.key} href={t.href} className={t.key === current ? "on" : ""} aria-current={t.key === current ? "page" : undefined}>{t.label}</a>
        ))}
      </nav>
      {desc ? <p className="section-desc">{desc}</p> : null}
    </div>
  );
}
