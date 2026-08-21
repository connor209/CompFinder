"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

const MARKET_LABELS = {
  "ebay.co.uk": "UK",
  "ebay.com": "US",
  "ebay.de": "DE",
  "ebay.fr": "FR",
  "ebay.it": "IT",
  "ebay.es": "ES",
  "ebay.ca": "CA",
  "ebay.com.au": "AU"
};

function fmtPence(pence) {
  if (pence == null) return "—";
  return `£${(pence / 100).toFixed(2)}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function HistoryView({ initialChecks }) {
  const [checks, setChecks] = useState(initialChecks);
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("");
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    return checks.filter((c) => {
      const haystack = `${c.title} ${c.sku || ""} ${c.query || ""}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesConfidence = !confidenceFilter || c.confidence === confidenceFilter;
      return matchesSearch && matchesConfidence;
    });
  }, [checks, search, confidenceFilter]);

  function exportCsv() {
    const header =
      "Date,SKU,Title,Query,Market,Data Source,Confidence,Comps Used,Comps Excluded,Current Price,Recommended Price,Note\n";
    const rows = filtered.map((c) =>
      [
        fmtDate(c.created_at),
        c.sku || "",
        c.title,
        c.query || "",
        MARKET_LABELS[c.ebay_site] || c.ebay_site || "",
        c.data_source || "",
        c.confidence || "",
        c.comps_used ?? "",
        c.comps_excluded ?? "",
        c.current_pence != null ? (c.current_pence / 100).toFixed(2) : "",
        c.recommended_pence != null ? (c.recommended_pence / 100).toFixed(2) : "",
        c.note || ""
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compfinder-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearHistory() {
    if (!confirm("Delete your entire price-check history? This can't be undone.")) return;
    setClearing(true);
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("price_checks").delete().eq("user_id", user.id);
    setClearing(false);
    if (error) {
      alert(`Could not clear history: ${error.message}`);
      return;
    }
    setChecks([]);
  }

  if (checks.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="eyebrow">Price-check history</span>
        </div>
        <p className="hint">
          Nothing here yet. Every item you price in the panel is saved automatically — run a batch and it'll show up
          here.
        </p>
      </section>
    );
  }

  return (
    <section className="panel results-panel">
      <div className="panel-head">
        <span className="eyebrow">Price-check history</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" disabled={filtered.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn btn-ghost" disabled={clearing} onClick={clearHistory}>
            {clearing ? "Clearing…" : "Clear history"}
          </button>
        </div>
      </div>

      <div className="results-toolbar">
        <input
          type="text"
          placeholder="Filter by title, SKU, or query…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
          <option value="">All confidence</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <span className="hint-small">
          {filtered.length === checks.length
            ? `${checks.length} check(s)`
            : `${filtered.length} of ${checks.length} check(s) shown`}
        </span>
      </div>

      <div className="table-wrap">
        <table id="compfinder-results">
          <thead>
            <tr>
              <th>Date</th>
              <th>SKU</th>
              <th>Title</th>
              <th>Query used</th>
              <th>Market</th>
              <th>Comps</th>
              <th>Confidence</th>
              <th>Current</th>
              <th>Recommended</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const isActive = c.data_source === "active";
              const confidenceLabel =
                c.confidence && isActive ? `${c.confidence} (active)` : c.confidence || "—";
              return (
                <tr key={c.id}>
                  <td>{fmtDate(c.created_at)}</td>
                  <td>{c.sku || "—"}</td>
                  <td>{c.title}</td>
                  <td>{c.query || "—"}</td>
                  <td>{MARKET_LABELS[c.ebay_site] || c.ebay_site || "—"}</td>
                  <td>
                    {c.comps_used ?? 0} used / {c.comps_excluded ?? 0} excluded
                  </td>
                  <td>
                    {c.confidence ? (
                      <span
                        className={`conf-badge conf-${c.confidence.toLowerCase()}${
                          isActive ? " conf-badge-active" : ""
                        }`}
                      >
                        {confidenceLabel}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{fmtPence(c.current_pence)}</td>
                  <td>{fmtPence(c.recommended_pence)}</td>
                  <td>{c.note || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
