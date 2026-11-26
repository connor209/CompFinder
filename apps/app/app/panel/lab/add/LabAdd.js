"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardUploaderCsv from "@/lib/carduploader.js";
import { groupsFromItems, listingForGroup, priceFromComps } from "@/lib/lab-copies.js";
import { renderListing, TITLE_MAX } from "@/lib/listing-template.js";
import {
  DRAFT_KEY, mergeGroups, liveCopies, groupToSend, rowStatus, STATUS_TEXT, LISTABLE, applyBulk, parsePrice,
  FILTERS, filterRows, sortRows, tickedOnScreen, draftTotals, serialiseDraft, restoreDraft, isThin,
  LANGUAGES, DECISION_TEXT, unreadableRows, settleSent, compsShown, applyCardRule, ruleFeedbackArgs
} from "@/lib/lab-draft.js";
import { RULE_KINDS, ruleKeyFor, normaliseRule, isEmptyRule, describeRule, saleBreaksRule, ruleComment, SALE_REASONS, saleReasonLabel, ruleKindForReason, normaliseSaleNote, saleComment } from "@/lib/price-rules.js";
import { listRules, saveRule } from "@/lib/price-rules-store.js";
import { recordFeedback } from "@/lib/feedback-store.js";
import { LAB_TABLE_CSS } from "../labTableCss";
import { PRICING_KEY } from "@/lib/lab-overview.js";
import { evidenceFrom, evidenceSummary, evidencePrice, chosenSales, picksDiffer } from "@/lib/lab-evidence.js";
import { parseCostPence } from "@/lib/card-costs.js";
import { createClient } from "@/lib/supabase/client";
import {
  batchIdFrom, listLabBatches, loadLabBatch, createLabBatch, saveLabBatch, renameLabBatch, deleteLabBatch,
  defaultBatchName, localKeyFor, batchDefaults, batchKind, batchProgress, refreshTile, tilesToFill
} from "@/lib/lab-batches.js";
import BatchHome, { BATCH_HOME_CSS } from "./BatchHome";
import NewBatch, { NEW_BATCH_CSS } from "./NewBatch";
import BatchSteps, { BATCH_STEPS_CSS } from "./BatchSteps";
import LabHeader, { LAB_HEADER_CSS } from "../LabHeader";
import { labCardFor, compsFromResult, applyComps } from "@/lib/lab-pricing.js";
import { navigate } from "@/lib/client-nav.js";
import { applyJobs, isOpen, remainingCards } from "@/lib/pricing-queue.js";

/**
 * Add copies: the working list between a CardUploader export and eBay.
 * Load one or more exports, price them from sold comps, edit prices, titles,
 * subtypes and which copies go — singly or in bulk — then list.
 *
 * Each upload is a BATCH, kept on the server (lib/lab-batches.js, migration
 * 047) at its own URL, so two tabs or two devices are two batches rather than
 * one localStorage slot overwritten by whichever saved last. The same batch
 * open twice is caught by its rev and shown as a conflict, never overwritten.
 * Before 047 the screen keeps the old one-list-per-browser draft.
 * Rules in lib/lab-draft.js; every bulk action and every List acts on rows
 * ticked AND on screen.
 */

const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const SORTS = [["attention", "Needs attention first"], ["name", "Name"], ["sku", "SKU"], ["price-desc", "Your price, high first"], ["comps-desc", "Sold comps, high first"]];
const STATUS_CLASS = { ready: "s-live", checked: "s-live", thin: "s-soldout", needsprice: "s-sold", toolow: "s-sold", failed: "s-sold", listed: "s-next", excluded: "s-ended", nocopies: "s-ended", sending: "s-soldout" };

