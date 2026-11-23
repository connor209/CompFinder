"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CardUploaderCsv from "@/lib/carduploader.js";
import { groupsFromItems, desiredFor, pickList, pilePositions, listingForGroup, priceFromComps, listBlockers, PHOTO_PROMISE } from "@/lib/lab-copies.js";

/**
 * The lab screen. Four parts, top to bottom: the scorecard the test is judged
 * on, adding copies from a CardUploader export, the live listings with their
 * queues, and the pick list. Nothing here is linked from the rest of the app.
 */

const SETTINGS_KEY = "cf-lab-settings";
const box = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16 };
const row = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const thumb = { width: 64, height: 88, objectFit: "contain", background: "var(--surface-sink)", borderRadius: 6, border: "1px solid var(--line)" };
const small = { fontSize: 13, color: "var(--ink-soft)" };
const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch { return {}; }
}

async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

export default function LabCopies() {
  const [lab, setLab] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [file, setFile] = useState(null); // { name, groups, refused }
  const [prices, setPrices] = useState({});
  const [comps, setComps] = useState({}); // group key → { pence, confidence, n, flags, error }
  const [progress, setProgress] = useState(null); // { label, done, total }
  const [failures, setFailures] = useState([]); // [{ title, error }] from the last List all
  const [preview, setPreview] = useState(null); // group key
  const [settings, setSettings] = useState({ categoryId: "183454", postcode: "", shippingCost: "0", dispatchDays: "2", returnsDays: "14" });

  useEffect(() => { setSettings((s) => ({ ...s, ...loadSettings() })); }, []);
  const saveSettings = (patch) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    return next;
  });

  const reload = useCallback(async () => setLab(await api()), []);
  useEffect(() => { reload(); }, [reload]);

  // eBay sale notifications: read once on open, since asking costs two eBay calls.
  const [notify, setNotify] = useState(null); // { state } | { error }
  const loadNotify = useCallback(async () => {
    const r = await api({ action: "notifyState" });
    setNotify(r.ok ? { state: r.state } : { error: r.error });
  }, []);
  // Keyed on a boolean that actually CHANGES when the lab arrives. `lab?.missing`
  // is undefined before the load and after it, so the effect never re-ran and
  // the line sat on "Asking eBay…" for ever.
  const labReady = Boolean(lab && lab.ok !== false && !lab.missing);
  useEffect(() => { if (labReady) loadNotify(); }, [labReady, loadNotify]);

  async function notifyOn() {
    const url = `${window.location.origin}/api/lab/ebay-notify`;
    if (!window.confirm(`Turn on eBay sale notifications?\n\neBay will tell ${url} the moment anything on your account sells. Only lab listings are acted on; every other sale is ignored.`)) return;
    setBusy("notify");
    let r = await api({ action: "notifyOn", url });
    if (!r.ok && r.needsReplace) {
      if (window.confirm(`${r.error}\n\nThat setting covers this app's whole eBay connection. Replace it with ${url}?`)) {
        r = await api({ action: "notifyOn", url, replace: true });
      }
    }
    setBusy(null);
    if (r.ok) setNotify({ state: r.state });
    else if (!r.needsReplace) setMsg({ bad: true, text: r.error });
    reload();
  }

  async function notifyOff() {
    if (!window.confirm("Turn sale notifications off? The listings then only move on when you press Check for sales.")) return;
    setBusy("notify");
    const r = await api({ action: "notifyOff" });
    setBusy(null);
    if (r.ok) setNotify({ state: r.state }); else setMsg({ bad: true, text: r.error });
    reload();
  }

  const copies = lab?.copies || [];
  const listings = lab?.listings || [];
  const events = lab?.events || [];
  const picks = useMemo(() => pickList(copies), [copies]);
  const pos = useMemo(() => pilePositions(copies), [copies]);
  const bySku = useMemo(() => new Map(copies.map((c) => [String(c.id), c])), [copies]);

  const score = useMemo(() => {
    const count = (k) => events.filter((e) => e.kind === k).length;
    return {
      sold: count("reserved") + count("mismatch"),
      notified: count("notified"),
      mismatch: count("mismatch"),
      moved: count("pictures"),
      oversold: count("oversold"),
      errors: count("error")
    };
  }, [events]);

  async function run(label, body, after) {
    setBusy(label);
    setMsg(null);
    const r = await api(body);
    setBusy(null);
    if (!r.ok) setMsg({ bad: true, text: r.error || "That didn't work." });
    else if (after) after(r);
    await reload();
    return r;
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const items = CardUploaderCsv.extractItems(String(reader.result || ""));
        const { groups, refused } = groupsFromItems(items);
        setFile({ name: f.name, groups, refused, rows: items.length });
        setPreview(null);
      } catch (err) {
        setFile({ name: f.name, groups: [], refused: [], error: err.message || "Couldn't read that file." });
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  function priceOf(key) {
    const v = String(prices[key] || "").replace(/[£\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
    return Math.round(Number(v) * 100);
  }

  const joinOf = (g) => listingForGroup(lab?.listings || [], g);

  /**
   * Price every group from sold comps through /api/batch-comps — the app's
   * own batch pricer, house rules and all, unchanged. One card per group (its
   * head copy: the copies are the same card in the same condition), fifty to
   * a request and one request at a time, as that route asks. A typed price is
   * never overwritten; an unpriced group stays blank and blocks List all.
   */
  async function priceAll() {
    const todo = (file?.groups || []).filter((g) => !joinOf(g));
    if (!todo.length) return;
    setBusy("price");
    setMsg(null);
    setProgress({ label: "Pricing from sold comps", done: 0, total: todo.length });
    const next = {};
    for (let i = 0; i < todo.length; i += 50) {
      const chunk = todo.slice(i, i + 50);
      const cards = chunk.map((g) => ({
        sku: g.copies[0].sku, name: g.cardName, number: g.cardNumber, set: g.set, title: g.title, condition: g.condition, language: g.language
      }));
      try {
        const res = await fetch("/api/batch-comps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) });
        const j = await res.json();
        if (!res.ok || !j.results) throw new Error(j.error || `Pricing answered ${res.status}.`);
        const bySku = new Map(j.results.map((r) => [String(r.sku), r]));
        for (const g of chunk) {
          const r = bySku.get(String(g.copies[0].sku));
          const flags = r?.flags ? Object.keys(r.flags).filter((k) => r.flags[k]) : [];
          next[g.key] = { pence: priceFromComps(r), confidence: r?.confidence || null, n: r?.n_comps ?? null, flags };
        }
      } catch (e) {
        for (const g of chunk) next[g.key] = { pence: null, error: e.message };
      }
      setProgress({ label: "Pricing from sold comps", done: Math.min(i + 50, todo.length), total: todo.length });
    }
    setComps((c) => ({ ...c, ...next }));
    setPrices((p) => {
      const out = { ...p };
      for (const [k, v] of Object.entries(next)) if (!String(out[k] || "").trim() && v.pence != null) out[k] = (v.pence / 100).toFixed(2);
      return out;
    });
    setProgress(null);
    setBusy(null);
  }

  /** Every group in the file, one at a time: new listings and joins alike. */
  async function listAll() {
    const groups = file?.groups || [];
    const blockers = listBlockers(groups.filter((g) => !joinOf(g)), priceOf);
    if (blockers.length) {
      setMsg({ bad: true, text: `No price yet for ${blockers.slice(0, 3).join(", ")}${blockers.length > 3 ? ` and ${blockers.length - 3} more` : ""}. Type one, or price from sold comps.` });
      return;
    }
    const joins = groups.filter((g) => joinOf(g));
    const fresh = groups.filter((g) => !joinOf(g));
    const total = fresh.reduce((t, g) => t + priceOf(g.key) * g.copies.length, 0);
    const ok = window.confirm(
      `List ${groups.length} card${groups.length === 1 ? "" : "s"} on eBay — LIVE.\n\n` +
      `${fresh.length} new listing${fresh.length === 1 ? "" : "s"} (${fresh.reduce((t, g) => t + g.copies.length, 0)} copies, ${gbp(total)} in all)\n` +
      `${joins.length} joining a listing already live (its price stays)\n\nGo?`
    );
    if (!ok) return;
    setBusy("listAll");
    setMsg(null);
    setFailures([]);
    const failed = [];
    const done = new Set();
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      setProgress({ label: "Listing", done: i, total: groups.length });
      const r = await api({ action: "create", group: g, pricePence: priceOf(g.key), settings: { ...settings, shippingCost: Number(settings.shippingCost) || 0 } });
      if (r.ok) done.add(g.key);
      else failed.push({ title: g.title, error: r.error || "Failed." });
    }
    setProgress(null);
    setBusy(null);
    setFailures(failed);
    setFile((f) => f && { ...f, groups: f.groups.filter((x) => !done.has(x.key)) });
    setMsg(failed.length
      ? { bad: true, text: `${done.size} listed, ${failed.length} failed — see below. The failed ones are still in the list to retry.` }
      : { text: `All ${done.size} listed.` });
    await reload();
  }

  async function list(g) {
    const joining = joinOf(g);
    const pence = joining ? joining.price_pence : priceOf(g.key);
    if (pence == null) { setMsg({ bad: true, text: "Type a price first." }); return; }
    const ok = window.confirm(joining
      ? `Add ${g.copies.length} cop${g.copies.length === 1 ? "y" : "ies"} to "${joining.title}" (eBay ${joining.ebay_item_id})?\n\nIts quantity goes up by ${g.copies.length}; its price stays at ${gbp(joining.price_pence)}.`
      : `List "${g.title}" on eBay — LIVE, real buyers can buy it.\n\n` +
        `${g.condition} · quantity ${g.copies.length} · ${gbp(pence)} each\nShowing ${g.copies[0].sku}'s scans.\n\nList it?`
    );
    if (!ok) return;
    await run(`list-${g.key}`, {
      action: "create", group: g, pricePence: pence,
      settings: { ...settings, shippingCost: Number(settings.shippingCost) || 0 }
    }, (r) => {
      setMsg({ text: r.joined
        ? `Added to eBay ${r.itemId}: quantity ${r.from ?? "?"} → ${r.to}.`
        : `Listed — eBay item ${r.itemId}.${r.warnings?.length ? ` eBay warned: ${r.warnings.join(" ")}` : ""}` });
      setFile((f) => f && { ...f, groups: f.groups.filter((x) => x.key !== g.key) });
      setPreview(null);
    });
  }

  if (!lab) return <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>Loading the lab…</main>;
  if (lab.missing) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
        <h1>Lab · quantity listings</h1>
        <p>Run <code>supabase/migrations/039_lab_copies.sql</code> in the Supabase SQL editor first. It only adds the lab&apos;s own three tables.</p>
      </main>
    );
  }

  const previewGroup = file?.groups.find((g) => g.key === preview) || null;
  const rank = (g) => {
    if (joinOf(g)) return 3;
    const c = comps[g.key];
    if (priceOf(g.key) == null) return 0;
    if (c && (c.confidence === "low" || c.confidence === "none" || (c.flags || []).length)) return 1;
    return 2;
  };

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16, color: "var(--ink)" }}>
      <h1 style={{ marginBottom: 4 }}>Lab · quantity listings</h1>
      <p style={small}>
        A side build. One listing per card and condition at quantity N, showing the copy that goes next. It has its
        own tables, and nothing else in the app reads them. See <code>docs/LAB_COPIES.md</code>.
      </p>

      {/* ---------------- The scorecard: what the test is judged on ---------------- */}
      <section style={box}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong>Scorecard</strong>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => run("check", { action: "check" }, (r) => setLastCheck(r))}>
            {busy === "check" ? "Checking eBay…" : "↻ Check for sales"}
          </button>
        </div>
        <div style={{ ...row, gap: 24, marginTop: 12 }}>
          <span>Sales reserved <strong>{score.sold}</strong></span>
          <span style={{ color: score.mismatch ? "var(--bad)" : undefined }}>Buyer saw a different copy <strong>{score.mismatch}</strong></span>
          <span>Photo moves <strong>{score.moved}</strong></span>
          <span style={{ color: score.oversold ? "var(--bad)" : undefined }}>Oversold <strong>{score.oversold}</strong></span>
          <span style={{ color: score.errors ? "var(--warn)" : undefined }}>Errors <strong>{score.errors}</strong></span>
          <span>Notifications <strong>{score.notified}</strong></span>
        </div>
        {lastCheck && (
          <div style={{ ...small, marginTop: 10 }}>
            Last check: {lastCheck.reserved} reserved, {lastCheck.moved} photo{lastCheck.moved === 1 ? "" : "s"} moved
            {lastCheck.mismatched ? `, ${lastCheck.mismatched} where the buyer saw a different copy` : ""}.
            {lastCheck.orders != null ? ` Read ${lastCheck.orders} order line${lastCheck.orders === 1 ? "" : "s"} from the last ${lastCheck.windowHours}h; asked eBay about ${lastCheck.asked} listing${lastCheck.asked === 1 ? "" : "s"}.` : ""}
            {(lastCheck.notes || []).map((n, i) => <div key={i}>⚠ {n}</div>)}
            {(lastCheck.quantities || []).map((q) => (
              <div key={q.listingId}>
                ⚠ {q.title}: eBay has {q.ebay} for sale, the queue has {q.ours}.{" "}
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => {
                  if (window.confirm(`Set eBay's quantity for "${q.title}" to ${q.ours}?`)) run(`q-${q.listingId}`, { action: "setQuantity", listingId: q.listingId });
                }}>Set eBay to {q.ours}</button>
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: 10, color: msg.bad ? "var(--bad)" : "var(--good)" }}>{msg.text}</div>}
        <div style={{ ...row, justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12 }}>
          <div style={small}>
            {!notify && "Asking eBay about sale notifications…"}
            {notify?.error && <span style={{ color: "var(--warn)" }}>Couldn&apos;t read eBay&apos;s notification settings: {notify.error}</span>}
            {notify?.state && (notify.state.saleEnabled && notify.state.appEnabled && notify.state.url === (typeof window !== "undefined" ? `${window.location.origin}/api/lab/ebay-notify` : "")
              ? <span style={{ color: "var(--good)" }}>● Sale notifications on: a sale moves the photo on by itself, within about a minute.</span>
              : <span>○ Sale notifications off: listings only move on when you press Check for sales.{notify.state.url ? ` (eBay currently sends this app's notifications to ${notify.state.url}.)` : ""}</span>)}
            {notify?.state && !notify.state.devIdSet && (
              <div style={{ color: "var(--warn)" }}>
                EBAY_DEV_ID isn&apos;t set, so notifications can&apos;t be signature-checked. They still work, but are only treated as a prompt to check eBay.
              </div>
            )}
          </div>
          {notify?.state && (notify.state.saleEnabled
            ? <button className="btn btn-ghost" disabled={!!busy} onClick={notifyOff}>Turn off</button>
            : <button className="btn" disabled={!!busy} onClick={notifyOn}>{busy === "notify" ? "Setting up…" : "Turn on sale notifications"}</button>)}
        </div>
      </section>

      {/* ---------------- Pick ---------------- */}
      <section style={box}>
        <strong>Pick ({picks.length})</strong>
        <p style={small}>Reserved copies still on the shelf, deepest first, so every number above stays true as you pull.</p>
        {picks.length === 0 && <p style={small}>Nothing to pick.</p>}
        {picks.map((c) => (
          <div key={c.id} style={{ ...row, borderTop: "1px solid var(--line)", padding: "8px 0" }}>
            {c.scan_urls?.[0] ? <img src={c.scan_urls[0]} alt="" style={thumb} referrerPolicy="no-referrer" /> : <div style={thumb} />}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div><strong>{c.sku}</strong> · card {c.position ?? "?"} in the LAB pile</div>
              <div style={small}>{listings.find((l) => l.id === c.listing_id)?.title} · order {c.reserved_order}</div>
              {c.reserved_mismatch && <div style={{ color: "var(--bad)", fontSize: 13 }}>⚠ This buyer was shown a different copy. Check the photo on the order before sending.</div>}
            </div>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run(`pull-${c.id}`, { action: "pull", copyId: c.id })}>Picked</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => {
              if (window.confirm(`Release ${c.sku}? Only for a CANCELLED order. It goes back into its queue.`)) run(`rel-${c.id}`, { action: "release", copyId: c.id });
            }}>Release</button>
          </div>
        ))}
      </section>

      {/* ---------------- Live listings ---------------- */}
      <section style={box}>
        <strong>Listings ({listings.filter((l) => !l.ended_at).length} live)</strong>
        {listings.length === 0 && <p style={small}>None yet. Add copies below.</p>}
        {listings.map((l) => {
          const d = desiredFor(l, copies);
          const mine = copies.filter((c) => c.listing_id === l.id);
          const showing = l.pictured_copy_id ? bySku.get(String(l.pictured_copy_id)) : null;
          return (
            <div key={l.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0", opacity: l.ended_at ? 0.55 : 1 }}>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <div>
                  <strong>{l.title}</strong>
                  <div style={small}>
                    {l.condition} · {gbp(l.price_pence)} · {d.quantity} for sale ·{" "}
                    {l.ebay_item_id
                      ? <a href={`https://www.ebay.co.uk/itm/${l.ebay_item_id}`} target="_blank" rel="noreferrer">eBay {l.ebay_item_id}</a>
                      : "not on eBay"}
                    {l.ended_at ? " · ended" : ""}
                    {l.checked_at ? ` · checked ${new Date(l.checked_at).toLocaleString()}` : ""}
                  </div>
                </div>
                {!l.ended_at && (
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => {
                    if (window.confirm(`End "${l.title}" on eBay? Copies still in the queue stay in the LAB pile.`)) run(`end-${l.id}`, { action: "end", listingId: l.id });
                  }}>End listing</button>
                )}
              </div>
              <div style={{ ...row, marginTop: 8 }}>
                {mine.sort((a, b) => a.pile_seq - b.pile_seq).map((c) => {
                  const state = c.pulled_at ? "pulled" : c.reserved_line ? "sold" : d.head?.id === c.id ? "next" : "queued";
                  const isShowing = showing?.id === c.id;
                  return (
                    <div key={c.id} style={{ textAlign: "center", fontSize: 12, opacity: c.pulled_at ? 0.4 : 1 }}>
                      {c.scan_urls?.[0] ? <img src={c.scan_urls[0]} alt="" style={{ ...thumb, outline: isShowing ? "3px solid var(--accent)" : "none" }} referrerPolicy="no-referrer" /> : <div style={thumb} />}
                      <div><strong>{c.sku}</strong>{pos.get(String(c.id)) ? ` · #${pos.get(String(c.id))}` : ""}</div>
                      <div style={{ color: state === "sold" ? "var(--warn)" : state === "next" ? "var(--accent)" : "var(--ink-soft)" }}>
                        {isShowing ? "on eBay now" : state}
                      </div>
                    </div>
                  );
                })}
              </div>
              {showing && d.head && showing.id !== d.head.id && !l.ended_at && (
                <div style={{ color: "var(--warn)", fontSize: 13, marginTop: 6 }}>
                  ⚠ eBay is still showing {showing.sku}, which has sold. Press Check for sales to move it on to {d.head.sku}.
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ---------------- Add copies ---------------- */}
      <section style={box}>
        <strong>Add copies from a CardUploader export</strong>
        <p style={small}>
          Recognise the LAB stack in CardUploader and export it, but <strong>don&apos;t list it there</strong>. Copies of the same
          card in the same condition become one listing, and they sell in the order they sit in the file.
        </p>
        <div style={row}>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={small}>Listing settings</summary>
          <div style={{ ...row, marginTop: 8 }}>
            <label className="field"><span>Category ID</span><input value={settings.categoryId} onChange={(e) => saveSettings({ categoryId: e.target.value })} /></label>
            <label className="field"><span>Postcode</span><input value={settings.postcode} onChange={(e) => saveSettings({ postcode: e.target.value })} /></label>
            <label className="field"><span>Postage £</span><input value={settings.shippingCost} onChange={(e) => saveSettings({ shippingCost: e.target.value })} /></label>
            <label className="field"><span>Dispatch days</span><input value={settings.dispatchDays} onChange={(e) => saveSettings({ dispatchDays: e.target.value })} /></label>
            <label className="field"><span>Returns days (blank = none)</span><input value={settings.returnsDays} onChange={(e) => saveSettings({ returnsDays: e.target.value })} /></label>
          </div>
          <p style={small}>If your eBay business policies are linked in Settings, those are used for postage and returns instead.</p>
        </details>

        {file?.error && <p style={{ color: "var(--bad)" }}>{file.error}</p>}
        {file && !file.error && (
          <div style={{ marginTop: 12 }}>
            <div style={small}>{file.name}: {file.rows} rows → {file.groups.length} listing{file.groups.length === 1 ? "" : "s"}{file.refused.length ? `, ${file.refused.length} refused` : ""}.</div>
            {file.refused.map((r) => <div key={r.sku} style={{ fontSize: 13, color: "var(--warn)" }}>✗ {r.sku} — {r.why}</div>)}
            <div style={{ ...row, margin: "10px 0" }}>
              <button className="btn" disabled={!!busy || !file.groups.some((g) => !joinOf(g))} onClick={priceAll}>
                {busy === "price" ? "Pricing…" : "£ Price from sold comps"}
              </button>
              <button className="btn btn-primary" disabled={!!busy || !file.groups.length} onClick={listAll}>
                {busy === "listAll" ? "Listing…" : `List all ${file.groups.length} on eBay (live)`}
              </button>
              {progress && <span style={small}>{progress.label}: {progress.done} of {progress.total}…</span>}
            </div>
            {failures.map((f, i) => <div key={i} style={{ fontSize: 13, color: "var(--bad)" }}>✗ {f.title} — {f.error}</div>)}
            {/* Exceptions first: no price, a thin or flagged price, then the rest. */}
            {file.groups.slice().sort((a, b) => rank(a) - rank(b)).map((g) => (
              <div key={g.key} style={{ ...row, borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <img src={g.copies[0].scans[0]} alt="" style={thumb} referrerPolicy="no-referrer" />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div><strong>{g.title}</strong></div>
                  <div style={small}>{g.condition} · {g.copies.length} cop{g.copies.length === 1 ? "y" : "ies"}: {g.copies.map((c) => c.sku).join(", ")}</div>
                  {joinOf(g) && (
                    <div style={{ fontSize: 13, color: "var(--accent)" }}>
                      Joins eBay {joinOf(g).ebay_item_id}: quantity +{g.copies.length}, price stays {gbp(joinOf(g).price_pence)}
                    </div>
                  )}
                  {!joinOf(g) && comps[g.key] && <CompsNote c={comps[g.key]} typed={priceOf(g.key)} />}
                </div>
                {!joinOf(g) && (
                  <label className="field" style={{ width: 110 }}><span>Price £</span>
                    <input inputMode="decimal" value={prices[g.key] || ""} onChange={(e) => setPrices((p) => ({ ...p, [g.key]: e.target.value }))} />
                  </label>
                )}
                <button className="btn" onClick={() => setPreview(preview === g.key ? null : g.key)}>{preview === g.key ? "Close preview" : "Preview"}</button>
              </div>
            ))}
          </div>
        )}

        {previewGroup && (
          <div style={{ ...box, marginTop: 12, background: "var(--surface-2)" }}>
            <div style={small}>As a buyer will see it</div>
            <h3 style={{ margin: "6px 0" }}>{previewGroup.title}</h3>
            <div>Condition: Ungraded · {previewGroup.condition} · {joinOf(previewGroup) ? `${gbp(joinOf(previewGroup).price_pence)} (the live listing's price)` : priceOf(previewGroup.key) != null ? gbp(priceOf(previewGroup.key)) : "no price yet"} · {previewGroup.copies.length} {joinOf(previewGroup) ? "more" : "available"}</div>
            {joinOf(previewGroup) && <p style={small}>These copies join the back of eBay {joinOf(previewGroup).ebay_item_id}&apos;s queue. Its photos don&apos;t change until the copies in front of them sell.</p>}
            <div style={{ ...row, margin: "10px 0" }}>
              {previewGroup.copies[0].scans.map((u) => <img key={u} src={u} alt="" style={{ ...thumb, width: 120, height: 166 }} referrerPolicy="no-referrer" />)}
            </div>
            <p style={small}>{PHOTO_PROMISE}</p>
            <p style={small}>
              These are {previewGroup.copies[0].sku}&apos;s scans. After it sells and you press Check for sales, the listing shows{" "}
              {previewGroup.copies[1] ? `${previewGroup.copies[1].sku}'s` : "nothing more: it was the only copy"}.
            </p>
            <button className="btn btn-primary" disabled={!!busy || (!joinOf(previewGroup) && priceOf(previewGroup.key) == null)} onClick={() => list(previewGroup)}>
              {busy === `list-${previewGroup.key}` ? "Listing…" : joinOf(previewGroup) ? "Add to the live listing" : "List on eBay (live)"}
            </button>
          </div>
        )}
      </section>

      {/* ---------------- The log ---------------- */}
      <section style={box}>
        <strong>Log</strong>
        <p style={small}>Every eBay change the lab made, and every sale it read. Newest first.</p>
        {events.length === 0 && <p style={small}>Nothing yet.</p>}
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
          {events.map((e) => (
            <div key={e.id} style={{ borderTop: "1px solid var(--line)", padding: "4px 0", color: e.kind === "mismatch" || e.kind === "oversold" ? "var(--bad)" : e.kind === "error" ? "var(--warn)" : undefined }}>
              {new Date(e.at).toLocaleString()} · <strong>{e.kind}</strong> · {JSON.stringify(e.detail)}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

/** What the sold comps said about one group, beside the price box. */
function CompsNote({ c, typed }) {
  if (c.error) return <div style={{ fontSize: 13, color: "var(--bad)" }}>Pricing failed: {c.error}</div>;
  if (c.pence == null) return <div style={{ fontSize: 13, color: "var(--bad)" }}>No price from sold comps{c.n != null ? ` (${c.n} comps)` : ""}. Type one.</div>;
  const thin = c.confidence === "low" || c.confidence === "none" || (c.flags || []).length;
  return (
    <div style={{ fontSize: 13, color: thin ? "var(--warn)" : "var(--ink-soft)" }}>
      Sold comps: {gbp(c.pence)} · {c.n ?? "?"} comps · {c.confidence || "?"} confidence
      {(c.flags || []).length ? ` · ${c.flags.join(", ").replace(/_/g, " ")}` : ""}
      {typed != null && typed !== c.pence ? ` · you typed ${gbp(typed)}` : ""}
    </div>
  );
}
