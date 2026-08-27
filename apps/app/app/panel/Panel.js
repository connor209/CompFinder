"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { APP_SETTINGS, appNameTokens, applyConditionPreference, applyNumberGuards, conditionPreferenceHolds, dropForeignPostage, needsActiveCheck, poolDisagrees, reviewVerdict, settingsForText, soldContradictsAsking, MIN_SOLD_COMPS_TO_PRICE } from "@/lib/matching";
import { createGate, runPool, SOLDCOMPS_GAP_MS, BROWSE_GAP_MS, BATCH_CONCURRENCY } from "@/lib/pace";
import CardUploaderCsv from "@/lib/carduploader.js";
import { buildStockIndex, buildHistoryIndex, checkRow, priceGap } from "@/lib/stockcheck.js";
import { repriceCardUploaderCsv, pricedSkuMap } from "@/lib/ebayexport.js";
import {
  saveBatch,
  loadBatch,
  batchRows,
  restoreResults,
  updateItemActive,
  updateItemRec,
  FILTER_KEYS,
  RETENTION_DAYS
} from "@/lib/batch-store.js";
import { effectivePence, isOverridden, overrideNote, withOverride } from "@/lib/price-override.js";
import { buildPool, poolLabel, stickerRows, stickerSummary, NAME_LENGTHS, DEFAULT_NAME_MAX } from "@/lib/showstock.js";
import { labelFile } from "@/lib/labelexport.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import QuickSearch from "./QuickSearch";
import Inventory from "./Inventory";
import Arbitrage from "./Arbitrage";
import Dashboard from "./Dashboard";
import Sales from "./Sales";
import Stacks from "./Stacks";
import PullSheet from "./PullSheet";
import ShowDesk from "./ShowDesk";
import SellSheet from "./SellSheet";
import Buy from "./Buy";
import Accounts from "./Accounts";
import Browse from "./Browse";
import Scan from "./Scan";
import BulkListModal from "./BulkListModal";
import SavedBatches from "./SavedBatches";
import PriceOverride from "./PriceOverride";
import MarketLinks from "./MarketLinks";
import { Icon } from "./icons";
import ThemeSeg from "./ThemeSeg";
import SkinPicker from "./SkinPicker";

const LOCAL_BUDGET_KEY = "compfinder_soldcomps_budget";
// The run currently on screen, kept for this browser tab. Saved runs live in
// Supabase (migration 023); this is only what covers the gap between finishing
// a run and it being saved, and the case where saving isn't available at all.
const LIVE_BATCH_KEY = "cf-batch-live";
// How wide the labels being printed on are, in characters of card name.
const LABEL_NAME_KEY = "cf-label-name-max";

// Section <-> URL slug mapping so each stream has its own /panel/<slug>.
const STREAM_SLUG = {
  dashboard: "dashboard",
  single: "search",
  scan: "scan",
  batch: "batch",
  browse: "browse",
  buy: "buy",
  inventory: "listings",
  arbitrage: "arbitrage",
  sales: "sales",
  stacks: "stacks",
  pull: "pull",
  shows: "shows",
  sheets: "sheets",
  accounts: "accounts"
};
const SLUG_STREAM = Object.fromEntries(Object.entries(STREAM_SLUG).map(([k, v]) => [v, k]));

// Sections grouped into modules for the two-level nav. `desc` is the one-line
// contextual description shown on hover (as a rail tooltip for single-section
// modules, and as a subtitle in the flyout for multi-section ones).
const MODULES = [
  { key: "dashboard", label: "Dashboard", icon: "home", desc: "Your portfolio & activity at a glance", sections: [{ key: "dashboard", label: "Dashboard" }] },
  {
    key: "pricing",
    label: "Pricing",
    icon: "search",
    desc: "Search, scan or batch-price cards",
    sections: [
      { key: "single", label: "Quick search", desc: "Price a single card fast" },
      { key: "scan", label: "Scan", desc: "Point your camera to price instantly" },
      { key: "batch", label: "Batch", desc: "Price a whole list or CSV at once" }
    ]
  },
  { key: "browse", label: "Browse", icon: "grid", desc: "Explore every game, set & card", sections: [{ key: "browse", label: "Browse" }] },
  { key: "buy", label: "Buy", icon: "cart", desc: "Log deals & purchases you take in", sections: [{ key: "buy", label: "Buy" }] },
  {
    key: "ebay",
    label: "eBay",
    icon: "tag",
    desc: "List, sell & fulfil on eBay",
    sections: [
      { key: "inventory", label: "My listings", desc: "Your live eBay listings & repricing" },
      { key: "sales", label: "Sales", desc: "Completed sales, fees & profit" },
      { key: "stacks", label: "Stacks", desc: "Group inventory into sellable stacks" },
      { key: "pull", label: "Pull sheet", desc: "Pick & pack the day's orders" },
      { key: "shows", label: "Show desk", desc: "Check stock out to shows & back in" }
    ]
  },
  { key: "sheets", label: "Sell sheets", icon: "sheet", desc: "Build CSV imports for Cardmarket listing tools", sections: [{ key: "sheets", label: "Sell sheets" }] },
  { key: "accounts", label: "Accounts", icon: "chart", desc: "Profit & loss and tax-ready reports", sections: [{ key: "accounts", label: "P&L" }] },
  { key: "arbitrage", label: "Arbitrage", icon: "trend", desc: "Spot underpriced buying opportunities", sections: [{ key: "arbitrage", label: "Arbitrage" }] }
];
const moduleForStream = (s) => MODULES.find((m) => m.sections.some((sec) => sec.key === s)) || MODULES[0];

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function loadLocalBudget() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_BUDGET_KEY) || "null");
    if (saved && saved.month === monthKey()) return saved;
  } catch {
    /* ignore malformed storage */
  }
  return { count: 0, month: monthKey() };
}

function incrementLocalBudget() {
  const current = loadLocalBudget();
  const next = { count: current.count + 1, month: monthKey() };
  localStorage.setItem(LOCAL_BUDGET_KEY, JSON.stringify(next));
  return next;
}

function inferConditionFromTitle(title) {
  const t = (title || "").toLowerCase();
  if (/\bnm\b|near mint/.test(t)) return "NM";
  if (/\blp\b|lightly played/.test(t)) return "LP";
  if (/\bmp\b|moderately played/.test(t)) return "MP";
  if (/(?<!\d\s)\bhp\b|heavily played/.test(t)) return "HP";
  if (/damaged/.test(t)) return "DMG";
  return null;
}

/** Same logic as the extension's buildQueryForItem — unchanged, just takes
 *  its toggle values as arguments instead of reading them off the DOM. */
function buildQueryForItem(item, settings, includeCondition, useFullTitle) {
  if (item.source === "csv") {
    const built = CardUploaderCsv.buildQueryFromItem(item.csvItem, { includeCondition, useFullTitle });
    return { query: built.query, nameTokens: built.nameTokens, set: built.set, csvItem: item.csvItem, cardNumber: item.csvItem.cardNumber };
  }
  const baseQuery = CompFinderPricing.simplifyTitle(item.title, settings.stripWords);
  const nameTokens = appNameTokens(baseQuery);
  let query;
  if (useFullTitle && item.title && item.title.trim()) {
    query = item.title.trim().replace(/\s+/g, " ");
  } else {
    query = baseQuery;
    if (includeCondition) {
      const inferred = inferConditionFromTitle(item.title);
      if (inferred) query = `${baseQuery} ${inferred}`;
    }
  }
  const numMatch = /\b([A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4})\b/i.exec(query);
  return { query, nameTokens, set: null, csvItem: null, cardNumber: numMatch ? numMatch[1].replace(/\s+/g, "") : null };
}

/**
 * A recommendation with the number taken off it.
 *
 * Two sold comps is not a price — measured across the 2026-08-25 batch, the
 * prices built from two comps or fewer had a median of £15.49 against £9.99
 * for those built from four or more, because with two comps nothing absorbs a
 * bad one and every downstream guard is below its own minimum. The comps are
 * KEPT so the deep dive still shows what was found and why it wasn't enough;
 * only the figure is withheld, and the row says so rather than going quiet.
 */
function heldRec(rec, soldCount, fetched, activeCount, apiDiagnostic, disagrees = false, activeDisagreed = false) {
  const totals = (rec.included || []).map((c) => c.totalPence).filter((t) => t > 0);
  const range = totals.length
    ? ` (${CompFinderPricing.toPoundsStr(Math.min(...totals))}-${CompFinderPricing.toPoundsStr(Math.max(...totals))})`
    : "";
  const why = disagrees
    ? `The ${soldCount} sold comp(s) for this card range too widely${range} to be the same product, so any single figure would be right for none of them`
    : soldCount === 0
      ? `No sold comps matched this card out of ${fetched} fetched`
      : `Only ${soldCount} sold comp(s) matched this card out of ${fetched} fetched — too few to price from`;
  // Name the reason the live market couldn't stand in, rather than assuming it
  // was the count. A run held Slugma No. 218 saying "only 8 active listing(s)
  // matched, which is too few" when the minimum is three — it had plenty, they
  // just disagreed with each other as badly as the sold comps did. A note that
  // gives the wrong reason is worse than a short one: it sends you to look for
  // a problem that isn't there.
  const active = activeCount == null
    ? ""
    : activeCount === 0
      ? " No active listings matched either."
      : activeDisagreed
        ? ` The ${activeCount} active listing(s) disagree just as widely, so the live market can't settle it either.`
        : ` Only ${activeCount} active listing(s) matched, which is too few to stand in for it.`;
  return {
    ...rec,
    rawPence: null,
    finalPence: null,
    confidence: "Low",
    priceHeld: true,
    note: `${why}, so no price is given rather than a figure you'd have to know to distrust.${active}${apiDiagnostic ? " " + apiDiagnostic : ""}`
  };
}

