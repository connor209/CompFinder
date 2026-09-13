"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listBatches, purgeExpired, deleteBatch, RETENTION_DAYS } from "@/lib/batch-store.js";

const OPEN_KEY = "cf-saved-runs-open";

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "6 days left" — the honest version of a retention promise, per run. */
function fmtLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `${days} days left`;
  if (days === 1) return "1 day left";
  const hours = Math.max(0, Math.floor(ms / 3600000));
  return hours <= 1 ? "expires within the hour" : `${hours} hours left`;
}

/**
 * The runs we still have. Listed above the Batch screen rather than behind
 * their own nav entry, because the moment you want one is the moment you are
 * looking at an empty Batch screen wondering where the last one went.
 *
 * Folded shut by default, because that argument is about being ONE CLICK
 * away, not about being permanently in the way: thirty days of retention on a
 * screen somebody opens several times a day is a stack of rows between the
 * controls and the results. The header still carries the count, so the thing
 * it exists to answer — is the last run still there? — is answered without
 * opening it.
 */
export default function SavedBatches({ onOpen, refreshNonce = 0, openId = null }) {
  const [rows, setRows] = useState(null); // null = still loading
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(false);
  // Remembered, like every other preference about what this screen shows.
  useEffect(() => {
    try { if (localStorage.getItem(OPEN_KEY) === "on") setOpen(true); } catch { /* private mode — shut is fine */ }
  }, []);
  function toggle() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      try { localStorage.setItem(OPEN_KEY, next ? "on" : "off"); } catch { /* best-effort */ }
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Sweep first, so the list never offers a run that is past its keep-by.
      await purgeExpired(supabase, user.id).catch(() => {});
      setRows(await listBatches(supabase, user.id));
      setError("");
    } catch (err) {
      console.error("Saved runs could not be listed:", err);
      setRows([]);
      setError(
        /price_batches/.test(err.message || "")
          ? "Saved runs need migration 023 applying in Supabase — until then a run is only kept for this browser tab."
          : `Could not load saved runs: ${err.message}`
      );
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshNonce]);

  async function remove(row) {
    if (!confirm(`Delete the saved run "${row.label}"? The prices stay in your History; the comps behind them don't.`)) return;
    setBusyId(row.id);
    try {
      await deleteBatch(createClient(), row.id);
      setRows((cur) => (cur || []).filter((r) => r.id !== row.id));
    } catch (err) {
      setError(`Could not delete that run: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }


  const count = rows ? rows.length : null;
  const openRow = rows && openId ? rows.find((r) => r.id === openId) : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <button type="button" className="sb-toggle" onClick={toggle} aria-expanded={open}>
          <span className="sb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="eyebrow">Saved runs</span>
          {count != null ? <span className="sb-count">{count}</span> : null}
        </button>
        <span className="hint-small">
          {open
            ? `Kept ${RETENTION_DAYS} days · re-opening one costs no SoldComps requests`
            : openRow
              ? `Showing “${openRow.label || "Batch run"}”`
              : count === 0
                ? "Nothing saved yet"
                : `Kept ${RETENTION_DAYS} days`}
        </span>
      </div>

      {/* Shown whether the list is open or shut. A save that failed is the one
          thing on this panel you have to see, and it is the whole reason the
          empty case says so out loud rather than rendering nothing. */}
      {error ? <p className="hint hint-small compfinder-error">{error}</p> : null}
      {open && rows === null ? <p className="hint hint-small">Looking for earlier runs…</p> : null}

      {open && rows && rows.length === 0 && !error ? (
        // Says so rather than hiding, because an empty list and a save that
        // failed used to look identical: nothing on the screen at all.
        <p className="hint hint-small">
          Nothing saved yet. Finishing a batch puts it here, comps and all — if a finished run
          isn&rsquo;t listed, it didn&rsquo;t save, and the panel above says why.
        </p>
      ) : null}

      {open && rows && rows.length > 0 ? (
        <div className="sb-list">
          {rows.map((row) => (
            <div key={row.id} className={`sb-row${row.id === openId ? " sb-row-on" : ""}`}>
              <div className="sb-main">
                <span className="sb-label">{row.label || "Batch run"}</span>
                <span className="sb-meta">
                  {fmtWhen(row.created_at)} · {row.priced_count} of {row.item_count} priced
                  {row.status === "stopped" ? " · stopped early" : ""}
                </span>
              </div>
              <span className="sb-left">{fmtLeft(row.expires_at)}</span>
              <div className="sb-acts">
                <button type="button" className="btn btn-ghost" onClick={() => onOpen(row.id)} disabled={row.id === openId}>
                  {row.id === openId ? "Open" : "Re-open"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => remove(row)} disabled={busyId === row.id}>
                  {busyId === row.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
