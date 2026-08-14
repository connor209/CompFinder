"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";
import CardUploaderCsv from "@/lib/carduploader.js";
import QuickSearch from "./QuickSearch";
import Inventory from "./Inventory";
import Arbitrage from "./Arbitrage";
import Dashboard from "./Dashboard";
import Sales from "./Sales";
import Stacks from "./Stacks";
import PullSheet from "./PullSheet";
import Buy from "./Buy";
import Accounts from "./Accounts";
import Browse from "./Browse";
import Scan from "./Scan";
import BulkListModal from "./BulkListModal";
import ThemeSeg from "./ThemeSeg";

const LOCAL_BUDGET_KEY = "compfinder_soldcomps_budget";

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
  accounts: "accounts"
};
const SLUG_STREAM = Object.fromEntries(Object.entries(STREAM_SLUG).map(([k, v]) => [v, k]));

// Sections grouped into modules for the two-level nav. `desc` is the one-line
// contextual description shown on hover (as a rail tooltip for single-section
// modules, and as a subtitle in the flyout for multi-section ones).
const MODULES = [
  { key: "dashboard", label: "Dashboard", icon: "🏠", desc: "Your portfolio & activity at a glance", sections: [{ key: "dashboard", label: "Dashboard" }] },
  {
    key: "pricing",
    label: "Pricing",
    icon: "🔍",
    desc: "Search, scan or batch-price cards",
    sections: [
      { key: "single", label: "Quick Search", desc: "Price a single card fast" },
      { key: "scan", label: "Scan", desc: "Point your camera to price instantly" },
      { key: "batch", label: "Batch", desc: "Price a whole list or CSV at once" }
    ]
  },
  { key: "browse", label: "Browse", icon: "📚", desc: "Explore every game, set & card", sections: [{ key: "browse", label: "Browse" }] },
  { key: "buy", label: "Buy", icon: "🛒", desc: "Log deals & purchases you take in", sections: [{ key: "buy", label: "Buy" }] },
  {
    key: "ebay",
    label: "eBay",
    icon: "🏷️",
    desc: "List, sell & fulfil on eBay",
    sections: [
      { key: "inventory", label: "My listings", desc: "Your live eBay listings & repricing" },
      { key: "sales", label: "Sales", desc: "Completed sales, fees & profit" },
      { key: "stacks", label: "Stacks", desc: "Group inventory into sellable stacks" },
      { key: "pull", label: "Pull sheet", desc: "Pick & pack the day's orders" }
    ]
  },
  { key: "accounts", label: "Accounts", icon: "📒", desc: "Profit & loss and tax-ready reports", sections: [{ key: "accounts", label: "P&L" }] },
  { key: "arbitrage", label: "Arbitrage", icon: "📊", desc: "Spot underpriced buying opportunities", sections: [{ key: "arbitrage", label: "Arbitrage" }] }
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
  const nameTokens = CompFinderPricing.extractNameTokens(baseQuery);
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

export default function Panel({ initialSection = "dashboard" }) {
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
  const deepDiveCard = useCallback((query, opts = {}) => {
    seedNonce.current += 1;
    setSeed({ query, nonce: seedNonce.current, game: opts.game || null, card: opts.card || null });
    go("single");
  }, [go]);

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
  const [reasonFilter, setReasonFilter] = useState("");
  const [showCurrentPrice, setShowCurrentPrice] = useState(false);
  const [resultsView, setResultsView] = useState("cards");

  const settings = CompFinderPricing.DEFAULT_SETTINGS;

  const onCsvSelected = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
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
        runBatch(loaded);
      } catch (err) {
        setCsvSummary(`Could not read CSV: ${err.message}`);
        setCsvItems(null);
      }
    };
    reader.readAsText(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const response = await fetch("/api/soldcomps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, options: opts })
      }).then((r) => r.json());

      if (response && response.ok) {
        const next = incrementLocalBudget();
        setBudget(next);
        return response;
      }

      if (response && response.isRateLimited && attempt < 2) {
        attempt++;
        if (onRetry) onRetry(attempt, 2000 * attempt);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      const next = incrementLocalBudget();
      setBudget(next);
      const e = new Error((response && response.error) || "Unknown error calling SoldComps.");
      e.isAuthError = response && response.isAuthError;
      e.isQuotaExceeded = response && response.isQuotaExceeded;
      throw e;
    }
  }

  async function runBatch(items) {
    if (!items || items.length === 0) {
      setStatus("Paste at least one title, or upload a CSV, first.");
      setStatusIsError(true);
      return;
    }

    setRunning(true);
    setResults([]);
    setActiveByIndex({});
    let consecutiveFailures = 0;
    let stoppedEarly = false;
    let stopReason = "";
    const collected = [];

    const searchOptions = { ebaySite, itemLocation, itemCondition, minPrice: minPrice || null, maxPrice: maxPrice || null, soldAfterDays: Number(soldWithin) };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const { title, sku } = item;

      setStatus(`Pricing ${i + 1} of ${items.length}: "${title}"`);
      const { query, nameTokens, set, csvItem, cardNumber } = buildQueryForItem(item, settings, includeCondition, useFullTitle);

      let soldComps, apiDiagnostic;
      try {
        const result = await fetchSoldCompsWithRetry(query, searchOptions, (attempt, delay) =>
          setStatus(`Item ${i + 1} of ${items.length}: SoldComps rate limit — retry ${attempt} in ${Math.round(delay / 1000)}s…`)
        );
        soldComps = result.comps;
        if (result.comps.length === 0) {
          apiDiagnostic =
            result.rawItemCount > 0
              ? `SoldComps returned ${result.rawItemCount} raw result(s) but all ${result.skippedWrongCurrency} were filtered as non-GBP (saw: ${result.currenciesSeen.join(", ") || "unknown"}).`
              : `SoldComps returned 0 raw results for this exact query.`;
        }
        consecutiveFailures = 0;
      } catch (err) {
        if (err.isAuthError || err.isQuotaExceeded) {
          stoppedEarly = true;
          stopReason = `Stopped at item ${i + 1} of ${items.length} — ${err.message}`;
          collected.push({ title, sku, query, csvItem, rec: null, failed: err.message });
          setResults([...collected]);
          setStatus(stopReason);
          setStatusIsError(true);
          break;
        }
        consecutiveFailures++;
        collected.push({ title, sku, query, csvItem, rec: null, failed: err.message });
        setResults([...collected]);
        setStatus(`Item ${i + 1} of ${items.length}: ${err.message}`);
        setStatusIsError(true);
        if (consecutiveFailures >= settings.maxConsecutiveFailures) {
          stoppedEarly = true;
          stopReason = `Stopped after ${consecutiveFailures} failures in a row (item ${i + 1} of ${items.length}).`;
          setStatus(stopReason);
          break;
        }
        await new Promise((r) => setTimeout(r, settings.interItemDelayMs));
        continue;
      }

      let rec = CompFinderPricing.recommend(soldComps, settings, nameTokens, "sold", cardNumber, set);
      if (apiDiagnostic) rec.note = apiDiagnostic;

      if (rec.included.length === 0) {
        // No sold comps — fall back to SoldComps' own active-listings mode
        // (sold=false, confirmed in their docs) instead of the old Terapeak
        // bridge. No tab, no message-passing, just a second API call.
        setStatus(`Item ${i + 1} of ${items.length}: no sold comps for "${query}" — checking active listings…`);
        try {
          const activeResult = await fetchSoldCompsWithRetry(query, { ...searchOptions, sold: false });
          const activeRec = CompFinderPricing.recommend(activeResult.comps, settings, nameTokens, "active", cardNumber, set);
          if (activeRec.included.length > 0) rec = activeRec;
          else rec.note = `No sold or active comps found after exclusions — no price forced.${apiDiagnostic ? " " + apiDiagnostic : ""}`;
        } catch (err) {
          rec.note += ` (Active-listing fallback also failed: ${err.message})`;
        }
      }

      collected.push({ title, sku, query, csvItem, rec, nameTokens, set, cardNumber });
      setResults([...collected]);

      if (i < items.length - 1) await new Promise((r) => setTimeout(r, Math.min(settings.interItemDelayMs, 1200)));
    }

    setRunning(false);
    saveHistory(collected);
    const failedCount = collected.filter((r) => r.failed).length;
    if (!stoppedEarly) {
      setStatus(`Done — ${collected.length} of ${items.length} item(s) processed` + (failedCount ? `, ${failedCount} failed.` : "."));
      setStatusIsError(false);
    }

    // Opt-in: fetch active (asking-price) listings for every priced item too.
    // Off by default because it's a second API call per item (~2× quota).
    if (fetchActiveAlways && !stoppedEarly) {
      for (let i = 0; i < collected.length; i++) {
        if (collected[i].rec) await fetchActiveFor(collected[i], i);
      }
    }
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
      const activeResult = await fetchSoldCompsWithRetry(result.query, activeOptions);
      const activeRec = CompFinderPricing.recommend(
        activeResult.comps,
        settings,
        result.nameTokens || null,
        "active",
        result.cardNumber || null,
        result.set || null
      );
      setActiveByIndex((m) => ({ ...m, [index]: { loading: false, rec: activeRec } }));
    } catch (err) {
      setActiveByIndex((m) => ({ ...m, [index]: { loading: false, error: err.message } }));
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

      const records = priced.map((r) => ({
        user_id: user.id,
        title: r.title,
        sku: r.sku || null,
        query: r.query,
        ebay_site: ebaySite,
        data_source: r.rec.dataSource,
        confidence: r.rec.confidence,
        recommended_pence: r.rec.finalPence ?? null,
        current_pence:
          r.csvItem && r.csvItem.startPrice ? Math.round(parseFloat(r.csvItem.startPrice) * 100) : null,
        comps_used: r.rec.included.length,
        comps_excluded: r.rec.excluded.length,
        note: r.rec.note || null
      }));

      const { error } = await supabase.from("price_checks").insert(records);
      if (error) console.warn("Could not save price history:", error.message);
    } catch (err) {
      console.warn("Could not save price history:", err.message);
    }
  }

  function getPastedItems() {
    return pastedText
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((title) => ({ sku: "", title, source: "paste" }));
  }

  function exportCsv() {
    const header = "SKU,Title,Simplified Query,Comps Used,Comps Excluded,Data Source,Confidence,Current Price,Recommended Price,Note\n";
    const rows = results.map((r) => {
      const currentPrice = r.csvItem && r.csvItem.startPrice ? r.csvItem.startPrice : "";
      if (!r.rec) {
        return [r.sku || "", r.title, r.query, "", "", "", "Skipped", currentPrice, "", r.failed]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
      }
      const price = r.rec.finalPence != null ? (r.rec.finalPence / 100).toFixed(2) : "";
      return [r.sku || "", r.title, r.query, r.rec.included.length, r.rec.excluded.length, r.rec.dataSource, r.rec.confidence, currentPrice, price, r.rec.note]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
    });
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compfinder-prices-${new Date().toISOString().slice(0, 10)}.csv`;
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
  const filteredResults = results
    .map((r, origIndex) => ({ r, origIndex }))
    .filter(({ r }) => {
      const searchText = `${r.sku} ${r.title} ${r.query}`.toLowerCase();
      const matchesSearch = !resultsSearch || searchText.includes(resultsSearch.toLowerCase());
      const confidence = r.rec ? r.rec.confidence : "Low";
      const matchesConfidence = !confidenceFilter || confidence === confidenceFilter;
      const reasons = r.rec ? Object.keys(countReasons(r.rec)) : [];
      const matchesReason = !reasonFilter || reasons.includes(reasonFilter);
      return matchesSearch && matchesConfidence && matchesReason;
    });

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
                  <span className="rail-ic" aria-hidden="true">{m.icon}</span>
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
      {stream === "buy" && <Buy />}
      {stream === "browse" && <Browse onDeepDive={deepDiveCard} />}
      {stream === "accounts" && <Accounts />}
      {stream === "batch" && (
        <>
      <div className="status-strip">
        <span className="chip">{`SoldComps: ${budget.count} this month (local estimate)`}</span>
      </div>

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

      <section className="panel results-panel">
        <div className="panel-head">
          <span className="eyebrow">Results</span>
          <div style={{ display: "flex", gap: 8 }}>
            {(() => {
              const pricedCount = results.filter((r) => r.rec && r.rec.finalPence != null).length;
              return (
                <button className="btn btn-primary" disabled={pricedCount === 0} onClick={() => setShowBulkList(true)}>
                  🏷️ List on eBay{pricedCount ? ` (${pricedCount})` : ""}
                </button>
              );
            })()}
            <button className="btn btn-ghost" disabled={results.length === 0} onClick={exportCsv}>Export CSV</button>
          </div>
        </div>

        {showBulkList ? (
          <BulkListModal
            cards={results
              .filter((r) => r.rec && r.rec.finalPence != null)
              .map((r) => ({
                baseTitle: r.title,
                name: (r.nameTokens && r.nameTokens.join(" ")) || r.title,
                number: r.cardNumber || "",
                set: r.set || "",
                sku: r.sku || "",
                pricePence: r.rec.finalPence
              }))}
            onClose={() => setShowBulkList(false)}
            onDone={() => {}}
          />
        ) : null}

        <div className="results-toolbar">
          <input type="text" placeholder="Filter by title, SKU, or query…" value={resultsSearch} onChange={(e) => setResultsSearch(e.target.value)} />
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

        {results.length === 0 ? (
          <p className="dd-empty">Run a search or upload a CSV to see priced results here.</p>
        ) : resultsView === "cards" ? (
          <div className="rc-grid rise-grid">
            {filteredResults.map(({ r, origIndex }) => (
              <ResultCard
                key={origIndex}
                r={r}
                showCurrentPrice={showCurrentPrice}
                active={activeByIndex[origIndex]}
                onCheckActive={() => fetchActiveFor(r, origIndex)}
                onDeepDive={deepDiveCard}
              />
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table id="compfinder-results" className={showCurrentPrice ? "" : "hide-current-price"}>
              <thead>
                <tr>
                  <th>SKU</th><th>Title</th><th>Query used</th><th>Comps</th>
                  <th>Confidence</th><th>Current</th><th>Recommended</th><th>Active</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map(({ r, origIndex }) => (
                  <ResultRow
                    key={origIndex}
                    r={r}
                    showCurrentPrice={showCurrentPrice}
                    active={activeByIndex[origIndex]}
                    onCheckActive={() => fetchActiveFor(r, origIndex)}
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
                    <span className="ic" aria-hidden="true">{m.icon}</span> {m.label}
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

function countReasons(rec) {
  const counts = {};
  for (const e of rec.excluded) counts[e.exclusionReason] = (counts[e.exclusionReason] || 0) + 1;
  return counts;
}

function ResultRow({ r, showCurrentPrice, active, onCheckActive }) {
  const [open, setOpen] = useState(false);
  if (!r.rec) {
    return (
      <tr>
        <td>{r.sku}</td><td>{r.title}</td><td>{r.query}</td><td>—</td>
        <td><span className="conf-badge conf-low">Skipped</span></td>
        <td>—</td><td>—</td><td>—</td><td>{r.failed}</td>
      </tr>
    );
  }
  const rec = r.rec;
  const priceStr = rec.finalPence != null ? CompFinderPricing.toPoundsStr(rec.finalPence) : "—";
  const reasonCounts = countReasons(rec);
  const reasonBreakdown = Object.entries(reasonCounts).map(([reason, n]) => `${n} ${reason}`).join(", ");
  const compsCell = `${rec.included.length} used / ${rec.excluded.length} excluded` + (reasonBreakdown ? ` (${reasonBreakdown})` : "");
  const isActive = rec.dataSource === "active";
  const confidenceLabel = isActive ? `${rec.confidence} (active)` : rec.confidence;

  let currentCell = "—";
  let rowClass = "";
  if (showCurrentPrice && r.csvItem && r.csvItem.startPrice) {
    const currentPence = Math.round(parseFloat(r.csvItem.startPrice) * 100);
    currentCell = CompFinderPricing.toPoundsStr(currentPence);
    if (rec.finalPence != null && Math.abs(rec.finalPence - currentPence) >= 300) rowClass = "compfinder-big-delta";
  }

  const canExpand = rec.included.length + rec.excluded.length > 0 || !!(active && active.rec);

  return (
    <>
      <tr className={rowClass}>
        <td>{r.sku}</td><td>{r.title}</td><td>{r.query}</td>
        <td>
          {canExpand ? (
            <button type="button" className="comps-toggle" onClick={() => setOpen((o) => !o)}>
              <span className="comps-toggle-caret">{open ? "▾" : "▸"}</span> {compsCell}
            </button>
          ) : (
            compsCell
          )}
        </td>
        <td><span className={`conf-badge conf-${rec.confidence.toLowerCase()}${isActive ? " conf-badge-active" : ""}`}>{confidenceLabel}</span></td>
        <td>{currentCell}</td><td>{priceStr}</td>
        <td><ActiveCell active={active} soldRec={rec} onCheck={onCheckActive} /></td>
        <td>{rec.note}</td>
      </tr>
      {open && canExpand && (
        <tr className="comps-detail-row">
          <td colSpan={9}><CompsDetail rec={rec} active={active} /></td>
        </tr>
      )}
    </>
  );
}

function ResultCard({ r, showCurrentPrice, active, onCheckActive, onDeepDive }) {
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
      </div>
    );
  }

  const rec = r.rec;
  const priceStr = rec.finalPence != null ? CompFinderPricing.toPoundsStr(rec.finalPence) : "—";
  const reasonCounts = countReasons(rec);
  const reasonBreakdown = Object.entries(reasonCounts).map(([reason, n]) => `${n} ${reason}`).join(", ");
  const compsCell = `${rec.included.length} used / ${rec.excluded.length} excluded` + (reasonBreakdown ? ` (${reasonBreakdown})` : "");
  const isActive = rec.dataSource === "active";
  const confidenceLabel = isActive ? `${rec.confidence} (active)` : rec.confidence;
  const canExpand = rec.included.length + rec.excluded.length > 0 || !!(active && active.rec);

  let currentPence = null;
  let bigDelta = false;
  if (showCurrentPrice && r.csvItem && r.csvItem.startPrice) {
    currentPence = Math.round(parseFloat(r.csvItem.startPrice) * 100);
    if (rec.finalPence != null && Math.abs(rec.finalPence - currentPence) >= 300) bigDelta = true;
  }
  const delta = currentPence != null && rec.finalPence != null ? rec.finalPence - currentPence : null;

  return (
    <div className={`rc${bigDelta ? " rc-big-delta" : ""}`}>
      <div className="rc-head">
        <span className="rc-title" title={r.title}>{r.title}</span>
        <span className={`conf-badge conf-${rec.confidence.toLowerCase()}${isActive ? " conf-badge-active" : ""}`}>{confidenceLabel}</span>
      </div>
      {r.sku ? <div className="rc-sku">SKU {r.sku}</div> : null}
      <div className="rc-q" title={r.query}>“{r.query}”</div>

      <div className="rc-prices">
        <div className="rc-pcell">
          <span className="k">Recommended</span>
          <span className="v big">{priceStr}</span>
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

      {rec.note ? <div className="rc-note">{rec.note}</div> : null}

      <div className="rc-foot">
        {canExpand ? (
          <button type="button" className="comps-toggle" onClick={() => setOpen((o) => !o)}>
            <span className="comps-toggle-caret">{open ? "▾" : "▸"}</span> {compsCell}
          </button>
        ) : (
          <span className="hint-small">{compsCell}</span>
        )}
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
  // splitByNonUkLocation in lib/pricing.js), and any populated value is
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
      <a href={url} target="_blank" rel="noopener noreferrer">
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