export default function Panel({ initialSection = "dashboard", initialBatchId = null, initialPool = null }) {
  const [pastedText, setPastedText] = useState("");
  const [csvItems, setCsvItems] = useState(null);
  const [csvSummary, setCsvSummary] = useState("");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [running, setRunning] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [budget, setBudget] = useState({ count: 0 });
  const [stream, setStream] = useState(SLUG_STREAM[initialSection] || "dashboard");
  const [openModule, setOpenModule] = useState(null);
  const [navSheet, setNavSheet] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [seed, setSeed] = useState(null);
  const seedNonce = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  // Navigate a section: update state + the URL so each has a distinct page.
  const go = useCallback((s) => {
    setStream(s);
    router.push(`/panel/${STREAM_SLUG[s] || "dashboard"}`, { scroll: false });
  }, [router]);

  // Navigate + close any open nav overlay (rail flyout / full sheet / context).
  const nav = useCallback((s) => {
    go(s);
    setOpenModule(null);
    setNavSheet(false);
    setCtxOpen(false);
  }, [go]);

  // Keep the active section in sync with the URL (back/forward, direct links).
  useEffect(() => {
    const slug = (pathname || "").replace(/^\/panel\/?/, "").split("/")[0] || "dashboard";
    const st = SLUG_STREAM[slug];
    if (st) setStream((cur) => (cur === st ? cur : st));
  }, [pathname]);

  // Remember the last section visited within each module, so clicking a module
  // returns you to where you were.
  const lastByModule = useRef({});
  useEffect(() => {
    lastByModule.current[moduleForStream(stream).key] = stream;
  }, [stream]);

  // Deep dive a card in Quick Search. `opts` may carry { game, card } so a jump
  // from Browse lands on the right game (pokemon/mtg/other) and prices the exact
  // card (name + number + set), not just a text string.
  //
  // The payload is stashed in sessionStorage as well as React state: navigating
  // to /panel/search remounts this component (a slug change remounts the route),
  // which resets its state before Quick Search reads the prop — sessionStorage
  // survives that, so the search always fires. Quick Search consumes it on mount.
  //
  // Crucially we DON'T call go()/setStream here: setStream would mount Quick
  // Search on the *old* Panel for one render before the navigation remounts it,
  // and that throwaway instance would consume+clear the payload and run a search
  // that's immediately discarded — leaving the real (post-remount) Quick Search
  // with nothing. Navigating via the URL alone means only the final Quick Search
  // reads the payload.
  const deepDiveCard = useCallback((query, opts = {}) => {
    seedNonce.current += 1;
    const payload = { query, nonce: seedNonce.current, game: opts.game || null, card: opts.card || null };
    try { sessionStorage.setItem("cf-deepdive", JSON.stringify(payload)); } catch { /* private mode */ }
    setSeed(payload);
    router.push(`/panel/${STREAM_SLUG.single}`, { scroll: false });
  }, [router]);

  const currentModule = moduleForStream(stream);

  // Search filters
  const [ebaySite, setEbaySite] = useState("ebay.co.uk");
  const [itemLocation, setItemLocation] = useState("domestic");
  const [itemCondition, setItemCondition] = useState("any");
  const [soldWithin, setSoldWithin] = useState("90");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [includeCondition, setIncludeCondition] = useState(false);
  const [useFullTitle, setUseFullTitle] = useState(false);
  const [fetchActiveAlways, setFetchActiveAlways] = useState(false);

  // Active (asking-price) listings fetched on demand, keyed by the row's
  // index in `results`: { loading } | { rec } | { error }.
  const [activeByIndex, setActiveByIndex] = useState({});

  // Results filters
  const [showBulkList, setShowBulkList] = useState(false);
  const [resultsSearch, setResultsSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [showCurrentPrice, setShowCurrentPrice] = useState(false);
  const [resultsView, setResultsView] = useState("cards");

  // What we already know about these cards: our live eBay listings and our own
  // past price decisions. Loaded once when the Batch stream is first opened,
  // so a batch run doesn't wait on it.
  const [known, setKnown] = useState(null); // { stock, history, listings, checks } | { error }
  const [stockOnly, setStockOnly] = useState(false);
  // The uploaded CardUploader CSV, kept verbatim so the eBay export can hand
  // the same file back with only the prices changed.
  const [csvRaw, setCsvRaw] = useState(null); // { text, name }

  // The show pool named by ?pool=show — the cards currently checked out to a
  // show, offered for pricing. Loaded, then WAITED ON: a pool of 200 cards is
  // 200 SoldComps requests, and a screen that spent them on mount would spend
  // them again on every refresh.
  const [pool, setPool] = useState(null); // { items, skipped, label } | null
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState("");
  // The pool the results on screen were priced from, so the sticker panel and
  // the saved run's label both know which trip this was. A ref as well as
  // state: runBatchInner reads it in the same tick it is set.
  const [poolRun, setPoolRun] = useState(null);
  const poolRunRef = useRef(null);
  // Rate gates for the batch's outbound calls. Refs rather than state: they are
  // machinery, and re-rendering when a slot is taken would be absurd.
  const soldGate = useRef(createGate(SOLDCOMPS_GAP_MS));
  const browseGate = useRef(createGate(BROWSE_GAP_MS));
  const [stickerNotice, setStickerNotice] = useState("");
  const [applyingStickers, setApplyingStickers] = useState(false);
  // How much of a card's name fits the label being printed on. A preference
  // about physical stationery, so it is remembered rather than re-chosen every
  // run — and the list on screen shows the cut text, so a bad choice is
  // visible before a hundred labels come off the roll.
  // Sticker prices set by hand, keyed by the card's position in the run. That
  // key rather than the SKU because the sticker list renders in run order and
  // never filters or re-sorts — and a saved run restores by position too, so
  // an edit lands back on the card it was typed for.
  const [overrides, setOverrides] = useState({});
  const [nameMax, setNameMax] = useState(DEFAULT_NAME_MAX);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(LABEL_NAME_KEY));
      if (saved > 0) setNameMax(saved);
    } catch { /* private mode — the default is fine */ }
  }, []);
  function saveNameMax(n) {
    setNameMax(n);
    try { localStorage.setItem(LABEL_NAME_KEY, String(n)); } catch { /* best-effort */ }
  }

  // The saved run the results on screen came from — set both when one is
  // re-opened and when a fresh run has just been saved, so the screen can say
  // which it is and a later active-listing check updates the right record.
  const [openBatch, setOpenBatch] = useState(null);
  const [openingBatch, setOpeningBatch] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [batchNoticeIsError, setBatchNoticeIsError] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  // Bumped every time a price is set by hand. Only there to drive the
  // sessionStorage write below — an override is the one change to a run that
  // doesn't happen at the end of one.
  const [overrideNonce, setOverrideNonce] = useState(0);
  const [batchesNonce, setBatchesNonce] = useState(0);

  const settings = APP_SETTINGS;

  const currentFilters = () => ({
    ebaySite,
    itemLocation,
    itemCondition,
    soldWithin,
    minPrice,
    maxPrice,
    includeCondition,
    useFullTitle,
    fetchActiveAlways
  });

  // A saved run is restored together with the filters it ran under, so the
  // controls above the results never describe something other than the results
  // below them — a 30-day window on screen over a 90-day run is a quiet lie.
  const applyFilters = useCallback((filters) => {
    if (!filters) return;
    const setters = {
      ebaySite: setEbaySite,
      itemLocation: setItemLocation,
      itemCondition: setItemCondition,
      soldWithin: setSoldWithin,
      minPrice: setMinPrice,
      maxPrice: setMaxPrice,
      includeCondition: setIncludeCondition,
      useFullTitle: setUseFullTitle,
      fetchActiveAlways: setFetchActiveAlways
    };
    for (const key of FILTER_KEYS) {
      if (filters[key] != null && setters[key]) setters[key](filters[key]);
    }
  }, []);

  /** Load a saved run into the results screen. Costs nothing upstream: the
   *  comps are the ones it was priced from, frozen, not a fresh lookup. */
  const openSavedBatch = useCallback(async (id) => {
    setOpeningBatch(true);
    setBatchNotice("");
    try {
      const loaded = await loadBatch(createClient(), id);
      if (!loaded) {
        setBatchNotice("That run is no longer saved — it may have passed its keep-by date.");
        return;
      }
      setResults(loaded.results);
      setActiveByIndex(loaded.activeByIndex);
      setCsvRaw(loaded.batch.csv_text ? { text: loaded.batch.csv_text, name: loaded.batch.csv_name || "batch.csv" } : null);
      setCsvItems(null);
      setCsvSummary("");
      applyFilters(loaded.batch.filters);
      setOpenBatch(loaded.batch);
      // A saved pool run brings its sticker panel back with it. That is the
      // whole reason the show it was priced for is stored: re-opening the run
      // at the table days later is how a lost label gets reprinted.
      setPoolRun(loaded.batch.pool_name || null);
      poolRunRef.current = loaded.batch.pool_name || null;
      setOverrides(loaded.batch.pool_name ? await savedStickers(loaded.results) : {});
      setStatus(
        `Re-opened ${loaded.batch.label} — priced ${new Date(loaded.batch.created_at).toLocaleString()}, and showing exactly what it was priced from.`
      );
      setStatusIsError(false);
    } catch (err) {
      console.error("Saved run could not be opened:", err);
      setBatchNotice(`Could not open that run: ${err.message}`);
      setBatchNoticeIsError(true);
    } finally {
      setOpeningBatch(false);
    }
  }, [applyFilters]);

  // Re-opening pushes /panel/batch/<id> rather than loading in place: a slug
  // change remounts this component, so putting the id in the URL is what makes
  // a re-opened run survive the NEXT deep dive as well.
  const goToBatch = useCallback((id) => {
    router.push(`/panel/batch/${id}`, { scroll: false });
  }, [router]);

  // The live copy of the current run, kept across the remount that navigation
  // causes. Opening a deep dive pushes /panel/search, which remounts this
  // component and resets its state — that is exactly how a finished 59-card
  // run used to vanish. Written on the way out and once at the end of a run,
  // rather than on every row: a run's worth of comps is around a megabyte of
  // JSON, and serialising it after each of 59 cards would be felt.
  const liveRef = useRef(null);
  const skipLiveWrite = useRef(false);
  useEffect(() => {
    liveRef.current = { results, activeByIndex, csvRaw, csvSummary, status, statusIsError, openBatch, batchNotice, batchNoticeIsError, poolRun, overrides };
  });
  const writeLive = useCallback(() => {
    const live = liveRef.current;
    if (skipLiveWrite.current || !live || live.results.length === 0) return;
    try {
      sessionStorage.setItem(
        LIVE_BATCH_KEY,
        JSON.stringify({
          items: batchRows(live.results, live.activeByIndex),
          csvRaw: live.csvRaw,
          csvSummary: live.csvSummary,
          status: live.status,
          statusIsError: live.statusIsError,
          openBatch: live.openBatch,
          batchNotice: live.batchNotice,
          batchNoticeIsError: live.batchNoticeIsError,
          poolRun: live.poolRun,
          overrides: live.overrides
        })
      );
    } catch {
      /* Private mode, or a run bigger than the tab's storage quota. The
         Supabase copy is the one that has to hold, and it isn't bounded by
         this — so failing here is quiet on purpose. */
    }
  }, []);
  useEffect(() => () => writeLive(), [writeLive]);
  useEffect(() => {
    if (!running && results.length > 0) writeLive();
  }, [running, results.length, writeLive]);
  // A price you typed is worth the same megabyte the run was: losing it to a
  // deep dive is exactly the failure the live copy exists to prevent, and it
  // would be worse here, because nothing on screen would say it had gone.
  useEffect(() => {
    if (overrideNonce > 0) writeLive();
  }, [overrideNonce, writeLive]);

  // On mount: an id in the URL wins (that is someone deliberately re-opening a
  // run), otherwise restore whatever this tab was last looking at. Only on the
  // Batch screen — a run is a megabyte of JSON to parse, and the Dashboard has
  // no use for it.
  const restoredLive = useRef(false);
  useEffect(() => {
    if (restoredLive.current || stream !== "batch") return;
    restoredLive.current = true;
    if (initialBatchId) {
      openSavedBatch(initialBatchId);
      return;
    }
    // A pool in the URL is a deliberate "price this set", same as an id is a
    // deliberate "re-open that run" — restoring the last thing this tab looked
    // at over the top of it would bury what was just asked for.
    if (initialPool) return;
    let payload = null;
    try {
      payload = JSON.parse(sessionStorage.getItem(LIVE_BATCH_KEY) || "null");
    } catch {
      /* nothing to restore */
    }
    if (!payload || !payload.items || payload.items.length === 0) return;
    const restored = restoreResults(payload.items);
    setResults(restored.results);
    setActiveByIndex(restored.activeByIndex);
    if (payload.csvRaw) setCsvRaw(payload.csvRaw);
    if (payload.csvSummary) setCsvSummary(payload.csvSummary);
    if (payload.status) {
      setStatus(payload.status);
      setStatusIsError(!!payload.statusIsError);
    }
    if (payload.openBatch) setOpenBatch(payload.openBatch);
    if (payload.batchNotice) {
      setBatchNotice(payload.batchNotice);
      setBatchNoticeIsError(!!payload.batchNoticeIsError);
    }
    if (payload.poolRun) {
      setPoolRun(payload.poolRun);
      poolRunRef.current = payload.poolRun;
    }
    if (payload.overrides) setOverrides(payload.overrides);
  }, [stream, initialBatchId, initialPool, openSavedBatch]);

  // Load the show pool: every card still checked out. The Show Desk owns this
  // set — nothing here decides what is in it, which is why re-running the pool
  // after packing another box picks the new cards up for free.
  const poolRequested = useRef(false);
  useEffect(() => {
    if (stream !== "batch" || initialPool !== "show" || poolRequested.current) return;
    // Latched before the first await, not after: without it a failed load
    // leaves `pool` null and `poolLoading` back to false, which is the exact
    // state this effect fires on — it would retry forever.
    poolRequested.current = true;
    let cancelled = false;
    (async () => {
      setPoolLoading(true);
      setPoolError("");
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("stock_checkouts")
          .select("id,sku,title,event,stack_name,sticker_pence")
          .is("resolved_at", null)
          .order("checked_out_at", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        const { items, skipped } = buildPool(data || []);
        setPool({ items, skipped, label: poolLabel(data || []) });
      } catch (err) {
        if (!cancelled) {
          setPoolError(
            /stock_checkouts|does not exist|schema cache/i.test(err.message || "")
              ? "The show desk isn't set up in Supabase yet — migration 016 hasn't been applied."
              : `Couldn't load the show pool: ${err.message}`
          );
        }
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stream, initialPool]);

  /** Clear the screen for a fresh run, and stop the one being cleared from
   *  being written back out on the way to the empty page. */
  const startNewBatch = useCallback(() => {
    skipLiveWrite.current = true;
    try { sessionStorage.removeItem(LIVE_BATCH_KEY); } catch { /* ignore */ }
    setResults([]);
    setActiveByIndex({});
    setCsvRaw(null);
    setCsvItems(null);
    setCsvSummary("");
    setOpenBatch(null);
    setBatchNotice("");
    setBatchNoticeIsError(false);
    setStatus("");
    setStatusIsError(false);
    setPoolRun(null);
    poolRunRef.current = null;
    setStickerNotice("");
    setOverrides({});
    router.push("/panel/batch", { scroll: false });
  }, [router]);

  // Load our live listings and our own price history once, so every batch row
  // can say "we already sell this at £X" without another round trip. Failure
  // is quiet — the stock column just doesn't appear.
  const loadKnown = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const pageSize = 1000;
      let listings = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("ebay_listings")
          .select("ebay_item_id,sku,title,url,price_value,price_currency,quantity")
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        listings = listings.concat(data);
        if (data.length < pageSize) break;
      }
      const { data: checks } = await supabase
        .from("price_checks")
        .select("title,sku,recommended_pence,confidence,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(2000);
      setKnown({
        stock: buildStockIndex(listings),
        history: buildHistoryIndex(checks || []),
        listings: listings.length,
        checks: (checks || []).length
      });
    } catch (err) {
      console.warn("Could not load existing stock:", err.message);
    }
  }, []);

  useEffect(() => {
    if (stream === "batch" && known === null) loadKnown();
  }, [stream, known, loadKnown]);

  // runBatch is redefined every render, so it closes over the current filter
  // state. onCsvSelected is memoised with no deps, so calling runBatch from
  // inside it directly would call the FIRST render's copy and price every CSV
  // with the default filters, ignoring whatever the user picked. The ref
  // always points at the latest one.
  const runBatchRef = useRef(null);
  useEffect(() => {
    runBatchRef.current = runBatch;
  });

  const onCsvSelected = useCallback((e) => {
    const file = e.target.files[0];
    e.target.value = ""; // let the same file be re-selected after a failure
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setCsvRaw({ text: String(reader.result), name: file.name });
        const items = CardUploaderCsv.extractItems(reader.result);
        if (items.length === 0) {
          setCsvSummary("No rows with a recognisable Card Name + Card Number found — is this a CardUploader export?");
          setCsvItems(null);
          return;
        }
        const loaded = items.map((item) => ({ sku: item.sku, title: item.title, source: "csv", csvItem: item }));
        setCsvItems(loaded);
        const repairedCount = items.filter((i) => i.cardNumberRepaired).length;
        setCsvSummary(
          `Loaded ${items.length} card(s) from ${file.name}.` +
            (repairedCount
              ? ` ⚠ ${repairedCount} card number(s) looked like Excel had auto-converted them to dates and were repaired — worth double-checking those rows.`
              : "")
        );
        // runBatch is async: a rejection here would NOT reach the catch
        // below, it would just vanish and leave the panel stuck on
        // "Pricing 1 of N…" forever. Surface it as a status instead.
        runBatchRef.current(loaded).catch((err) => {
          setStatus(`Batch failed: ${err.message}`);
          setStatusIsError(true);
        });
      } catch (err) {
        setCsvSummary(`Could not read CSV: ${err.message}`);
        setCsvItems(null);
      }
    };
    reader.onerror = () => {
      setCsvSummary(`Could not read ${file.name} — the browser could not open that file.`);
      setCsvItems(null);
    };
    reader.readAsText(file);
  }, []);

  /** Snap-to-search: downscale the photo in the browser (keeps the vision call
   *  cheap and fast, and well under image-size limits), send it to /api/identify,
   *  and append the identified card to the paste box for the user to confirm
   *  before running. Never auto-runs — identification is a suggestion. */
  const onPhotoSelected = useCallback((e) => {
    const file = e.target.files[0];
    e.target.value = ""; // let the same photo be re-selected later
    if (!file) return;

    setIdentifying(true);
    setStatus("Reading card photo…");
    setStatusIsError(false);

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const maxEdge = 1024;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

      try {
        const res = await fetch("/api/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mediaType: "image/jpeg" })
        }).then((r) => r.json());

        if (!res.ok) throw new Error(res.error || "Could not identify the card.");
        const card = res.result;
        if (!card.identified || !card.suggested_query) {
          setStatus(
            card.notes ||
              "Couldn't read a card in that photo — try again with the card filling the frame in good light."
          );
          setStatusIsError(true);
        } else {
          setPastedText((prev) => (prev.trim() ? `${prev.trim()}\n` : "") + card.suggested_query);
          setStatus(`Identified: “${card.suggested_query}” — check it's right, then Run search & price.`);
          setStatusIsError(false);
        }
      } catch (err) {
        setStatus(`Card identification failed: ${err.message}`);
        setStatusIsError(true);
      } finally {
        setIdentifying(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setIdentifying(false);
      setStatus("Could not read that image file.");
      setStatusIsError(true);
    };
    img.src = url;
  }, []);

  /** One SoldComps request via the API route, with rate-limit retry —
   *  same shape as the extension's fetchSoldCompsWithRetry, just a fetch()
   *  to our own API instead of a chrome.runtime message. `sold: false`
   *  switches to active-listings mode — this one parameter is the entire
   *  replacement for what the Terapeak bridge used to provide. */
  async function fetchSoldCompsWithRetry(query, opts, onRetry) {
    let attempt = 0;
    while (true) {
      // Every attempt takes a slot, retries included — a retry is a request
      // like any other and SoldComps counts it the same way.
      await soldGate.current();
      const response = await fetch("/api/soldcomps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, options: opts })
      }).then((r) => r.json());

      if (response && response.ok) {
        // A cache hit spent nothing upstream, so it must not count against the
        // quota estimate — otherwise re-running a list looks as expensive as
        // the first run and the number stops being worth reading.
        if (!response.cached) {
          const next = incrementLocalBudget();
          setBudget(next);
        }
        return response;
      }

      if (response && response.isRateLimited && attempt < 2) {
        attempt++;
        if (onRetry) onRetry(attempt, 2000 * attempt);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      // Deliberately NOT counted: SoldComps confirm (2026-08-21) that failed
      // requests don't count against the monthly quota, so counting them here
      // would inflate this estimate exactly when things are going wrong.
      const e = new Error((response && response.error) || "Unknown error calling SoldComps.");
      e.isAuthError = response && response.isAuthError;
      e.isQuotaExceeded = response && response.isQuotaExceeded;
      throw e;
    }
  }

  /**
   * Active listings, preferring eBay's own Browse API over SoldComps.
   *
   * Browse is first-party, 5,000 calls a day free, and needs no per-user key —
   * so a live-market check costs nothing and no longer has to be rationed to
   * suspicious rows. SoldComps stays as the fallback for the cases Browse
   * can't serve: eBay app credentials not configured, or a Browse call that
   * fails. The caller cannot tell the difference; both return the same shape.
   *
   * Deliberately NOT counted against the local quota estimate when Browse
   * answers, because nothing was spent. `budgetSpent` says which happened.
   */
  async function fetchActiveListings(query, opts) {
    try {
      await browseGate.current();
      const res = await fetch("/api/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, options: opts })
      }).then((r) => r.json());
      if (res && res.ok && Array.isArray(res.comps)) return { ...res, budgetSpent: false };
    } catch {
      /* fall through to SoldComps — a live-market check is worth one metered
         request when the free route is unavailable, and silently skipping it
         would quietly re-introduce the £29.99 Golbat. */
    }
    return { ...(await fetchSoldCompsWithRetry(query, { ...opts, sold: false })), budgetSpent: true };
  }

  async function runBatch(items, { poolName = null } = {}) {
    if (!items || items.length === 0) {
      setStatus("Paste at least one title, or upload a CSV, first.");
      setStatusIsError(true);
      return;
    }

    setRunning(true);
    skipLiveWrite.current = false;
    setOpenBatch(null);
    setBatchNotice("");
    setBatchNoticeIsError(false);
    setStickerNotice("");
    // Set the ref as well as the state: runBatchInner saves the run at the end
    // of this same call, and would otherwise read the previous render's value.
    poolRunRef.current = poolName;
    setPoolRun(poolName);
    setOverrides({});
    try {
      await runBatchInner(items);
    } finally {
      // Whatever happens — an unexpected throw included — the Run button has
      // to come back, or the only way out of the page is a reload.
      setRunning(false);
    }
  }

  async function runBatchInner(items) {
    setResults([]);
    // Fresh per run, so one run's pacing never delays the next.
    soldGate.current = createGate(SOLDCOMPS_GAP_MS);
    browseGate.current = createGate(BROWSE_GAP_MS);
    setActiveByIndex({});
    let consecutiveFailures = 0;
    let stoppedEarly = false;
    let stopReason = "";
    // Indexed by position, not pushed: cards complete out of order under
    // concurrency, and the run has to keep the order the list was given.
    const collected = new Array(items.length).fill(null);

    const searchOptions = { ebaySite, itemLocation, itemCondition, minPrice: minPrice || null, maxPrice: maxPrice || null, soldAfterDays: Number(soldWithin) };

    // SoldComps' sold-listings endpoint can be down while their active-
    // listings endpoint keeps working (their own status note, 2026-08-21:
    // "active listing endpoint is still working, and failed requests do not
    // count against your request quota"). So a failed sold lookup is worth
    // retrying as an active lookup rather than writing the card off — and
    // once sold has failed this many times in a row, stop paying for it on
    // every remaining card and go straight to active for the rest of the run.
    const SOLD_DOWN_STREAK = 3;
    let soldFailStreak = 0;
    let soldEndpointDown = false;

    const priceFromActive = (q, tokens, num, st, title) =>
      fetchActiveListings(q, { ...searchOptions, sold: false }).then((r) =>
        CompFinderPricing.recommend(
          dropForeignPostage(applyNumberGuards(r.comps, num)).comps,
          settingsForText(title || q), tokens, "active", num, st
        )
      );

    // One card. Runs BATCH_CONCURRENCY at a time — see lib/pace.js for why
    // three, and why the old 1.2s sleep between cards was the wrong tool.
    // Writes into its own slot rather than pushing, so a run stays in the
    // order the list was given however the cards actually complete.
    let done = 0;
    const priceOne = async (i) => {
      const item = items[i];
      const { title, sku } = item;

      done++;
      setStatus(`Pricing ${done} of ${items.length}: "${title}"`);

      let query, nameTokens, set, csvItem, cardNumber;
      let soldComps, apiDiagnostic, fromCache = false;
      try {
        // Inside the try on purpose: a single malformed row must fail that
        // row like any other error, not reject out of runBatch and leave the
        // whole batch frozen mid-item with `running` stuck on.
        ({ query, nameTokens, set, csvItem, cardNumber } = buildQueryForItem(item, settings, includeCondition, useFullTitle));

        if (soldEndpointDown) {
          throw new Error(`Sold-listing lookup skipped — it failed on the first ${SOLD_DOWN_STREAK} cards of this run.`);
        }

        const result = await fetchSoldCompsWithRetry(query, searchOptions, (attempt, delay) =>
          setStatus(`Item ${i + 1} of ${items.length}: SoldComps rate limit — retry ${attempt} in ${Math.round(delay / 1000)}s…`)
        );
        soldComps = result.comps;
        fromCache = !!result.cached;
        if (result.comps.length === 0) {
          apiDiagnostic =
            result.rawItemCount > 0
              ? `SoldComps returned ${result.rawItemCount} raw result(s) but all ${result.skippedWrongCurrency} were filtered as non-GBP (saw: ${result.currenciesSeen.join(", ") || "unknown"}).`
              : `SoldComps returned 0 raw results for this exact query.`;
        }
        consecutiveFailures = 0;
        soldFailStreak = 0;
      } catch (err) {
        if (err.isAuthError || err.isQuotaExceeded) {
          // Nothing after this can succeed, so stop pulling new cards. Work
          // already in flight still finishes and its results are kept —
          // throwing away a card we have already paid for helps nobody.
          stoppedEarly = true;
          stopReason = `Stopped at item ${done} of ${items.length} — ${err.message}`;
          collected[i] = { title, sku, query, csvItem, rec: null, failed: err.message };
          setResults(collected.filter(Boolean));
          setStatus(stopReason);
          setStatusIsError(true);
          return;
        }

        // The sold lookup failed (or was skipped). Before writing the card
        // off, try the active-listings endpoint — it can be up while sold is
        // down, and SoldComps confirm failed requests aren't billed, so the
        // attempt is free when sold is the thing that's broken.
        soldFailStreak++;
        let salvaged = null;
        if (query) {
          setStatus(`Item ${i + 1} of ${items.length}: sold lookup failed — trying active listings…`);
          try {
            const activeRec = await priceFromActive(query, nameTokens, cardNumber, set, title);
            if (activeRec.included.length > 0) {
              activeRec.note = `Priced from active listings (asking prices), not sold comps — the sold lookup failed: ${err.message}`;
              salvaged = activeRec;
            }
          } catch {
            /* active is down too — fall through to the normal failure path */
          }
        }

        if (salvaged) {
          // A priced card, just from a weaker source — the row is labelled
          // "active" in the results, so it doesn't get read as a sold price.
          if (!soldEndpointDown && soldFailStreak >= SOLD_DOWN_STREAK) {
            soldEndpointDown = true;
            setStatus(`SoldComps' sold-listing endpoint is failing — pricing the rest of this run from active listings instead.`);
          }
          consecutiveFailures = 0;
          collected[i] = { title, sku, query, csvItem, rec: salvaged, nameTokens, set, cardNumber };
          setResults(collected.filter(Boolean));
          return;
        }

        // "Consecutive" now means consecutive COMPLETIONS with no success
        // between them, since cards no longer finish in the order they start.
        // Same intent — stop a run that is failing persistently rather than
        // burn the rest of a list on it — and the count is still reset by any
        // success, which is what makes it a streak rather than a total.
        consecutiveFailures++;
        collected[i] = { title, sku, query, csvItem, rec: null, failed: err.message };
        setResults(collected.filter(Boolean));
        setStatus(`Item ${done} of ${items.length}: ${err.message}`);
        setStatusIsError(true);
        if (consecutiveFailures >= settings.maxConsecutiveFailures) {
          stoppedEarly = true;
          stopReason = `Stopped after ${consecutiveFailures} failures in a row (item ${done} of ${items.length}).`;
          setStatus(stopReason);
        }
        return;
      }

      // Postage that no UK seller charges to post one card is not card value.
      // Dropped BEFORE pricing so every downstream rule sees the card rather
      // than somebody's international shipping — measured across this batch,
      // 74-82% of each recommended price was the postage.
      // Per CARD, not per run: an English card excludes foreign-language comps,
      // a card whose title names a language does not. See settingsForText.
      const cardSettings = settingsForText(title || query);
      const { comps: ukPostageComps, changed: postageDropped } = dropForeignPostage(applyNumberGuards(soldComps, cardNumber));

      let rec = CompFinderPricing.recommend(ukPostageComps, cardSettings, nameTokens, "sold", cardNumber, set);

      // Condition, over the comps that survived identity — never over the raw
      // pool. Near-mint sells for about twice lightly-played (measured across
      // 29 cards), and pooling the two is the largest per-card error left. The
      // ordering is load-bearing: applied earlier this removes wrong cards
      // that happen to say "NM", which costs splitSetMismatch its majority and
      // lets £20 wrong cards into the price. See applyConditionPreference.
      const cardCondition = (csvItem && csvItem.condition) || inferConditionFromTitle(title);
      const pref = applyConditionPreference(rec.included, cardCondition);
      if (pref.dropped.length) {
        const byGrade = CompFinderPricing.recommend(
          pref.comps.map(({ totalPence, exclusionReason, ...c }) => c),
          cardSettings, nameTokens, "sold", cardNumber, set
        );
        if (conditionPreferenceHolds(byGrade)) {
          // Nothing is dropped quietly: the set-aside comps stay in the deep
          // dive with their own reason, exactly as every other rule's are.
          byGrade.excluded = [
            ...byGrade.excluded,
            ...pref.dropped.map((c) => ({ ...c, exclusionReason: "conditionMismatch" }))
          ];
          byGrade.note = `${byGrade.note} (Note: ${pref.reason}.)`;
          rec = byGrade;
        }
      }

      if (apiDiagnostic) rec.note = apiDiagnostic;
      if (postageDropped > 0) {
        rec.note = `${rec.note ? rec.note + " " : ""}(Note: postage was dropped from ${postageDropped} comp(s) charging more than any UK seller charges to post a single card — the sale still counts, their international shipping doesn't.)`;
      }

      // Too few sold comps to be a price. Ask what the card is actually LISTED
      // at rather than trusting one sale: Sunkern No. 191 became a £19.49
      // recommendation off a single £19.36 comp while twelve live UK listings
      // for it sat at £1.99-£2.24. The active market is the sanity check that
      // was already one API call away and only ever got made at zero comps.
      if (needsActiveCheck(rec, cardSettings)) {
        const soldCount = rec.included.length;
        // A sold pool can be internally consistent and still not be the card.
        // Golbat No. 042 priced £29.99 off four comps spanning £12.00-£44.33 —
        // no outlier, no disagreement, Medium confidence — on a card listed
        // live at £3.48. Nothing in the pool could catch it, so above
        // SANITY_CHECK_ABOVE_PENCE the sold answer is checked against the live
        // market rather than trusted on its own shape.
        const sanityOnly = soldCount >= MIN_SOLD_COMPS_TO_PRICE && !poolDisagrees(rec, cardSettings);
        // Two different reasons, one remedy: ask the live market. Too few sold
        // comps to price from, or a pool whose comps disagree so widely they
        // cannot all be the same product — Golbat No. 042 blended 15 comps at
        // £12.99, 6 at £5.08 and 3 at £2.60 into £7.99, a figure right for none
        // of them, and said so in its own note while printing it.
        const disagrees = soldCount >= MIN_SOLD_COMPS_TO_PRICE;
        setStatus(
          soldCount === 0
            ? `Item ${i + 1} of ${items.length}: no sold comps for "${query}" — checking active listings…`
            : disagrees
              ? `Item ${i + 1} of ${items.length}: sold comps for "${query}" disagree — checking what it's listed at…`
              : `Item ${i + 1} of ${items.length}: only ${soldCount} sold comp(s) for "${query}" — checking what it's listed at…`
        );
        try {
          const activeResult = await fetchActiveListings(query, { ...searchOptions, sold: false });
          const { comps: ukActive } = dropForeignPostage(applyNumberGuards(activeResult.comps, cardNumber));
          const activeRec = CompFinderPricing.recommend(ukActive, cardSettings, nameTokens, "active", cardNumber, set);
          // The live market only helps if it agrees with itself. Actives that
          // span as widely as the sold comps did are the same pooling problem
          // seen from the other side, and swapping one blend for another would
          // just move the fault.
          const activeUsable = activeRec.included.length >= MIN_SOLD_COMPS_TO_PRICE && !poolDisagrees(activeRec, cardSettings);
          if (sanityOnly) {
            // The sold pool looked fine, so it is kept unless the live market
            // flatly contradicts it. Asking prices run ABOVE sold ones, so a
            // sold figure well above what the card is listed at today is not a
            // strong card — it is evidence those sales were something else.
            if (activeUsable && soldContradictsAsking(rec, activeRec)) {
              const wasPence = rec.rawPence;
              activeRec.note = `${activeRec.note} (The ${soldCount} sold comp(s) for this card averaged ${CompFinderPricing.toPoundsStr(wasPence)} — well above what it is listed at right now, which means those sales were most likely a different product. Priced from the live market instead; the sold figure is in the deep dive if you want to judge it yourself.)`;
              // Flagged structurally, not left to be read out of the note: the
              // review queue has to know this happened, and a screen that
              // regexes its own prose is one edit from silently reading nothing.
              activeRec.soldOverruled = true;
              rec = activeRec;
            }
          } else if (activeUsable) {
            activeRec.note = `${activeRec.note} ${
              disagrees
                ? `(The ${soldCount} sold comp(s) for this card ranged too widely to be one product, so this is the live asking market instead.)`
                : `(Only ${soldCount} sold comp(s) matched this card out of ${soldComps.length} fetched — too few to price from, so this is the live asking market instead.)`
            }`;
            rec = activeRec;
          } else {
            rec = heldRec(
              rec, soldCount, soldComps.length, activeRec.included.length, apiDiagnostic, disagrees,
              activeRec.included.length >= MIN_SOLD_COMPS_TO_PRICE
            );
          }
        } catch (err) {
          if (sanityOnly) {
            // The sold price stands. It was never in doubt from its own shape;
            // this call was a second opinion, and not getting one is no reason
            // to withhold an answer.
            rec.note = `${rec.note} (Could not check this against the live market: ${err.message})`;
          } else {
            rec = heldRec(rec, soldCount, soldComps.length, null, apiDiagnostic, disagrees);
            rec.note = `${rec.note} (Active-listing check also failed: ${err.message})`;
          }
        }
      }

      collected[i] = { title, sku, query, csvItem, rec, nameTokens, set, cardNumber, fromCache };
      setResults(collected.filter(Boolean));
    };

    // The gates in fetchSoldCompsWithRetry and fetchActiveListings do the
    // pacing now, so the pool only decides how many cards may be in the air.
    await runPool(items.length, BATCH_CONCURRENCY, priceOne, () => stoppedEarly);

    // Pulling stops at the first stop signal, but cards already running finish
    // — so compact away the slots that were never reached.
    const finished = collected.filter(Boolean);
    collected.length = 0;
    collected.push(...finished);
    setResults(finished);

    setRunning(false);
    saveHistory(collected);
    const failedCount = collected.filter((r) => r.failed).length;
    if (!stoppedEarly) {
      const freeCount = collected.filter((r) => r.fromCache).length;
      setStatus(
        `Done — ${collected.length} of ${items.length} item(s) processed` +
        (failedCount ? `, ${failedCount} failed` : "") +
        (freeCount ? `, ${freeCount} served from the last 24 hours at no cost` : "") + "."
      );
      setStatusIsError(false);
    }

    // Opt-in: fetch active (asking-price) listings for every priced item too.
    // Off by default because it's a second API call per item (~2× quota).
    // Collected locally as well as into state because the save below has to
    // include them: a re-opened run that had lost the asking prices this run
    // paid for would send you to fetch them a second time.
    const activeLocal = {};
    if (fetchActiveAlways && !stoppedEarly) {
      for (let i = 0; i < collected.length; i++) {
        if (!collected[i].rec) continue;
        const activeRec = await fetchActiveFor(collected[i], i);
        if (activeRec) activeLocal[i] = { loading: false, rec: activeRec };
      }
    }

    await saveBatchRun(collected, activeLocal, stoppedEarly ? "stopped" : "complete");
  }

  /** Fetch active (asking-price) listings for one already-priced item and
   *  stash the result under its row index. Used both by the per-row "Check
   *  active" button and the batch-wide toggle. Runs the same recommend()
   *  pipeline in active mode so the asking-price figure is filtered the same
   *  way the sold figure was. Each call spends one SoldComps request. */
  async function fetchActiveFor(result, index) {
    if (!result || !result.rec) return;
    setActiveByIndex((m) => ({ ...m, [index]: { loading: true } }));
    const activeOptions = {
      ebaySite,
      itemLocation,
      itemCondition,
      minPrice: minPrice || null,
      maxPrice: maxPrice || null,
      sold: false
    };
    try {
      const activeResult = await fetchActiveListings(result.query, activeOptions);
      const activeRec = CompFinderPricing.recommend(
        dropForeignPostage(applyNumberGuards(activeResult.comps, result.cardNumber || null)).comps,
        settingsForText(result.title || result.query),
        result.nameTokens || null,
        "active",
        result.cardNumber || null,
        result.set || null
      );
      setActiveByIndex((m) => ({ ...m, [index]: { loading: false, rec: activeRec } }));
      // When this row belongs to a saved run, the record should say what the
      // screen now says — otherwise re-opening it a third time asks for these
      // listings again. Best-effort: the figure is already on screen either way.
      if (openBatch?.id) {
        updateItemActive(createClient(), openBatch.id, index, activeRec).catch(() => {});
      }
      return activeRec;
    } catch (err) {
      setActiveByIndex((m) => ({ ...m, [index]: { loading: false, error: err.message } }));
      return null;
    }
  }

  /** Persist every priced item from a finished batch to the user's history.
   *  Fire-and-forget: history is a convenience, so a save failure is logged
   *  but never interrupts pricing or surfaces as a scary error. Only items
   *  that actually produced a recommendation are stored — pure failures
   *  (no rec) aren't worth keeping. RLS ties each row to the signed-in user. */
  async function saveHistory(rows) {
    const priced = rows.filter((r) => r.rec);
    if (priced.length === 0) return;
    try {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) return;

      const records = priced.map((r) => historyRecord({ userId: user.id, row: r, rec: r.rec, ebaySite }));

      const { error } = await supabase.from("price_checks").insert(records);
      if (error) console.warn("Could not save price history:", error.message);
    } catch (err) {
      console.warn("Could not save price history:", err.message);
    }
  }

  /**
   * A price you set by hand, into the same history the run wrote to.
   *
   * A NEW row rather than a correction of the one this run inserted, and that
   * is not laziness: `price_checks` grants select, insert and delete and no
   * UPDATE policy (supabase/schema.sql), so an update would quietly change
   * nothing at all — the worst possible outcome for a record. A new row is
   * also the truer account. Pricing the card was one decision at one time;
   * overriding it is another, later, and buildHistoryIndex() in stockcheck.js
   * reads the most recent per card, so "last priced" becomes your number the
   * moment you set it.
   */
  async function recordPriceDecision(row, rec) {
    try {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("price_checks")
        .insert(historyRecord({ userId: user.id, row, rec, ebaySite }));
      if (error) console.warn("Could not save the price you set:", error.message);
    } catch (err) {
      console.warn("Could not save the price you set:", err.message);
    }
  }

  /**
   * Put your price on one row of the run — or take it back off.
   *
   * Three copies of a run exist and all three have to hear about this, because
   * the one you list from is whichever you happen to reach for next:
   *
   *   - React state, which is what every export and the sticker panel read;
   *   - the sessionStorage copy, which is what survives a deep dive;
   *   - the saved run in Supabase, which is what survives the tab.
   *
   * The saved run is patched row by row (`updateItemRec`) rather than re-saved
   * whole: saving creates a NEW run, and an afternoon of corrections would
   * leave a saved-runs list of near-identical megabyte copies with no way to
   * tell which one you were listing from.
   */
  async function setOverrideFor(index, pence) {
    const row = results[index];
    if (!row) return;
    const nextRec = withOverride(row.rec, pence);
    // Typing the same number back in, or confirming an empty box on a row that
    // never had an override, changes nothing — and withOverride hands back the
    // very same rec to say so. Recording a decision that wasn't one would put
    // a duplicate row in your price history every time you tabbed through.
    if (nextRec === row.rec) return;
    const nextRow = { ...row, rec: nextRec };
    setResults((prev) => prev.map((r, i) => (i === index ? nextRow : r)));
    setOverrideNonce((n) => n + 1);

    recordPriceDecision(nextRow, nextRec);

    if (!openBatch?.id) return;
    try {
      await updateItemRec(createClient(), openBatch.id, index, nextRec);
    } catch (err) {
      setBatchNoticeIsError(true);
      setBatchNotice(
        `Your price for "${row.title}" is on screen, but this saved run could NOT be updated with it: ${err.message}. Press Save this run to keep a copy that has it.`
      );
    }
  }

  /** Persist a finished run — every card, with the comps behind it and the
   *  filters it ran under. saveHistory above keeps the flat prices for the
   *  History screen; this keeps the working, which is the part that costs
   *  59 SoldComps requests to reproduce.
   *
   *  Unlike saveHistory, a failure here is worth saying out loud: the whole
   *  promise is that the run can be got back, and quietly not saving it would
   *  only be discovered at the moment it was needed. */
  async function saveBatchRun(rows, activeLocal, status) {
    if (!rows.some((r) => r.rec)) return;
    setSavingBatch(true);
    try {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        setBatchNotice("This run could NOT be saved — you appear to be signed out. Sign in again and press Save this run.");
        setBatchNoticeIsError(true);
        return;
      }
      const saved = await saveBatch(supabase, user.id, {
        results: rows,
        activeByIndex: activeLocal,
        filters: currentFilters(),
        csvRaw,
        poolName: poolRunRef.current,
        status
      });
      if (!saved) return;
      setOpenBatch(saved.batch);
      setBatchesNonce((n) => n + 1);
      setBatchNoticeIsError(saved.degraded.length > 0);
      setBatchNotice(
        saved.degraded.length === 0
          ? `Saved — kept for ${RETENTION_DAYS} days, comps and all, and re-opening it spends nothing.`
          : `Saved, but ${saved.degraded.length} card(s) kept their price without the comps behind it: ${saved.degraded.slice(0, 3).join(", ")}${saved.degraded.length > 3 ? "…" : ""}. Those rows say so when the run is re-opened.`
      );
    } catch (err) {
      // The message is the only thing that can tell us what went wrong on a
      // machine we can't see, so log the whole error object too.
      console.error("Batch run could not be saved:", err);
      const detail = [err.message, err.code, err.details, err.hint].filter(Boolean).join(" · ");
      setBatchNoticeIsError(true);
      setBatchNotice(
        /price_batch|does not exist|schema cache/i.test(detail)
          ? `This run could NOT be saved — the saved-runs tables aren't reachable (${detail}). Migration 023 may not have been applied, or Supabase's schema cache hasn't picked it up yet. The run is still on screen; press Save this run to try again.`
          : `This run could NOT be saved: ${detail}. The run is still on screen — press Save this run to try again, or export the CSV.`
      );
    } finally {
      setSavingBatch(false);
    }
  }

  /** Save whatever is on screen, on demand. The automatic save at the end of a
   *  run is the normal path; this is what makes a failure recoverable instead
   *  of terminal, and it is the only thing standing between a run that didn't
   *  save and re-pricing every card in it. */
  async function saveCurrentRun() {
    await saveBatchRun(results, activeByIndex, "complete");
  }

  function getPastedItems() {
    return pastedText
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((title) => ({ sku: "", title, source: "paste" }));
  }

  function exportCsv() {
    // "Overridden From" is APPENDED rather than slotted in next to the price:
    // this file gets opened in a sheet that somebody has already built columns
    // against, and a new column in the middle silently moves every one of them.
    const header =
      "SKU,Title,Simplified Query,Comps Used,Comps Excluded,Data Source,Confidence," +
      "Already Listed,Listed Price,Last Priced,Current Price,Recommended Price,Note,Overridden From\n";
    const rows = results.map((r) => {
      const currentPrice = r.csvItem && r.csvItem.startPrice ? r.csvItem.startPrice : "";
      const k = knownFor(r);
      const listedPence = k?.stock?.match?.pricePence ?? null;
      const stockCell = k?.stock ? (k.stock.count > 1 ? `yes (${k.stock.count})` : "yes") : "";
      const listedCell = listedPence != null ? (listedPence / 100).toFixed(2) : "";
      const lastCell = k?.history ? (k.history.match.pricePence / 100).toFixed(2) : "";
      const quote = (cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
      if (!r.rec) {
        return quote([r.sku || "", r.title, r.query, "", "", "", "Skipped", stockCell, listedCell, lastCell, currentPrice, "", r.failed, ""]);
      }
      // The price column is what you'd list at, so it is YOURS where you set
      // one. What the app had said moves to the last column rather than being
      // dropped — a sheet that can't show what a price replaced can't be
      // checked against the run it came from.
      const pence = effectivePence(r.rec);
      const price = pence != null ? (pence / 100).toFixed(2) : "";
      const wasPrice = isOverridden(r.rec) && r.rec.finalPence != null ? (r.rec.finalPence / 100).toFixed(2) : "";
      const noteCell = [overrideNote(r.rec), r.rec.note].filter(Boolean).join(" ");
      return quote([r.sku || "", r.title, r.query, r.rec.included.length, r.rec.excluded.length, r.rec.dataSource, r.rec.confidence, stockCell, listedCell, lastCell, currentPrice, price, noteCell, wasPrice]);
    });
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compfinder-prices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The whole run as JSON — every comp used, every comp excluded, with the
   * reason each was dropped.
   *
   * Export CSV gives one row a card and is what you list from. This is the
   * evidence UNDER those rows, and it exists because a pricing rule judged on
   * the two cards that prompted it gets reversed later — the 2026-08-25 Neo
   * batch took four rounds partly because the comps behind it were only ever
   * in React state and every question cost another run.
   *
   * The saved run in Supabase holds the same thing, but reading it needs the
   * service-role key and a terminal. This is the same data, one click, and it
   * works when migration 023 hasn't been applied.
   *
   * `node scripts/recurse-batch.mjs --corpus <file>` prices every card in it
   * both ways and costs nothing at SoldComps.
   *
   * Not small — a run is roughly a megabyte of comps — and it carries your
   * SKUs and asking prices, so it belongs on your machine rather than in the
   * repo.
   */
  function downloadRun() {
    const payload = {
      dumpedAt: new Date().toISOString(),
      // What the run was priced UNDER. A corpus without its filters can't be
      // compared against a later one — the sold window and the marketplace
      // change what came back at least as much as any rule does.
      searchOptions: { ebaySite, itemLocation, itemCondition, soldAfterDays: Number(soldWithin), minPrice: minPrice || null, maxPrice: maxPrice || null },
      poolName: poolRunRef.current || null,
      cards: results.map((r, i) => ({
        sku: r.sku || "", title: r.title, query: r.query,
        set: r.set || null, cardNumber: r.cardNumber || null,
        nameTokens: r.nameTokens || null,
        failed: r.failed || null,
        shipped: r.rec
          ? {
              rawPence: r.rec.rawPence ?? null, finalPence: r.rec.finalPence ?? null,
              // Beside finalPence, never instead of it: recurse-batch.mjs
              // re-prices this corpus and compares against what the ENGINE
              // said, which a hand-typed number overwriting it would poison.
              overridePence: r.rec.overridePence ?? null,
              confidence: r.rec.confidence ?? null, dataSource: r.rec.dataSource ?? null,
              priceHeld: !!r.rec.priceHeld, note: r.rec.note || "",
              used: (r.rec.included || []).length, excluded: (r.rec.excluded || []).length
            }
          : null,
        activeShipped: activeByIndex[i]?.rec
          ? { rawPence: activeByIndex[i].rec.rawPence ?? null, used: (activeByIndex[i].rec.included || []).length }
          : null,
        // included + excluded IS the pool as fetched. Reassembling them gives
        // a harness back what SoldComps returned, which is what it needs to
        // re-price the card under a different rule.
        comps: r.rec ? [...(r.rec.included || []), ...(r.rec.excluded || [])] : []
      }))
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compfinder-run-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The sticker prices already written against this run's cards, as overrides.
   *
   * Re-opening a saved run at the show is how a lost label gets reprinted, and
   * a reprint has to say what the first print said — so the saved price wins
   * over a fresh suggestion, hand-set or not. Without this, re-opening a run
   * you had priced by hand would quietly put the engine's numbers back and
   * print a second, different label for the same card.
   *
   * Matched on SKU rather than row order, for the same reason applyStickers is.
   * Failure is quiet and total: no saved prices simply means the suggestions
   * stand, which is exactly what happened before any of this existed.
   */
  async function savedStickers(rows) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("stock_checkouts")
        .select("sku,sticker_pence")
        .is("resolved_at", null)
        .not("sticker_pence", "is", null);
      if (error) throw error;
      const bySku = new Map();
      for (const c of data || []) if (c.sku) bySku.set(String(c.sku).toLowerCase(), c.sticker_pence);
      const found = {};
      (rows || []).forEach((r, i) => {
        const p = r.sku ? bySku.get(String(r.sku).toLowerCase()) : null;
        if (p != null) found[i] = p;
      });
      return found;
    } catch {
      return {};
    }
  }

  /**
   * Set one card's sticker price by hand, in whole pounds.
   *
   * Whole pounds because that is what the label prints — labelPrice() rounds
   * to the pound, so accepting £7.50 here would quietly put £8 on the sticker
   * and there would be no way to tell from the screen. It is a cash price
   * across a table; the pence were never going to be handed over.
   *
   * An empty box clears the override rather than setting zero, which is what
   * puts a card back on the suggestion — or back to held, if that is where it
   * started.
   */
  function setSticker(index, pounds) {
    setOverrides((prev) => {
      const next = { ...prev };
      const n = Number(String(pounds).replace(/[^0-9.]/g, ""));
      if (!String(pounds).trim() || !Number.isFinite(n) || n <= 0) delete next[index];
      else next[index] = Math.round(n) * 100;
      return next;
    });
  }

  /**
   * Write the run's sticker prices back onto the open checkouts they came
   * from, so the Show Desk can price a card at the table and the label export
   * has one number to print.
   *
   * Rows are matched on SKU, never on order: the results list gets filtered
   * and re-sorted on screen, and a sticker landing on the wrong card is a card
   * sold for the wrong money. Held rows are skipped entirely rather than
   * written as null — a card that had a sticker from an earlier run keeps it,
   * instead of losing it to a run that happened to price it badly.
   *
   * This one is not fire-and-forget. The whole point is that the number is
   * still there at the show, and a silent failure would only surface with a
   * customer standing in front of you.
   */
  async function applyStickers() {
    const rows = stickerRows(results, { nameMax, overrides }).filter((r) => !r.held && r.sku);
    if (rows.length === 0) return;
    setApplyingStickers(true);
    setStickerNotice("Saving sticker prices to the show desk…");
    try {
      const supabase = createClient();
      const { data: open, error } = await supabase
        .from("stock_checkouts")
        .select("id,sku")
        .is("resolved_at", null);
      if (error) throw error;

      const bySku = new Map();
      for (const c of open || []) {
        if (c.sku) bySku.set(String(c.sku).toLowerCase(), c.id);
      }
      const now = new Date().toISOString();
      let saved = 0;
      const missing = [];
      for (const r of rows) {
        const id = bySku.get(r.sku.toLowerCase());
        if (!id) { missing.push(r.sku); continue; }
        const { error: upErr } = await supabase
          .from("stock_checkouts")
          .update({
            sticker_pence: r.stickerPence,
            sticker_set_at: now,
            sticker_batch_id: openBatch?.id || null
          })
          .eq("id", id);
        if (upErr) throw upErr;
        saved += 1;
      }
      setStickerNotice(
        `Saved ${saved} sticker price${saved === 1 ? "" : "s"} to the show desk.` +
          (missing.length
            ? ` ${missing.length} card${missing.length === 1 ? " was" : "s were"} no longer checked out (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}) — checked back in since this run.`
            : "")
      );
    } catch (err) {
      setStickerNotice(
        /sticker_pence|does not exist|schema cache/i.test(err.message || "")
          ? "Sticker prices could NOT be saved — migration 024 hasn't been applied in Supabase yet. They're still on screen, and the CSV below still works."
          : `Sticker prices could NOT be saved: ${err.message}`
      );
    } finally {
      setApplyingStickers(false);
    }
  }

  /**
   * The label file, as the Nimbot printer's app imports it: two columns,
   * `Price` then `Name`, one row per card, and it generates a label per row.
   *
   * A real .xlsx rather than a CSV, so the file goes from here to the printer
   * without Excel ever opening it — which is also what keeps a card number
   * like "4/99" from being silently rewritten as "Apr-99" on the way (see
   * repairExcelDateMangling in lib/carduploader.js).
   */
  function downloadLabelFile() {
    const bytes = labelFile(results, { nameMax, overrides });
    if (bytes.length === 0) return;
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labels-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // Results filtering — computed at render time from plain state, same
  // effect as the extension's dataset-attribute toggling, simpler here
  // since React already re-renders on state change.
  const reasonOptions = [...new Set(results.flatMap((r) => (r.rec ? Object.keys(countReasons(r.rec)) : [])))];
  // What we already know about each row — computed here so the filter, the
  // cards, the table and both exports all read the same answer.
  const knownFor = (r) => (known ? checkRow(r, known) : null);
  // One verdict per row, read by the summary, the filter and the rows — the
  // same reason knownFor is computed here rather than three times.
  const verdictFor = (r) => reviewVerdict(r.rec);
  const needsReviewCount = results.filter((r) => verdictFor(r).needsReview).length;
  const askingCount = results.filter((r) => !verdictFor(r).needsReview && verdictFor(r).basis).length;
  const filteredResults = results
    .map((r, origIndex) => ({ r, origIndex, known: knownFor(r) }))
    .filter(({ r, known: k }) => {
      const searchText = `${r.sku} ${r.title} ${r.query}`.toLowerCase();
      const matchesSearch = !resultsSearch || searchText.includes(resultsSearch.toLowerCase());
      const confidence = r.rec ? r.rec.confidence : "Low";
      const matchesConfidence = !confidenceFilter || confidence === confidenceFilter;
      const reasons = r.rec ? Object.keys(countReasons(r.rec)) : [];
      const matchesReason = !reasonFilter || reasons.includes(reasonFilter);
      const matchesStock = !stockOnly || !!k?.stock;
      const v = verdictFor(r);
      const matchesReview =
        !reviewFilter ||
        (reviewFilter === "needs" ? v.needsReview : reviewFilter === "asking" ? !!v.basis : !v.needsReview);
      return matchesSearch && matchesConfidence && matchesReason && matchesStock && matchesReview;
    });
  const inStockCount = known ? results.filter((r) => knownFor(r)?.stock).length : 0;

  // Sticker rows for a pool run. Derived at render from the same results the
  // table shows, through the one function that owns the rounding — the number
  // on screen, the number written to the show desk and the number in the CSV
  // are the same number by construction, not by three callers agreeing.
  const stickers = poolRun ? stickerRows(results, { nameMax, overrides }) : [];
  const stickerCounts = stickerSummary(stickers);

  /** Hand back the uploaded CardUploader CSV with our prices in it. */
  function exportEbayCsv() {
    if (!csvRaw) return;
    try {
      const { csv, updated, missing, skipped } = repriceCardUploaderCsv(csvRaw.text, pricedSkuMap(results));
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = csvRaw.name.replace(/\.csv$/i, "") + "-priced.csv";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(
        `eBay upload file ready: ${updated} row(s) repriced` +
          (skipped ? `, ${skipped} left at their original price` : "") +
          (missing.length ? `, ${missing.length} priced SKU(s) weren't in the file` : "") +
          ". Upload it in eBay Seller Hub → Reports."
      );
      setStatusIsError(false);
    } catch (err) {
      setStatus(err.message);
      setStatusIsError(true);
    }
  }

  return (
    <div id="app" className="shell">
      <header className="appbar">
        <button
          className="icobtn"
          aria-label="Open navigation"
          aria-expanded={navSheet}
          onClick={() => { setNavSheet((v) => !v); setCtxOpen(false); setOpenModule(null); }}
        >
          {navSheet ? "✕" : "☰"}
        </button>
        <div className="wordmark">
          <span className="brand-mark">CF</span>
          <span className="wm-t">Comp&nbsp;Finder</span>
        </div>
        <button
          className={`icobtn ctx${ctxOpen ? " on" : ""}`}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={ctxOpen}
          onClick={() => { setCtxOpen((v) => !v); setNavSheet(false); setOpenModule(null); }}
        >
          •••
        </button>
      </header>

      <div className="workspace">
        <nav className="rail" aria-label="Sections">
          {MODULES.map((m) => {
            const multi = m.sections.length > 1;
            const active = currentModule.key === m.key;
            const open = openModule === m.key;
            return (
              <div
                className="rail-item"
                key={m.key}
                onMouseEnter={() => { if (multi) setOpenModule(m.key); }}
                onMouseLeave={() => setOpenModule((o) => (o === m.key ? null : o))}
              >
                <button
                  className={active ? "on" : ""}
                  aria-label={m.desc ? `${m.label} — ${m.desc}` : m.label}
                  aria-current={active ? "true" : undefined}
                  aria-haspopup={multi ? "menu" : undefined}
                  aria-expanded={multi ? open : undefined}
                  onClick={() => { if (multi) setOpenModule((o) => (o === m.key ? null : m.key)); else nav(m.sections[0].key); }}
                >
                  <span className="rail-ic" aria-hidden="true"><Icon name={m.icon} size={22} /></span>
                </button>
                {/* Single-section modules reveal a description tooltip on hover;
                    multi-section ones show theirs in the flyout header below. */}
                {!multi ? (
                  <span className="rail-tip" role="tooltip">
                    <b>{m.label}</b>
                    {m.desc ? <span>{m.desc}</span> : null}
                  </span>
                ) : null}
                {multi && open ? (
                  <div className="rail-fly" role="menu">
                    <div className="rail-fly-h">
                      {m.label}
                      {m.desc ? <span className="rail-fly-sub">{m.desc}</span> : null}
                    </div>
                    {m.sections.map((sec) => (
                      <button key={sec.key} role="menuitem" className={stream === sec.key ? "on" : ""} onClick={() => nav(sec.key)} title={sec.desc || undefined}>
                        <span className="rail-fly-lbl">
                          {sec.label}
                          {sec.desc ? <span className="rail-fly-desc">{sec.desc}</span> : null}
                        </span>
                        {stream === sec.key ? <span aria-hidden="true">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <main className="stream-main">
      {stream === "dashboard" && <Dashboard onNavigate={go} />}
      {stream === "single" && <QuickSearch seed={seed} />}
      {stream === "scan" && <Scan onDeepDive={deepDiveCard} />}
      {stream === "inventory" && <Inventory onDeepDive={deepDiveCard} />}
      {stream === "arbitrage" && <Arbitrage />}
      {stream === "sales" && <Sales />}
      {stream === "stacks" && <Stacks />}
      {stream === "pull" && <PullSheet />}
      {stream === "shows" && <ShowDesk />}
      {stream === "sheets" && <SellSheet />}
      {stream === "buy" && <Buy />}
      {stream === "browse" && <Browse onDeepDive={deepDiveCard} />}
      {stream === "accounts" && <Accounts />}
      {stream === "batch" && (
        <>
      <div className="status-strip">
        <span className="chip">{`SoldComps: ${budget.count} this month (local estimate)`}</span>
      </div>

      {openBatch ? (
        <div className="sb-open">
          <div className="sb-open-t">
            <span className="eyebrow">Saved run</span>
            <span className="hint-small">
              {openBatch.label} · {new Date(openBatch.created_at).toLocaleString()} · comps frozen as they were priced
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={startNewBatch}>Start a new batch</button>
        </div>
      ) : null}
      {openingBatch ? <p className="hint hint-small">Opening that run…</p> : null}
      {batchNotice ? (
        <p className={`hint hint-small sb-notice${batchNoticeIsError ? " compfinder-error" : ""}`}>{batchNotice}</p>
      ) : null}

      <SavedBatches onOpen={goToBatch} refreshNonce={batchesNonce} openId={openBatch?.id || null} />

      {initialPool === "show" ? (
        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">Show pool</span>
            {pool ? <span className="badge2">{pool.items.length} away</span> : null}
          </div>
          {poolLoading ? <p className="hint hint-small">Reading what&apos;s checked out…</p> : null}
          {poolError ? <p className="hint hint-small" style={{ color: "var(--bad-ink)" }}>{poolError}</p> : null}
          {pool && !poolLoading ? (
            pool.items.length === 0 ? (
              <p className="dd-empty">
                Nothing is checked out. Pack for the show on the Show desk first — this prices whatever is away.
              </p>
            ) : (
              <>
                <p className="hint">
                  Every card checked out to <b>{pool.label}</b>. Pricing them costs{" "}
                  <b>{pool.items.length}</b> SoldComps request{pool.items.length === 1 ? "" : "s"} and takes
                  roughly {Math.max(1, Math.round((pool.items.length * 3) / 60))} minute
                  {Math.max(1, Math.round((pool.items.length * 3) / 60)) === 1 ? "" : "s"}. The run saves
                  itself, and re-opening it later spends nothing.
                </p>
                {pool.skipped.length > 0 ? (
                  <p className="hint hint-small">
                    {pool.skipped.length} checked-out card{pool.skipped.length === 1 ? " has" : "s have"} no
                    title to search on and {pool.skipped.length === 1 ? "is" : "are"} left out
                    {pool.skipped.some((k) => k.sku) ? ` (${pool.skipped.map((k) => k.sku).filter(Boolean).join(", ")})` : ""}.
                  </p>
                ) : null}
                <div className="row">
                  <button
                    className="btn btn-primary"
                    disabled={running}
                    onClick={() => runBatch(pool.items, { poolName: pool.label })}
                  >
                    {running ? "Running…" : `Price all ${pool.items.length}`}
                  </button>
                </div>
              </>
            )
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><span className="eyebrow">Search</span></div>
        <p className="hint">Paste titles OR upload a CardUploader CSV export below.</p>

        <textarea
          rows={5}
          placeholder={"e.g.\nPoliwag 30/149 Pokemon NM Holo\nCharmander 4/102 Base Set LP"}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
        />

        <div className="row row-file">
          <label className={`btn btn-ghost file-label${identifying ? " is-disabled" : ""}`} htmlFor="cardPhoto">
            {identifying ? "Reading photo…" : "📷 Identify from photo"}
          </label>
          <input
            id="cardPhoto"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={identifying}
            onChange={onPhotoSelected}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          />
          <span className="hint-small">Snap a card to fill the box — you confirm before it searches.</span>
        </div>

        <div className="filters">
          <span className="eyebrow eyebrow-small">SoldComps filters</span>
          <div className="filter-grid">
            <label className="field">
              <span>eBay marketplace</span>
              <select value={ebaySite} onChange={(e) => setEbaySite(e.target.value)}>
                <option value="ebay.co.uk">United Kingdom</option>
                <option value="ebay.com">United States</option>
                <option value="ebay.de">Germany</option>
                <option value="ebay.fr">France</option>
                <option value="ebay.it">Italy</option>
                <option value="ebay.es">Spain</option>
                <option value="ebay.ca">Canada</option>
                <option value="ebay.com.au">Australia</option>
              </select>
            </label>
            <label className="field">
              <span>Item location</span>
              <select value={itemLocation} onChange={(e) => setItemLocation(e.target.value)}>
                <option value="default">Default</option>
                <option value="domestic">Domestic sellers</option>
                <option value="worldwide">Worldwide</option>
              </select>
            </label>
            <label className="field">
              <span>Condition</span>
              <select value={itemCondition} onChange={(e) => setItemCondition(e.target.value)}>
                <option value="any">Any</option>
                <option value="new">New</option>
                <option value="used">Used</option>
              </select>
            </label>
            <label className="field">
              <span>Sold within</span>
              <select value={soldWithin} onChange={(e) => setSoldWithin(e.target.value)}>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 6 months</option>
                <option value="365">Last 12 months</option>
              </select>
            </label>
            <label className="field">
              <span>Min price (£)</span>
              <input type="number" min="0" step="0.01" placeholder="e.g. 1.00" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
            </label>
            <label className="field">
              <span>Max price (£)</span>
              <input type="number" min="0" step="0.01" placeholder="e.g. 20.00" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </label>
          </div>

          <label className="checkbox-field">
            <input type="checkbox" checked={includeCondition} disabled={useFullTitle} onChange={(e) => setIncludeCondition(e.target.checked)} />
            <span>Include condition (NM, LP, MP, HP, DMG) in the search text</span>
          </label>

          <label className="checkbox-field">
            <input type="checkbox" checked={useFullTitle} onChange={(e) => setUseFullTitle(e.target.checked)} />
            <span>Search using the full original title, not the condensed version</span>
          </label>

          <label className="checkbox-field">
            <input type="checkbox" checked={fetchActiveAlways} onChange={(e) => setFetchActiveAlways(e.target.checked)} />
            <span>Also fetch active (asking-price) listings for every item — uses ≈2× your SoldComps quota</span>
          </label>
        </div>

        <div className="row">
          <button className="btn btn-primary" disabled={running} onClick={() => runBatch(getPastedItems())}>
            {running ? "Running…" : "Run search & price"}
          </button>
        </div>

        <div className="divider"><span>or</span></div>

        <div className="row row-file">
          <label className="btn btn-ghost file-label" htmlFor="csvInput">Upload CardUploader CSV</label>
          <input id="csvInput" type="file" accept=".csv" onChange={onCsvSelected} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
        </div>
        {csvSummary && <p className="hint hint-small">{csvSummary}</p>}
      </section>

      {status && <div className={statusIsError ? "compfinder-error" : ""} id="compfinder-status">{status}</div>}

      {poolRun && stickers.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">Sticker prices — {poolRun}</span>
            <span className="badge2">
              {stickerCounts.priced} priced{stickerCounts.held ? ` · ${stickerCounts.held} held` : ""}
            </span>
          </div>
          <p className="hint">
            Cash-rounded from the recommended price — £1 steps to £20, £5 to £100, £10 above — because
            nobody hands 50p pieces across a table. A thin price is held back rather than printed: a
            sticker has no room for the caveat the screen would show next to it.{" "}
            <b>A price you set yourself is never held</b>, either way round — that is what the hold is
            asking for. Override the price on the results above and it rounds to the ladder like any
            other, because what you type there is an eBay price; type in the box here and it goes on
            the label exactly as typed, because here you are writing the label.
          </p>
          <div className="stack-list">
            {stickers.map((r, i) => (
              <div className="ps-row" key={i}>
                <span className="stack-sku">{r.sku || "—"}</span>
                <span className="stack-title" title={r.title}>{r.label || <em>—</em>}</span>
                {/* The price this sticker was rounded FROM — yours where you
                    set one on the result above, which is why it can differ
                    from what the run worked out. The sticker box to the right
                    is a different decision again: that one is the label. */}
                <span
                  className="hint-small"
                  style={{ color: r.pricedByHand ? "var(--accent-2)" : "var(--ink-faint)", flex: "none" }}
                  title={r.overriddenFromPence != null ? `You priced this card by hand — the app had £${(r.overriddenFromPence / 100).toFixed(2)}` : undefined}
                >
                  {r.recommendedPence != null ? `eBay £${(r.recommendedPence / 100).toFixed(2)}` : "no price"}
                </span>
                {r.held ? (
                  <span className="hint-small" style={{ color: "var(--warn-ink)", flex: "none" }} title={r.reason}>
                    held — {r.reason}
                  </span>
                ) : r.edited ? (
                  <span className="hint-small" style={{ color: "var(--accent-2)", flex: "none" }}>
                    set by hand
                  </span>
                ) : null}
                <label className="sd-sticker-edit" title="What goes on the label. Whole pounds — it is cash across a table.">
                  £
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={r.stickerPence != null ? Math.round(r.stickerPence / 100) : ""}
                    placeholder={r.suggestedPence != null ? String(Math.round(r.suggestedPence / 100)) : "—"}
                    onChange={(e) => setSticker(i, e.target.value)}
                    aria-label={`Sticker price for ${r.label || r.sku || "this card"}`}
                  />
                </label>
                {overrides[i] != null ? (
                  <button
                    className="stack-pull"
                    onClick={() => setSticker(i, "")}
                    title={r.suggestedPence != null ? `Back to the suggested £${Math.round(r.suggestedPence / 100)}` : "Back to held"}
                  >
                    ↺
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="results-toolbar" style={{ marginTop: 10 }}>
            <span className="hint-small">Name on the label</span>
            <div className="view-toggle" role="group" aria-label="How much of the card name fits the label">
              {Object.entries(NAME_LENGTHS).map(([key, len]) => (
                <button
                  key={key}
                  aria-pressed={nameMax === len}
                  onClick={() => saveNameMax(len)}
                  title={`Cut card names to ${len} characters`}
                >
                  {key === "short" ? "Short" : key === "medium" ? "Medium" : "Long"}
                </button>
              ))}
            </div>
            <span className="hint-small" style={{ color: "var(--ink-faint)" }}>
              {stickers.filter((r) => !r.held && r.label.endsWith("…")).length} name(s) cut to fit
            </span>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={applyingStickers || stickerCounts.priced === 0}
              onClick={applyStickers}
            >
              {applyingStickers ? "Saving…" : `Save ${stickerCounts.priced} sticker price${stickerCounts.priced === 1 ? "" : "s"} to the show desk`}
            </button>
            <button
              className="btn btn-ghost"
              disabled={stickerCounts.priced === 0}
              onClick={downloadLabelFile}
              title="Price and Name, as the Nimbot app imports it — one label per row"
            >
              ⬇ Label file (.xlsx)
            </button>
          </div>
          {stickerNotice ? <p className="hint hint-small sb-notice">{stickerNotice}</p> : null}
        </section>
      ) : null}

      <section className="panel results-panel">
        <div className="panel-head">
          <span className="eyebrow">Results</span>
          <div style={{ display: "flex", gap: 8 }}>
            {(() => {
              const pricedCount = results.filter((r) => effectivePence(r.rec) != null).length;
              return (
                <button className="btn btn-primary" disabled={pricedCount === 0} onClick={() => setShowBulkList(true)}>
                  🏷️ List on eBay{pricedCount ? ` (${pricedCount})` : ""}
                </button>
              );
            })()}
            {!openBatch && results.length > 0 ? (
              <button
                className="btn btn-ghost"
                disabled={savingBatch || running}
                onClick={saveCurrentRun}
                title="Keep this run — every comp and exclusion — so it can be re-opened without pricing it again"
              >
                {savingBatch ? "Saving…" : "💾 Save this run"}
              </button>
            ) : null}
            {csvRaw ? (
              <button
                className="btn btn-ghost"
                disabled={results.length === 0}
                onClick={exportEbayCsv}
                title="Your CardUploader CSV with our prices in it, ready for eBay Seller Hub → Reports"
              >
                ⬆ eBay upload CSV
              </button>
            ) : null}
            <button className="btn btn-ghost" disabled={results.length === 0} onClick={exportCsv}>Export CSV</button>
            <button
              className="btn btn-ghost"
              disabled={results.length === 0}
              onClick={downloadRun}
              title="Every comp behind every price, as JSON — the evidence under the CSV. About a megabyte; stays on your machine."
            >
              ⬇ Download this run
            </button>
          </div>
        </div>

        {showBulkList ? (
          <BulkListModal
            cards={results
              .filter((r) => effectivePence(r.rec) != null)
              .map((r) => ({
                baseTitle: r.title,
                name: (r.nameTokens && r.nameTokens.join(" ")) || r.title,
                number: r.cardNumber || "",
                set: r.set || "",
                sku: r.sku || "",
                // What actually goes on the listing. A card priced by hand
                // lists at your number, including one the app couldn't price
                // at all — which is half the reason to type one.
                pricePence: effectivePence(r.rec)
              }))}
            onClose={() => setShowBulkList(false)}
            onDone={() => {}}
          />
        ) : null}

        {results.length > 0 ? (
          <>
            {/* The whole point of the screen in one line. You cannot read 89
                notes; this says how many you have to. */}
            <p className="hint" style={{ marginBottom: ".5rem" }}>
              {needsReviewCount === 0 ? (
                <><strong>{results.length} priced, none needing a look.</strong> Nothing here disagreed with itself.</>
              ) : (
                <>
                  <strong>{results.length - needsReviewCount} ready to list</strong>
                  {" · "}
                  <button className="comps-toggle" onClick={() => setReviewFilter(reviewFilter === "needs" ? "" : "needs")}>
                    {needsReviewCount} need{needsReviewCount === 1 ? "s" : ""} a look
                  </button>
                  {askingCount ? <> · {askingCount} priced from asking prices</> : null}
                </>
              )}
            </p>
            <div className="results-toolbar">
              <input type="text" placeholder="Filter by title, SKU, or query…" value={resultsSearch} onChange={(e) => setResultsSearch(e.target.value)} />
              <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
                <option value="">All rows</option>
                <option value="needs">Needs a look ({needsReviewCount})</option>
                <option value="clear">Ready to list ({results.length - needsReviewCount})</option>
                <option value="asking">On asking prices ({askingCount})</option>
              </select>
              <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
                <option value="">All confidence</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">All exclusion reasons</option>
                {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className="hint-small">{filteredResults.length === results.length ? `${results.length} row(s)` : `${filteredResults.length} of ${results.length} row(s) shown`}</span>
              <div className="view-toggle" role="group" aria-label="Results view">
                <button aria-pressed={resultsView === "cards"} onClick={() => setResultsView("cards")}>▦ Cards</button>
                <button aria-pressed={resultsView === "table"} onClick={() => setResultsView("table")}>☰ Table</button>
              </div>
            </div>

            <label className="checkbox-field">
              <input type="checkbox" checked={showCurrentPrice} onChange={(e) => setShowCurrentPrice(e.target.checked)} />
              <span>Show current price &amp; highlight big changes</span>
            </label>

            {known ? (
              inStockCount > 0 ? (
                <label className="checkbox-field">
                  <input type="checkbox" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)} />
                  <span>
                    Only cards we already stock — <b>{inStockCount}</b> of {results.length} matched a live listing
                  </span>
                </label>
              ) : (
                <p className="hint hint-small">
                  None of these match a live listing (checked against {known.stock.size.toLocaleString()} of ours).
                </p>
              )
            ) : (
              <p className="hint hint-small">Checking against our own stock…</p>
            )}
          </>
        ) : null}

        {results.length === 0 ? (
          <p className="dd-empty">Run a search or upload a CSV to see priced results here — finished runs are saved for {RETENTION_DAYS} days and listed above.</p>
        ) : resultsView === "cards" ? (
          <div className="rc-grid rise-grid">
            {filteredResults.map(({ r, origIndex, known: k }) => (
              <ResultCard
                key={origIndex}
                r={r}
                known={k}
                showCurrentPrice={showCurrentPrice}
                active={activeByIndex[origIndex]}
                onCheckActive={() => fetchActiveFor(r, origIndex)}
                onDeepDive={deepDiveCard}
                onOverride={(pence) => setOverrideFor(origIndex, pence)}
              />
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table id="compfinder-results" className={showCurrentPrice ? "" : "hide-current-price"}>
              <thead>
                <tr>
                  <th>SKU</th><th>Title</th><th>Query used</th><th>Comps</th>
                  <th>Confidence</th><th>In stock</th><th>Current</th><th>Recommended</th><th>Active</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map(({ r, origIndex, known: k }) => (
                  <ResultRow
                    key={origIndex}
                    r={r}
                    known={k}
                    showCurrentPrice={showCurrentPrice}
                    active={activeByIndex[origIndex]}
                    onCheckActive={() => fetchActiveFor(r, origIndex)}
                    onOverride={(pence) => setOverrideFor(origIndex, pence)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      )}
        </main>
      </div>

      {/* Full navigation sheet (☰) — labelled modules + their sections */}
      {navSheet ? (
        <div className="navsheet-wrap" onClick={() => setNavSheet(false)}>
          <div className="navsheet" role="menu" aria-label="Navigate" onClick={(e) => e.stopPropagation()}>
            <div className="navsheet-h">Navigate</div>
            {MODULES.map((m) => {
              const multi = m.sections.length > 1;
              const active = currentModule.key === m.key;
              return (
                <div key={m.key}>
                  <button
                    className={`nav-i${active ? " on" : ""}`}
                    onClick={() => { if (!multi) nav(m.sections[0].key); }}
                  >
                    <span className="ic" aria-hidden="true"><Icon name={m.icon} size={19} /></span> {m.label}
                  </button>
                  {multi ? (
                    <div className="subs">
                      {m.sections.map((sec) => (
                        <button key={sec.key} className={`sub-i${stream === sec.key ? " on" : ""}`} onClick={() => nav(sec.key)}>
                          {sec.label}
                          {stream === sec.key ? <span className="tick" aria-hidden="true">✓</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Context menu (•••) — appearance + settings + sign out */}
      {ctxOpen ? (
        <>
          <div className="ctx-backdrop" onClick={() => setCtxOpen(false)} />
          <div className="ctxsheet" role="menu" aria-label="More">
            <div className="ctx-theme">
              <div className="ctx-theme-l">Appearance</div>
              <ThemeSeg />
            </div>
            <div className="ctx-theme">
              <div className="ctx-theme-l">Theme</div>
              <SkinPicker />
            </div>
            <div className="ctx-sep" />
            <a className="ctx-row" href="/settings"><span className="ic" aria-hidden="true">⚙</span> Settings</a>
            <a className="ctx-row" href="/history"><span className="ic" aria-hidden="true">🕘</span> History</a>
            <div className="ctx-sep" />
            <button className="ctx-row danger" onClick={handleSignOut}><span className="ic" aria-hidden="true">⎋</span> Sign out</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * One row of price history, from one priced card.
 *
 * Defined once because two things write it — the end of a run, and a price you
 * set by hand afterwards — and a history whose rows disagree about what
 * "recommended" means is a history nobody can read.
 *
 * `recommended_pence` is the EFFECTIVE price: the number actually gone with,
 * because that is what the column is for and what stockcheck.js reads back as
 * "last priced". The engine's figure is not lost — overrideNote() spells it
 * out in `note`, which the History screen already shows.
 */
function historyRecord({ userId, row, rec, ebaySite }) {
  const note = [overrideNote(rec), rec?.note || ""].filter(Boolean).join(" ");
  return {
    user_id: userId,
    title: row.title,
    sku: row.sku || null,
    query: row.query,
    ebay_site: ebaySite,
    data_source: rec?.dataSource ?? null,
    confidence: rec?.confidence ?? null,
    recommended_pence: effectivePence(rec),
    current_pence:
      row.csvItem && row.csvItem.startPrice ? Math.round(parseFloat(row.csvItem.startPrice) * 100) : null,
    comps_used: (rec?.included || []).length,
    comps_excluded: (rec?.excluded || []).length,
    note: note || null
  };
}

function countReasons(rec) {
  const counts = {};
  for (const e of rec.excluded) counts[e.exclusionReason] = (counts[e.exclusionReason] || 0) + 1;
  return counts;
}

/**
 * What we already know about this card: the live listing we have (if any) and
 * what we priced it at last time. Shown so a new copy goes up in line with the
 * one on the shelf instead of accidentally undercutting it.
 */
function KnownCell({ known, rec }) {
  const stock = known?.stock;
  const hist = known?.history;
  if (!stock && !hist) return <span className="hint-small">—</span>;
  const listed = stock?.match?.pricePence ?? null;
  const gap = priceGap(effectivePence(rec), listed);
  return (
    <span className="kn">
      {stock ? (
        <span
          className={`kn-chip${stock.ambiguous ? " kn-chip-amb" : ""}`}
          title={
            (stock.ambiguous
              ? `${stock.count} of our listings match this card — showing the first. `
              : "") + `Matched on ${stock.via === "sku" ? "SKU" : "card name & number"}: ${stock.match.title}`
          }
        >
          In stock{stock.count > 1 ? ` ×${stock.count}` : ""}
          {listed != null ? ` · ${CompFinderPricing.toPoundsStr(listed)}` : ""}
        </span>
      ) : null}
      {gap ? (
        <span className={`kn-gap ${gap.delta > 0 ? "up" : "down"}${gap.big ? " kn-gap-big" : ""}`}>
          {gap.delta > 0 ? "▲" : "▼"} {CompFinderPricing.toPoundsStr(Math.abs(gap.delta))} vs listed
        </span>
      ) : null}
      {hist ? (
        <span className="kn-hist" title={`Last priced ${String(hist.match.created_at).slice(0, 10)} — ${hist.match.title}`}>
          last {CompFinderPricing.toPoundsStr(hist.match.pricePence)}
        </span>
      ) : null}
    </span>
  );
}

function ResultRow({ r, known, showCurrentPrice, active, onCheckActive, onOverride }) {
  const [open, setOpen] = useState(false);
  if (!r.rec) {
    // A card the app couldn't price still gets a price box. It is the strongest
    // case for one: the row is going in a box with a label on it either way,
    // and the alternative to typing a number here is pricing it somewhere else
    // and losing the run's record of what you decided.
    return (
      <tr>
        <td>{r.sku}</td>
        <td><span className="rr-title">{r.title} <MarketLinks query={r.query || r.title} gameSlug="pokemon" /></span></td>
        <td>{r.query}</td><td>—</td>
        <td><span className="conf-badge conf-low">Skipped</span></td>
        <td><KnownCell known={known} rec={null} /></td>
        <td>—</td>
        <td><PriceOverride rec={null} onSet={onOverride} compact /></td>
        <td>—</td><td>{r.failed}</td>
      </tr>
    );
  }
  const rec = r.rec;
  const reasonCounts = countReasons(rec);
  const reasonBreakdown = Object.entries(reasonCounts).map(([reason, n]) => `${n} ${reason}`).join(", ");
  const compsCell = `${rec.included.length} used / ${rec.excluded.length} excluded` + (reasonBreakdown ? ` (${reasonBreakdown})` : "");
  const isActive = rec.dataSource === "active";
  const confidenceLabel = isActive ? `${rec.confidence} (active)` : rec.confidence;
  const verdict = reviewVerdict(rec);

  let currentCell = "—";
  let rowClass = "";
  if (showCurrentPrice && r.csvItem && r.csvItem.startPrice) {
    const currentPence = Math.round(parseFloat(r.csvItem.startPrice) * 100);
    currentCell = CompFinderPricing.toPoundsStr(currentPence);
    const pence = effectivePence(rec);
    if (pence != null && Math.abs(pence - currentPence) >= 300) rowClass = "compfinder-big-delta";
  }

  const canExpand = rec.included.length + rec.excluded.length > 0 || !!(active && active.rec);

  return (
    <>
      <tr className={rowClass}>
        <td>{r.sku}</td>
        <td><span className="rr-title">{r.title} <MarketLinks query={r.query || r.title} gameSlug="pokemon" /></span></td>
        <td>{r.query}</td>
        <td>
          {canExpand ? (
            <button type="button" className="comps-toggle" onClick={() => setOpen((o) => !o)}>
              <span className="comps-toggle-caret">{open ? "▾" : "▸"}</span> {compsCell}
            </button>
          ) : (
            compsCell
          )}
        </td>
        <td>
          {verdict.needsReview ? (
            <span className="review-badge" title={verdict.reasons.join("; ")}>⚑ Look</span>
          ) : (
            <span className={`conf-badge conf-${rec.confidence.toLowerCase()}${isActive ? " conf-badge-active" : ""}`}>{confidenceLabel}</span>
          )}
        </td>
        <td><KnownCell known={known} rec={rec} /></td>
        <td>{currentCell}</td>
        <td><PriceOverride rec={rec} onSet={onOverride} compact /></td>
        <td><ActiveCell active={active} soldRec={rec} onCheck={onCheckActive} /></td>
        <td>{[overrideNote(rec), rec.note].filter(Boolean).join(" ")}</td>
      </tr>
      {open && canExpand && (
        <tr className="comps-detail-row">
          <td colSpan={10}><CompsDetail rec={rec} active={active} /></td>
        </tr>
      )}
    </>
  );
}

function ResultCard({ r, known, showCurrentPrice, active, onCheckActive, onDeepDive, onOverride }) {
  const [open, setOpen] = useState(false);

  if (!r.rec) {
    return (
      <div className="rc rc-skip">
        <div className="rc-head">
          <span className="rc-title" title={r.title}>{r.title}</span>
          <span className="conf-badge conf-low">Skipped</span>
        </div>
        {r.sku ? <div className="rc-sku">SKU {r.sku}</div> : null}
        {r.failed ? <div className="rc-note">{r.failed}</div> : null}
        {/* See the note on the table's skipped row: a card with no price is
            the card most likely to need one typed. */}
        <div className="rc-prices">
          <div className="rc-pcell">
            <span className="k">Your price</span>
            <span className="v"><PriceOverride rec={null} onSet={onOverride} /></span>
          </div>
        </div>
      </div>
    );
  }

  const rec = r.rec;
  const mine = isOverridden(rec);
  const reasonCounts = countReasons(rec);
  const reasonBreakdown = Object.entries(reasonCounts).map(([reason, n]) => `${n} ${reason}`).join(", ");
  const compsCell = `${rec.included.length} used / ${rec.excluded.length} excluded` + (reasonBreakdown ? ` (${reasonBreakdown})` : "");
  const isActive = rec.dataSource === "active";
  const confidenceLabel = isActive ? `${rec.confidence} (active)` : rec.confidence;
  const verdict = reviewVerdict(rec);
  const canExpand = rec.included.length + rec.excluded.length > 0 || !!(active && active.rec);

  let currentPence = null;
  let bigDelta = false;
  if (showCurrentPrice && r.csvItem && r.csvItem.startPrice) {
    currentPence = Math.round(parseFloat(r.csvItem.startPrice) * 100);
    if (effectivePence(rec) != null && Math.abs(effectivePence(rec) - currentPence) >= 300) bigDelta = true;
  }
  const delta =
    currentPence != null && effectivePence(rec) != null ? effectivePence(rec) - currentPence : null;

  return (
    <div className={`rc${bigDelta ? " rc-big-delta" : ""}`}>
      <div className="rc-head">
        <span className="rc-title" title={r.title}>{r.title}</span>
        {verdict.needsReview ? <span className="review-badge" title={verdict.reasons.join("; ")}>⚑ Needs a look</span> : null}
        <span className={`conf-badge conf-${rec.confidence.toLowerCase()}${isActive ? " conf-badge-active" : ""}`}>{confidenceLabel}</span>
      </div>
      {verdict.needsReview ? <div className="review-why">{verdict.reasons.join(" · ")}</div> : null}
      {r.sku ? <div className="rc-sku">SKU {r.sku}</div> : null}
      {known?.stock || known?.history ? <div className="rc-known"><KnownCell known={known} rec={rec} /></div> : null}
      <div className="rc-q" title={r.query}>“{r.query}”</div>

      <div className="rc-prices">
        <div className="rc-pcell">
          <span className="k">{mine ? "Your price" : "Recommended"}</span>
          <span className="v big"><PriceOverride rec={rec} onSet={onOverride} /></span>
        </div>
        {currentPence != null ? (
          <div className="rc-pcell">
            <span className="k">Current</span>
            <span className="v">
              {CompFinderPricing.toPoundsStr(currentPence)}
              {delta ? <span className={`rc-delta ${delta > 0 ? "up" : "down"}`}>{delta > 0 ? "▲" : "▼"} {CompFinderPricing.toPoundsStr(Math.abs(delta))}</span> : null}
            </span>
          </div>
        ) : null}
        <div className="rc-pcell">
          <span className="k">Active</span>
          <span className="v"><ActiveCell active={active} soldRec={rec} onCheck={onCheckActive} /></span>
        </div>
      </div>

      {overrideNote(rec) ? <div className="rc-note rc-note-mine">{overrideNote(rec)}</div> : null}
      {rec.note ? <div className="rc-note">{rec.note}</div> : null}

      <div className="rc-foot">
        {canExpand ? (
          <button type="button" className="comps-toggle" onClick={() => setOpen((o) => !o)}>
            <span className="comps-toggle-caret">{open ? "▾" : "▸"}</span> {compsCell}
          </button>
        ) : (
          <span className="hint-small">{compsCell}</span>
        )}
        <MarketLinks query={r.query || r.title} gameSlug="pokemon" />
        {onDeepDive ? <button type="button" className="rc-dive" onClick={() => onDeepDive(r.title)}>Deep dive ↗</button> : null}
      </div>

      {open && canExpand ? <div className="rc-detail"><CompsDetail rec={rec} active={active} /></div> : null}
    </div>
  );
}

function ActiveCell({ active, soldRec, onCheck }) {
  if (!active) {
    return <button type="button" className="comps-toggle" onClick={onCheck}>Check</button>;
  }
  if (active.loading) return <span className="hint-small">…</span>;
  if (active.error) return <span className="loc-flag" title={active.error}>failed</span>;
  const rec = active.rec;
  if (!rec || rec.finalPence == null) return <span className="hint-small">none</span>;
  const val = CompFinderPricing.toPoundsStr(rec.finalPence);
  const n = rec.included.length;
  // Asking prices normally sit ABOVE recent sold, so this compares the gap,
  // not raw magnitude: an ask well above recent sold hints demand/prices
  // rising, an ask at or below recent sold hints the market is softening.
  let arrow = null;
  if (soldRec.finalPence != null) {
    if (rec.finalPence > soldRec.finalPence * 1.15) {
      arrow = <span className="conf-high" title="Asking prices well above recent sold — demand may be rising">▲</span>;
    } else if (rec.finalPence < soldRec.finalPence * 0.95) {
      arrow = <span className="conf-low" title="Asking prices at or below recent sold — market may be softening">▼</span>;
    }
  }
  return (
    <span title={`${n} active listing(s), median asking price`}>
      {val} {arrow} <span className="hint-small">({n})</span>
    </span>
  );
}

const EXCLUSION_LABELS = {
  nameMismatch: "Different card — name didn't match",
  variantMismatch: "Reverse-holo variant mismatch",
  graded: "Graded card",
  multiCardLot: "Multi-card lot",
  nonUkLocation: "Non-UK seller location",
  setMismatch: "Different set",
  priceOutlier: "Price outlier",
  highPostage: "High postage",
  catalogMismatch: "Different product (eBay catalog match)"
};

function exclusionLabel(reason) {
  if (!reason) return "—";
  if (EXCLUSION_LABELS[reason]) return EXCLUSION_LABELS[reason];
  // Fallback for keyword-category codes from settings.excludeKeywords —
  // prettify the camelCase/slug into something readable.
  return reason.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function compPriceStr(c) {
  const item = c.itemPricePence != null ? `£${(c.itemPricePence / 100).toFixed(2)}` : "—";
  const post = c.postagePence ? ` +£${(c.postagePence / 100).toFixed(2)} post` : "";
  return item + post;
}

function LocationCell({ loc }) {
  // A null/empty location is the app's signal for "UK-domestic" (see
  // splitByNonUkLocation in @compfinder/core/pricing.js), and any populated value is
  // treated as non-UK. Spelling both out makes it obvious at a glance
  // whether a comp was kept as UK or flagged as foreign — the exact thing
  // to eyeball when a known UK sale seems to have been wrongly dropped.
  if (loc) return <span className="loc-flag">{loc}</span>;
  return <span className="loc-uk">UK / domestic</span>;
}

function compSoldDate(c) {
  const d = c._source && c._source.endedAt;
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}

function TitleCell({ c }) {
  const url = c._source && c._source.url;
  if (url) {
    return (
      <a href={epnLink(url, { customId: "batch-comp" })} target="_blank" rel={relFor(url, "noopener noreferrer")}>
        {c.title}
      </a>
    );
  }
  return <>{c.title}</>;
}

function CompsDetail({ rec, active }) {
  const used = rec.included || [];
  const dropped = rec.excluded || [];
  const activeRec = active && active.rec;
  const activeListings = activeRec ? activeRec.included || [] : [];
  return (
    <div className="comps-detail">
      <div className="comps-detail-group">
        <span className="eyebrow eyebrow-small">Comps used ({used.length})</span>
        {used.length === 0 ? (
          <p className="hint hint-small">None — no comp survived the filters.</p>
        ) : (
          <div className="comps-mini-wrap">
            <table className="comps-mini">
              <thead>
                <tr><th>Price</th><th>Date sold</th><th>Location</th><th>Listing title</th></tr>
              </thead>
              <tbody>
                {used.map((c, i) => (
                  <tr key={i}>
                    <td>{compPriceStr(c)}</td>
                    <td>{compSoldDate(c)}</td>
                    <td><LocationCell loc={c.itemLocation} /></td>
                    <td><TitleCell c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="comps-detail-group">
        <span className="eyebrow eyebrow-small">Comps excluded ({dropped.length})</span>
        {dropped.length === 0 ? (
          <p className="hint hint-small">None.</p>
        ) : (
          <div className="comps-mini-wrap">
            <table className="comps-mini">
              <thead>
                <tr><th>Price</th><th>Date sold</th><th>Why excluded</th><th>Location</th><th>Listing title</th></tr>
              </thead>
              <tbody>
                {dropped.map((c, i) => (
                  <tr key={i}>
                    <td>{compPriceStr(c)}</td>
                    <td>{compSoldDate(c)}</td>
                    <td>{exclusionLabel(c.exclusionReason)}</td>
                    <td><LocationCell loc={c.itemLocation} /></td>
                    <td><TitleCell c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeRec && (
        <div className="comps-detail-group">
          <span className="eyebrow eyebrow-small">Active listings — asking prices ({activeListings.length})</span>
          {activeListings.length === 0 ? (
            <p className="hint hint-small">No active listings found for this query.</p>
          ) : (
            <>
              <p className="hint hint-small">{activeRec.note}</p>
              <div className="comps-mini-wrap">
                <table className="comps-mini">
                  <thead>
                    <tr><th>Asking price</th><th>Location</th><th>Listing title</th></tr>
                  </thead>
                  <tbody>
                    {activeListings.map((c, i) => (
                      <tr key={i}>
                        <td>{compPriceStr(c)}</td>
                        <td><LocationCell loc={c.itemLocation} /></td>
                        <td><TitleCell c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
