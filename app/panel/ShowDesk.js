"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkoutStackCard, unhideListing, nextStackName } from "@/lib/checkout";

/**
 * Show desk — check stock out to shows and back in again. Checking a card out
 * flags it away (stack numbering re-flows around it, like a pull you can undo)
 * and hides its eBay listing so it can't double-sell. From the desk you then
 * either mark it SOLD at the show (permanent pull + cash-sale record for P&L,
 * listing ended) or check it back in: to its old spot, to the back of a
 * chosen stack, or into a freshly allocated stack.
 */

const EVENT_KEY = "cf-show-event";
const HIDE_KEY = "cf-show-hide";

const pounds = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

function parsePricePence(raw) {
  const cleaned = String(raw || "").replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function hideChip(co) {
  if (co.hide_error) return { text: "hide failed", color: "var(--bad-ink)", title: co.hide_error };
  if (co.hide_method === "quantity") return { text: "hidden on eBay", color: "var(--conf-high)", title: "Quantity set to 0 — restores to the same listing at check-in." };
  if (co.hide_method === "ended") return { text: "ended · relists on return", color: "var(--warn-ink)", title: "The listing was ended and will be relisted (new item id) at check-in." };
  if (co.ebay_item_id) return { text: "still live on eBay", color: "var(--ink-faint)", title: "The listing was left active — it could still sell online while you're away." };
  return { text: "no eBay listing", color: "var(--ink-faint)", title: "No active listing matched this SKU." };
}

export default function ShowDesk() {
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [stacks, setStacks] = useState([]);
  const [open, setOpen] = useState([]); // unresolved checkouts, oldest first
  const [history, setHistory] = useState([]);
  const [event, setEvent] = useState("");
  const [hideOnEbay, setHideOnEbay] = useState(true);
  const [sku, setSku] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [feedback, setFeedback] = useState([]); // recent checkout results
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState(new Set());
  const [backPickerOpen, setBackPickerOpen] = useState(false);

  const supabase = () => createClient();

  useEffect(() => {
    try {
      setEvent(localStorage.getItem(EVENT_KEY) || "");
      setHideOnEbay(localStorage.getItem(HIDE_KEY) !== "0");
    } catch { /* storage unavailable */ }
  }, []);
  function saveEvent(v) {
    setEvent(v);
    try { localStorage.setItem(EVENT_KEY, v); } catch { /* best-effort */ }
  }
  function saveHide(v) {
    setHideOnEbay(v);
    try { localStorage.setItem(HIDE_KEY, v ? "1" : "0"); } catch { /* best-effort */ }
  }

  async function load() {
    const sb = supabase();
    const { data: st } = await sb.from("card_stacks").select("id,name").order("created_at", { ascending: true });
    setStacks(st || []);
    const { data: away, error } = await sb
      .from("stock_checkouts")
      .select("*")
      .is("resolved_at", null)
      .order("checked_out_at", { ascending: true });
    if (error) {
      setNeedsMigration(true);
      setLoading(false);
      return;
    }
    setOpen(away || []);
    const { data: past } = await sb
      .from("stock_checkouts")
      .select("*")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(30);
    setHistory(past || []);
    setSel(new Set());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const stackName = useMemo(() => new Map(stacks.map((s) => [s.id, s.name])), [stacks]);

  // ---- Checkout ------------------------------------------------------------

  async function doCheckout(skus) {
    const list = skus.map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setMsg("");
    const results = [];
    const sb = supabase();
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      setProgress(list.length > 1 ? `Checking out ${i + 1} of ${list.length}…` : "Checking out…");
      const { data: matches } = await sb.from("stack_cards").select("*").ilike("sku", s);
      const candidates = (matches || []).filter((c) => !c.pulled_at && !c.checked_out_at);
      if (candidates.length === 0) {
        const gone = (matches || []).some((c) => c.checked_out_at && !c.pulled_at);
        results.push({ sku: s, ok: false, text: gone ? "already checked out" : "no unpulled card with that SKU" });
        continue;
      }
      const card = candidates[0];
      const r = await checkoutStackCard(sb, {
        card,
        stackName: stackName.get(card.stack_id) || null,
        event: event.trim() || null,
        hideOnEbay
      });
      if (!r.ok) {
        results.push({ sku: s, ok: false, text: r.error });
        if (r.needsMigration) { setNeedsMigration(true); break; }
        continue;
      }
      const hideText = r.hideError
        ? `⚠ listing not hidden: ${r.hideError}`
        : r.hideMethod === "quantity" ? "listing hidden (qty 0)"
        : r.hideMethod === "ended" ? "listing ended — relists at check-in"
        : r.itemId ? "listing left live" : "no listing found";
      results.push({ sku: card.sku, ok: true, text: `out of ${stackName.get(card.stack_id) || "stack"} · ${hideText}` });
    }
    setFeedback(results);
    setProgress("");
    setBusy(false);
    setSku("");
    setBulk("");
    await load();
  }

  // ---- Check-in ------------------------------------------------------------

  const selected = useMemo(() => (sel.size > 0 ? open.filter((o) => sel.has(o.id)) : open), [sel, open]);

  function toggleSel(id) {
    setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function maxPosition(sb, stackId) {
    const { data } = await sb
      .from("stack_cards")
      .select("position")
      .eq("stack_id", stackId)
      .not("position", "is", null)
      .order("position", { ascending: false })
      .limit(1);
    return data && data.length ? data[0].position : 0;
  }

  async function checkin(items, mode, chosenStackId = null) {
    if (items.length === 0) return;
    setBusy(true);
    setMsg("");
    setBackPickerOpen(false);
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();

    let stackId = chosenStackId;
    let newStackNote = "";
    if (mode === "new_stack") {
      const name = nextStackName(stacks.map((s) => s.name));
      const { data: created } = await sb.from("card_stacks").insert({ user_id: user.id, name }).select("id,name").single();
      if (!created) { setBusy(false); setMsg("Couldn't create a new stack."); return; }
      stackId = created.id;
      newStackNote = ` into new stack ${created.name}`;
    }
    let base = 0;
    if (mode === "back" || mode === "new_stack") base = await maxPosition(sb, stackId);

    let restored = 0;
    const warnings = [];
    for (let i = 0; i < items.length; i++) {
      const co = items[i];
      setProgress(`Checking in ${i + 1} of ${items.length}…`);

      // Put the card back in a stack.
      if (co.stack_card_id) {
        const patch = mode === "spot"
          ? { checked_out_at: null }
          : { checked_out_at: null, stack_id: stackId, position: base + 1 + i };
        await sb.from("stack_cards").update(patch).eq("id", co.stack_card_id);
      } else {
        warnings.push(`${co.sku || "?"}: its stack card no longer exists — add it back by hand.`);
      }

      // Bring the listing back (best-effort).
      const u = await unhideListing(co);
      if (u.error) warnings.push(`${co.sku || "?"}: ${u.error}`);
      if (u.newItemId && co.stack_card_id) {
        await sb.from("stack_cards").update({ ebay_item_id: u.newItemId }).eq("id", co.stack_card_id);
      }

      await sb.from("stock_checkouts").update({
        resolved_at: new Date().toISOString(),
        resolution: "returned",
        return_mode: mode,
        return_stack_id: mode === "spot" ? co.stack_id : stackId,
        relisted_item_id: u.newItemId || null
      }).eq("id", co.id);
      restored += 1;
    }
    setProgress("");
    setBusy(false);
    const modeText = mode === "spot" ? "to their original spots" : mode === "back" ? ` to the back of ${stackName.get(stackId) || "the stack"}` : newStackNote;
    setMsg(`Checked in ${restored} card(s) ${modeText}.${warnings.length ? ` ⚠ ${warnings.join(" · ")}` : ""}`.trim());
    await load();
  }

  async function markSold(co) {
    const raw = prompt(`Sold "${co.sku || co.title || "card"}" at the show for £… (leave blank to record without a price)`);
    if (raw === null) return;
    const pence = parsePricePence(raw);
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const warnings = [];

    if (co.stack_card_id) {
      await sb.from("stack_cards").update({ pulled_at: new Date().toISOString(), checked_out_at: null }).eq("id", co.stack_card_id);
    }

    // The listing must go for good. Quantity-hidden or still-live → end it now;
    // already-ended needs nothing.
    if (co.ebay_item_id && co.hide_method !== "ended") {
      try {
        const res = await fetch("/api/ebay/end-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: co.ebay_item_id })
        }).then((r) => r.json());
        if (!res.ok) warnings.push(`listing not ended: ${res.error || "unknown error"} — end it on eBay by hand.`);
      } catch {
        warnings.push("couldn't reach eBay to end the listing — end it by hand.");
      }
    }

    await sb.from("stock_checkouts").update({
      resolved_at: new Date().toISOString(),
      resolution: "sold",
      sold_price_pence: pence
    }).eq("id", co.id);

    setBusy(false);
    setMsg(`Marked ${co.sku || "card"} sold${pence != null ? ` for ${pounds(pence)}` : ""}.${warnings.length ? ` ⚠ ${warnings.join(" ")}` : ""}`);
    await load();
  }

  async function returnOne(co) { await checkin([co], "spot"); }

  // ---- Render --------------------------------------------------------------

  if (loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading show desk…</div>;

  if (needsMigration) {
    return (
      <div className="mine-banner">
        <span className="mine-ic" aria-hidden="true">⚠</span>
        <div>
          <strong>One-off setup needed</strong>
          <p className="hint hint-small" style={{ marginTop: 4 }}>
            The show desk needs the <code>016_show_checkouts.sql</code> migration — run it once in the Supabase SQL editor
            (it adds the checkout ledger and the away-flag on stack cards), then reload this page.
          </p>
        </div>
      </div>
    );
  }

  const soldRows = history.filter((h) => h.resolution === "sold");
  const takings = soldRows.reduce((t, h) => t + (h.sold_price_pence || 0), 0);
  const selCount = sel.size > 0 ? sel.size : open.length;

  return (
    <div className="rise-group sd-scope">
      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Check stock out</span>
          <button className="btn btn-ghost" onClick={() => setShowBulk((v) => !v)}>{showBulk ? "Single" : "Bulk paste"}</button>
        </div>
        <div className="sd-opts">
          <input
            className="stack-title-inp"
            value={event}
            onChange={(e) => saveEvent(e.target.value)}
            placeholder="Show / event name (optional — tags each checkout)"
            aria-label="Show name"
          />
          <label className="sd-toggle">
            <input type="checkbox" checked={hideOnEbay} onChange={(e) => saveHide(e.target.checked)} />
            Hide listings on eBay
          </label>
        </div>
        {showBulk ? (
          <>
            <p className="hint hint-small" style={{ marginTop: 0 }}>One SKU per line — each card is checked out of its stack and its listing hidden.</p>
            <textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"AB11\nAB12\nC4"} />
            <button className="btn btn-primary" onClick={() => doCheckout(bulk.split("\n").map((l) => l.split(/[,\t ]/)[0]))} disabled={busy || !bulk.trim()} style={{ marginTop: 10 }}>
              {busy ? progress || "Checking out…" : "Check out all"}
            </button>
          </>
        ) : (
          <div className="dd-search" style={{ marginBottom: 0 }}>
            <div className="dd-combo"><div className="dd-inp"><span className="mag" aria-hidden="true">#</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && sku.trim() && !busy) doCheckout([sku]); }}
                placeholder="SKU (e.g. AB11) — Enter to check out"
                aria-label="SKU to check out"
              />
            </div></div>
            <button className="btn btn-primary" onClick={() => doCheckout([sku])} disabled={busy || !sku.trim()}>
              {busy ? progress || "…" : "Check out"}
            </button>
          </div>
        )}
        {feedback.length > 0 ? (
          <div className="sd-feedback">
            {feedback.map((f, i) => (
              <p key={i} className="hint hint-small" style={{ margin: "4px 0", color: f.ok ? "var(--conf-high)" : "var(--bad-ink)" }}>
                {f.ok ? "✓" : "✕"} <b>{f.sku}</b> — {f.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {msg ? <p className="hint hint-small" style={{ color: "var(--accent-2)", marginTop: -6 }}>{msg}</p> : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Away at the show</h3>
          <span className="badge2">{open.length} out</span>
        </div>
        {open.length === 0 ? (
          <p className="dd-empty">Nothing checked out. Enter a SKU above as you pack for a show — numbering in its stack adjusts automatically while it&apos;s away.</p>
        ) : (
          <>
            <div className="sd-bulkbar">
              <label className="sd-toggle">
                <input
                  type="checkbox"
                  checked={sel.size === open.length && open.length > 0}
                  onChange={(e) => setSel(e.target.checked ? new Set(open.map((o) => o.id)) : new Set())}
                />
                {sel.size > 0 ? `${sel.size} selected` : "All"}
              </label>
              <div className="ps-actions">
                <button className="btn btn-ghost" onClick={() => checkin(selected, "spot")} disabled={busy}>↩ Return to spots ({selCount})</button>
                <button className="btn btn-ghost" onClick={() => setBackPickerOpen((v) => !v)} disabled={busy}>⤵ To back of stack…</button>
                <button className="btn btn-ghost" onClick={() => checkin(selected, "new_stack")} disabled={busy}>✚ New stack ({selCount})</button>
              </div>
            </div>
            {backPickerOpen ? (
              <div className="sd-backpicker">
                <span className="hint-small">Add {selCount} card(s), in order, to the back of:</span>
                {stacks.map((s) => (
                  <button key={s.id} className="stack-tab" onClick={() => checkin(selected, "back", s.id)} disabled={busy}>{s.name}</button>
                ))}
              </div>
            ) : null}
            {busy && progress ? <p className="hint hint-small"><span className="spinner" /> &nbsp;{progress}</p> : null}
            <div className="stack-list">
              {open.map((co) => {
                const chip = hideChip(co);
                return (
                  <label className="ps-row" key={co.id}>
                    <input type="checkbox" checked={sel.has(co.id)} onChange={() => toggleSel(co.id)} />
                    <span className="stack-sku">{co.sku || "—"}</span>
                    <span className="stack-title">{co.title || <em>—</em>}</span>
                    {co.stack_name ? <span className="badge2" title="Stack it left">{co.stack_name}</span> : null}
                    {co.event ? <span className="badge2" title="Event">{co.event}</span> : null}
                    <span className="hint-small" style={{ color: chip.color, flex: "none" }} title={chip.title}>{chip.text}</span>
                    <span className="sd-rowacts">
                      <button className="stack-pull" style={{ color: "var(--conf-high)", borderColor: "var(--line-strong)" }} onClick={(e) => { e.preventDefault(); markSold(co); }} disabled={busy}>£ Sold</button>
                      <button className="stack-pull" onClick={(e) => { e.preventDefault(); returnOne(co); }} disabled={busy}>↩ Return</button>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {history.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Recent activity</span>
            {soldRows.length > 0 ? <span className="badge2">{soldRows.length} sold · {pounds(takings)}</span> : null}
          </div>
          <div className="stack-list">
            {history.map((co) => (
              <div className="stack-row" key={co.id}>
                <span className="stack-sku">{co.sku || "—"}</span>
                <span className="stack-title">{co.title || <em>—</em>}</span>
                {co.event ? <span className="badge2">{co.event}</span> : null}
                <span className="hint-small" style={{ color: co.resolution === "sold" ? "var(--conf-high)" : "var(--ink-faint)", flex: "none" }}>
                  {co.resolution === "sold"
                    ? `sold at show${co.sold_price_pence != null ? ` · ${pounds(co.sold_price_pence)}` : ""}`
                    : co.return_mode === "spot" ? "returned to spot"
                    : co.return_mode === "back" ? "returned to back"
                    : co.return_mode === "new_stack" ? "returned · new stack"
                    : "returned"}
                  {co.resolved_at ? ` · ${new Date(co.resolved_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
