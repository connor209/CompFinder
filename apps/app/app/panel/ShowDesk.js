"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { liveRanks, stackDepths, positionLabel, locationsBySku } from "@/lib/stackpos.js";
import { isListingAvailable, soldOutSkus } from "@/lib/stockcheck.js";
import {
  checkoutStackCard, unhideListing, nextStackName, planReallocation,
  DEFAULT_STACK_CAPACITY, HIDE_MODES, getHideMode, setHideMode
} from "@/lib/checkout";
import { parseOverridePence, poundsStr } from "@/lib/price-override.js";
import {
  showView, selectionFor, facetsOf, listingState, matchesQuery,
  SHOW_SORTS, DEFAULT_SORT, STICKER_FILTERS, LISTING_FILTERS
} from "@/lib/showfilter.js";
import { counterView, onlineMatches, inBoxSkus } from "@/lib/showcounter.js";
import { recordWant, loadWants, deleteWant, wantsSummary } from "@/lib/wants-store.js";

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

// The chip and the "still sellable online" filter classify a row the same way,
// through listingState() — a filter that finds three cards a chip says are
// hidden is the sort of disagreement nobody notices until one sells twice. The
// two hidden methods differ only in their wording, which is the chip's job.
function hideChip(co) {
  const state = listingState(co);
  if (state === "failed") return { text: "hide failed", color: "var(--bad-ink)", title: co.hide_error };
  if (state === "hidden") {
    return co.hide_method === "ended"
      ? { text: "ended · relists on return", color: "var(--warn-ink)", title: "The listing was ended and will be relisted (new item id) at check-in." }
      : { text: "hidden on eBay", color: "var(--conf-high)", title: "Quantity set to 0 — restores to the same listing at check-in." };
  }
  if (state === "live") return { text: "still live on eBay", color: "var(--ink-faint)", title: "The listing was left active — it could still sell online while you're away." };
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
  // How the away list is being read right now. Not persisted: a search is
  // about the card in your hand a moment ago, and coming back tomorrow to a
  // list still filtered to Saturday's show would look like missing stock.
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [eventFilter, setEventFilter] = useState("");
  const [stackFilter, setStackFilter] = useState("");
  const [stickerFilter, setStickerFilter] = useState("any");
  const [listingFilter, setListingFilter] = useState("any");
  // Counter mode — the list turned round to face a customer. NOT persisted,
  // for the same reason the search isn't: coming back tomorrow to a desk that
  // is still in customer mode hides every button you need and looks broken.
  const [counterMode, setCounterMode] = useState(false);
  const [images, setImages] = useState(new Map()); // sku -> eBay photo of THIS copy
  const [listings, setListings] = useState([]);    // live eBay stock, for the counter
  const [stackCards, setStackCards] = useState([]); // every unpulled card, for locating one
  // Which online row has had its location revealed. One at a time, and never
  // by default: a stack name and a depth are picking data, and counter mode is
  // pointed at a customer. See the note on the reveal button below.
  const [locationOpen, setLocationOpen] = useState(null);
  const [wants, setWants] = useState([]);
  const [wantsMissing, setWantsMissing] = useState(false); // migration 026 not applied
  const [showWants, setShowWants] = useState(false);
  const [backPickerOpen, setBackPickerOpen] = useState(false);
  const [recs, setRecs] = useState(null); // null = closed; [] = built, empty
  const [recsLoading, setRecsLoading] = useState(false);
  const [recSel, setRecSel] = useState(new Set());
  const [recCount, setRecCount] = useState(20);
  const [recSkipped, setRecSkipped] = useState(0); // in a stack, but sold out on eBay
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
    setStackCards(all);

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

    // A photo of THIS copy, for the counter view. Read from the listings we
    // already sync rather than fetched per row, and absent for anything
    // checked out by ENDING its listing — those drop out of ebay_listings on
    // the next sync. A gap is fine; catalogue art in its place would not be,
    // since it shows a mint scan of a played card to the person holding it.
    try {
      const live = await pagedSelect(() =>
        sb.from("ebay_listings").select("ebay_item_id,sku,title,price_value,quantity,image_url")
      );
      const bySku = new Map();
      for (const l of live) {
        if (l.sku && l.image_url) bySku.set(String(l.sku).toLowerCase(), l.image_url);
      }
      setImages(bySku);
      setListings(live || []);
    } catch { /* no pictures and no online list is a gap, not a failure */ }

    const w = await loadWants(sb);
    setWantsMissing(Boolean(w.missing));
    setWants(w.rows || []);
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
    setRecSkipped(0);
    setMsg("");
    const sb = supabase();
    const [cards, listings] = await Promise.all([
      pagedSelect(() => sb.from("stack_cards").select("*").is("pulled_at", null)),
      pagedSelect(() => sb.from("ebay_listings").select("sku,price_value,price_currency,quantity").not("sku", "is", null))
    ]);
    // A card that SOLD is still a row here. eBay's out-of-stock control leaves
    // a sold fixed-price listing in the ActiveList at quantity 0, so "the SKU
    // has a listing price" said yes to cards that left the building months
    // ago — and they came out at the TOP of a list ranked by value, because
    // the expensive cards are the ones that sell. isListingAvailable() in
    // stockcheck.js is the one definition of the difference.
    const gone = soldOutSkus(listings);
    const priceBySku = new Map();
    for (const l of listings) {
      if (!isListingAvailable(l)) continue;
      const k = String(l.sku).toLowerCase();
      if (l.price_value != null && !priceBySku.has(k)) priceBySku.set(k, Math.round(Number(l.price_value) * 100));
    }
    // Where each card physically is, right now. Computed over EVERY unpulled
    // card, not just the recommended ones — a rank is a count within its whole
    // stack, so narrowing the list first would number the shortlist instead of
    // the shelf.
    const ranks = liveRanks(cards);
    const depths = stackDepths(cards);
    // Counted before the shortlist is cut, and shown: a card silently dropped
    // looks exactly like a card we never had, and this one needs reconciling
    // rather than ignoring.
    setRecSkipped(
      cards.filter((c) => !c.checked_out_at && c.sku && gone.has(String(c.sku).toLowerCase())).length
    );
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

  // What's on screen, and what the buttons under it act on. Both come out of
  // showfilter.js, so "all of them" can never mean more than you can see —
  // read the note on selectionFor(): the cards a bulk action moves silently
  // are the ones that were never rendered.
  const view = useMemo(
    () => showView(open, {
      query: q, sort, event: eventFilter, stack: stackFilter,
      sticker: stickerFilter, listing: listingFilter
    }),
    [open, q, sort, eventFilter, stackFilter, stickerFilter, listingFilter]
  );
  const visible = view.rows;
  const selected = useMemo(() => selectionFor(visible, sel), [visible, sel]);
  // The customer's list. Same search, same sort, same rows — projected through
  // showcounter.js so what reaches a stranger's eyes is an allow-list rather
  // than this row with the private bits hidden by CSS.
  const counter = useMemo(
    () => counterView(open, {
      query: q, sort, event: eventFilter, stack: stackFilter,
      sticker: stickerFilter, listing: listingFilter
    }, { images }),
    [open, q, sort, eventFilter, stackFilter, stickerFilter, listingFilter, images]
  );
  const wantGroups = useMemo(() => wantsSummary(wants), [wants]);
  // Stock that is listed online and not in the box. Only ever on a search, and
  // never a card already in the list above it — see onlineMatches().
  const online = useMemo(
    () => (counterMode ? onlineMatches(listings, { query: q, inBoxSkus: inBoxSkus(open) }) : []),
    [counterMode, listings, q, open]
  );
  // Where every card physically is, and which SKU each online row came from.
  //
  // The SKU map is deliberately NOT part of the projected row. counterRow()
  // and listingRow() stay an allow-list of what a customer may read; this is
  // the desk resolving one of its own rows back to its own data, on a tap, out
  // of state it already holds. Putting the SKU on the row to make the lookup
  // easier is exactly the shortcut check-showcounter.mjs exists to refuse.
  const locations = useMemo(() => locationsBySku(stackCards, stackName), [stackCards, stackName]);
  const skuByListingId = useMemo(() => {
    const m = new Map();
    for (const l of listings) if (l?.ebay_item_id && l?.sku) m.set(String(l.ebay_item_id), String(l.sku).toLowerCase());
    return m;
  }, [listings]);
  function locationFor(rowId) {
    const sku = skuByListingId.get(String(rowId));
    return sku ? locations.get(sku) || null : null;
  }
  const events = useMemo(() => facetsOf(open, "event"), [open]);
  const stackFacets = useMemo(() => facetsOf(open, "stack_name"), [open]);
  // Record what somebody just asked for. Pre-filled from the search box,
  // because by the time you want this you have already typed it — "gengar" is
  // in the box and the answer is on screen. `hadMatch` is taken from THAT
  // search rather than recomputed later: the useful fact is whether we could
  // meet the ask at the moment it was made.
  async function noteWant(text) {
    const raw = String(text ?? q).trim();
    if (!raw) return;
    setBusy(true);
    const res = await recordWant(supabase(), {
      query: raw,
      event,
      hadMatch: visible.length > 0
    });
    setBusy(false);
    if (res.missing) {
      setWantsMissing(true);
      setMsg("Want list needs migration 026 — run it in Supabase and this starts recording.");
      return;
    }
    if (!res.ok) {
      setMsg(`Couldn't record that: ${res.error}`);
      return;
    }
    setWants((prev) => [res.row, ...prev]);
    setMsg(`Noted: “${raw}”${visible.length > 0 ? "" : " — we didn't have it"}.`);
  }

  async function removeWant(id) {
    const res = await deleteWant(supabase(), id);
    if (!res.ok && !res.missing) {
      setMsg(`Couldn't remove that: ${res.error}`);
      return;
    }
    setWants((prev) => prev.filter((w) => w.id !== id));
  }

  function clearFilters() {
    setQ("");
    setEventFilter("");
    setStackFilter("");
    setStickerFilter("any");
    setListingFilter("any");
  }

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
  const selCount = selected.length;
  // The same words you typed above, over the cards that have already been
  // sold or filed. Searching the show stock and finding nothing usually means
  // the card is here rather than gone, and that is worth one line.
  const pastMatches = q.trim() ? history.filter((h) => matchesQuery(h, q)) : history;

  return (
    <div className="rise-group sd-scope">
      {/* Counter mode hides every screen that isn't the stock list. Not styled
          away — not rendered. A customer holding the tablet can scroll, and a
          "£ Sold" button that is merely off-palette is still a button. */}
      {counterMode ? null : (
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
      )}

      {recs !== null && !counterMode ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Recommended show stock — highest value first</span>
            <button className="btn btn-ghost" onClick={() => setRecs(null)}>Close</button>
          </div>
          {recSkipped > 0 ? (
            <p className="hint hint-small" style={{ marginTop: 0, color: "var(--warn-ink)" }}>
              {recSkipped} card{recSkipped === 1 ? "" : "s"} left out: still in a stack, but the eBay listing is
              out of stock (quantity 0) — which is what a card that has already <b>sold</b> looks like.
              Run <b>Stacks → Reconcile</b> to pull them, or you&apos;ll be looking for cards that aren&apos;t there.
            </p>
          ) : null}
          {recs.length === 0 ? (
            <p className="dd-empty">No stack cards matched a live listing price. Sync your eBay listings, then try again.</p>
          ) : (
            <>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                Your live stock ranked by listing price. Untick anything staying home, then check the rest out in one go.
              </p>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                The SKU comes first, then the <b>live position</b> — count that many from the top of the
                stack. The two are not the same number: a SKU is a name and never moves, while positions
                close up behind every card pulled or taken to a show.
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
                  <label className="ps-row sd-rec-row" key={card.id}>
                    <input
                      type="checkbox"
                      checked={recSel.has(card.id)}
                      onChange={() => setRecSel((prev) => { const n = new Set(prev); if (n.has(card.id)) n.delete(card.id); else n.add(card.id); return n; })}
                    />
                    <span className="stack-sku" title="The card's SKU. A name, not an address — it does not move when the stack re-flows.">
                      {card.sku}
                    </span>
                    <span className="stack-pos" title="Live position — count this many from the top of the stack">
                      {rank ?? "?"}
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
          <h3>{counterMode ? "In stock today" : "Away at the show"}</h3>
          <span className="badge2">{counterMode ? `${counter.shown} card${counter.shown === 1 ? "" : "s"}` : `${open.length} out`}</span>
          {open.length > 0 && !counterMode ? (
            <button
              className="btn btn-ghost"
              onClick={() => router.push("/panel/batch?pool=show")}
              title="Price everything that's checked out and get a recommended sticker price for each"
              disabled={busy}
            >
              🏷 Price this pool
            </button>
          ) : null}
          {/* Always offered, including with an empty box. Gated on there being
              stock out, it vanished exactly when someone wanted to find out what
              it did — and a control you can only discover while packing for a
              show is one nobody discovers. An empty counter screen is also an
              honest thing to hand somebody at a table that has sold out. */}
          <button
            className={counterMode ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => { setCounterMode((v) => !v); setSel(new Set()); }}
            title={counterMode
              ? "Back to the desk — the SKUs, the eBay state and the sold/return buttons come back"
              : "Turn the list round to face a customer: pictures, names and prices only"}
          >
            {counterMode ? "✕ Back to the desk" : "👋 Show a customer"}
          </button>
          {!counterMode && !wantsMissing && wantGroups.length > 0 ? (
            <button className="btn btn-ghost" onClick={() => setShowWants((v) => !v)} title="What people have asked for">
              🔎 Asked for ({wantGroups.length})
            </button>
          ) : null}
        </div>
        {open.length === 0 && !counterMode ? (
          /* The desk's empty state points at the checkout form, which counter
             mode does not render — so it would be telling a customer to enter
             a SKU into a box that isn't on screen. Counter mode therefore
             keeps the search below instead of stopping here: with nothing
             checked out the online list is the only stock there is, and it is
             reachable only through that box. */
          <p className="dd-empty">Nothing checked out. Enter a SKU above as you pack for a show — numbering in its stack adjusts automatically while it&apos;s away.</p>
        ) : (
          <>
            <div className="sd-find">
              <div className="dd-inp sd-find-inp">
                <span className="mag" aria-hidden="true">⌕</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={counterMode ? "Search the stock — name or number" : "Find a card — name, SKU, number, show"}
                  aria-label="Search the show stock"
                />
                {q ? (
                  <button className="sd-clear" onClick={() => setQ("")} title="Clear the search" aria-label="Clear the search">×</button>
                ) : null}
              </div>
              <select className="sd-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort the show stock">
                {SHOW_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {/* Operational filters, not a customer's. "Still sellable
                  online" in particular says out loud that the card is on eBay,
                  which invites a price-check against the sticker in front of
                  them. */}
              {counterMode ? null : (
                <>
              <select className="sd-select" value={stickerFilter} onChange={(e) => setStickerFilter(e.target.value)} aria-label="Filter by sticker">
                {STICKER_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select
                className="sd-select"
                value={listingFilter}
                onChange={(e) => setListingFilter(e.target.value)}
                aria-label="Filter by eBay listing"
                title="“Still sellable online” is the one to check before you leave: those listings can take somebody's money while the card is in the box."
              >
                {LISTING_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
                </>
              )}
              {/* Only offered when there's a choice to make: one show, or one
                  stack, is not a filter — it's a dropdown with one answer. */}
              {events.length > 1 && !counterMode ? (
                <select className="sd-select" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label="Filter by show">
                  <option value="">Any show</option>
                  {events.map((e) => <option key={e.value} value={e.value}>{e.value} ({e.count})</option>)}
                </select>
              ) : null}
              {stackFacets.length > 1 && !counterMode ? (
                <select className="sd-select" value={stackFilter} onChange={(e) => setStackFilter(e.target.value)} aria-label="Filter by the stack it left">
                  <option value="">Any stack</option>
                  {stackFacets.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
                </select>
              ) : null}
            </div>
            {view.filtering && !counterMode ? (
              /* Said out loud, because the alternative is a button that looks
                 like it does one thing and does another. A card filed while it
                 was off screen leaves nothing behind to notice. */
              <p className="hint hint-small sd-find-note">
                Showing <b>{view.shown}</b> of {view.total} checked out
                {view.hidden > 0 ? ` — ${view.hidden} hidden by the search` : ""}.
                {" "}Everything below acts on {selCount === 1 ? "the one card" : `these ${selCount} cards`}, never on what you can&apos;t see.
                {" "}<button className="sd-clear-all" onClick={clearFilters}>Clear</button>
              </p>
            ) : null}
            {counterMode ? null : (
            <div className="sd-bulkbar">
              <label className="sd-toggle">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((o) => sel.has(o.id))}
                  ref={(el) => {
                    if (el) el.indeterminate = visible.some((o) => sel.has(o.id)) && !visible.every((o) => sel.has(o.id));
                  }}
                  // Ticking adds the rows on screen and leaves any tick outside
                  // the search alone: unticking a row you can't see is its own
                  // surprise. selectionFor() is what stops those being acted on.
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSel((prev) => {
                      const n = new Set(prev);
                      for (const o of visible) { if (on) n.add(o.id); else n.delete(o.id); }
                      return n;
                    });
                  }}
                  disabled={visible.length === 0}
                />
                {sel.size > 0 ? `${selCount} selected` : `All ${visible.length}`}
              </label>
              {/* Nothing on screen is nothing to act on: a search that matches
                  no card leaves these buttons pointing at an empty set, and a
                  "Return to spots" that quietly does nothing reads as broken. */}
              <div className="ps-actions">
                <button className="btn btn-primary" onClick={buildPlan} disabled={busy || selCount === 0}>✨ Reallocate ({selCount})</button>
                <button className="btn btn-ghost" onClick={() => checkin(selected, "spot")} disabled={busy || selCount === 0}>↩ Return to spots</button>
                <button className="btn btn-ghost" onClick={() => { setPlan(null); setBackPickerOpen((v) => !v); }} disabled={busy || selCount === 0}>⤵ Pick a stack…</button>
                <button className="btn btn-ghost" onClick={() => checkin(selected, "new_stack")} disabled={busy || selCount === 0}>✚ New stack</button>
              </div>
            </div>
            )}

            {plan && !counterMode ? (
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

            {backPickerOpen && !counterMode ? (
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
            {visible.length === 0 ? (
              counterMode ? (
                /* Three different situations, and saying the wrong one is
                   confusing rather than merely terse: nothing searched for
                   yet, searched and found only online stock (which renders
                   below, so this must keep quiet), or a genuine miss — the
                   valuable moment, and the ask that leaves no trace anywhere
                   else. */
                !q.trim() ? (
                  <p className="dd-empty">
                    {open.length === 0
                      ? "Nothing in the box. Search to check what we have online."
                      : "Search to find a card."}
                  </p>
                ) : online.length > 0 ? null : (
                <p className="dd-empty">
                  Nothing here matches that.{" "}
                  {!wantsMissing ? (
                    <button className="sd-clear-all" onClick={() => noteWant(q)} disabled={busy}>
                      Note that someone asked for “{q.trim()}”
                    </button>
                  ) : null}
                  {" "}
                  <button className="sd-clear-all" onClick={clearFilters}>Clear the search</button>
                </p>
                )
              ) : (
              <p className="dd-empty">
                Nothing checked out matches that.{" "}
                {q.trim() && pastMatches.length > 0
                  ? `${pastMatches.length} card${pastMatches.length === 1 ? "" : "s"} in Recent activity below ${pastMatches.length === 1 ? "does" : "do"} — it may already be sold or back in its stack. `
                  : ""}
                <button className="sd-clear-all" onClick={clearFilters}>Clear the search</button>
              </p>
              )
            ) : null}
            {/* Two lists, one search. The counter list is built from
                counterView() and never from `visible`, so nothing on this
                branch can reach a field the projection didn't allow. */}
            {counterMode ? (
              <div className="stack-list sd-counter">
                {counter.rows.map((c) => (
                  <div className="ps-row sd-counter-row" key={c.id}>
                    {c.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="sd-counter-art" src={c.image} alt="" loading="lazy" width="44" height="62" />
                    ) : (
                      <span className="sd-counter-art sd-counter-noart" aria-hidden="true" />
                    )}
                    <span className="stack-title">{c.name}</span>
                    {/* An ask is not a figure, and shouldn't be set like one:
                        at price size it competes with the real numbers in the
                        rows above and below, and on a phone it was long enough
                        to drop onto a line of its own, away from its card. */}
                    <span className={c.pricePence == null ? "sd-price sd-price-ask" : "sd-price"}>{c.priceText}</span>
                  </div>
                ))}
              </div>
            ) : (
            <div className="stack-list">
              {visible.map((co) => {
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
            )}
            {/* Stock we have listed online. A SEPARATE list under its own
                heading, never merged into the one above, because the list
                above is cards you can physically hand over.

                The wording says "ask", not "not here", and that is the whole
                point of it. Not everything that travels to a show gets checked
                out, so a card can be in the box and absent from the list above
                — and telling a customer we haven't got it, while it sits in
                the box, loses a sale we had already made. What the system
                actually knows is that we own one; whether it is in this room
                is a question for the person at the table. */}
            {counterMode && online.length > 0 ? (
              <>
                <div className="sd-counter-split">
                  <span className="eyebrow">Ask us about these</span>
                  <span className="hint-small">
                    Also in our stock — some travel with us, some are at home. Ask and we&apos;ll check.
                  </span>
                </div>
                <div className="stack-list sd-counter">
                  {online.map((c) => (
                    <div className="ps-row sd-counter-row sd-counter-online" key={c.id}>
                      {c.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img className="sd-counter-art" src={c.image} alt="" loading="lazy" width="44" height="62" />
                      ) : (
                        <span className="sd-counter-art sd-counter-noart" aria-hidden="true" />
                      )}
                        <span className="stack-title">{c.name}</span>
                      <span className={c.pricePence == null ? "sd-price sd-price-ask" : "sd-price"}>{c.priceText}</span>
                      {/* Where it is, on a tap and never before one.
                          A stack name and a depth tell a stranger how much
                          stock there is and where it lives, so this is the one
                          piece of desk data allowed on this screen and it is
                          allowed only because YOU asked for it, one row at a
                          time. It is looked up from state the desk already
                          holds rather than carried on the row — the projection
                          stays an allow-list. */}
                      <button
                        className="stack-pull sd-locate"
                        onClick={() => setLocationOpen((cur) => (cur === c.id ? null : c.id))}
                        title="Where is this one?"
                        aria-label="Where is this one?"
                      >
                        {locationOpen === c.id ? (locationFor(c.id) || "not in a stack") : "⌖"}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {/* Someone asked, and we HAD it. Worth as much as a miss: it says
                which cards are worth packing again, and it is the same tap. */}
            {counterMode && !wantsMissing && q.trim() && (counter.shown > 0 || online.length > 0) ? (
              <p className="hint hint-small sd-find-note">
                <button className="sd-clear-all" onClick={() => noteWant(q)} disabled={busy}>
                  Note that someone asked for “{q.trim()}”
                </button>
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* The want list. Desk-only: it is a record of what we could not sell,
          which is a buying note to ourselves and nothing a customer should
          read over the counter. */}
      {showWants && !counterMode && !wantsMissing ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Asked for</span>
            <span className="badge2">{wantGroups.filter((g) => g.misses > 0).length} we couldn&apos;t meet</span>
            <button className="btn btn-ghost" onClick={() => setShowWants(false)}>Close</button>
          </div>
          <p className="hint hint-small">
            What people asked for at the table. The ones we didn&apos;t have are the
            buying list — nothing else records them.
          </p>
          <div className="stack-list">
            {wantGroups.map((g) => (
              <div className="stack-row" key={g.key}>
                <span className="stack-title">{g.query}</span>
                <span className="badge2">{g.asks} ask{g.asks === 1 ? "" : "s"}</span>
                {g.misses > 0 ? (
                  <span className="hint-small" style={{ color: "var(--warn-ink)", flex: "none" }}>
                    {g.misses} not in stock
                  </span>
                ) : (
                  <span className="hint-small" style={{ color: "var(--conf-high)", flex: "none" }}>had it</span>
                )}
                <span className="sd-rowacts">
                  <button className="stack-pull" onClick={() => setQ(g.query)} title="Search the stock for this">⌕</button>
                  <button className="stack-pull" onClick={() => removeWant(g.ids[0])} title="Remove one of these">✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {wantsMissing && !counterMode ? (
        <p className="hint hint-small">
          The want list needs <b>migration 026</b>, applied in Supabase. Everything
          else on this screen works without it.
        </p>
      ) : null}

      {history.length > 0 && !counterMode ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Recent activity</span>
            {/* The takings are the day's, not the search's: a total that moved
                while you looked for one card would be read as money going
                missing. */}
            {soldRows.length > 0 ? <span className="badge2">{soldRows.length} sold · {pounds(takings)}</span> : null}
            {q.trim() ? <span className="badge2">{pastMatches.length} of {history.length} match your search</span> : null}
          </div>
          {q.trim() && pastMatches.length === 0 ? (
            <p className="dd-empty">Nothing here matches “{q.trim()}” either.</p>
          ) : null}
          <div className="stack-list">
            {pastMatches.map((co) => (
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