async function api(body) {
  const res = await fetch("/api/lab", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
}

/**
 * What this screen last saw, kept for the life of the page — it outlives the
 * screen remounting on every in-place navigation (lib/client-nav.js), never a
 * reload. Going back and forth between the grid and a batch used to start from
 * nothing each time: the whole screen waited on /api/lab (a function waking
 * up, a login check, every lab listing, copy and log line) even on the grid,
 * which uses none of it, and a batch was a second read after the list. Now the
 * last answer is drawn at once and the fresh one replaces it when it lands.
 *
 * The rev of a batch and whether a save is in flight are kept HERE too, not
 * per screen: a save started by the screen you just left must not leave the
 * next one saving over a rev it no longer holds.
 */
const MEM = { lab: null, batches: null, tiles: true, open: new Map(), rev: new Map(), saving: new Set(), rules: null };
const MEM_OPEN_MAX = 6;
function rememberOpen(id, entry) {
  MEM.open.delete(id);
  MEM.open.set(id, { ...(MEM.open.get(id) || {}), ...entry });
  while (MEM.open.size > MEM_OPEN_MAX) MEM.open.delete(MEM.open.keys().next().value);
}
const startingBatch = () => {
  if (typeof window === "undefined") return null;
  const id = batchIdFrom(window.location.search);
  return id ? MEM.open.get(id) || null : null;
};

function loadDraft() {
  try { return restoreDraft(localStorage.getItem(DRAFT_KEY)); } catch { return []; }
}

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function LabAdd() {
  // The batch this screen opens on, if it was seen this session — drawn at once.
  const [start] = useState(startingBatch);
  const [lab, setLab] = useState(() => MEM.lab);
  // Whether `lab` is this visit's answer, not the one remembered: listing waits for it.
  const [labFresh, setLabFresh] = useState(false);
  const [rows, setRows] = useState(() => start?.rows || []);
  const [loaded, setLoaded] = useState(() => Boolean(start) || (MEM.batches != null && typeof window !== "undefined" && !batchIdFrom(window.location.search)));
  // Where the list lives: "ok" (batches on the server), "missing" (047 not
  // run — the old local draft), "error" (couldn't ask — the local draft too,
  // so a dropped connection never stops the work).
  const [store, setStore] = useState(() => (MEM.batches ? "ok" : "loading"));
  const [batch, setBatch] = useState(() => start?.batch || null); // { id, name, updated_at } of the open batch
  const [batches, setBatches] = useState(() => MEM.batches || []);
  const [batchTiles, setBatchTiles] = useState(() => MEM.tiles); // false before migration 049: no cover or value on a tile
  const [legacy, setLegacy] = useState([]); // a pre-batch list still in this browser
  const [saveState, setSaveState] = useState("saved"); // saved | pending | saving | conflict | error
  const [saveErr, setSaveErr] = useState("");
  const [renaming, setRenaming] = useState(null);
  // /panel/lab/add?new=1 — the New batch setup, before any file is read.
  const [isNew, setIsNew] = useState(false);
  const tableRef = useRef(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const revRef = useRef(start?.rev ?? 0);
  const savedRef = useRef(start?.savedJson ?? "[]");
  const flushingRef = useRef(false);
  const conflictRef = useRef(false);
  const batchId = batch?.id || null;
  useEffect(() => { if (store === "ok") MEM.batches = batches; }, [batches, store]);
  const batchIdRef = useRef(null);
  batchIdRef.current = batchId;
  // The pricing queue (migration 048): every job of this account, and this
  // batch's answers. `missing` means 048 isn't run — the tab prices itself.
  const [queue, setQueue] = useState({ jobs: [], eta: [], busy: null, batchJobs: [], missing: false, loaded: false });
  const [refused, setRefused] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [file, setFile] = useState("");
  const [sort, setSort] = useState("attention");
  const [ticked, setTicked] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());
  const [panel, setPanel] = useState(null); // "price" | "subtype"
  const [priceText, setPriceText] = useState("");
  const [pctText, setPctText] = useState("0");
  const [costText, setCostText] = useState("");
  const [subtypePick, setSubtypePick] = useState("");
  // The language of the NEXT file loaded. Batches are one language each, so
  // it is chosen before loading and stamped on every card in the file.
  const [batchLang, setBatchLang] = useState("English");
  const [anyLang, setAnyLang] = useState(false);
  const [langPick, setLangPick] = useState("English");
  const [anyPick, setAnyPick] = useState(false);
  // Sales from sellers outside the UK: per batch, like the language.
  const [overseas, setOverseas] = useState(false);
  const [overseasPick, setOverseasPick] = useState(false);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  // The rows in the request being priced right now, shown on the rows.
  const [pricingIds, setPricingIds] = useState(() => new Set());
  const stopRef = useRef(false);
  const [msg, setMsg] = useState(null);
  // Your rules for a card (migration 050): key → rule, and whether they can be kept.
  const [cardRules, setCardRules] = useState(() => MEM.rules || new Map());
  const [rulesStore, setRulesStore] = useState("ok");
  // The view (which rows, in what order) is worked out when you ASK for it —
  // a filter, a search, a sort, a load, a bulk action — never because a price
  // was typed. Re-sorting on every keystroke moved a row out from under the
  // next price box (caught testing, 2026-11-24): the second price went on the
  // wrong card.
  const [viewKey, setViewKey] = useState(0);
  const refreshView = () => setViewKey((k) => k + 1);

  const reloadLab = useCallback(async () => {
    const r = await api();
    MEM.lab = r;
    setLab(r);
    setLabFresh(true);
  }, []);
  useEffect(() => {
    listRules(createClient()).then((r) => {
      if (r.ok) { MEM.rules = r.rules; setCardRules(r.rules); }
      else setRulesStore(r.missing ? "missing" : "error");
    });
  }, []);
  useEffect(() => {
    reloadLab();
    let live = true;
    (async () => {
      const sb = createClient();
      const id = batchIdFrom(window.location.search);
      if (!id && new URLSearchParams(window.location.search).get("new")) setIsNew(true);
      // The list and the batch are read together, not one after the other.
      const [listed, got] = await Promise.all([listLabBatches(sb), id ? loadLabBatch(sb, id) : Promise.resolve(null)]);
      if (!live) return;
      if (!listed.ok) {
        // Before 047, or the store can't be reached: the old local draft.
        setStore(listed.missing ? "missing" : "error");
        if (!listed.missing) setSaveErr(listed.error || "");
        setRows(loadDraft());
        setLoaded(true);
        return;
      }
      setStore("ok");
      setBatches(listed.batches);
      setBatchTiles(listed.tiles !== false);
      MEM.batches = listed.batches;
      MEM.tiles = listed.tiles !== false;
      // Batches saved before 049 have no cover or value on their tile yet:
      // fill them in, two at a time, as the grid is already on screen.
      if (listed.tiles !== false && !id) {
        const todo = tilesToFill(listed.batches);
        (async () => {
          for (let i = 0; i < todo.length && live; i += 2) {
            const done = await Promise.all(todo.slice(i, i + 2).map((b) => refreshTile(sb, b.id).then((r) => ({ id: b.id, r }))));
            if (!live) return;
            const got = new Map(done.filter((d) => d.r.ok).map((d) => [d.id, d.r.tile]));
            if (got.size) setBatches((bs) => bs.map((b) => (got.has(b.id) ? { ...b, ...got.get(b.id) } : b)));
            if (done.some((d) => d.r.missing)) return;
          }
        })();
      }
      setLegacy(loadDraft());
      if (id) {
        if (got.ok) {
          const b = got.batch;
          const remembered = MEM.rev.get(b.id);
          // Drawn from memory and nothing has changed on the server since, or
          // edited here already (a save is on its way): keep what is on screen.
          const sameAsShown = start && remembered != null && b.rev <= remembered;
          const editedHere = start && JSON.stringify(rowsRef.current) !== savedRef.current;
          setBatch({ id: b.id, name: b.name, updated_at: b.updated_at });
          if (sameAsShown || editedHere) { setLoaded(true); return; }
          let startRows = b.rows;
          // A save that never reached the server (wifi dropped, tab closed)
          // is still on this device; take it if it is newer than the server's.
          try {
            const local = JSON.parse(localStorage.getItem(localKeyFor(b.id)) || "null");
            if (local?.v === 1 && Array.isArray(local.rows) && local.at && new Date(local.at) > new Date(b.updated_at)
              && JSON.stringify(local.rows) !== JSON.stringify(b.rows)) startRows = local.rows;
          } catch { /* no backup */ }
          revRef.current = b.rev;
          MEM.rev.set(b.id, b.rev);
          savedRef.current = JSON.stringify(b.rows);
          rememberOpen(b.id, { batch: { id: b.id, name: b.name, updated_at: b.updated_at }, rows: startRows, rev: b.rev, savedJson: savedRef.current });
          setRows(startRows);
        } else {
          // Shown from memory but gone from the server (deleted in another
          // tab): don't leave a batch on screen that saving can't reach.
          if (start) { MEM.open.delete(id); setBatch(null); setRows([]); }
          setMsg({ bad: true, text: got.error || "Couldn't open that batch." });
        }
      }
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [reloadLab]);
  // Pricing runs from this tab (listing runs on the server): closing or
  // reloading it stops the pricing after the card in flight. Ask first.
  useEffect(() => {
    if (busy !== "price") return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  /**
   * Save the open batch, if it changed — and only over the rev it was loaded
   * at. One save in flight at a time; a change made while one is out is saved
   * straight after it, so the rev is never stale by our own hand.
   */
  async function flushBatch() {
    const id = batchIdRef.current;
    if (!id || flushingRef.current || conflictRef.current) return;
    // A save from the screen just left is still out: wait for it, then go.
    if (MEM.saving.has(id)) { setTimeout(() => flushBatch(), 400); return; }
    const now = rowsRef.current;
    const json = JSON.stringify(now);
    if (json === savedRef.current) { setSaveState("saved"); return; }
    flushingRef.current = true;
    MEM.saving.add(id);
    setSaveState("saving");
    if (MEM.rev.has(id)) revRef.current = Math.max(revRef.current, MEM.rev.get(id));
    const res = await saveLabBatch(createClient(), { id, rows: now, rev: revRef.current });
    flushingRef.current = false;
    MEM.saving.delete(id);
    if (res.ok) {
      revRef.current = res.rev;
      MEM.rev.set(id, res.rev);
      savedRef.current = json;
      rememberOpen(id, { rows: now, rev: res.rev, savedJson: json });
      setSaveState("saved");
      setSaveErr("");
      if (JSON.stringify(rowsRef.current) !== json) flushBatch();
    } else if (res.conflict) {
      conflictRef.current = true;
      setSaveState("conflict");
    } else {
      setSaveState("error");
      setSaveErr(res.error || "unknown error");
    }
  }

  // Kept as you go: a typed price survives a reload. A batch saves to the
  // server a moment after the last change, with a copy on this device in case
  // the save doesn't arrive; without batches, the old one-list draft.
  useEffect(() => {
    if (!loaded) return undefined;
    if (store !== "ok") {
      try { localStorage.setItem(DRAFT_KEY, serialiseDraft(rows)); } catch { /* full or blocked: the list still works */ }
      return undefined;
    }
    if (!batchId) return undefined;
    try { localStorage.setItem(localKeyFor(batchId), serialiseDraft(rows)); } catch { /* the server copy still saves */ }
    if (batch) rememberOpen(batchId, { batch, rows });
    if (JSON.stringify(rows) === savedRef.current || conflictRef.current) return undefined;
    setSaveState("pending");
    const t = setTimeout(() => { flushBatch(); }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loaded, store, batchId]);

  // Switching section in place (lib/client-nav.js) unmounts this screen
  // without a page unload, so the debounced save would be cancelled with it:
  // save now instead. The fetch outlives the screen.
  useEffect(() => () => { flushBatch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving with a save still to arrive is the one way left to lose work.
  useEffect(() => {
    if (saveState !== "pending" && saveState !== "saving") return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /** Read the queue; put this batch's answers on its rows; restart a worker that died. */
  async function refreshQueue() {
    if (store !== "ok") return;
    const res = await fetch(`/api/pricing-queue${batchId ? `?batch=${batchId}` : ""}`).then((r) => r.json()).catch(() => null);
    if (!res) return;
    if (!res.ok) { if (res.missing) setQueue((q) => ({ ...q, missing: true, loaded: true })); return; }
    setQueue({ jobs: res.jobs, eta: res.eta, busy: res.busy, batchJobs: res.batchJobs || [], missing: false, loaded: true });
    if (res.batchJobs?.length) setRows((rs) => applyJobs(rs, res.batchJobs));
    if (res.busy === false && res.jobs.some(isOpen)) {
      fetch("/api/pricing-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kick" }) }).catch(() => {});
    }
  }

  async function cancelQueued(id) {
    if (!window.confirm("Stop this pricing job? Cards already priced keep their prices.")) return;
    const res = await fetch("/api/pricing-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id }) }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
    if (!res.ok) setMsg({ bad: true, text: res.error || "Couldn't stop it." });
    refreshQueue();
  }

  const queueOpen = queue.jobs.some(isOpen);
  useEffect(() => {
    if (!loaded || store !== "ok") return undefined;
    refreshQueue();
    const t = setInterval(refreshQueue, queueOpen ? 8000 : 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, store, batchId, queueOpen]);

  /** This batch's rows waiting in an open job, for the "queued" mark on the row. */
  const queuedIds = useMemo(() => {
    const ids = new Set();
    for (const j of queue.batchJobs) if (isOpen(j)) for (const c of remainingCards(j)) ids.add(String(c.rowId));
    return ids;
  }, [queue.batchJobs]);

  /** Start a batch holding `list`, and put it in the URL so this tab IS that batch. */
  async function startBatch(list, fileNames, name = "") {
    const res = await createLabBatch(createClient(), { name: name || defaultBatchName(fileNames), rows: list });
    if (!res.ok) return res;
    revRef.current = res.batch.rev;
    MEM.rev.set(res.batch.id, res.batch.rev);
    savedRef.current = JSON.stringify(list);
    rememberOpen(res.batch.id, { batch: { id: res.batch.id, name: res.batch.name, updated_at: res.batch.updated_at }, rows: list, rev: res.batch.rev, savedJson: savedRef.current });
    conflictRef.current = false;
    setBatch({ id: res.batch.id, name: res.batch.name, updated_at: res.batch.updated_at });
    setBatches((bs) => [res.batch, ...bs]);
    setSaveState("saved");
    setIsNew(false);
    try { window.history.replaceState(null, "", `${window.location.pathname}?batch=${res.batch.id}`); } catch { /* the batch is saved either way */ }
    return res;
  }

  /** The other tab's version wins: load it over this one. */
  async function takeTheirs() {
    const got = await loadLabBatch(createClient(), batchId);
    if (!got.ok) { setMsg({ bad: true, text: got.error || "Couldn't reload the batch." }); return; }
    revRef.current = got.batch.rev;
    MEM.rev.set(got.batch.id, got.batch.rev);
    savedRef.current = JSON.stringify(got.batch.rows);
    conflictRef.current = false;
    setRows(got.batch.rows);
    setSaveState("saved");
    refreshView();
  }

  /** This tab's version wins: save it over the other one, knowingly. */
  async function keepMine() {
    const got = await loadLabBatch(createClient(), batchId);
    if (!got.ok) { setMsg({ bad: true, text: got.error || "Couldn't reach the batch." }); return; }
    revRef.current = got.batch.rev;
    MEM.rev.set(got.batch.id, got.batch.rev);
    savedRef.current = JSON.stringify(got.batch.rows);
    conflictRef.current = false;
    flushBatch();
  }

  async function removeBatch(b) {
    if (!window.confirm(`Delete the batch "${b.name}" (${b.card_count ?? rows.length} cards)? Typed prices go with it. Nothing on eBay changes.`)) return;
    const res = await deleteLabBatch(createClient(), b.id);
    if (!res.ok) { setMsg({ bad: true, text: `Couldn't delete it: ${res.error || "migration 047 isn't run"}` }); return; }
    try { localStorage.removeItem(localKeyFor(b.id)); } catch { /* nothing to clear */ }
    if (b.id === batchId) { navigate("/panel/lab/add"); return; }
    setBatches((bs) => bs.filter((x) => x.id !== b.id));
  }

  async function saveRename() {
    const res = await renameLabBatch(createClient(), batchId, renaming);
    if (!res.ok) { setMsg({ bad: true, text: res.error }); return; }
    setBatch((b) => ({ ...b, name: res.name }));
    setRenaming(null);
  }

  /** A list from before batches, still in this browser: make it a batch. */
  async function adoptLegacy() {
    const res = await startBatch(legacy, [...new Set(legacy.map((r) => r.file))]);
    if (!res.ok) { setMsg({ bad: true, text: `Couldn't save it as a batch: ${res.error || "migration 047 isn't run"}` }); return; }
    setRows(legacy);
    setLegacy([]);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* it is a batch now */ }
    refreshView();
  }

  const listings = lab?.listings || [];
  const settings = lab?.listingSettings || null;
  const subtypes = settings?.subtypes || [];
  const joinsOf = useCallback((r) => (r.result?.ok ? null : listingForGroup(listings, r)), [listings]);
  const shownIds = useMemo(
    () => sortRows(filterRows(rows, { filter, q, file }, joinsOf), sort, joinsOf).map((r) => r.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, q, file, sort, viewKey, rows.length, joinsOf]
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const shown = useMemo(() => shownIds.map((id) => byId.get(id)).filter(Boolean), [shownIds, byId]);
  const onScreen = tickedOnScreen(ticked, shown);
  const hiddenTicks = ticked.size - onScreen.length;
  const totals = useMemo(() => draftTotals(rows, joinsOf), [rows, joinsOf]);
  const files = useMemo(() => [...new Set(rows.map((r) => r.file))], [rows]);
  const allOnScreen = shown.length > 0 && shown.every((r) => ticked.has(String(r.id)));

  const titleOf = (r) => {
    if (r.titleOverride) return { text: r.titleOverride.slice(0, TITLE_MAX), cut: r.titleOverride.length > TITLE_MAX, own: true };
    const j = joinsOf(r);
    if (j) return { text: j.title, cut: false, joined: true };
    const out = renderListing(settings || {}, { ...r, copies: liveCopies(r) }, { subtype: r.subtype });
    return { text: out.title, cut: out.titleCut };
  };
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /**
   * Your rule for the card on this row: applied at once to every row of the
   * card in this batch (no new search), kept for next time (050), and told to
   * the feedback store as a 👎 with the rule in the comment (046), which is
   * what export-feedback.mjs tallies.
   */
  /**
   * A note on ONE sale — an automated pick you unticked, and why. Kept on the
   * row beside the sale (it stays in the table), told to feedback, and, when
   * asked, turned into this card's rule in the same step.
   */
  async function saveSaleNote(row, sale, input, { alsoRule = false } = {}) {
    const note = input ? normaliseSaleNote(input) : null;
    const id = String(sale.id);
    setRows((rs) => rs.map((r) => {
      if (r.id !== row.id) return r;
      const notes = { ...(r.saleNotes || {}) };
      if (note) notes[id] = note; else delete notes[id];
      return { ...r, saleNotes: notes };
    }));
    if (!note) return;
    recordFeedback(createClient(), ruleFeedbackArgs(row, null, saleComment(note, sale), { query: `${ruleKeyFor(row)}|sale:${id}` }))
      .then((res) => { if (res && !res.ok && !res.missing) setMsg({ bad: true, text: `Note kept on the card, but not sent to feedback: ${res.error}` }); })
      .catch(() => {});
    const kind = ruleKindForReason(note.why);
    if (alsoRule && kind) {
      const cur = cardRules.get(ruleKeyFor(row)) || row.comps?.rule || { kinds: [], words: [], note: "" };
      await saveCardRule(row, { ...cur, kinds: [...new Set([...(cur.kinds || []), kind])], note: cur.note || note.text });
    } else {
      setMsg({ text: `Noted on that sale: ${saleReasonLabel(note.why)}${note.text ? ` — ${note.text}` : ""}.` });
    }
  }

  async function saveCardRule(row, input) {
    const rule = normaliseRule(input);
    const key = ruleKeyFor(row);
    const empty = isEmptyRule(rule);
    setRows((rs) => applyCardRule(rs, key, empty ? null : rule));
    setCardRules((m) => { const n = new Map(m); if (empty) n.delete(key); else n.set(key, rule); MEM.rules = n; return n; });
    const sb = createClient();
    const label = [row.cardName, row.cardNumber, row.set].filter(Boolean).join(" ");
    const kept = await saveRule(sb, null, { key, label, rule });
    if (!empty) recordFeedback(sb, ruleFeedbackArgs(row, rule, ruleComment(rule))).catch(() => {});
    const what = empty ? "rule removed" : `rule: ${describeRule(rule)}`;
    if (kept.ok) setMsg({ text: `${label} — ${what}. ${empty ? "" : "Applied to this batch, and kept for every time this card is priced."}` });
    else if (kept.missing) setMsg({ text: `${label} — ${what}, applied to this batch. Not kept for next time: migration 050 still to run.` });
    else setMsg({ bad: true, text: `${label} — ${what}, applied to this batch, but not kept: ${kept.error}` });
  }
  const tick = (id, on) => setTicked((t) => { const n = new Set(t); if (on) n.add(String(id)); else n.delete(String(id)); return n; });

  // ---- files -------------------------------------------------------------
  /**
   * Read CardUploader exports into the list `base`, each card stamped with the
   * batch's language and which sales count. Returns the new list and what was
   * refused; changes no state.
   */
  async function readFiles(picked, { language, anyLanguage, overseas: os }, base) {
    let next = base;
    const newRefused = [];
    let added = 0;
    let rowsRead = 0;
    for (const f of picked) {
      try {
        const text = await f.text();
        // The batch's language beats whatever the file or a title said.
        const items = CardUploaderCsv.extractItems(text, { allowNoNumber: true }).map((it) => ({ ...it, language }));
        const allRows = CardUploaderCsv.rowsToObjects(CardUploaderCsv.parseCsv(text));
        const skipped = unreadableRows(allRows, { needNumber: false });
        rowsRead += allRows.length - allRows.filter((r) => !Object.values(r || {}).some((v) => String(v ?? "").trim())).length;
        // Same rows extractItems kept (a name; a number is optional here), so the extras line up.
        const raw = allRows.filter((r) => (r["*C:Card Name"] || "").trim());
        const extras = raw.map((r) => ({ finish: (r["*C:Finish"] || "").trim(), setCode: (r["*C:Set Code"] || r["C:Set Code"] || "").trim() }));
        const { groups, refused: rf } = groupsFromItems(items, extras.length === items.length ? extras : []);
        const merged = mergeGroups(next, groups, f.name, { anyLanguage, overseas: os });
        next = merged.rows;
        added += merged.added;
        newRefused.push(...skipped.map((x) => ({ ...x, file: f.name })), ...rf.map((x) => ({ ...x, file: f.name })), ...merged.refused.map((x) => ({ ...x, file: f.name })));
      } catch (err) {
        newRefused.push({ sku: f.name, title: "", why: err.message || "couldn't read that file", file: f.name });
      }
    }
    return { next, newRefused, added, rowsRead };
  }

  const loadedAs = (o) => `${o.language}${o.anyLanguage ? ", sales in every language" : ""}${o.overseas ? ", overseas sellers counted" : ""}`;

  /** More exports into the list on screen — an open batch loads them the way it was set up. */
  async function onFiles(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    const as = store === "ok" && batchId ? batchDefaults(rows) : { language: batchLang, anyLanguage: anyLang, overseas };
    const { next, newRefused, added, rowsRead } = await readFiles(picked, as, rows);
    // No batch open: this upload IS a new batch, saved before it is shown.
    if (store === "ok" && !batchId && next.length) {
      const made = await startBatch(next, picked.map((f) => f.name));
      if (!made.ok) setMsg({ bad: true, text: `Loaded, but couldn't save it as a batch: ${made.error}. It is only in this tab — don't refresh.` });
    }
    setRows(next);
    refreshView();
    setRefused((r) => [...r, ...newRefused]);
    setMsg({ text: `${rowsRead} row${rowsRead === 1 ? "" : "s"} read, ${added} cop${added === 1 ? "y" : "ies"} loaded from ${picked.length} file${picked.length === 1 ? "" : "s"} as ${loadedAs(as)}${newRefused.length ? `, ${newRefused.length} refused (below)` : ""}.` });
  }

  /** New batch → Create: read the files with the setup's settings, make the batch, and queue it if asked. */
  async function createFromSetup({ files: picked, name, language, anyLanguage, overseas: os, subtype, costPence, priceNow }) {
    setBusy("create");
    setMsg(null);
    try {
      const as = { language, anyLanguage, overseas: os };
      const { next: read, newRefused, added } = await readFiles(picked, as, []);
      setRefused(newRefused);
      if (!read.length) { setMsg({ bad: true, text: "Nothing in that file could be loaded — see what was refused below." }); return; }
      let next = read;
      const ids = next.map((r) => r.id);
      if (subtype) next = applyBulk(next, ids, { op: "subtype", value: subtype });
      if (costPence != null) next = applyBulk(next, ids, { op: "costEach", pence: costPence });
      const made = await startBatch(next, picked.map((f) => f.name), name);
      setRows(next);
      refreshView();
      if (!made.ok) {
        setIsNew(false);
        setMsg({ bad: true, text: `Loaded, but couldn't save it as a batch: ${made.error}. It is only in this tab — don't refresh.` });
        return;
      }
      let queued = null;
      if (priceNow) queued = await queueRows(next.filter((r) => !joinsOf(r)).map((r) => r.id), made.batch.id);
      setMsg({ bad: queued && !queued.ok, text: `Batch created: ${added} cop${added === 1 ? "y" : "ies"} as ${loadedAs(as)}${newRefused.length ? `, ${newRefused.length} refused (below)` : ""}.${queued ? (queued.ok ? ` ${queued.job.total} queued for pricing — prices fill in as they arrive.` : ` Couldn't queue it for pricing: ${queued.error}`) : ""}` });
      refreshQueue();
    } finally {
      setBusy(null);
    }
  }

  // ---- pricing -----------------------------------------------------------
  /** Sold comps for the ticked rows on screen, or — nothing ticked — every row not yet priced from comps. */
  /** The rows a press of £ Price would price: ticked on screen, else every row not yet priced. */
  function rowsToPrice() {
    const base = onScreen.length ? onScreen : rows.filter((r) => !r.comps && !r.result?.ok && !r.excluded);
    return base.filter((r) => !joinsOf(r) && !r.result?.ok && !r.result?.pending && !queuedIds.has(String(r.id)));
  }

  /**
   * With batches, pricing is QUEUED: the server's one worker prices every
   * queued batch in turn under SoldComps' limit, and the answers land on the
   * rows here as they come (lib/pricing-queue.js). Without the queue (048 not
   * run), the tab prices as it always has.
   */
  async function priceFromSold() {
    if (store !== "ok" || !batchId || queue.missing) return priceInTab();
    const todo = rowsToPrice();
    if (!todo.length) { setMsg({ text: "Nothing to price — every row has sold comps, is queued, joins a live listing or is listed." }); return; }
    if (saveState !== "saved") await flushBatch(); // the server prices the rows as saved
    const res = await queueRows(todo.map((r) => r.id));
    if (res.missing) { setQueue((q) => ({ ...q, missing: true })); return priceInTab(); }
    if (!res.ok) { setMsg({ bad: true, text: `Couldn't queue it: ${res.error}` }); return; }
    setMsg({ text: `Queued ${res.job.total} card${res.job.total === 1 ? "" : "s"} for pricing. Prices fill in here as they arrive — you can close this tab, queue more batches, or come back later.` });
    refreshQueue();
  }

  /** Put rows of a batch in the pricing queue. */
  function queueRows(rowIds, id = batchId) {
    return fetch("/api/pricing-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "enqueue", batchId: id, rowIds }) })
      .then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
  }

  /** The step bar's buttons: show a slice of the table, and bring it into view. */
  function showOnly(f) {
    setFilter(f === "needsprice" || f === "thin" || f === "failed" || f === "listed" ? f : "all");
    setQ("");
    refreshView();
    try { tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* old browser */ }
  }

  async function priceInTab() {
    const base = onScreen.length ? onScreen : rows.filter((r) => !r.comps && !r.result?.ok && !r.excluded);
    const todo = base.filter((r) => !joinsOf(r) && !r.result?.ok && !r.result?.pending);
    if (!todo.length) { setMsg({ text: "Nothing to price — every row has sold comps, joins a live listing or is listed." }); return; }
    // Two batches pricing at once in two tabs run past SoldComps' 60 a minute
    // between them, and lookups start failing. The other tab's bar is in
    // PRICING_KEY; this tab isn't pricing, so a fresh one is someone else's.
    try {
      const other = JSON.parse(localStorage.getItem(PRICING_KEY) || "null");
      if (other && Date.now() - (other.updatedAt || 0) < 60000 && other.done < other.total
        && !window.confirm(`Another tab is pricing right now (${other.done} of ${other.total}). Running both at once goes past SoldComps' limit and lookups fail. Price this batch anyway?`)) return;
    } catch { /* can't tell: go ahead */ }
    setBusy("price");
    setMsg(null);
    stopRef.current = false;
    // A few cards a request: each is up to seven searches paced at SoldComps'
    // 60 a minute, and a small request is what lets the bar move and the rows
    // fill in as the run goes rather than all at the end.
    const PER_REQUEST = 3;
    const startedAt = Date.now();
    const tally = { done: 0, priced: 0, noPrice: 0, failed: 0, searches: 0, cacheHits: 0 };
    const show = (current) => {
      setProgress({ ...tally, total: todo.length, startedAt, current });
      // The lab's overview reads this, in this tab or another.
      try { localStorage.setItem(PRICING_KEY, JSON.stringify({ done: tally.done, total: todo.length, startedAt, updatedAt: Date.now() })); } catch { /* blocked: the bar here still works */ }
    };
    for (let i = 0; i < todo.length; i += PER_REQUEST) {
      if (stopRef.current) break;
      const chunk = todo.slice(i, i + PER_REQUEST);
      setPricingIds(new Set(chunk.map((r) => r.id)));
      show(chunk.map((r) => r.title));
      const cards = chunk.map(labCardFor);
      const got = new Map();
      try {
        const res = await fetch("/api/batch-comps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards, depth: 3 }) });
        const j = await res.json();
        if (!res.ok || !j.results) throw new Error(j.error || `Pricing answered ${res.status}.`);
        tally.searches += j.summary?.soldcomps_requests || 0;
        tally.cacheHits += j.summary?.cache_hits || 0;
        const bySku = new Map(j.results.map((x) => [String(x.sku), x]));
        for (const r of chunk) {
          const x = bySku.get(String(r.copies[0].sku));
          got.set(r.id, compsFromResult(x, r));
        }
      } catch (e) {
        for (const r of chunk) got.set(r.id, { pence: null, error: e.message });
      }
      for (const c of got.values()) {
        tally.done += 1;
        if (c.error) tally.failed += 1; else if (c.pence != null) tally.priced += 1; else tally.noPrice += 1;
      }
      // Each request's rows fill in as soon as it answers. A price already
      // typed is never overwritten; new sales drop any old picks.
      setRows((rs) => applyComps(rs, got));
      show([]);
    }
    const stopped = stopRef.current && tally.done < todo.length;
    setPricingIds(new Set());
    setProgress(null);
    try { localStorage.removeItem(PRICING_KEY); } catch { /* nothing to clear */ }
    setBusy(null);
    refreshView();
    const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    setMsg({ bad: tally.failed > 0, text: `${stopped ? `Stopped after ${tally.done} of ${todo.length}. ` : ""}Priced ${tally.priced}, ${tally.noPrice} with no sales to price from${tally.failed ? `, ${tally.failed} failed (marked error — price them again)` : ""}. ${tally.searches} searches, ${tally.cacheHits} from the cache, about ${mins} min. Typed prices were kept.` });
  }

  // ---- bulk edits ----------------------------------------------------------
  function bulk(action, label) {
    if (!onScreen.length) return;
    setRows((rs) => applyBulk(rs, onScreen.map((r) => r.id), action));
    refreshView();
    setMsg({ text: `${label} — ${onScreen.length} row${onScreen.length === 1 ? "" : "s"}.` });
    setPanel(null);
  }

  // ---- listing -----------------------------------------------------------
  async function listRows(candidates) {
    if (!labFresh) { setMsg({ text: "Checking your live listings on eBay first — try again in a moment." }); return; }
    const go = candidates.filter((r) => LISTABLE.has(rowStatus(r, joinsOf(r))));
    const skipped = candidates.length - go.length;
    if (!go.length) { setMsg({ bad: true, text: "Nothing ticked is ready to list — give it a price, or put it back in." }); return; }
    const joins = go.filter((r) => joinsOf(r));
    const fresh = go.filter((r) => !joinsOf(r));
    const copies = go.reduce((t, r) => t + liveCopies(r).length, 0);
    const value = fresh.reduce((t, r) => t + r.pricePence * liveCopies(r).length, 0);
    const checkFirst = fresh.filter((r) => isThin(r)).length;
    if (!window.confirm(
      `List ${go.length} card${go.length === 1 ? "" : "s"} on eBay — LIVE.\n\n` +
      `${fresh.length} new listing${fresh.length === 1 ? "" : "s"}, ${gbp(value)} in all\n` +
      `${joins.length} joining a listing already live (its price stays)\n${copies} copies` +
      (checkFirst ? `\n\n⚠ ${checkFirst} of the new listings ${checkFirst === 1 ? "is" : "are"} marked Check first (a Terapeak check, a thin or wide price, or a failed lookup).` : "") +
      (skipped ? `\n\n${skipped} ticked row${skipped === 1 ? " isn't" : "s aren't"} ready and will be left alone.` : "") + "\n\nGo?"
    )) return;
    // Handed to the server in jobs of a dozen, sent together: each job lists
    // its cards on the server and carries on if this page is closed. The rows
    // say "Listing on eBay…" until the lab's log says how each one went.
    setBusy("list");
    setMsg(null);
    const job = `j${Date.now().toString(36)}`;
    const PER_JOB = 12;
    const chunks = [];
    for (let i = 0; i < go.length; i += PER_JOB) chunks.push(go.slice(i, i + PER_JOB));
    const answers = await Promise.all(chunks.map((chunk, n) => api({
      action: "createMany", job: `${job}-${n}`,
      items: chunk.map((r) => ({
        rowId: r.id, group: groupToSend(r), pricePence: r.pricePence, subtype: r.subtype || "",
        marketPence: r.comps?.pence ?? null, titleOverride: r.titleOverride || ""
      }))
    })));
    const sentAt = Date.now();
    const jobOf = new Map();
    const refusedOf = new Map();
    chunks.forEach((chunk, n) => chunk.forEach((r) => (answers[n]?.ok ? jobOf.set(r.id, `${job}-${n}`) : refusedOf.set(r.id, answers[n]?.error || "The server didn't take the job."))));
    setRows((rs) => rs.map((r) => (jobOf.has(r.id) ? { ...r, result: { pending: true, job: jobOf.get(r.id), sentAt } }
      : refusedOf.has(r.id) ? { ...r, result: { ok: false, error: refusedOf.get(r.id) } } : r)));
    setBusy(null);
    setTicked(new Set());
    refreshView();
    setMsg(refusedOf.size
      ? { bad: true, text: `${jobOf.size} sent to list, ${refusedOf.size} not taken — marked Failed to retry.` }
      : { text: `${jobOf.size} card${jobOf.size === 1 ? "" : "s"} sent to list on eBay. They list on the server — you can leave this page; the rows update here as they go, or whenever you come back.` });
  }

  // ---- Cardmarket's price guide, for reference -------------------------
  // Read from what the nightly job stored (no request to Cardmarket), kept
  // on the row for a day, shown beside the sold comps — never priced from.
  const CM_TTL_MS = 24 * 60 * 60 * 1000;
  const [cmRate, setCmRate] = useState(null);
  const cmBusy = useRef(false);
  useEffect(() => {
    if (!loaded || cmBusy.current) return;
    const due = rows.filter((r) => r.set && !r.result?.ok && (!r.cm || Date.now() - (r.cm.fetchedAt || 0) > CM_TTL_MS)).slice(0, 400);
    if (!due.length) return;
    cmBusy.current = true;
    (async () => {
      try {
        const res = await fetch("/api/cardmarket/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          cards: due.map((r) => ({ id: r.id, name: r.cardName, number: r.cardNumber, set: r.set, finish: r.card?.finish || "", title: r.title }))
        }) });
        const j = await res.json();
        if (j.ok) {
          setCmRate({ rate: j.rate, asOf: j.rateAsOf, fallback: j.rateFallback });
          const at = Date.now();
          setRows((rs) => rs.map((r) => (j.results?.[r.id] ? { ...r, cm: { ...j.results[r.id], fetchedAt: at } } : r)));
        }
      } catch { /* reference only: a failed read leaves the rows as they were */ }
      cmBusy.current = false;
    })();
  }, [loaded, rows]);

  // Rows sent to a background job are settled from the lab's log: on every
  // load, and every few seconds while any are still out.
  const sending = rows.some((r) => r.result?.pending);
  useEffect(() => {
    if (lab?.ok) setRows((rs) => settleSent(rs, lab));
  }, [lab]);
  useEffect(() => {
    if (!sending) return undefined;
    const t = setInterval(() => { reloadLab(); }, 6000);
    return () => clearInterval(t);
  }, [sending, reloadLab]);

  // The grid and New batch need nothing from /api/lab, so nothing waits on it;
  // a batch draws at once and fills in what joins a live listing when it lands.
  if (lab && !lab.ok) {
    return <main className="li-wrap"><style>{LAB_TABLE_CSS}</style>{lab.needsMove || lab.foldPending ? <>{lab.error} <a href="/panel/lab">Open the lab</a></> : `Couldn't load the lab: ${lab.error}`}</main>;
  }

  const s = totals.byStatus;

  const css = LAB_TABLE_CSS + EXTRA_CSS + LAB_HEADER_CSS + BATCH_HOME_CSS + NEW_BATCH_CSS + BATCH_STEPS_CSS;
  const legacyBanner = legacy.length > 0 ? (
    <div className="li-panel lb-row li-warn">
      This browser still has a list from before batches ({legacy.length} card{legacy.length === 1 ? "" : "s"}).
      <button className="li-btn primary" onClick={adoptLegacy}>Save it as a batch</button>
      <button className="li-btn" onClick={() => { if (window.confirm("Discard that old list? Typed prices go with it.")) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* gone */ } setLegacy([]); } }}>Discard</button>
    </div>
  ) : null;
  const queueLog = store === "ok" && !queue.missing && queue.jobs.length > 0 ? <QueueLog queue={queue} batchId={batchId} onCancel={cancelQueued} /> : null;

  if (store === "loading") return <main className="li-wrap"><style>{css}</style><LabHeader current="batches" />Loading your batches…</main>;

  // ---- the batch grid --------------------------------------------------------
  if (store === "ok" && !batchId && !isNew) {
    const pricingIds = new Set(queue.jobs.filter(isOpen).map((j) => j.batch_id).filter(Boolean));
    return (
      <main className="li-wrap">
        <style>{css}</style>
        <LabHeader current="batches" />
        {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}
        {queueLog}
        <BatchHome
          batches={batches}
          tiles={batchTiles}
          pricingIds={pricingIds}
          legacy={legacyBanner}
          onDelete={removeBatch}
          onRename={async (b) => {
            const name = window.prompt("Rename the batch", b.name);
            if (name == null || !name.trim() || name.trim() === b.name) return;
            const res = await renameLabBatch(createClient(), b.id, name);
            if (!res.ok) { setMsg({ bad: true, text: res.error }); return; }
            setBatches((bs) => bs.map((x) => (x.id === b.id ? { ...x, name: res.name } : x)));
          }}
        />
      </main>
    );
  }

  // ---- New batch: the setup, before a file is read ----------------------------
  if (store === "ok" && isNew) {
    return (
      <main className="li-wrap">
        <style>{css}</style>
        <LabHeader current="batches" />
        {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}
        <NewBatch subtypes={subtypes} busy={busy === "create"} queueAvailable={!queue.missing} onCreate={createFromSetup} />
      </main>
    );
  }

  const defaults = batchId ? batchDefaults(rows) : null;
  const progressNow = batchProgress(rows, joinsOf, queuedIds);

  return (
    <main className="li-wrap">
      <style>{css}</style>
      <LabHeader current="batches" />

      {/* ---------------- The open batch ---------------- */}
      {store === "missing" ? (
        <div className="li-panel li-dim">One list per browser until migration 047 is run — then each upload is its own batch, kept on the server, and tabs stop overwriting each other.</div>
      ) : store === "error" ? (
        <div className="li-panel li-warn">Couldn&apos;t reach your batches ({saveErr}). Working on this browser&apos;s list for now — one tab only.</div>
      ) : batchId ? (
        <div className="lb-head">
          <a className="nb-back" href="/panel/lab/add">← Batches</a>
          <div className="lb-titlerow">
            {renaming != null ? (
              <>
                <input className="li-search" value={renaming} autoFocus onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(null); }} />
                <button className="li-btn" onClick={saveRename}>Save</button>
                <button className="li-btn" onClick={() => setRenaming(null)}>Cancel</button>
              </>
            ) : (
              <>
                <h1>{batch.name}</h1>
                <button className="li-icon" title="Rename" onClick={() => setRenaming(batch.name)}>✎</button>
              </>
            )}
            <span className={`lb-save lb-${saveState}`}>
              {saveState === "saved" ? "✓ saved" : saveState === "pending" || saveState === "saving" ? "saving…" : saveState === "error" ? `not saved: ${saveErr} — it is still on this device` : ""}
            </span>
          </div>
          <div className="lb-chips">
            <span className="lb-chip">{batchKind({ language: defaults.language, game: rows.find((r) => r.card?.game)?.card?.game })}</span>
            <span className="lb-chip">{defaults.anyLanguage ? "sales in every language" : `${defaults.language} sales only`}</span>
            <span className="lb-chip">{defaults.overseas ? "overseas sellers counted" : "UK sellers"}</span>
            <span className="lb-chip">New listings <b>{gbp(totals.value)}</b></span>
            {!labFresh ? <span className="lb-chip">checking live listings…</span> : null}
          </div>
        </div>
      ) : (
        <div className="li-head">
          <div className="li-title">
            <h1>Add copies</h1>
            <span className="li-totals">
              {totals.rows} card{totals.rows === 1 ? "" : "s"} · {totals.copies} cop{totals.copies === 1 ? "y" : "ies"}
              <span>New listings <b>{gbp(totals.value)}</b></span>
            </span>
          </div>
        </div>
      )}
      {saveState === "conflict" ? (
        <div className="li-panel lb-conflict">
          <b>This batch was saved from another tab or device since you opened it.</b> Nothing here has been saved over it.
          <button className="li-btn primary" onClick={takeTheirs}>↻ Load the latest (lose changes made here)</button>
          <button className="li-btn" onClick={keepMine}>Keep this tab&apos;s version (overwrite the other)</button>
        </div>
      ) : null}

      {batchId ? (
        <BatchSteps
          progress={progressNow}
          busy={!!busy}
          onPrice={priceFromSold}
          onFilter={showOnly}
          onListReady={() => listRows(rows.filter((r) => progressNow.readyIds.includes(r.id)))}
        />
      ) : null}

      {/* ---------------- Load ---------------- */}
      {batchId ? (
        <div className="li-panel lb-more">
          <label className="li-btn" style={{ cursor: "pointer" }}>
            ＋ Add more exports
            <input type="file" accept=".csv,text/csv" multiple style={{ display: "none" }} onChange={onFiles} disabled={!!busy} />
          </label>
          <span className="li-dim">Loaded as {defaults.language}{defaults.anyLanguage ? ", sales in every language" : ""}{defaults.overseas ? ", overseas sellers" : ""}, like the rest of this batch.</span>
          <span className="li-spacer" />
          {rows.some((r) => r.result?.ok) && <button className="li-btn" disabled={!!busy} onClick={() => setRows((rs) => rs.filter((r) => !r.result?.ok))}>Clear listed rows</button>}
          <button className="li-btn" disabled={!!busy} onClick={() => removeBatch({ id: batchId, name: batch.name, card_count: rows.length })}>Delete batch</button>
        </div>
      ) : (
      <div className="li-panel">
        <label className="li-dim" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Batch language
          <select className="li-select" value={batchLang} disabled={!!busy} onChange={(e) => setBatchLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="li-check li-dim" title="Count sold listings of this card in any language (CardCropper's All languages). Graded, other printings and lots stay out.">
          <input type="checkbox" checked={anyLang} disabled={!!busy} onChange={(e) => setAnyLang(e.target.checked)} /> count sales in every language
        </label>
        <label className="li-check li-dim" title="Count sales from sellers outside the UK. Postage is capped at £4 in the price either way. Mostly worth it for Japanese cards with little UK supply.">
          <input type="checkbox" checked={overseas} disabled={!!busy} onChange={(e) => setOverseas(e.target.checked)} /> count overseas sellers
        </label>
        <label className="li-btn primary" style={{ cursor: "pointer" }}>
          {`＋ Load ${batchLang} export(s)`}
          <input type="file" accept=".csv,text/csv" multiple style={{ display: "none" }} onChange={onFiles} disabled={!!busy} />
        </label>
        <span className="li-dim">
          Several files at once is fine. Automatic eBay Inventory must be OFF in CardUploader so the export carries your SKUs. Nothing is listed until you press List.
        </span>
        <span className="li-spacer" />
        {rows.some((r) => r.result?.ok) && <button className="li-btn" disabled={!!busy} onClick={() => setRows((rs) => rs.filter((r) => !r.result?.ok))}>Clear listed rows</button>}
        {rows.length > 0 && <button className="li-btn" disabled={!!busy} onClick={() => {
          if (window.confirm(`Clear the whole list (${rows.length} rows)? Typed prices go with it. Nothing on eBay changes.`)) { setRows([]); setRefused([]); setTicked(new Set()); }
        }}>Clear list</button>}
      </div>
      )}

      {refused.length > 0 && (
        <details className="li-panel" open={refused.length <= 8}>
          <summary className="li-warn">{refused.length} cop{refused.length === 1 ? "y" : "ies"} refused — not in the list</summary>
          <div className="li-plan">
            {refused.map((r, i) => <div key={i}>✗ <b>{r.sku}</b> {r.title ? `· ${r.title}` : ""} — {r.why} <span className="li-dim">({r.file})</span></div>)}
          </div>
          <button className="li-btn" onClick={() => setRefused([])}>Dismiss</button>
        </details>
      )}

      {/* ---------------- Toolbar ---------------- */}
      <div className="li-toolbar" ref={tableRef}>
        <input className="li-search" placeholder="Search name, set, SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="li-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{k !== "all" && k !== "joins" && s[k] ? ` (${s[k]})` : ""}</option>)}
        </select>
        {files.length > 1 && (
          <select className="li-select" value={file} onChange={(e) => setFile(e.target.value)}>
            <option value="">All files</option>
            {files.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <span className="li-spacer" />
        <select className="li-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {queueLog}
      {msg && <div className={msg.bad ? "li-msg bad" : "li-msg"}>{msg.text}</div>}
      {progress && <PricingBar p={progress} onStop={() => { stopRef.current = true; setProgress((x) => (x ? { ...x, stopping: true } : x)); }} />}
      {rows.some((r) => r.result?.pending) && (
        <div className="li-msg">⏳ {rows.filter((r) => r.result?.pending).length} card{rows.filter((r) => r.result?.pending).length === 1 ? "" : "s"} still listing on eBay — on the server, so you can leave this page. Rows update every few seconds.</div>
      )}

      <div className="li-card">
        {/* ---------------- Bulk bar ---------------- */}
        <div className="li-bulk">
          <button className="li-chip" disabled={!!busy || !rows.length} onClick={priceFromSold} title="Ticked rows on screen; with nothing ticked, every row not yet priced from sold comps">
            {busy === "price" ? "Pricing…" : store === "ok" && batchId && !queue.missing ? "£ Queue for pricing" : "£ Price from sold comps"}
          </button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "price" ? null : "price")}>Set price ▾</button>
          {subtypes.length > 0 && <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "subtype" ? null : "subtype")}>Subtype ▾</button>}
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "language" ? null : "language")}>Language &amp; sellers ▾</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => setPanel(panel === "cost" ? null : "cost")}>Cost ▾</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => bulk({ op: "check" }, "Marked checked")} title="The ticked rows' prices have been reviewed">✓ Mark checked</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => bulk({ op: "exclude" }, "Left out")}>Leave out</button>
          <button className="li-chip" disabled={!onScreen.length || !!busy} onClick={() => bulk({ op: "include" }, "Put back")}>Put back</button>
          <button className="li-chip primary-chip" disabled={!onScreen.length || !!busy} onClick={() => listRows(onScreen)}>
            {busy === "list" ? "Sending…" : `List ticked (${onScreen.length})`}
          </button>
          <span className="li-dim">{onScreen.length ? `${onScreen.length} ticked` : "Tick rows to edit or list them"}</span>
          {hiddenTicks > 0 && <span className="li-warn">{hiddenTicks} ticked off screen — not acted on <button className="li-link" onClick={() => setTicked(new Set())}>untick</button></span>}
          {busy === "price" && <span className="li-dim">Pricing — see the bar above</span>}
          <span className="li-spacer" />
          <button className="li-chip" onClick={refreshView} title="Apply your edits to the filter and sort. Rows don't move while you type.">↻ Re-sort</button>
          <span className="li-dim">{shown.length} of {rows.length} shown</span>
        </div>

        {panel === "price" && (
          <div className="li-panel inset">
            <span>Set price on {onScreen.length}:</span>
            <input className="li-num" inputMode="decimal" placeholder="£" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            <button className="li-btn" disabled={parsePrice(priceText) == null} onClick={() => bulk({ op: "price", pence: parsePrice(priceText) }, `Price set to ${gbp(parsePrice(priceText))}`)}>Set</button>
            <span className="li-dim">or</span>
            <button className="li-btn" onClick={() => bulk({ op: "comps" }, "Sold-comps price used")}>Use sold comps</button>
            <span className="li-dim">or sold comps</span>
            <input className="li-num" inputMode="numeric" value={pctText} onChange={(e) => setPctText(e.target.value)} style={{ width: 60 }} />
            <span>%</span>
            <button className="li-btn" disabled={!Number.isFinite(Number(pctText))} onClick={() => bulk({ op: "compsPct", pct: Number(pctText) }, `Sold comps ${Number(pctText) >= 0 ? "+" : ""}${Number(pctText)}%, laddered`)}>Apply</button>
            <span className="li-dim">or</span>
            <button className="li-btn" onClick={() => bulk({ op: "ladder" }, "Rounded up onto .49/.99")}>Round up to .49/.99</button>
            <button className="li-btn" onClick={() => bulk({ op: "clear" }, "Prices cleared")}>Clear prices</button>
            <span className="li-dim" style={{ flexBasis: "100%" }}>
              A row with no sold-comps price is left as it is by the sold-comps options. Rows joining a live listing keep that listing&apos;s price whatever is set here.
            </span>
          </div>
        )}
        {panel === "cost" && (() => {
          const pence = parseCostPence(costText);
          const copies = onScreen.reduce((t, r) => t + liveCopies(r).length, 0);
          return (
            <div className="li-panel inset">
              <span>What {onScreen.length} card{onScreen.length === 1 ? "" : "s"} ({copies} cop{copies === 1 ? "y" : "ies"}) cost you:</span>
              <input className="li-num" inputMode="decimal" placeholder="£" value={costText} onChange={(e) => setCostText(e.target.value)} />
              <button className="li-btn" disabled={pence == null} onClick={() => bulk({ op: "costEach", pence }, `Cost set to ${gbp(pence)} a copy`)}>Each copy</button>
              <button className="li-btn" disabled={pence == null} onClick={() => bulk({ op: "costLot", pence }, `${gbp(pence)} for the lot, split by price`)}>For the lot, split by price</button>
              <button className="li-btn" onClick={() => bulk({ op: "costClear" }, "Costs cleared")}>Clear</button>
              <span className="li-dim" style={{ flexBasis: "100%" }}>
                Saved on each card when it lists, so a sale can say what it made. A lot is shared by what each card is priced at (the dearer card carries more of it) — price first, then split.
                No cost is &ldquo;not known&rdquo;, never free. Cards already listed take a cost in the Inventory.
              </span>
            </div>
          );
        })()}
        {panel === "language" && (
          <div className="li-panel inset">
            <span>Language for {onScreen.length}:</span>
            <select className="li-select" value={langPick} onChange={(e) => setLangPick(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="li-check"><input type="checkbox" checked={anyPick} onChange={(e) => setAnyPick(e.target.checked)} /> count sales in every language</label>
            <label className="li-check"><input type="checkbox" checked={overseasPick} onChange={(e) => setOverseasPick(e.target.checked)} /> count overseas sellers</label>
            <button className="li-btn" onClick={() => bulk({ op: "language", language: langPick, anyLanguage: anyPick, overseas: overseasPick }, `Language set to ${langPick}${anyPick ? ", every language counted" : ""}${overseasPick ? ", overseas sellers counted" : ""}`)}>Set</button>
            <span className="li-dim" style={{ flexBasis: "100%" }}>
              Changing it drops those rows&apos; sold comps (they were for the other language) and any price that only came from them. Price them again after.
            </span>
          </div>
        )}
        {panel === "subtype" && (
          <div className="li-panel inset">
            <span>Subtype for {onScreen.length}:</span>
            <select className="li-select" value={subtypePick} onChange={(e) => setSubtypePick(e.target.value)}>
              <option value="">— none —</option>
              {subtypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="li-btn" onClick={() => bulk({ op: "subtype", value: subtypePick }, subtypePick ? `Subtype set to ${subtypePick}` : "Subtype cleared")}>Set</button>
          </div>
        )}

        {/* ---------------- The table ---------------- */}
        <div className="la-fit">
          <table className="li-table la-table">
            <thead>
              <tr>
                <th className="li-cb"><input type="checkbox" checked={allOnScreen} aria-label="Tick everything shown" onChange={(e) => setTicked((t) => { const n = new Set(t); for (const r of shown) { if (e.target.checked) n.add(String(r.id)); else n.delete(String(r.id)); } return n; })} /></th>
                <th className="la-c-card">Card</th>
                <th className="sm-hide la-c-status">Status</th>
                <th className="sm-hide la-c-copies">Copies</th>
                <th className="sm-hide la-c-cond">Condition</th>
                <th className="r sm-hide la-c-comps">Sold comps</th>
                <th className="r la-c-price">Your price</th>
                <th className="sm-hide md-hide la-c-file">File</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={8} className="li-empty">{rows.length ? "Nothing matches." : "Load a CardUploader export to start."}</td></tr>
              )}
              {shown.map((r) => {
                const j = joinsOf(r);
                const st = rowStatus(r, j);
                const t = titleOf(r);
                const live = liveCopies(r);
                // The sold comps as shown: your picks in "see sales" where you made them.
                const cs = compsShown(r);
                const isOpen = open.has(r.id);
                const done = st === "listed";
                return (
                  <Fragment key={r.id}>
                    <tr className={st === "excluded" || done ? "ended" : ""}>
                      <td className="li-cb"><input type="checkbox" checked={ticked.has(String(r.id))} aria-label={`Tick ${r.title}`} onChange={(e) => tick(r.id, e.target.checked)} /></td>
                      <td>
                        <div className="li-cardcell">
                          <button className="li-icon" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-label={isOpen ? "Fold" : "Open"}>{isOpen ? "▾" : "▸"}</button>
                          <span className="li-thumb">{live[0]?.scans?.[0] || r.copies[0]?.scans?.[0] ? <img src={live[0]?.scans?.[0] || r.copies[0].scans[0]} alt="" referrerPolicy="no-referrer" /> : null}</span>
                          <span>
                            <b>{t.text}</b>
                            <small>
                              {[r.set, r.cardNumber, r.subtype, r.language && r.language !== "English" ? r.language : "", r.anyLanguage ? "every language" : "", r.overseas ? "overseas sellers" : ""].filter(Boolean).join(" · ")}
                              {t.own ? " · your title" : ""}{t.cut ? <span className="li-warn"> · cut at 80</span> : null}
                              {r.costPence != null ? ` · cost ${gbp(r.costPence)}${live.length > 1 ? " each" : ""}` : ""}
                            </small>
                            <small className="sm-only">
                              <span className={`li-status ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span> ×{live.length} · {r.condition}
                              {cs.pence != null ? ` · comps ${gbp(cs.pence)}${cs.picked ? " (your picks)" : ""}` : ""}{r.comps?.decision && r.comps.decision !== "apply" ? ` · ${DECISION_TEXT[r.comps.decision]}` : ""}{j && !done ? " · joins a listing" : ""}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="sm-hide">
                        <span className={`li-status ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span>
                        {st === "thin" && <button className="li-link" disabled={!!busy} onClick={() => setRow(r.id, { checkedAt: new Date().toISOString() })} title="You've looked at the sales behind this price and are happy with it">✓ Mark checked</button>}
                        {st === "checked" && <small className="li-dim">checked {new Date(r.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · <button className="li-link" disabled={!!busy} onClick={() => setRow(r.id, { checkedAt: null })}>undo</button></small>}
                        {j && !done && <small style={{ color: "var(--accent)" }}>joins eBay {j.ebay_item_id}</small>}
                        {done && r.result.itemId && <small><a href={`https://www.ebay.co.uk/itm/${r.result.itemId}`} target="_blank" rel="noreferrer">{r.result.joined ? "added to" : "eBay"} {r.result.itemId}</a></small>}
                        {st === "failed" && <small style={{ color: "var(--bad)", whiteSpace: "normal", maxWidth: 260 }}>{r.result.error}</small>}
                      </td>
                      <td className="mono sm-hide">{live.length}{live.length !== r.copies.length ? <small>of {r.copies.length}</small> : null}</td>
                      <td className="sm-hide"><b>{r.condition}</b></td>
                      <td className="r sm-hide" title={r.comps?.error || (r.comps ? `${r.comps.n ?? "?"} sales counted${r.comps.searches ? ` of ${r.comps.fetched ?? "?"} found across ${r.comps.searches} searches` : ""} · ${r.comps.confidence || "?"} confidence${r.comps.decision ? ` · ${DECISION_TEXT[r.comps.decision] || r.comps.decision}${r.comps.reason ? ` (${r.comps.reason})` : ""}` : ""}${r.comps.flags?.length ? ` · ${r.comps.flags.join(", ").replace(/_/g, " ")}` : ""}` : "Not priced from sold comps yet")}>
                        {pricingIds.has(r.id) ? <span className="la-now">⏳ pricing now…</span> : queuedIds.has(String(r.id)) ? <span className="la-now">⏳ queued</span> : r.comps?.error ? <span style={{ color: "var(--bad)" }}>error</span> : gbp(cs.pence)}
                        {cs.picked && <small style={{ color: "var(--accent)" }}>your picks · counted {gbp(cs.counted)}</small>}
                        {r.comps && !r.comps.error && <small className={isThin(r) && st !== "checked" ? "li-warn" : ""}>{cs.n ?? "?"} sale{cs.n === 1 ? "" : "s"}{r.comps.decision ? ` · ${DECISION_TEXT[r.comps.decision] || r.comps.decision}` : ` · ${r.comps.confidence || "?"}`}</small>}
                        {r.comps?.decision && r.comps.decision !== "apply" && r.comps.reason && <small className="li-warn" style={{ whiteSpace: "normal", maxWidth: 200 }}>{r.comps.reason}</small>}
                        {r.comps?.flags?.includes("in_hand_check") && <small className="li-warn">check in hand</small>}
                        {r.comps?.evidence && <small className="li-dim" style={{ whiteSpace: "normal", maxWidth: 220 }}>{evidenceSummary(r.comps.evidence)}</small>}
                        <CmLine cm={r.cm} rate={cmRate} />
                        {r.comps?.evidence?.length > 0 && (
                          <button className="li-link" onClick={() => setOpen((o) => new Set(o).add(r.id))}>
                            {picksDiffer(r.comps.evidence, r.picks) ? "🔍 your picks" : "🔍 see sales"}
                          </button>
                        )}
                        {r.comps && !r.comps.error && r.language && r.language !== "English" && !r.comps.setCode && <small className="li-dim">no set code</small>}
                      </td>
                      <td className="r">
                        {j ? <span className="li-dim">{gbp(j.price_pence)}<small>listing&apos;s price</small></span> : (
                          <PriceBox value={r.pricePence} disabled={done || !!busy} onSet={(p) => setRow(r.id, { pricePence: p })} />
                        )}
                      </td>
                      <td className="li-dim sm-hide md-hide la-file">{r.file}</td>
                    </tr>
                    {isOpen && (
                      <tr className="li-sub">
                        <td />
                        <td colSpan={7}>
                          <div className="la-open">
                            <div className="la-fields">
                              <label>Title for this card <span className="li-dim">(blank = your template)</span>
                                <input value={r.titleOverride} disabled={done} maxLength={120} placeholder={t.own ? "" : titleOf({ ...r, titleOverride: "" }).text}
                                  onChange={(e) => setRow(r.id, { titleOverride: e.target.value })} />
                                <span className={(r.titleOverride || "").length > TITLE_MAX ? "li-warn" : "li-dim"}>{(r.titleOverride || "").length || t.text.length} / {TITLE_MAX}</span>
                              </label>
                              {subtypes.length > 0 && (
                                <label>Subtype
                                  <select value={r.subtype} disabled={done} onChange={(e) => setRow(r.id, { subtype: e.target.value })}>
                                    <option value="">—</option>
                                    {subtypes.map((x) => <option key={x} value={x}>{x}</option>)}
                                  </select>
                                </label>
                              )}
                              <label className="li-check"><input type="checkbox" checked={!r.excluded} disabled={done} onChange={(e) => setRow(r.id, { excluded: !e.target.checked })} /> List this card</label>
                            </div>
                            {r.comps?.evidence?.length > 0 && (
                              <SalesFound row={r} disabled={done || !!busy} status={st}
                                rule={cardRules.get(ruleKeyFor(r)) || r.comps?.rule || null}
                                onRule={(rule) => saveCardRule(r, rule)}
                                onNote={(sale, note, opts) => saveSaleNote(r, sale, note, opts)}
                                onCheck={(on) => setRow(r.id, { checkedAt: on ? new Date().toISOString() : null })}
                                onPicks={(picks) => setRow(r.id, { picks })}
                                onUse={(pence) => { setRow(r.id, { pricePence: pence }); setMsg({ text: `${r.title}: price set to ${gbp(pence)} from the sales you picked.` }); }} />
                            )}
                            <div className="la-copies">
                              {r.copies.map((c, i) => {
                                const skip = (r.skippedSkus || []).map((x) => x.toLowerCase()).includes(String(c.sku).toLowerCase());
                                return (
                                  <label key={c.sku} className={`la-copy ${skip ? "off" : ""}`}>
                                    <a href={c.scans?.[0] || "#"} target="_blank" rel="noreferrer"><img src={c.scans?.[0]} alt="" referrerPolicy="no-referrer" /></a>
                                    <span className="mono">{c.sku}</span>
                                    <span className="li-dim">{i === 0 && !skip ? "photo on the listing" : skip ? "left out" : "queued"}</span>
                                    <span className="li-check"><input type="checkbox" checked={!skip} disabled={done} onChange={(e) => {
                                      const set = new Set((r.skippedSkus || []).map((x) => x.toLowerCase()));
                                      if (e.target.checked) set.delete(String(c.sku).toLowerCase()); else set.add(String(c.sku).toLowerCase());
                                      setRow(r.id, { skippedSkus: [...set] });
                                    }} /> list</span>
                                  </label>
                                );
                              })}
                            </div>
                            {!done && <button className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy || !LISTABLE.has(st)} onClick={() => listRows([r])}>List this card</button>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

/**
 * Cardmarket's figure for a row, in pounds: the trend (the reverse holo's for
 * a reverse), an arrow for where the 7-day average sits against the 30-day,
 * and the euros and the rate behind it on hover. A card with no Cardmarket
 * product it can be pinned to says so on hover rather than borrowing another's.
 */
function CmLine({ cm, rate }) {
  if (!cm) return null;
  if (cm.pence == null) return <small className="li-dim" title={cm.why || "No Cardmarket figure"}>Cardmarket —</small>;
  const arrow = cm.dir === "up" ? "↑" : cm.dir === "down" ? "↓" : "";
  const tip = [
    `Cardmarket ${cm.reverse ? "reverse holo " : ""}trend €${cm.eurTrend != null ? cm.eurTrend.toFixed(2) : "?"}`,
    cm.avg7Pence != null ? `7-day £${(cm.avg7Pence / 100).toFixed(2)}` : "", cm.avg30Pence != null ? `30-day £${(cm.avg30Pence / 100).toFixed(2)}` : "",
    cm.lowPence != null ? `low £${(cm.lowPence / 100).toFixed(2)}` : "", cm.product ? `product: ${cm.product}` : "",
    rate ? `at £${Number(rate.rate).toFixed(4)}/€${rate.fallback ? " (approximate — no ECB rate stored yet)" : rate.asOf ? ` (ECB ${rate.asOf})` : ""}` : "",
    cm.asOf ? `guide of ${cm.asOf}` : ""
  ].filter(Boolean).join(" · ");
  return <small className="la-cm" title={tip}>Cardmarket £{(cm.pence / 100).toFixed(2)}{arrow ? ` ${arrow}` : ""}{rate?.fallback ? "*" : ""}</small>;
}

/** The pricing run, as a bar: cards done of the total, time left, what is being searched now. */
function PricingBar({ p, onStop }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const elapsed = (now - p.startedAt) / 1000;
  const left = p.done > 0 ? Math.max(0, Math.round((elapsed / p.done) * (p.total - p.done))) : null;
  const fmt = (sec) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)}s`);
  return (
    <div className="la-progress" role="status" aria-live="polite">
      <div className="la-progress-top">
        <b>Pricing from sold comps</b>
        <span><b>{p.done}</b> of {p.total} cards · {pct}%</span>
        <span className="li-dim">{left == null ? "working out time left…" : `about ${fmt(left)} left`} · {fmt(elapsed)} so far</span>
        <span className="li-spacer" />
        <button className="li-btn" disabled={p.stopping} onClick={onStop}>{p.stopping ? "Stopping after these…" : "Stop"}</button>
      </div>
      <div className="la-bar" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
      <div className="la-progress-foot li-dim">
        <span>✓ {p.priced} priced</span>
        {p.noPrice > 0 && <span>· {p.noPrice} no sales</span>}
        {p.failed > 0 && <span style={{ color: "var(--bad)" }}>· {p.failed} failed</span>}
        <span>· {p.searches} searches ({p.cacheHits} from cache)</span>
        {p.current?.length > 0 && <span className="la-current">· now: {p.current.join(" · ")}</span>}
      </div>
    </div>
  );
}

/**
 * Every sale a card's searches found, counted or left out and why, to pick
 * from. Ticks start on what the filter counted; tick a left-out sale that is
 * plainly the card, untick a counted one that isn't, and the price below is
 * worked out from your picks by the same house rules as the server's. Nothing
 * changes until "Use this price".
 */
/**
 * "These sales aren't this card": quick kinds, your own words, a note. What it
 * would take out is counted before you save, off the sales on screen.
 */
function CardRule({ row, rule, onSave, disabled }) {
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState(() => new Set(rule?.kinds || []));
  const [words, setWords] = useState(() => (rule?.words || []).join(", "));
  const [note, setNote] = useState(rule?.note || "");
  useEffect(() => { setKinds(new Set(rule?.kinds || [])); setWords((rule?.words || []).join(", ")); setNote(rule?.note || ""); }, [rule]);
  const draft = normaliseRule({ kinds: [...kinds], words: words.split(","), note });
  const ev = row.comps?.evidence || [];
  const hits = isEmptyRule(draft) ? 0 : ev.filter((e) => (e.counted || e.reasonCode === "yourRule") && saleBreaksRule(e.title, draft, row.cardName)).length;
  if (!open) {
    return (
      <div className="la-rule">
        {rule && !isEmptyRule(rule)
          ? <span>Your rule for this card: <b>{describeRule(rule)}</b>{rule.note ? <span className="li-dim"> — {rule.note}</span> : null}</span>
          : <span className="li-dim">Wrong card in these sales (stamped, graded, a lot…)?</span>}
        <button className="li-link" disabled={disabled} onClick={() => setOpen(true)}>{rule && !isEmptyRule(rule) ? "edit rule" : "＋ add a rule for this card"}</button>
      </div>
    );
  }
  return (
    <div className="la-rule open">
      <div><b>Not this card:</b> {RULE_KINDS.map((k) => (
        <label key={k.key} className="li-check" title={k.hint}>
          <input type="checkbox" checked={kinds.has(k.key)} disabled={disabled}
            onChange={(e) => setKinds((s) => { const n = new Set(s); if (e.target.checked) n.add(k.key); else n.delete(k.key); return n; })} /> {k.label}
        </label>
      ))}</div>
      <div className="la-rule-fields">
        <input className="li-search" placeholder="Words that mean it isn't this card, comma-separated" value={words} disabled={disabled} onChange={(e) => setWords(e.target.value)} />
        <input className="li-search" placeholder="A note (yours — e.g. no stamp on this one)" value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="la-sales-foot">
        <span className="li-dim">{isEmptyRule(draft) ? "Tick a kind or type a word." : `Takes out ${hits} of the sales found. Kept for this card and used every time it's priced.`}</span>
        <span className="li-spacer" />
        <button className="li-btn" disabled={disabled} onClick={() => setOpen(false)}>Cancel</button>
        {rule && !isEmptyRule(rule) && <button className="li-btn" disabled={disabled} onClick={() => { onSave(null); setOpen(false); }}>Remove rule</button>}
        <button className="li-btn primary" disabled={disabled || isEmptyRule(draft)} onClick={() => { onSave(draft); setOpen(false); }}>Save rule</button>
      </div>
    </div>
  );
}

/** Why this one sale isn't the card: a reason, a few words, and optionally a rule. */
function SaleNoteEditor({ note, onSave, onCancel, disabled }) {
  const [why, setWhy] = useState(note?.why || "");
  const [text, setText] = useState(note?.text || "");
  const [alsoRule, setAlsoRule] = useState(false);
  const kind = ruleKindForReason(why);
  const save = () => onSave({ why: why || "other", text }, { alsoRule: alsoRule && !!kind });
  return (
    <div className="la-note">
      <select className="li-select" value={why} disabled={disabled} onChange={(e) => setWhy(e.target.value)} aria-label="Why not this sale?">
        <option value="">Why not this sale?</option>
        {SALE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
      <input className="la-note-text" placeholder="Note (optional)" value={text} maxLength={300} disabled={disabled}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (why || text.trim())) save(); if (e.key === "Escape") onCancel(); }} />
      {kind && <label className="li-check" title="Make it this card's rule, so every sale like this is left out from now on"><input type="checkbox" checked={alsoRule} disabled={disabled} onChange={(e) => setAlsoRule(e.target.checked)} /> rule for this card</label>}
      <button className="li-btn primary" disabled={disabled || (!why && !text.trim())} onClick={save}>Save</button>
      {note && <button className="li-btn" disabled={disabled} onClick={() => onSave(null)}>Remove</button>}
      <button className="li-link" disabled={disabled} onClick={onCancel}>cancel</button>
    </div>
  );
}

function SalesFound({ row, onPicks, onUse, onCheck, onRule, onNote, rule, status, disabled }) {
  const [noting, setNoting] = useState(null); // the sale id whose note is open
  const notes = row.saleNotes || {};
  const [showOut, setShowOut] = useState(false);
  const [showSearches, setShowSearches] = useState(false);
  const ev = row.comps.evidence;
  const chosen = new Set(chosenSales(ev, row.picks).map((e) => String(e.id)));
  const toggle = (id, on) => {
    const next = new Set(chosen);
    if (on) next.add(String(id)); else next.delete(String(id));
    onPicks([...next]);
  };
  const p = evidencePrice(ev, row.picks, { condition: row.comps.condition || row.condition, game: row.comps.game || row.card?.game || "" });
  const changed = picksDiffer(ev, row.picks);
  // A sale you've unticked, noted, or taken out with your rule stays where it
  // was — it is the one you're about to say something about.
  const shown = ev.filter((e) => showOut || e.counted || chosen.has(String(e.id)) || e.reasonCode === "yourRule" || notes[String(e.id)]);
  const outCount = ev.filter((e) => !e.counted).length;
  return (
    <div className="la-sales">
      <div className="la-sales-head">
        <b>Sales found</b>
        <span className="li-dim">{evidenceSummary(ev)}</span>
        {row.cm?.pence != null && (
          <span className="la-cm">Cardmarket {row.cm.reverse ? "reverse " : ""}trend <b>{gbp(row.cm.pence)}</b>
            {row.cm.avg7Pence != null ? ` · 7d ${gbp(row.cm.avg7Pence)}` : ""}{row.cm.avg30Pence != null ? ` · 30d ${gbp(row.cm.avg30Pence)}` : ""}{row.cm.lowPence != null ? ` · low ${gbp(row.cm.lowPence)}` : ""}</span>
        )}
        <span className="li-spacer" />
        {outCount > 0 && <label className="li-check"><input type="checkbox" checked={showOut} onChange={(e) => setShowOut(e.target.checked)} /> show the {outCount} left out</label>}
        {row.comps.search?.length > 0 && <button className="li-link" onClick={() => setShowSearches((v) => !v)}>{showSearches ? "hide" : "show"} the {row.comps.search.length} searches</button>}
      </div>
      {showSearches && (
        <div className="li-plan">
          {row.comps.search.map((s, i) => <div key={i}><span className="mono">{s.query}</span> <span className="li-dim">— {s.error ? `failed: ${s.error}` : `found ${s.fetched ?? "?"}, new ${s.added ?? "?"}`}</span></div>)}
        </div>
      )}
      {onRule && <CardRule row={row} rule={rule} onSave={onRule} disabled={disabled} />}
      <div className="li-scroll" style={{ maxHeight: 360 }}>
        <table className="li-table la-sales-table">
          <thead><tr><th className="li-cb">Use</th><th>Sold listing</th><th className="r">Total</th><th className="sm-hide">Sold</th><th className="sm-hide">Filter</th></tr></thead>
          <tbody>
            {shown.map((e) => {
              const id = String(e.id);
              const note = notes[id];
              const unticked = !chosen.has(id) && (e.counted || e.reasonCode === "yourRule");
              return (
              <Fragment key={e.id}>
              <tr className={chosen.has(id) ? "" : "ended"}>
                <td className="li-cb"><input type="checkbox" disabled={disabled} checked={chosen.has(String(e.id))} onChange={(x) => toggle(e.id, x.target.checked)} aria-label={`Use ${e.title}`} /></td>
                <td style={{ whiteSpace: "normal" }}>
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                  <small className="sm-only">{e.date ? String(e.date).slice(0, 10) : ""} · {e.counted ? "counted" : e.reason}</small>
                  {note && <span className="la-note-tag">✎ {saleReasonLabel(note.why)}{note.text ? ` — ${note.text}` : ""}{onNote && <> · <button className="li-link" disabled={disabled} onClick={() => setNoting(id)}>edit</button></>}</span>}
                  {!note && onNote && <span className="la-note-tag"><button className="li-link" disabled={disabled} onClick={() => setNoting(id)} title="Say why this sale isn't the card — it stays on this card and goes to feedback">{unticked ? "✎ why not?" : "✎ add a note"}</button></span>}
                </td>
                <td className="r mono">£{Number(e.total).toFixed(2)}<small>£{Number(e.price).toFixed(2)} + £{Number(e.postage || 0).toFixed(2)}</small></td>
                <td className="mono sm-hide">{e.date ? String(e.date).slice(0, 10) : "—"}</td>
                <td className={`sm-hide ${e.counted ? "" : "li-dim"}`} style={{ whiteSpace: "normal", maxWidth: 220 }}>{e.counted ? (e.reason || "counted") : e.reason}</td>
              </tr>
              {noting === id && onNote && (
                <tr className="la-note-row"><td colSpan={5}>
                  <SaleNoteEditor note={note} disabled={disabled} onCancel={() => setNoting(null)}
                    onSave={(n, opts) => { onNote(e, n, opts); setNoting(null); }} />
                </td></tr>
              )}
              </Fragment>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={5} className="li-empty">Nothing counted. Tick &quot;show the left out&quot; to pick from what was found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="la-sales-foot">
        <span>{changed ? "Your picks" : "As counted"}: <b>{p.n}</b> sale{p.n === 1 ? "" : "s"}
          {p.suggestedPence != null ? <> → {p.method === "lowest" ? "the lowest" : "40th percentile"} £{(p.basisPence / 100).toFixed(2)} → <b>£{(p.suggestedPence / 100).toFixed(2)}</b>{row.comps.condition && row.comps.condition !== "NM" ? ` (${row.comps.condition})` : ""}</> : " — nothing to price from"}
        </span>
        <span className="li-spacer" />
        {changed && <button className="li-btn" disabled={disabled} onClick={() => onPicks(null)}>Reset picks</button>}
        {status === "thin" && <button className="li-btn" disabled={disabled} onClick={() => onCheck(true)}>✓ Mark checked</button>}
        {status === "checked" && <button className="li-btn" disabled={disabled} onClick={() => onCheck(false)}>Checked ✓ — undo</button>}
        {p.suggestedPence != null && p.suggestedPence === row.pricePence
          ? <span className="li-dim">✓ already the price</span>
          : <button className="li-btn primary" disabled={disabled || p.suggestedPence == null} onClick={() => onUse(p.suggestedPence)}>Use this price</button>}
      </div>
    </div>
  );
}

/** A price box that commits on blur or Enter, so typing "1" on the way to "12.49" doesn't flash a status. */
function PriceBox({ value, onSet, disabled }) {
  const [text, setText] = useState(value == null ? "" : (value / 100).toFixed(2));
  useEffect(() => { setText(value == null ? "" : (value / 100).toFixed(2)); }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) { if (value != null) onSet(null); return; }
    const p = parsePrice(t);
    if (p == null) { setText(value == null ? "" : (value / 100).toFixed(2)); return; }
    if (p !== value) onSet(p);
  };
  return (
    <input className="li-num" style={{ width: 84, textAlign: "right" }} inputMode="decimal" placeholder="£" value={text} disabled={disabled}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

/**
 * The pricing queue's log: every job, what it has done, and where the open
 * ones stand. Open by default while anything is waiting.
 */
function QueueLog({ queue, batchId, onCancel }) {
  const open = queue.jobs.filter(isOpen);
  const recent = queue.jobs.filter((j) => !isOpen(j)).slice(0, 8);
  const eta = new Map((queue.eta || []).map((e) => [e.id, e]));
  const statusText = { queued: "waiting", running: "pricing", done: "done", failed: "stopped", cancelled: "cancelled" };
  const line = (j) => {
    const e = eta.get(j.id);
    return (
      <div key={j.id} className={`pq-row pq-${j.status}`}>
        <span className="pq-status">{statusText[j.status] || j.status}</span>
        {j.batch_id && j.batch_id !== batchId ? <a href={`?batch=${j.batch_id}`}>{j.batch_name || "a batch"}</a> : <b>{j.batch_name || "this batch"}</b>}
        <span>{j.done} of {j.total}</span>
        <span className="li-dim">
          {j.priced} priced{j.no_price ? ` · ${j.no_price} no sales` : ""}{j.failed ? ` · ${j.failed} failed` : ""} · {j.searches} searches{j.cache_hits ? `, ${j.cache_hits} cached` : ""}
        </span>
        {e ? <span className="li-dim">#{e.place} in queue · ~{e.minutes} min</span> : null}
        {j.error ? <span style={{ color: "var(--bad)" }}>{j.error}</span> : null}
        <span className="li-spacer" />
        {isOpen(j) ? <button className="li-btn" onClick={() => onCancel(j.id)}>Stop</button> : null}
      </div>
    );
  };
  return (
    <details className="li-panel pq" open={open.length > 0}>
      <summary>
        <b>Pricing queue</b>{" "}
        <span className="li-dim">
          {open.length ? `${open.length} job${open.length === 1 ? "" : "s"} waiting or running` : "nothing waiting"}
          {queue.busy ? " · worker on it" : open.length ? " · starting…" : ""}
          {" "}— one at a time, 40 searches a minute, under SoldComps&apos; limit
        </span>
      </summary>
      {open.map(line)}
      {recent.length ? <div className="li-dim pq-sub">Recent</div> : null}
      {recent.map(line)}
    </details>
  );
}

const EXTRA_CSS = `
.lb-head { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
.lb-titlerow { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.lb-titlerow h1 { margin:0; font-size:22px; }
.lb-chips { display:flex; flex-wrap:wrap; gap:6px; }
.lb-chip { font-size:12px; padding:3px 10px; border-radius:999px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); }
.lb-chip b { color:var(--ink); }
.lb-more { padding:8px 12px; }
.pq { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
.pq summary { cursor:pointer; }
.pq-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:4px 0; border-top:1px solid var(--line); font-size:13px; }
.pq-status { font-weight:700; text-transform:uppercase; font-size:11px; letter-spacing:.04em; min-width:64px; }
.pq-running .pq-status { color:var(--accent); }
.pq-failed .pq-status { color:var(--bad); }
.pq-sub { margin-top:6px; }
.lb-strip, .lb-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.lb-list { display:flex; flex-direction:column; gap:8px; align-items:stretch; }
.lb-h { font-weight:700; }
.lb-row { padding:6px 0; border-top:1px solid var(--line); }
.lb-save { font-size:12px; color:var(--ink-faint); }
.lb-error { color:var(--bad); }
.lb-conflict { border-color:var(--bad); display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.li-chip.primary-chip { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.la-open { display: flex; flex-direction: column; gap: 12px; white-space: normal; padding: 4px 0; }
/* The card's open panel sits in a row of a table that scrolls sideways: pinned
   to the scroll box's own width (cqw), so it is never drawn past the edge. */
/* The Add copies table never scrolls sideways (asked for 2026-11-25): fixed
   column widths, text wraps, and the File column goes first when it's tight.
   Scrolled sideways, the tick column went off the left edge and rows looked
   as if they had no checkbox. */
.la-fit { overflow-x: clip; }
.la-table { table-layout: fixed; }
.la-table td { white-space: normal; overflow-wrap: anywhere; }
/* Widths include the padding, and the card cell may shrink: otherwise at
   ~1100px the Card column came out narrower than its own contents and the
   name ran over Status. */
.la-table th, .la-table td { box-sizing: border-box; }
.la-table .li-cardcell { min-width: 0; }
.la-table .li-cb { width: 40px; }
.la-table .la-c-status { width: 190px; }
.la-table .la-c-copies { width: 72px; }
.la-table .la-c-cond { width: 96px; }
.la-table .la-c-comps { width: 230px; }
.la-table .la-c-price { width: 124px; }
.la-table .la-c-file { width: 150px; }
.la-file { font-size: 12px; }
.la-open { min-width: 0; }
/* hidden + auto, never clip: clip on one axis turns the other off, and the
   sales list then spilled out of its 360px box over the rows below. */
.la-open .li-scroll { max-width: 100%; overflow-x: hidden; overflow-y: auto; }
.la-sales-table { table-layout: fixed; }
.la-sales-table td { white-space: normal; overflow-wrap: anywhere; }
.la-sales-table th:nth-child(1) { width: 44px; }
.la-sales-table th:nth-child(3) { width: 96px; }
.la-sales-table th:nth-child(4) { width: 104px; }
.la-sales-table th:nth-child(5) { width: 200px; }
/* A column hidden here is shrunk to nothing, never display:none: the open
   card spans colSpan={7}, and with a column removed that span made a ghost
   column that took half the spare width from Card. */
@media (max-width: 1200px) {
  .li-table.la-table .md-hide { display: table-cell; width: 0; padding: 0; border-width: 0; overflow: hidden; font-size: 0; }
  .li-table.la-table .md-hide > * { display: none; }
  .la-table .la-c-status { width: 160px; } .la-table .la-c-comps { width: 200px; }
}
@media (max-width: 760px) {
  .li-table.la-table .sm-hide { display: table-cell; width: 0; padding: 0; border-width: 0; overflow: hidden; font-size: 0; }
  .li-table.la-table .sm-hide > * { display: none; }
  .la-table .la-c-price { width: 104px; }
}
.la-sales-table td, .la-sales-table th { vertical-align: top; }
.la-note-row td { background: var(--surface-2, rgba(127,127,127,.06)); }
.la-note { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 13px; }
.la-note .li-select, .la-note .li-btn { padding: 4px 8px; font-size: 12px; }
.la-note-text { flex: 1 1 200px; min-width: 0; font: inherit; font-size: 13px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
.la-note-tag { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-soft); }
.la-fields { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.la-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-soft); max-width: 100%; min-width: 0; }
.la-fields input:not([type=checkbox]), .la-fields select { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); width: 420px; max-width: 100%; box-sizing: border-box; }
.la-fields .li-check { flex-direction: row; }
.la-copies { display: flex; flex-wrap: wrap; gap: 10px; }
.la-progress { border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; background: var(--surface); position: sticky; top: 8px; z-index: 5; }
.la-progress-top, .la-progress-foot { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13px; }
.la-bar { height: 10px; border-radius: 999px; background: var(--surface-sink); overflow: hidden; }
.la-bar > div { height: 100%; background: var(--accent); transition: width .4s ease; }
.la-current { white-space: normal; }
.la-now { color: var(--accent); font-weight: 600; }
.la-cm { color: var(--ink-soft); }
.la-cm b { color: var(--ink); }
.la-sales { border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); }
.la-rule { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13px; padding: 6px 8px; border-radius: 8px; background: var(--surface-2, rgba(127,127,127,.06)); }
.la-rule.open { flex-direction: column; align-items: stretch; }
.la-rule.open .li-check { margin-right: 10px; }
.la-rule-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.la-rule-fields .li-search { flex: 1 1 240px; min-width: 0; }
.la-sales-head, .la-sales-foot { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 13px; }
.la-sales-table td, .la-sales-table th { font-size: 12.5px; }
.la-sales-table tr.ended td { opacity: .55; }
.la-copy { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 104px; font-size: 12px; text-align: center; }
.la-copy img { width: 84px; height: 116px; object-fit: contain; background: var(--surface-sink); border-radius: 6px; }
.la-copy.off img { opacity: .35; }
small.sm-only { display: none; }
@media (max-width: 760px) {
  .la-fields input:not([type=checkbox]) { min-width: 0; width: 100%; }
  small.sm-only { display: block; margin-top: 3px; }
  small.sm-only .li-status { display: inline-block; margin-right: 4px; }
  .li-cardcell { min-width: 0; }
}
`;
