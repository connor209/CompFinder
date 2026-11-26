"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LabOverview from "./LabOverview";
import LabHeader from "./LabHeader";
import { describeEvent } from "@/lib/lab-log.js";
import { pickList } from "@/lib/lab-copies.js";

/**
 * The lab's home: what the lab is, the four steps a batch goes through, where
 * every card is now (LabOverview), what eBay has told us about sales, picking
 * and the activity log in words (lib/lab-log.js). Batches are their own page
 * (/panel/lab/add), listings and copies the Inventory.
 *
 * This page used to carry a whole second Add copies — its own CSV reader,
 * pricer (a third way of building a /api/batch-comps card) and List all —
 * with nothing on screen reaching it. Removed 2026-11-26: Add copies is the
 * one way a file enters the lab.
 */

const box = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16 };
const row = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const small = { fontSize: 13, color: "var(--ink-soft)" };
async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

export default function LabCopies() {
  const [lab, setLab] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
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
  const events = lab?.events || [];
  const picks = useMemo(() => pickList(copies), [copies]);

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

  if (!lab) return <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>Loading the lab…</main>;
  if (lab.foldPending || lab.needsMove) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
        <h1>Lab</h1>
        <section style={box}>
          <strong>The lab now keeps its copies in the stacks</strong>
          <p style={small}>
            Every lab copy becomes an ordinary stack card, marked LAB, in a stack named after its pile (TEST2-14 goes in LAB-TEST2).
            A copy whose SKU is already on a stack as a card nobody has pulled is that card, and stays where it is. Nothing on eBay changes.
          </p>
          {lab.foldPending ? (
            <p>Run <code>supabase/migrations/042_lab_into_stacks.sql</code> in Supabase first.</p>
          ) : (
            <>
              <p><strong>{lab.unmoved}</strong> cop{lab.unmoved === 1 ? "y" : "ies"} to move. Until they have, the lab — and sale notifications — wait.</p>
              <button className="btn btn-primary" disabled={!!busy} onClick={async () => {
                setBusy("move");
                const r = await api({ action: "moveToStacks" });
                setBusy(null);
                if (!r.ok) setMsg({ bad: true, text: r.error });
                else setMsg({ bad: r.refused?.length > 0, text: `${r.moved} moved into new stack cards, ${r.adopted} matched to cards already on a stack${r.refused?.length ? `. Not moved: ${r.refused.map((x) => `${x.sku} (${x.why})`).join("; ")}` : "."}` });
                await reload();
              }}>{busy === "move" ? "Moving…" : "▸ Move lab copies into stacks"}</button>
            </>
          )}
          {msg && <p style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }}>{msg.text}</p>}
        </section>
      </main>
    );
  }
  if (lab.missing) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
        <h1>Lab</h1>
        <p>Run <code>supabase/migrations/039_lab_copies.sql</code> in the Supabase SQL editor first. It only adds the lab&apos;s own three tables.</p>
      </main>
    );
  }

  const logRows = events.map((e) => ({ e, ...describeEvent(e) }));
  const problems = logRows.filter((x) => x.tone === "bad").length;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16, color: "var(--ink)" }}>
      <style>{HOME_CSS}</style>
      <LabHeader current="overview" />
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Lab overview</h1>
        <a className="btn btn-primary" href="/panel/lab/add?new=1">＋ New batch</a>
      </div>
      <p style={{ ...small, marginTop: 4 }}>
        One eBay listing per card and condition, with every copy you hold behind it. A buyer sees the photo of the exact copy they get,
        and when it sells the listing moves on to the next copy by itself.
      </p>

      <ol className="lab-how">
        <li><a href="/panel/lab/add?new=1"><b>1 · New batch</b><span>Load a CardUploader export</span></a></li>
        <li><a href="/panel/lab/add"><b>2 · Price</b><span>From sold comps, in the queue</span></a></li>
        <li><a href="/panel/lab/add"><b>3 · Check &amp; list</b><span>Look at the thin ones, then list</span></a></li>
        <li><a href="/panel/pull"><b>4 · Pick</b><span>Sales go on the pull sheet</span></a></li>
      </ol>

      <LabOverview lab={lab} onReload={reload} />

      {/* ---------------- Sales on eBay ---------------- */}
      <section style={box}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <strong>Sales on eBay</strong>
            <p style={{ ...small, margin: "2px 0 0" }}>What the lab has read from eBay since it started.</p>
          </div>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => run("check", { action: "check" }, (r) => setLastCheck(r))}>
            {busy === "check" ? "Checking eBay…" : "↻ Check eBay for sales"}
          </button>
        </div>
        <div className="lab-score">
          <span><b>{score.sold}</b>sales matched to a copy</span>
          <span><b>{score.moved}</b>photos moved on</span>
          <span className={score.mismatch ? "bad" : ""}><b>{score.mismatch}</b>buyer shown another copy</span>
          <span className={score.oversold ? "bad" : ""}><b>{score.oversold}</b>sold more than held</span>
          <span className={score.errors ? "warn" : ""}><b>{score.errors}</b>errors</span>
          <span><b>{score.notified}</b>sale alerts from eBay</span>
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

      {/* ---------------- Picking happens on the pull sheet ---------------- */}
      <section style={box}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <strong>Picking</strong>
            <p style={{ ...small, margin: "2px 0 0" }}>
              {picks.length ? <>{picks.length} sold cop{picks.length === 1 ? "y is" : "ies are"} waiting to be picked.</> : <>Nothing waiting to be picked.</>}{" "}
              Lab cards are picked on the pull sheet with everything else — each sale shows the exact copy the buyer saw and where it is.
            </p>
          </div>
          <a className="btn" href="/panel/pull">Open the pull sheet →</a>
        </div>
      </section>

      {/* ---------------- The log ---------------- */}
      <details style={box}>
        <summary style={{ cursor: "pointer" }}>
          <strong>Activity</strong> <span style={small}>— every change the lab made on eBay and every sale it read, newest first{problems ? ` · ${problems} need a look` : ""}</span>
        </summary>
        {logRows.length === 0 && <p style={small}>Nothing yet.</p>}
        <div style={{ marginTop: 8 }}>
          {logRows.map(({ e, text, tone }) => (
            <div key={e.id} className={`lab-log ${tone}`}>
              <span className="lab-when">{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}

const HOME_CSS = `
.lab-how { list-style:none; padding:0; margin:12px 0; display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:8px; }
.lab-how a { display:flex; flex-direction:column; gap:2px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--ink); text-decoration:none; font-size:13px; }
.lab-how a:hover { border-color:var(--accent); }
.lab-how span { color:var(--ink-soft); }
.lab-score { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px; margin-top:12px; }
.lab-score span { display:flex; flex-direction:column; gap:2px; font-size:12px; color:var(--ink-soft); padding:8px 10px; border:1px solid var(--line); border-radius:10px; }
.lab-score b { font-size:22px; color:var(--ink); }
.lab-score .bad b { color:var(--bad); } .lab-score .warn b { color:var(--warn); }
.lab-log { display:flex; gap:12px; padding:6px 0; border-top:1px solid var(--line); font-size:13px; }
.lab-log.bad { color:var(--bad); } .lab-log.good span:last-child { color:var(--ink); }
.lab-when { flex:0 0 auto; width:118px; color:var(--ink-faint); font-variant-numeric:tabular-nums; }
`;
