"use client";

import { useEffect, useState } from "react";
import { DRAFT_KEY, restoreDraft } from "@/lib/lab-draft.js";
import { labOverview, PRICING_KEY } from "@/lib/lab-overview.js";
import { createClient } from "@/lib/supabase/client";
import { listLabBatches, batchStage, batchKind } from "@/lib/lab-batches.js";
import { isOpen } from "@/lib/pricing-queue.js";

/**
 * Where every card is, at a glance: your batches and the pricing queue (the
 * account, read from the server), and eBay (the account). Before migration
 * 047 there are no batches, and the old one-list-per-browser counts show
 * instead. Asks for the lab again while listing jobs are running.
 */
export default function LabOverview({ lab, onReload }) {
  const [tick, setTick] = useState(0);
  // Batches (047) and the pricing queue (048), the account's own — null until
  // read, false when there are none to read (the migration isn't run).
  const [batches, setBatches] = useState(null);
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const res = await listLabBatches(createClient());
      if (!live) return;
      setBatches(res.ok ? res.batches : false);
      const q = await fetch("/api/pricing-queue").then((r) => r.json()).catch(() => null);
      if (live && q?.ok) setJobs(q.jobs || []);
    };
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, []);
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
        <strong>Right now</strong>
        {busy && <span className="lo-live">● listing on eBay now</span>}
        {o.pricing && <span className="lo-live">● pricing now</span>}
      </div>

      {o.pricing && (
        <div className="lo-pricing">
          <span>Pricing {o.pricing.done} of {o.pricing.total} cards {fmt(o.pricing.left)}</span>
          <div className="lo-bar"><div style={{ width: `${o.pricing.total ? Math.round((o.pricing.done / o.pricing.total) * 100) : 0}%` }} /></div>
        </div>
      )}

      {batches ? (() => {
        const pricingIds = new Set(jobs.filter(isOpen).map((j) => j.batch_id));
        const inProgress = batches.filter((b) => b.card_count && b.listed_count < b.card_count);
        const sum = (f) => batches.reduce((t, b) => t + (f(b) || 0), 0);
        const toPrice = sum((b) => (b.priced_count == null ? 0 : b.card_count - b.priced_count));
        const ready = sum((b) => (b.priced_count == null ? 0 : Math.max(0, b.priced_count - b.listed_count)));
        const openJobs = jobs.filter(isOpen);
        const recent = [...inProgress].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 4);
        return (
          <div className="lo-group">
            <div className="lo-gl">Batches <span>· <a href="/panel/lab/add">see them all</a></span></div>
            <div className="lo-tiles">
              {tile("batches in progress", inProgress.length, { href: "/panel/lab/add", sub: `${batches.length} in all` })}
              {tile("cards to price", toPrice, { href: "/panel/lab/add", tone: toPrice ? "var(--warn, #d9a441)" : undefined })}
              {tile("in the pricing queue", openJobs.reduce((t, j) => t + Math.max(0, j.total - j.done), 0), { href: "/panel/lab/add", tone: openJobs.length ? "var(--accent)" : undefined, sub: openJobs.length ? `${openJobs.length} batch${openJobs.length === 1 ? "" : "es"} waiting` : "" })}
              {tile("priced, not listed", ready, { href: "/panel/lab/add", tone: ready ? "var(--good, #3fb68b)" : undefined })}
              {tile("listed from batches", sum((b) => b.listed_count), { href: "/panel/lab/inventory" })}
            </div>
            {recent.length ? (
              <div className="lo-recent">
                {recent.map((b) => {
                  const st = batchStage(b, { pricing: pricingIds.has(b.id) });
                  return (
                    <a key={b.id} className="lo-batch" href={`/panel/lab/add?batch=${b.id}`}>
                      {b.cover_url ? <img src={b.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="lo-noscan" />}
                      <span className="lo-bt"><b>{b.name}</b><span>{batchKind(b)} · {b.card_count} cards</span><span className={`lo-st st-${st.key}`}>{st.label}</span></span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className="lo-s" style={{ margin: 0 }}>Nothing in progress. <a href="/panel/lab/add?new=1">Start a new batch</a> from a CardUploader export.</p>
            )}
          </div>
        );
      })() : batches === false ? (
      <div className="lo-group">
        <div className="lo-gl">Add copies <span>· this browser (batches need migration 047)</span></div>
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

      ) : null}

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
.lo-gl a { color: var(--accent); }
.lo-recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.lo-batch { display: flex; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--line, #2a2f36); border-radius: 10px; color: inherit; text-decoration: none; min-width: 0; }
.lo-batch:hover { border-color: var(--accent); }
.lo-batch img, .lo-noscan { width: 40px; height: 56px; object-fit: contain; border-radius: 4px; background: var(--surface-2); flex: 0 0 auto; }
.lo-bt { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--ink-soft); min-width: 0; }
.lo-bt b { color: var(--ink); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lo-st { font-weight: 600; }
.lo-st.st-ready { color: var(--accent); } .lo-st.st-listed { color: var(--good); } .lo-st.st-pricing-needed { color: var(--warn); }
`;
