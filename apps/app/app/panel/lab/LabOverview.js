"use client";

import { useEffect, useState } from "react";
import { DRAFT_KEY, restoreDraft } from "@/lib/lab-draft.js";
import { labOverview, PRICING_KEY } from "@/lib/lab-overview.js";

/**
 * Where every card is, at a glance: the Add copies list and a pricing run
 * (this device), and eBay (the account). Re-reads this device's list every
 * few seconds, so a run in another tab moves here too; asks for the lab again
 * while listing jobs are running on the server.
 */
export default function LabOverview({ lab, onReload }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 4000); return () => clearInterval(t); }, []);
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const rows = restoreDraft(read(DRAFT_KEY));
  let pricing = null;
  try { pricing = JSON.parse(read(PRICING_KEY) || "null"); } catch { pricing = null; }
  void tick; // re-rendered every few seconds so this device's list and a pricing run in another tab stay current
  const o = labOverview({ rows, lab, pricing, now: Date.now() });

  const busy = o.ebay.jobsRunning > 0 || o.draft.sending > 0;
  useEffect(() => {
    if (!busy || !onReload) return undefined;
    const t = setInterval(onReload, 8000);
    return () => clearInterval(t);
  }, [busy, onReload]);

  const d = o.draft;
  const tile = (label, n, { href, tone, sub } = {}) => {
    const body = (
      <>
        <span className="lo-n" style={tone ? { color: tone } : undefined}>{n}</span>
        <span className="lo-l">{label}</span>
        {sub && <span className="lo-s">{sub}</span>}
      </>
    );
    return href ? <a className="lo-tile" href={href}>{body}</a> : <div className="lo-tile">{body}</div>;
  };
  const fmt = (sec) => (sec == null ? "" : sec >= 90 ? `about ${Math.round(sec / 60)} min left` : `about ${sec}s left`);

  return (
    <section className="lo-wrap">
      <style>{CSS}</style>
      <div className="lo-head">
        <strong>Overview</strong>
        {busy && <span className="lo-live">● listing on eBay now</span>}
        {o.pricing && <span className="lo-live">● pricing now</span>}
      </div>

      {o.pricing && (
        <div className="lo-pricing">
          <span>Pricing {o.pricing.done} of {o.pricing.total} cards {fmt(o.pricing.left)}</span>
          <div className="lo-bar"><div style={{ width: `${o.pricing.total ? Math.round((o.pricing.done / o.pricing.total) * 100) : 0}%` }} /></div>
        </div>
      )}

      <div className="lo-group">
        <div className="lo-gl">Add copies <span>· this device</span></div>
        <div className="lo-tiles">
          {tile("cards in the list", d.rows - d.leftOut, { href: "/panel/lab/add", sub: `${d.copies} copies` })}
          {tile("not priced yet", d.unpriced, { href: "/panel/lab/add", tone: d.unpriced ? "var(--warn, #d9a441)" : undefined })}
          {tile("need a price", d.needsPrice, { href: "/panel/lab/add", tone: d.needsPrice ? "var(--warn, #d9a441)" : undefined })}
          {tile("check first", d.checkFirst, { href: "/panel/lab/add", tone: d.checkFirst ? "var(--warn, #d9a441)" : undefined })}
          {tile("ready to list", d.ready, { href: "/panel/lab/add", tone: d.ready ? "var(--good, #3fb68b)" : undefined })}
          {tile("listing on eBay", d.sending, { href: "/panel/lab/add", tone: d.sending ? "var(--accent)" : undefined })}
          {tile("failed", d.failed, { href: "/panel/lab/add", tone: d.failed ? "var(--bad)" : undefined })}
          {tile("listed from it", d.listed, { href: "/panel/lab/add" })}
        </div>
      </div>

      <div className="lo-group">
        <div className="lo-gl">eBay <span>· the account</span></div>
        <div className="lo-tiles">
          {tile("listing jobs running", o.ebay.jobsRunning, { tone: o.ebay.jobsRunning ? "var(--accent)" : undefined, sub: o.ebay.jobsRunning ? `${o.ebay.jobsListedSoFar} listed so far` : "" })}
          {tile("listed · last 24h", o.ebay.listed24h, { href: "/panel/lab/inventory" })}
          {tile("failed · last 24h", o.ebay.failed24h, { tone: o.ebay.failed24h ? "var(--bad)" : undefined })}
          {tile("live listings", o.ebay.liveListings, { href: "/panel/lab/inventory" })}
          {tile("copies for sale", o.ebay.forSale, { href: "/panel/lab/inventory" })}
          {tile("sold · last 24h", o.ebay.sold24h)}
          {tile("sold, to pull", o.ebay.awaitingPull, { href: "/panel/pull", tone: o.ebay.awaitingPull ? "var(--accent)" : undefined })}
          {o.ebay.errors24h > 0 && tile("errors · last 24h", o.ebay.errors24h, { tone: "var(--bad)", sub: "see the log below" })}
        </div>
      </div>
    </section>
  );
}

const CSS = `
.lo-wrap { border: 1px solid var(--line, #2a2f36); border-radius: 12px; padding: 12px; margin: 12px 0; display: flex; flex-direction: column; gap: 12px; }
.lo-head { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.lo-live { color: var(--accent); font-size: 13px; }
.lo-pricing { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.lo-bar { height: 8px; border-radius: 999px; background: var(--surface-sink, #111); overflow: hidden; }
.lo-bar > div { height: 100%; background: var(--accent); transition: width .4s ease; }
.lo-group { display: flex; flex-direction: column; gap: 6px; }
.lo-gl { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft, #9aa); }
.lo-gl span { text-transform: none; letter-spacing: 0; opacity: .8; }
.lo-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.lo-tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line, #2a2f36); background: var(--surface, transparent); color: inherit; text-decoration: none; min-width: 0; }
a.lo-tile:hover { border-color: var(--accent); }
.lo-n { font-size: 22px; font-weight: 700; line-height: 1.1; }
.lo-l { font-size: 12px; color: var(--ink-soft, #9aa); }
.lo-s { font-size: 11px; color: var(--ink-faint, #778); }
`;
