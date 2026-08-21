"use client";

import { useMemo } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";

const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

/**
 * Sold-price trend. Sales are grouped by day and each point is that day's
 * median, so one unusually cheap or expensive sale doesn't read as a swing in
 * the market. The dashed line is the 90-day median the recommendation is
 * built from, which is what makes the shape mean something.
 *
 * A simplified version of the app's chart — no hover callouts or click-through,
 * since the public page's job is "is this rising or falling", not forensics.
 */
export default function TrendChart({ sales, medianPence }) {
  const days = useMemo(() => {
    const map = new Map();
    for (const s of sales) {
      if (!s.t) continue;
      const d = new Date(s.t);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, { t: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), items: [] });
      map.get(key).items.push(s.v);
    }
    return [...map.values()]
      .map((d) => {
        const sorted = d.items.slice().sort((a, b) => a - b);
        const m = Math.floor(sorted.length / 2);
        return { t: d.t, v: sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2) };
      })
      .sort((a, b) => a.t - b.t);
  }, [sales]);

  if (days.length < 2) {
    return <p className="dd-empty">Not enough dated sales to chart a trend yet.</p>;
  }

  const W = 720, H = 210, L = 52, R = 14, T = 14, B = 26;
  const times = days.map((d) => d.t), vals = days.map((d) => d.v);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const all = medianPence != null ? [...vals, medianPence] : vals;
  const vMinRaw = Math.min(...all), vMaxRaw = Math.max(...all);
  const pad = (vMaxRaw - vMinRaw) * 0.22 || vMaxRaw * 0.1 || 100;
  const vMin = Math.max(0, vMinRaw - pad), vMax = vMaxRaw + pad;
  const x = (t) => L + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - L - R);
  const y = (v) => T + ((vMax - v) / (vMax - vMin)) * (H - T - B);
  const line = days.map((d, i) => (i ? "L" : "M") + x(d.t).toFixed(1) + " " + y(d.v).toFixed(1)).join(" ");
  const area = `${line} L ${x(times[times.length - 1]).toFixed(1)} ${H - B} L ${x(times[0]).toFixed(1)} ${H - B} Z`;
  const grid = [0.2, 0.5, 0.8].map((f) => Math.round(vMin + (vMax - vMin) * f));
  const short = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sold price trend over the last 90 days">
      <defs>
        <linearGradient id="pubtg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity="0.10" />
          <text x={L - 9} y={y(g) + 4} textAnchor="end" fontSize="11.5" fill="currentColor" opacity="0.45" fontFamily="var(--font-mono)">{pounds(g)}</text>
        </g>
      ))}
      {medianPence != null && (
        <line x1={L} x2={W - R} y1={y(medianPence)} y2={y(medianPence)} stroke="currentColor" strokeOpacity="0.34" strokeWidth="1.5" strokeDasharray="5 4" />
      )}
      <path d={area} fill="url(#pubtg)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {days.map((d, i) => (
        <circle key={i} cx={x(d.t)} cy={y(d.v)} r={i === days.length - 1 ? 5 : 3.4}
          fill="var(--surface)" stroke="var(--accent)" strokeWidth={i === days.length - 1 ? 2.6 : 1.8} />
      ))}
      <text x={L} y={H - 7} fontSize="11" fill="currentColor" opacity="0.5">{short(times[0])}</text>
      <text x={W - R} y={H - 7} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.5">{short(times[times.length - 1])}</text>
    </svg>
  );
}
