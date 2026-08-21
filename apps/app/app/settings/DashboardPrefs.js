"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Dashboard visibility preferences — lets the user choose which cards appear on
 * their home screen (some don't track a portfolio, etc.). Saved into
 * profiles.settings.dashboard as { key: boolean }; the Dashboard reads the same
 * map and hides anything switched off. Missing key = on by default.
 */
export const DASHBOARD_CARDS = [
  { key: "onboarding", label: "Get started checklist", desc: "Setup steps · auto-hides when done" },
  { key: "portfolio", label: "Portfolio & margins", desc: "Value, cost basis, potential margin" },
  { key: "valueChart", label: "Value over time", desc: "The trend chart" },
  { key: "costCoverage", label: "Cost coverage", desc: "Listings missing a cost" },
  { key: "aged", label: "Aged listings", desc: "Live over 90 days" },
  { key: "quickActions", label: "Quick actions", desc: "Shortcut buttons" }
];

export default function DashboardPrefs({ initialSettings }) {
  const initial = {};
  for (const c of DASHBOARD_CARDS) initial[c.key] = initialSettings?.dashboard?.[c.key] !== false;
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState("");

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setStatus("saving");
    try {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("profiles")
        .update({ settings: { ...initialSettings, dashboard: next } })
        .eq("id", user.id);
      if (error) throw new Error(error.message);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 480, marginTop: 20 }}>
      <div className="panel-head">
        <span className="eyebrow">Your dashboard</span>
        {status === "saving" ? <span className="badge2">Saving…</span> : status === "saved" ? <span className="badge2" style={{ color: "var(--conf-high)" }}>Saved ✓</span> : status === "error" ? <span className="badge2" style={{ color: "var(--bad-ink)" }}>Save failed</span> : null}
      </div>
      <p className="hint hint-small" style={{ marginTop: 0 }}>Choose what shows on your home screen. Changes save automatically.</p>
      <div className="pref-list">
        {DASHBOARD_CARDS.map((c) => (
          <div className="pref-i" key={c.key}>
            <div className="txt">
              <div className="pt">{c.label}</div>
              <div className="ps">{c.desc}</div>
            </div>
            <button
              className={`tgl${prefs[c.key] ? " on" : ""}`}
              role="switch"
              aria-checked={prefs[c.key]}
              aria-label={`${c.label}: ${prefs[c.key] ? "shown" : "hidden"}`}
              onClick={() => toggle(c.key)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
