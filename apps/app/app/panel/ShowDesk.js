"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { liveRanks, stackDepths, positionLabel } from "@/lib/stackpos.js";
import {
  checkoutStackCard, unhideListing, nextStackName, planReallocation,
  DEFAULT_STACK_CAPACITY, HIDE_MODES, getHideMode, setHideMode
} from "@/lib/checkout";
import { parseOverridePence, poundsStr } from "@/lib/price-override.js";

/**
 * Show desk — check stock out to shows and back in again. Checking a card out
 * flags it away (stack numbering re-flows around it, like a pull you can undo)
 * and hides its eBay listing so it can't double-sell. From the desk you then
 * either mark it SOLD at the show (permanent pull + cash-sale record for P&L,
 * listing ended) or check it back in: to its old spot, to the back of a
 * chosen stack, or into a freshly allocated stack.
 */

const EVENT_KEY = "cf-show-event";

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
  const [hideMode, setHideModeState] = useState("auto");
  const [sku, setSku] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [feedback, setFeedback] = useState([]); // recent checkout results
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState(new Set());
  const [backPickerOpen, setBackPickerOpen] = useState(false);
  const [recs, setRecs] = useState(null); // null = closed; [] = built, empty
  const [recsLoading, setRecsLoading] = useState(false);
  const [recSel, setRecSel] = useState(new Set());
  const [recCount, setRecCount] = useState(20);
  const [usedByStack, setUsedByStack] = useState(new Map());
  const [capacity, setCapacity] = useState(DEFAULT_STACK_CAPACITY);
  const [plan, setPlan] = useState(null); // proposed reallocation, awaiting confirm
  const profileSettings = useRef({});
  const router = useRouter();

  const supabase = () => createClient();

  useEffect(() => {
    try {
      setEvent(localStorage.getItem(EVENT_KEY) || "");
    } catch { /* storage unavailable */ }
    setHideModeState(getHideMode());
  }, []);
  function saveEvent(v) {
    setEvent(v);
    try { localStorage.setItem(EVENT_KEY, v); } catch { /* best-effort */ }
  }
  function saveHideMode(v) {
    setHideModeState(v);
    setHideMode(v);
  }

  async function load() {
    const sb = supabase();
    const { data: st } = await sb.from("card_stacks").select("id,name").order("created_at", { ascending: true });
    setStacks(st || []);

    // Live count per stack (unpulled, not away) — drives the free-space
    // figures and the reallocation plan.
    const all = await pagedSelect(() => sb.from("stack_cards").select("*").is("pulled_at", null));
    const used = new Map();
    for (const c of all) if (!c.checked_out_at) used.set(c.stack_id, (used.get(c.stack_id) || 0) + 1);
    setUsedByStack(used);

    // Cards-per-stack is a property of how you physically store them, so it's
    // a user setting rather than a per-stack column.
    try {
      const { data: { user } } = await sb.auth.getUser();
      const { data: profile } = await sb.from("profiles").select("settings").eq("id", user.id).single();
      const cap = profile?.settings?.stackCapacity;
      if (cap) setCapacity(cap);
      profileSettings.current = profile?.settings || {};
    } catch { /* falls back to the default */ }
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

  // Core: check out concrete stack_cards rows, one by one, with feedback.
  async function checkoutCards(cards) {
    const sb = supabase();
    const results = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      setProgress(cards.length > 1 ? `Checking out ${i + 1} of ${cards.length}…` : "Checking out…");
      const r = await checkoutStackCard(sb, {
        card,
        stackName: stackName.get(card.stack_id) || null,
        event: event.trim() || null,
        hideMode
      });
      if (!r.ok) {
        results.push({ sku: card.sku, ok: false, text: r.error });
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
    return results;
  }

  async function doCheckout(skus) {
    const list = skus.map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const cards = [];
    const misses = [];
    for (const s of list) {
      const { data: matches } = await sb.from("stack_cards").select("*").ilike("sku", s);
      const candidates = (matches || []).filter((c) => !c.pulled_at && !c.checked_out_at);
      if (candidates.length === 0) {
        const gone = (matches || []).some((c) => c.checked_out_at && !c.pulled_at);
        misses.push({ sku: s, ok: false, text: gone ? "already checked out" : "no unpulled card with that SKU" });
      } else {
        cards.push(candidates[0]);
      }
    }
    const results = await checkoutCards(cards);
    setFeedback([...results, ...misses]);
    setProgress("");
    setBusy(false);
    setSku("");
    setBulk("");
    await load();
  }

  // ---- Recommended picks ---------------------------------------------------
  // Suggest show stock by value: live stack cards ranked by their listing
  // price. The user unticks anything they'd rather leave home.

  async function buildRecs() {
    setRecsLoading(true);
    setRecs(null);
    setMsg("");
    const sb = supabase();
    const [cards, listings] = await Promise.all([
      pagedSelect(() => sb.from("stack_cards").select("*").is("pulled_at", null)),
      pagedSelect(() => sb.from("ebay_listings").select("sku,price_value,price_currency").not("sku", "is", null))
    ]);
    const priceBySku = new Map();
    for (const l of listings) {
      const k = String(l.sku).toLowerCase();
      if (l.price_value != null && !priceBySku.has(k)) priceBySku.set(k, Math.round(Number(l.price_value) * 100));
    }
    // Where each card physically is, right now. Computed over EVERY unpulled
    // card, not just the recommended ones — a rank is a count within its whole
    // stack, so narrowing the list first would number the shortlist instead of
    // the shelf.
    const ranks = liveRanks(cards);
    const depths = stackDepths(cards);
    const ranked = cards
      .filter((c) => !c.checked_out_at && c.sku && priceBySku.has(String(c.sku).toLowerCase()))
      .map((c) => ({
        card: c,
        pricePence: priceBySku.get(String(c.sku).toLowerCase()),
        rank: ranks.get(c.id) ?? null,
        depth: depths.get(c.stack_id) ?? null
      }))
      .sort((a, b) => b.pricePence - a.pricePence)
      .slice(0, Math.max(1, Math.min(200, Number(recCount) || 20)));
    setRecs(ranked);
    setRecSel(new Set(ranked.map((r) => r.card.id)));
    setRecsLoading(false);
  }

  async function checkoutRecs() {
    const chosen = (recs || []).filter((r) => recSel.has(r.card.id)).map((r) => r.card);
    if (chosen.length === 0) return;
    setBusy(true);
    setMsg("");
    const results = await checkoutCards(chosen);
    setFeedback(results);
    setProgress("");
    setBusy(false);
    setRecs(null);
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

  // Stacks with their live count + free space, in warehouse order.
  const stacksWithSpace = useMemo(
    () => stacks.map((s) => {
      const used = usedByStack.get(s.id) || 0;
      return { ...s, used, free: Math.max(0, capacity - used) };
    }),
    [stacks, usedByStack, capacity]
  );

  async function saveCapacity(v) {
    const n = Math.max(1, parseInt(v, 10) || DEFAULT_STACK_CAPACITY);
    setCapacity(n);
    setPlan(null);
    try {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      const next = { ...profileSettings.current, stackCapacity: n };
      profileSettings.current = next;
      await sb.from("profiles").update({ settings: next }).eq("id", user.id);
    } catch { /* best-effort — the plan still uses the new number */ }
  }

  function buildPlan() {
    setMsg("");
    setBackPickerOpen(false);
    setPlan(planReallocation(selected.length, stacksWithSpace, capacity));
  }

  // Execute a reallocation plan: each group takes the next slice of the batch.
  async function applyPlan() {
    const groups = plan?.groups || [];
    if (!groups.length || selected.length === 0) return;
    setBusy(true);
    setMsg("");
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();

    const warnings = [];
    let cursor = 0;
    let placed = 0;
    for (const g of groups) {
      let stackId = g.stackId;
      if (!stackId) {
        const { data: created } = await sb.from("card_stacks").insert({ user_id: user.id, name: g.name }).select("id").single();
        if (!created) { warnings.push(`couldn't create stack ${g.name}`); cursor += g.count; continue; }
        stackId = created.id;
      }
      const base = await maxPosition(sb, stackId);
      const slice = selected.slice(cursor, cursor + g.count);
      cursor += g.count;
      for (let i = 0; i < slice.length; i++) {
        setProgress(`Filing ${placed + 1} of ${selected.length}…`);
        const w = await restoreOne(sb, slice[i], { stack_id: stackId, position: base + 1 + i }, "back", stackId);
        warnings.push(...w);
        placed += 1;
      }
    }

    setProgress("");
    setBusy(false);
    setPlan(null);
    const where = groups.map((g) => `${g.name} (${g.count})`).join(", ");
    setMsg(`Filed ${placed} card(s) into ${where}.${warnings.length ? ` ⚠ ${warnings.join(" · ")}` : ""}`);
    await load();
  }

  // Return one card to stock: clear the away flag (optionally moving it),
  // un-hide its listing, and close the checkout row. Returns any warnings.
  async function restoreOne(sb, co, patch, returnMode, returnStackId) {
    const warnings = [];
    if (co.stack_card_id) {
      await sb.from("stack_cards").update({ checked_out_at: null, ...patch }).eq("id", co.stack_card_id);
    } else {
      warnings.push(`${co.sku || "?"}: its stack card no longer exists — add it back by hand.`);
    }
    const u = await unhideListing(co);
    if (u.error) warnings.push(`${co.sku || "?"}: ${u.error}`);
    if (u.newItemId && co.stack_card_id) {
      await sb.from("stack_cards").update({ ebay_item_id: u.newItemId }).eq("id", co.stack_card_id);
    }
    await sb.from("stock_checkouts").update({
      resolved_at: new Date().toISOString(),
      resolution: "returned",
      return_mode: returnMode,
      return_stack_id: returnStackId,
      relisted_item_id: u.newItemId || null
    }).eq("id", co.id);
    return warnings;
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
      const patch = mode === "spot" ? {} : { stack_id: stackId, position: base + 1 + i };
      const w = await restoreOne(sb, co, patch, mode, mode === "spot" ? co.stack_id : stackId);
      warnings.push(...w);
      restored += 1;
    }
    setProgress("");
    setBusy(false);
    const modeText = mode === "spot" ? "to their original spots" : mode === "back" ? ` to the back of ${stackName.get(stackId) || "the stack"}` : newStackNote;
    setMsg(`Checked in ${restored} card(s) ${modeText}.${warnings.length ? ` ⚠ ${warnings.join(" · ")}` : ""}`.trim());
    await load();
  }

  /**
   * Set — or clear — the sticker price on one card, here at the desk.
   *
   * The Batch screen's stickers are the normal way in: price the pool, and
   * every card gets a cash-rounded number written back. This is the other
   * half, and it is the half that happens on the day. A card the run held back
   * (thin comps, no comps at all), a card added to the box after the run, or
   * simply a price you have changed your mind about with the table in front of
   * you — none of those are worth re-pricing 43 cards for.
   *
   * What you type here is NOT put through the cash ladder. Overriding a price
   * on the Batch results is overriding an EBAY price, and the ladder turns
   * that into cash; here you are writing the label itself, the same as the
   * sticker box on the Batch screen's label panel.
   *
   * Whole pounds, for the same reason that box is: `labelPrice()` prints to
   * the pound, so a £7.50 sticker would come off the roll as £8 with nothing
   * on screen saying so — and a saved run re-opened at the show rehydrates
   * these very numbers into it. Refused rather than rounded, because the point
   * is that the number on the label is the number somebody chose.
   */
  async function setSticker(co) {
    const current = co.sticker_pence != null ? (co.sticker_pence / 100).toFixed(2) : "";
    const raw = prompt(
      `Sticker price for "${co.sku || co.title || "card"}" — £… (leave blank to take the sticker off)`,
      current
    );
    if (raw === null) return;
    const { pence, error } = parseOverridePence(raw);
    if (error) {
      setMsg(error);
      return;
    }
    if (pence != null && pence % 100 !== 0) {
      setMsg(`Stickers are whole pounds — the label would print ${poundsStr(Math.round(pence / 100) * 100)} for ${poundsStr(pence)} and nothing on screen would say so.`);
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const { error: upErr } = await supabase()
        .from("stock_checkouts")
        .update({
          sticker_pence: pence,
          sticker_set_at: pence == null ? null : new Date().toISOString(),
          // Not from a run, so nothing to point at. Cleared rather than left
          // pointing at the run whose price this just replaced.
          sticker_batch_id: null
        })
        .eq("id", co.id);
      if (upErr) throw upErr;
      setMsg(
        pence == null
          ? `Sticker taken off ${co.sku || co.title || "that card"}.`
          : `${co.sku || co.title || "That card"} stickered at ${poundsStr(pence)}.`
      );
      await load();
    } catch (err) {
      setMsg(
        /sticker_pence|does not exist|schema cache/i.test(err.message || "")
          ? "Sticker prices can't be saved yet — migration 024 hasn't been applied in Supabase."
          : `That sticker price couldn't be saved: ${err.message}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function markSold(co) {
    // Pre-filled with the sticker where there is one: the number on the card is
    // what was actually asked at the table, so typing it again is a chance to
    // get it wrong. Still editable — haggling is the norm at a show, and what
    // goes in the P&L has to be what changed hands, not what was printed.
    const asked = co.sticker_pence != null ? (co.sticker_pence / 100).toFixed(2) : "";
    const raw = prompt(
      `Sold "${co.sku || co.title || "card"}" at the show for £… (leave blank to record without a price)`,
      asked
    );
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
          <label className="sd-toggle" title="How each card's eBay listing is taken off sale while it's at the show">
            Hide on eBay:
            <select className="sd-select" value={hideMode} onChange={(e) => saveHideMode(e.target.value)}>
              {HIDE_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
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
        <div className="sd-recbar">
          <button className="btn btn-ghost" onClick={buildRecs} disabled={busy || recsLoading}>
            {recsLoading ? "Ranking your stock…" : "★ Recommend show stock"}
          </button>
          <label className="sd-toggle">
            top
            <input className="sd-count" type="number" min="1" max="200" value={recCount} onChange={(e) => setRecCount(e.target.value)} />
            by value
          </label>
        </div>
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

      {recs !== null ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Recommended show stock — highest value first</span>
            <button className="btn btn-ghost" onClick={() => setRecs(null)}>Close</button>
          </div>
          {recs.length === 0 ? (
            <p className="dd-empty">No stack cards matched a live listing price. Sync your eBay listings, then try again.</p>
          ) : (
            <>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                Your live stock ranked by listing price. Untick anything staying home, then check the rest out in one go.
              </p>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                The number on the left is the <b>live position</b> — count that many from the top of the
                stack. It is not the SKU: a SKU is a name and never moves, while positions close up
                behind every card pulled or taken to a show.
              </p>
              <div className="sd-bulkbar">
                <label className="sd-toggle">
                  <input
                    type="checkbox"
                    checked={recSel.size === recs.length && recs.length > 0}
                    // Indeterminate is the honest state for a part-selection: without it
                    // the box reads as "none selected" while forty cards are ticked.
                    ref={(el) => { if (el) el.indeterminate = recSel.size > 0 && recSel.size < recs.length; }}
                    onChange={(e) => setRecSel(e.target.checked ? new Set(recs.map((r) => r.card.id)) : new Set())}
                  />
                  {recSel.size === recs.length ? "All" : `${recSel.size} of ${recs.length}`}
                </label>
              </div>
              <div className="stack-list">
                {recs.map(({ card, pricePence, rank, depth }) => (
                  <label className="ps-row" key={card.id}>
                    <input
                      type="checkbox"
                      checked={recSel.has(card.id)}
                      onChange={() => setRecSel((prev) => { const n = new Set(prev); if (n.has(card.id)) n.delete(card.id); else n.add(card.id); return n; })}
                    />
                    <span className="stack-pos" title="Live position — count this many from the top of the stack">
                      {rank ?? "?"}
                    </span>
                    <span className="stack-sku" title="The card's SKU. A name, not an address — it does not move when the stack re-flows.">
                      {card.sku}
                    </span>
                    <span className="stack-title">{card.title || <em>—</em>}</span>
                    <span className="badge2" title="Where to walk, and how far to count">
                      {positionLabel(stackName.get(card.stack_id), rank, depth)}
                    </span>
                    <span className="sd-price">{pounds(pricePence)}</span>
                  </label>
                ))}
              </div>
              {(() => {
                const chosen = recs.filter((r) => recSel.has(r.card.id));
                const total = chosen.reduce((t, r) => t + r.pricePence, 0);
                return (
                  <button className="btn btn-primary" onClick={checkoutRecs} disabled={busy || chosen.length === 0} style={{ marginTop: 10 }}>
                    {busy ? progress || "Checking out…" : `Check out ${chosen.length} card(s) · ${pounds(total)}`}
                  </button>
                );
              })()}
            </>
          )}
        </div>
      ) : null}

      {msg ? <p className="hint hint-small" style={{ color: "var(--accent-2)", marginTop: -6 }}>{msg}</p> : null}

      <div className="panel">
        <div className="panel-head">
          <h3>Away at the show</h3>
          <span className="badge2">{open.length} out</span>
          {open.length > 0 ? (
            <button
              className="btn btn-ghost"
              onClick={() => router.push("/panel/batch?pool=show")}
              title="Price everything that's checked out and get a recommended sticker price for each"
              disabled={busy}
            >
              🏷 Price this pool
            </button>
          ) : null}
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
                  ref={(el) => { if (el) el.indeterminate = sel.size > 0 && sel.size < open.length; }}
                  onChange={(e) => setSel(e.target.checked ? new Set(open.map((o) => o.id)) : new Set())}
                />
                {sel.size > 0 ? `${sel.size} selected` : "All"}
              </label>
              <div className="ps-actions">
                <button className="btn btn-primary" onClick={buildPlan} disabled={busy}>✨ Reallocate ({selCount})</button>
                <button className="btn btn-ghost" onClick={() => checkin(selected, "spot")} disabled={busy}>↩ Return to spots</button>
                <button className="btn btn-ghost" onClick={() => { setPlan(null); setBackPickerOpen((v) => !v); }} disabled={busy}>⤵ Pick a stack…</button>
                <button className="btn btn-ghost" onClick={() => checkin(selected, "new_stack")} disabled={busy}>✚ New stack</button>
              </div>
            </div>

            {plan ? (
              <div className="sd-plan">
                <div className="sd-plan-head">
                  <b>Filing plan for {selCount} card(s)</b>
                  <label className="sd-toggle">
                    stack holds
                    <input className="sd-count" type="number" min="1" max="5000" value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      onBlur={(e) => saveCapacity(e.target.value)} />
                    cards
                  </label>
                </div>
                <div className="sd-plan-rows">
                  {plan.groups.map((g, i) => (
                    <div className="sd-plan-row" key={i}>
                      <span className="badge2">{g.name}</span>
                      <span className="sd-plan-count">{g.count} card{g.count === 1 ? "" : "s"}</span>
                      <span className="hint-small">
                        {g.isNew ? "new stack" : `${g.freeBefore} free → ${g.freeBefore - g.count} after`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="hint hint-small" style={{ marginTop: 0 }}>
                  {plan.groups.length === 1 && !plan.groups[0].isNew
                    ? `${plan.groups[0].name} has room for the lot — the tightest fit, so your roomier stacks stay free.`
                    : plan.newStacks > 0
                      ? `Fills the roomiest stacks first, then opens ${plan.newStacks} new one${plan.newStacks === 1 ? "" : "s"}.`
                      : "Spread across the roomiest stacks — no new stacks needed."}
                  {" "}Cards go to the back in order; SKUs are unchanged.
                </p>
                <div className="ps-actions">
                  <button className="btn btn-primary" onClick={applyPlan} disabled={busy}>
                    {busy ? progress || "Filing…" : "Confirm & file"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setPlan(null)} disabled={busy}>Cancel</button>
                </div>
              </div>
            ) : null}

            {backPickerOpen ? (
              <div className="sd-backpicker">
                <span className="hint-small">Add {selCount} card(s), in order, to the back of:</span>
                {stacksWithSpace.map((s) => (
                  <button
                    key={s.id}
                    className={`stack-tab${s.free < selCount ? " sd-tight" : ""}`}
                    onClick={() => checkin(selected, "back", s.id)}
                    disabled={busy}
                    title={`${s.used}/${capacity} used · ${s.free} free`}
                  >
                    {s.name} <span className="stack-count">{s.free} free</span>
                  </button>
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
                    {co.sticker_pence != null ? (
                      <span
                        className="sd-price"
                        title={co.sticker_batch_id ? "Sticker price from a Batch run — click ✎ to change it" : "Sticker price set here at the desk"}
                      >
                        {pounds(co.sticker_pence)}
                      </span>
                    ) : null}
                    <span className="hint-small" style={{ color: chip.color, flex: "none" }} title={chip.title}>{chip.text}</span>
                    <span className="sd-rowacts">
                      <button className="stack-pull" onClick={(e) => { e.preventDefault(); setSticker(co); }} disabled={busy} title={co.sticker_pence != null ? "Change this card's sticker price" : "Put a sticker price on this card"}>{co.sticker_pence != null ? "✎ £" : "🏷 £"}</button>
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
