"use client";

import { useState, useRef } from "react";
import CompFinderPricing from "@/lib/pricing.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;

function pounds(pence) {
  return pence == null ? "—" : CompFinderPricing.toPoundsStr(pence);
}

// Price an active-listing title against historic sold comps, using a tight
// name+number query so noisy eBay titles still find comps.
async function soldPriceForTitle(title) {
  const { query, nameTokens, number, graded, lot } = CompFinderPricing.buildCardQuery(title || "");
  if (lot) return { recPence: null, comps: 0, lot: true };
  const res = await fetch("/api/soldcomps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, options: { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 } })
  }).then((r) => r.json());
  if (!res || !res.ok) throw new Error((res && res.error) || "Pricing failed");
  const rec = CompFinderPricing.recommend(res.comps || [], settings, nameTokens, "sold", number || null, null);
  return { recPence: rec.finalPence ?? null, comps: rec.included.length, confidence: rec.confidence, graded, query };
}

export default function Arbitrage() {
  const [q, setQ] = useState("pokemon card");
  const [count, setCount] = useState(25);
  const [feePct, setFeePct] = useState(13);
  const [minRoi, setMinRoi] = useState(20);
  const [showAll, setShowAll] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const abortRef = useRef(false);

  function computeRow(listing, sold) {
    const activePence = listing.price != null ? Math.round(listing.price * 100) : null;
    const acqPence = activePence != null ? activePence + Math.round((listing.postage || 0) * 100) : null;
    const soldPence = sold.recPence;
    let profitPence = null;
    let roi = null;
    if (soldPence != null && acqPence != null && acqPence > 0) {
      const netResale = soldPence * (1 - feePct / 100);
      profitPence = Math.round(netResale - acqPence);
      roi = profitPence / acqPence;
    }
    return { listing, sold, activePence, acqPence, soldPence, profitPence, roi };
  }

  async function scan() {
    setScanning(true);
    setError("");
    setNote("");
    setResults([]);
    abortRef.current = false;
    try {
      const scanRes = await fetch(`/api/arbitrage/scan?q=${encodeURIComponent(q.trim() || "pokemon card")}&limit=${count}`).then((r) => r.json());
      if (!scanRes.ok) throw new Error(scanRes.error || "Scan failed.");
      const listings = scanRes.listings || [];
      if (listings.length === 0) {
        setNote("No active listings came back for that search.");
        setScanning(false);
        return;
      }
      setProgress({ done: 0, total: listings.length });

      const out = [];
      let i = 0;
      const CONCURRENCY = 3;
      async function worker() {
        while (i < listings.length && !abortRef.current) {
          const listing = listings[i++];
          try {
            const sold = await soldPriceForTitle(listing.title);
            out.push(computeRow(listing, sold));
          } catch {
            out.push(computeRow(listing, { recPence: null, comps: 0, confidence: "Low" }));
          }
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, listings.length) }, worker));

      out.sort((a, b) => (b.profitPence ?? -Infinity) - (a.profitPence ?? -Infinity));
      setResults(out);
      const wins = out.filter((r) => r.profitPence != null && r.profitPence > 0 && r.sold.comps >= 2).length;
      setNote(`Scanned ${out.length} listings · ${wins} potential opportunit${wins === 1 ? "y" : "ies"} found.`);
    } catch (err) {
      setError(err.message || "Something went wrong scanning.");
    } finally {
      setScanning(false);
    }
  }

  function stop() {
    abortRef.current = true;
  }

  const shown = results.filter((r) => {
    if (showAll) return true;
    return r.profitPence != null && r.sold.comps >= 2 && r.roi != null && r.roi * 100 >= minRoi;
  });

  return (
    <>
      <div className="panel">
        <div className="panel-head"><span className="eyebrow">Arbitrage scanner</span></div>
        <p className="hint" style={{ marginTop: 0 }}>
          Pulls the latest active listings for a search, then compares each against historic sold prices to surface
          cards listed below what they actually sell for. Each listing scanned uses one SoldComps request — keep the
          count modest to protect your quota.
        </p>

        <div className="filter-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
          <label className="field">
            <span>Search</span>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. pokemon base set" />
          </label>
          <label className="field">
            <span>Listings to scan</span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 25, 40, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>eBay fees %</span>
            <input type="number" min="0" max="30" step="0.5" value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Min ROI %</span>
            <input type="number" min="0" step="5" value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value))} />
          </label>
        </div>

        <div className="row" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={scan} disabled={scanning}>
            {scanning ? "Scanning…" : `Scan ${count} listings`}
          </button>
          {scanning ? <button className="btn btn-ghost" onClick={stop}>Stop</button> : null}
          <label className="checkbox-field" style={{ marginTop: 0 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span>Show all scanned (not just opportunities)</span>
          </label>
        </div>

        {scanning && progress.total > 0 ? (
          <div className="arb-progress">
            <div className="arb-bar" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            <span className="arb-progress-txt">Pricing {progress.done} / {progress.total}…</span>
          </div>
        ) : null}

        {note && !scanning ? <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{note}</p> : null}
        {error ? <p className="compfinder-error" style={{ marginTop: 10 }}>{error}</p> : null}
      </div>

      {shown.length > 0 ? (
        <div className="arb-grid">
          {shown.map((r) => {
            const good = r.profitPence != null && r.profitPence > 0;
            const trusted = r.sold.comps >= 2;
            return (
              <div className={`arb-card${good && trusted ? " arb-win" : ""}`} key={r.listing.itemId}>
                <div className="arb-thumb">
                  {r.listing.image ? <img src={r.listing.image} alt="" loading="lazy" /> : <span aria-hidden="true">🎴</span>}
                  {r.profitPence != null ? (
                    <span className={`arb-badge ${good ? "up" : "down"}`}>{good ? "+" : ""}{pounds(r.profitPence)}</span>
                  ) : null}
                </div>
                <div className="arb-body">
                  <a className="arb-title" href={r.listing.url || "#"} target="_blank" rel="noopener noreferrer">{r.listing.title}</a>
                  <div className="arb-nums">
                    <div><span className="k">Listed</span><span className="v">{pounds(r.activePence)}{r.listing.postage ? ` +${pounds(Math.round(r.listing.postage * 100))} p&p` : ""}</span></div>
                    <div><span className="k">Sold (est)</span><span className="v">{pounds(r.soldPence)} <em>· {r.sold.comps} comps</em></span></div>
                    <div>
                      <span className="k">Est. profit</span>
                      <span className={`v ${good ? "pos" : "neg"}`}>{r.profitPence != null ? `${good ? "+" : ""}${pounds(r.profitPence)}` : "—"}{r.roi != null ? ` (${Math.round(r.roi * 100)}%)` : ""}</span>
                    </div>
                  </div>
                  {r.sold.lot ? (
                    <div className="arb-warn">Multi-card lot — not priced.</div>
                  ) : r.sold.graded ? (
                    <div className="arb-warn">Graded card — priced vs raw comps, treat with caution.</div>
                  ) : !trusted ? (
                    <div className="arb-warn">Thin data — only {r.sold.comps} sold comp(s).</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : results.length > 0 && !scanning ? (
        <div className="panel"><p className="dd-empty">No listings cleared your {minRoi}% ROI threshold. Lower it or tick “show all”.</p></div>
      ) : null}
    </>
  );
}
