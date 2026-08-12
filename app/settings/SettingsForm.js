"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Covers the two most operationally important settings — the SoldComps key
 * and the item-location default — as a working example of the pattern.
 * The rest of options.html's thresholds (postage-outlier multiplier,
 * set-mismatch ratio, etc.) follow this exact same shape: a field here,
 * merged into the same settings JSONB column, no new plumbing needed.
 */
export default function SettingsForm({ initialApiKey, initialSettings }) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [itemLocation, setItemLocation] = useState(initialSettings.soldCompsItemLocation);
  const [monthlyQuota, setMonthlyQuota] = useState(initialSettings.soldCompsMonthlyQuota);
  const [ebayUsername, setEbayUsername] = useState(initialSettings.ebayUsername || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const { error: saveError } = await supabase
      .from("profiles")
      .update({
        soldcomps_api_key: apiKey.trim(),
        settings: {
          ...initialSettings,
          soldCompsItemLocation: itemLocation,
          soldCompsMonthlyQuota: Number(monthlyQuota),
          ebayUsername: ebayUsername.trim()
        }
      })
      .eq("id", user.id);

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSaved(true);
  }

  return (
    <section className="panel" style={{ maxWidth: 480 }}>
      <div className="panel-head">
        <span className="eyebrow">SoldComps account</span>
      </div>

      <form className="auth-form" onSubmit={handleSave}>
        <label>
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sc_..."
            autoComplete="off"
          />
        </label>
        <p className="hint hint-small">
          Stored in your own account row only — row-level security keeps it isolated from every other user. Get a
          key from your <a href="https://sold-comps.com/dashboard/api-keys" target="_blank" rel="noopener">SoldComps dashboard</a>.
        </p>

        <label>
          Item location default
          <select value={itemLocation} onChange={(e) => setItemLocation(e.target.value)}>
            <option value="domestic">Domestic sellers</option>
            <option value="default">Default</option>
            <option value="worldwide">Worldwide</option>
          </select>
        </label>

        <label>
          Monthly request quota (match your SoldComps plan)
          <input type="number" min="1" value={monthlyQuota} onChange={(e) => setMonthlyQuota(e.target.value)} />
        </label>

        <label>
          eBay username
          <input
            type="text"
            value={ebayUsername}
            onChange={(e) => setEbayUsername(e.target.value)}
            placeholder="your-ebay-id"
            autoComplete="off"
          />
        </label>
        <p className="hint hint-small">
          Optional. When set, a price check flags cards you already have listed on eBay (requires the app's eBay API keys to be configured).
        </p>

        {error && <p className="auth-error">{error}</p>}
        {saved && <p className="hint hint-small" style={{ color: "var(--conf-high)" }}>Saved.</p>}

        <button type="submit" className="btn btn-primary" disabled={saving} style={{ justifyContent: "center", marginTop: 4 }}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </section>
  );
}
