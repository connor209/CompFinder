"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  loadStorefronts,
  createStorefront,
  revokeStorefront,
  resumeStorefront,
  storefrontUrl,
  storefrontStatus,
  isPermanent,
  canResume,
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

/**
 * Sticker sizes, as the printed side of the QR. 25mm is about the smallest a
 * phone reads from arm's length off a binder spine; the caption scales with it.
 */
const STICKER_SIZES = [
  { mm: 25, label: "Small stickers (25mm)" },
  { mm: 40, label: "Medium stickers (40mm)" },
  { mm: 60, label: "Large stickers (60mm)" }
];

/**
 * A sheet of the same QR, for sticker paper. Only offered on a PERMANENT link:
 * a sticker goes on boxes and binders that outlive any one show, so one tied
 * to a show or a date is a sticker that goes dead on everything it is stuck to.
 */
function printStickers(url, mm) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const svg = qrSvg(url);
  const cell = `<div class="st"><div class="qr">${svg}</div><div class="cap">Scan to browse our cards</div></div>`;
  // Enough to fill an A4 sheet at this size; the browser drops what overflows.
  const across = Math.max(1, Math.floor(186 / (mm + 6)));
  const down = Math.max(1, Math.floor(265 / (mm + mm * 0.18 + 8)));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR stickers</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(${across}, ${mm + 6}mm); gap: 2mm; justify-content: center; }
  .st { width: ${mm + 6}mm; text-align: center; padding: 1mm 0 2mm; break-inside: avoid; }
  .qr { width: ${mm}mm; height: ${mm}mm; margin: 0 auto; }
  .qr svg { width: 100%; height: 100%; }
  .cap { font-size: ${Math.max(6, Math.round(mm * 0.22))}pt; font-weight: 600; line-height: 1.15; }
</style></head><body>
<div class="sheet">${cell.repeat(across * down)}</div>
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
  const [stickerMm, setStickerMm] = useState(STICKER_SIZES[1].mm);
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
  // A switched-off permanent link is PAUSED, not over: its stickers are still
  // stuck to things, so it stays on the desk with a way back on.
  const paused = rows.filter(canResume);
  const past = rows.filter((r) => storefrontStatus(r, now) !== "live" && !canResume(r)).slice(0, 5);
  const showName = String(event || "").trim();
  // "Until I switch it off" is the permanent QR, and a permanent QR is never
  // tied to one show: the show name changes, the sticker doesn't.
  const permanent = Number(days) === 0;

  function startMaking(asPermanent) {
    setDays(asPermanent ? 0 : DEFAULT_EXPIRY_DAYS);
    setForEvent(!asPermanent);
    setMaking(true);
  }

  async function make() {
    setBusy(true);
    setMsg("");
    const r = await createStorefront(createClient(), {
      title: title.trim() || (permanent ? "" : showName) || "",
      event: forEvent && !permanent ? showName : "",
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
    const ask = isPermanent(row)
      ? "Pause this QR? Every printed copy will say the show has finished until you switch it back on here."
      : "Switch this link off? Anybody scanning the sign will be told the show has finished.";
    if (!window.confirm(ask)) return;
    setBusy(true);
    const r = await revokeStorefront(createClient(), row.id);
    setBusy(false);
    if (!r.ok) { setMsg(r.error || "Couldn't switch it off."); return; }
    await refresh();
  }

  async function switchBackOn(row) {
    setBusy(true);
    const r = await resumeStorefront(createClient(), row);
    setBusy(false);
    if (!r.ok) { setMsg(r.error || "Couldn't switch it back on."); return; }
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
          <div className="sf-actions">
            {!live.some(isPermanent) && paused.length === 0 ? (
              <button className="btn btn-ghost" onClick={() => startMaking(true)} title="One QR that never changes — print it as stickers and signs and reuse it at every show">
                ＋ Permanent QR
              </button>
            ) : null}
            <button className="btn btn-ghost" onClick={() => startMaking(false)}>
              {live.length > 0 ? "＋ Another link" : "＋ QR for this show"}
            </button>
          </div>
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
          {permanent ? (
            <span className="sf-check" title="A permanent QR shows whatever is checked out at the time — the same sticker works at every show">
              Every card checked out, at whichever show
            </span>
          ) : (
            <label className="sf-check" title={showName ? `Only cards checked out with the show name "${showName}"` : "Set a show name above to limit this link to one show"}>
              <input type="checkbox" checked={forEvent && Boolean(showName)} disabled={!showName} onChange={(e) => setForEvent(e.target.checked)} />
              {showName ? `Only “${showName}”` : "Every card checked out"}
            </label>
          )}
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
        const keep = isPermanent(row);
        return (
          <div className="sf-qr-row" key={row.id} style={{ marginTop: 10 }}>
            <QrCode url={url} />
            <div className="sf-qr-info">
              <strong>{row.title || "Our stock"}{keep ? " · permanent" : ""}</strong>
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
                {keep ? (
                  <>
                    <select className="sd-select" value={stickerMm} onChange={(e) => setStickerMm(Number(e.target.value))} aria-label="Sticker size">
                      {STICKER_SIZES.map((z) => <option key={z.mm} value={z.mm}>{z.label}</option>)}
                    </select>
                    <button className="btn btn-ghost" onClick={() => { if (!printStickers(url, stickerMm)) setMsg("Allow pop-ups to print the stickers."); }}>🏷 Print stickers</button>
                  </>
                ) : null}
                <button className="btn btn-ghost" onClick={() => downloadSvg(url, `storefront-qr-${row.token.slice(0, 6)}.svg`)}>QR as SVG</button>
                <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Open</a>
                <button className="btn btn-ghost" onClick={() => switchOff(row)} disabled={busy}>{keep ? "Pause" : "Switch off"}</button>
              </div>
            </div>
          </div>
        );
      })}

      {paused.map((row) => (
        <div className="sf-old" key={row.id} style={{ marginTop: 10 }}>
          <span>
            <b>Paused:</b> {row.title || "permanent QR"} — {row.views || 0} view{row.views === 1 ? "" : "s"}. Printed copies say the show has finished.
          </span>
          <button className="btn btn-ghost" onClick={() => switchBackOn(row)} disabled={busy}>Switch back on</button>
        </div>
      ))}

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
