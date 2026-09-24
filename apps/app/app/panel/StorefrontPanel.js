"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  loadStorefronts,
  createStorefront,
  revokeStorefront,
  storefrontUrl,
  storefrontStatus,
  EXPIRY_CHOICES,
  DEFAULT_EXPIRY_DAYS
} from "@/lib/storefront-store.js";
import { qrPath, qrSvg } from "@/lib/qr.js";

/**
 * The QR on the table: make a link, print it, switch it off.
 *
 * The link opens the binder on a visitor's own phone (app/show/[token]) —
 * read-only, no request flow, no account. That is the cheapest honest test
 * docs/SHOW_STOREFRONT.md asks for before anything bigger: a sign, a list,
 * and a count of how many people looked. The count is on this panel.
 *
 * Desk chrome: ShowDesk renders it only when nobody but us is looking.
 */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function when(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The sign, as a page of its own, printed.
 *
 * A bare QR is a thing people walk past; "more cards than fit on this table"
 * is a reason to scan — the note is blunt that the sign does more of the work
 * than the software. Opened in its own window so the print is the sign and
 * nothing of the desk comes with it.
 */
function printSign(url, title) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Scan to browse</title>
<style>
  @page { margin: 12mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; color: #111; margin: 0; }
  h1 { font-size: 34pt; line-height: 1.1; margin: 8mm 0 6mm; }
  .qr { width: 120mm; height: 120mm; margin: 0 auto; }
  .qr svg { width: 100%; height: 100%; }
  p { font-size: 17pt; margin: 6mm 0 0; }
  .small { font-size: 11pt; color: #555; margin-top: 3mm; }
</style></head><body>
<h1>More cards than fit on this table</h1>
<div class="qr">${qrSvg(url)}</div>
<p>Scan to flip through everything we&rsquo;ve brought</p>
${title ? `<p class="small">${escapeHtml(title)}</p>` : ""}
<script>window.onload = function () { window.print(); };</script>
</body></html>`);
  w.document.close();
  return true;
}

function downloadSvg(url, name) {
  const blob = new Blob([qrSvg(url)], { type: "image/svg+xml" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function QrCode({ url }) {
  const { size, d } = useMemo(() => qrPath(url), [url]);
  return (
    <div className="sf-qr">
      <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the storefront link">
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
    </div>
  );
}

export default function StorefrontPanel({ event = "" }) {
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState("");
  const [forEvent, setForEvent] = useState(true);
  const [includeOnline, setIncludeOnline] = useState(true);
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [origin, setOrigin] = useState("");

  async function refresh() {
    const r = await loadStorefronts(createClient());
    setMissing(Boolean(r.missing));
    setRows(r.rows || []);
    if (!r.ok && !r.missing && r.error) setMsg(r.error);
    setLoaded(true);
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
  }, []);

  const now = new Date();
  const live = rows.filter((r) => storefrontStatus(r, now) === "live");
  const past = rows.filter((r) => storefrontStatus(r, now) !== "live").slice(0, 5);
  const showName = String(event || "").trim();

  async function make() {
    setBusy(true);
    setMsg("");
    const r = await createStorefront(createClient(), {
      title: title.trim() || showName || "",
      event: forEvent ? showName : "",
      includeOnline,
      days
    });
    setBusy(false);
    if (r.missing) { setMissing(true); return; }
    if (!r.ok) { setMsg(r.error || "Couldn't make the link."); return; }
    setMaking(false);
    setTitle("");
    await refresh();
  }

  async function switchOff(row) {
    if (!window.confirm("Switch this link off? Anybody scanning the sign will be told the show has finished.")) return;
    setBusy(true);
    const r = await revokeStorefront(createClient(), row.id);
    setBusy(false);
    if (!r.ok) { setMsg(r.error || "Couldn't switch it off."); return; }
    await refresh();
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Link copied.");
    } catch {
      setMsg(url);
    }
  }

  if (!loaded) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="eyebrow">QR for visitors — browse the box on their own phone</span>
        {!missing && !making ? (
          <button className="btn btn-ghost" onClick={() => setMaking(true)}>
            {live.length > 0 ? "＋ Another link" : "＋ Make a QR"}
          </button>
        ) : null}
      </div>

      {missing ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          Needs a one-off setup: run <code>supabase/migrations/029_show_storefronts.sql</code> in the Supabase SQL editor. Nothing else on this screen depends on it.
        </p>
      ) : null}

      {!missing && live.length === 0 && !making ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          A read-only binder of what&apos;s checked out — and, if you like, what&apos;s listed online — behind a QR code. No SKUs, no stack positions, nothing a visitor can press but the pages. Print it as a sign for the table.
        </p>
      ) : null}

      {making ? (
        <div className="sf-form">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={showName ? `Heading visitors see — e.g. ${showName}` : "Heading visitors see — e.g. your shop name"}
            aria-label="Heading visitors see"
          />
          <label className="sf-check" title={showName ? `Only cards checked out with the show name "${showName}"` : "Set a show name above to limit this link to one show"}>
            <input type="checkbox" checked={forEvent && Boolean(showName)} disabled={!showName} onChange={(e) => setForEvent(e.target.checked)} />
            {showName ? `Only “${showName}”` : "Every card checked out"}
          </label>
          <label className="sf-check" title="Listed cards go on pages of their own, marked “ask”, with their eBay price">
            <input type="checkbox" checked={includeOnline} onChange={(e) => setIncludeOnline(e.target.checked)} />
            Include what&apos;s listed online
          </label>
          <select className="sd-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How long the link stays up">
            {EXPIRY_CHOICES.map((c) => <option key={c.days} value={c.days}>Live {c.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={make} disabled={busy}>{busy ? "Making…" : "Make the link"}</button>
          <button className="btn btn-ghost" onClick={() => setMaking(false)} disabled={busy}>Cancel</button>
        </div>
      ) : null}

      {live.map((row) => {
        const url = storefrontUrl(origin, row.token);
        return (
          <div className="sf-qr-row" key={row.id} style={{ marginTop: 10 }}>
            <QrCode url={url} />
            <div className="sf-qr-info">
              <strong>{row.title || "Our stock"}</strong>
              <span className="sf-url">{url}</span>
              <span className="hint-small" style={{ marginTop: 0 }}>
                {row.event ? `Cards checked out for “${row.event}”` : "Every card checked out"}
                {row.include_online ? " + what's listed online" : ""}
                {" · "}{row.expires_at ? `until ${when(row.expires_at)}` : "until you switch it off"}
              </span>
              {/* Whether anybody scans is the question that decides whether
                  any of the rest of docs/SHOW_STOREFRONT.md is worth building. */}
              <span className="hint-small" style={{ marginTop: 0 }}>
                <b>{row.views || 0}</b> view{row.views === 1 ? "" : "s"}{row.last_viewed_at ? ` · last ${when(row.last_viewed_at)}` : ""}
              </span>
              <div className="sf-actions">
                <button className="btn btn-primary" onClick={() => { if (!printSign(url, row.title)) setMsg("Allow pop-ups to print the sign."); }}>🖨 Print sign</button>
                <button className="btn btn-ghost" onClick={() => copy(url)}>Copy link</button>
                <button className="btn btn-ghost" onClick={() => downloadSvg(url, `storefront-qr-${row.token.slice(0, 6)}.svg`)}>QR as SVG</button>
                <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Open</a>
                <button className="btn btn-ghost" onClick={() => switchOff(row)} disabled={busy}>Switch off</button>
              </div>
            </div>
          </div>
        );
      })}

      {past.length > 0 ? (
        <div className="sf-old" style={{ marginTop: 10 }}>
          <span>Earlier:</span>
          {past.map((r) => (
            <span key={r.id}>
              {r.title || r.event || "link"} — {r.views || 0} view{r.views === 1 ? "" : "s"} ({storefrontStatus(r, now) === "off" ? "switched off" : "ran out"})
            </span>
          ))}
        </div>
      ) : null}

      {msg ? <p className="hint hint-small">{msg}</p> : null}
    </div>
  );
}
