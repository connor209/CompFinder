"use client";

import dynamic from "next/dynamic";
import { navigate, inPlaceTarget, isPlainClick, NAV_EVENT } from "@/lib/client-nav.js";
import SectionTabs from "./SectionTabs";
import { useState, useCallback, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./icons";
import ThemeSeg from "./ThemeSeg";
import SkinPicker from "./SkinPicker";

/**
 * The panel shell: the menu, the section a URL names, and which screen is on
 * it. Nothing else lives here.
 *
 * It used to be ~4,000 lines because the Batch screen (later "Bulk pricing")
 * was written inline in it, with Imports and Arbitrage beside it. All three
 * were removed on 2026-11-26: new stock is priced in the lab (Add copies and
 * the pricing queue), a single card in Quick Search. /api/batch-comps, which
 * the lab prices through, is untouched.
 */


/**
 * Every screen is its own chunk, loaded the first time it is opened rather
 * than in one 460 kB bundle with the panel — and pre-fetched once the panel is
 * idle, and again on hover over its menu entry, so opening one is usually
 * instant anyway. The loaders are a map so the hover can name one.
 */
const SCREEN_LOADERS = {
  single: () => import("./QuickSearch"),
  inventory: () => import("./Inventory"),
  dashboard: () => import("./Dashboard"),
  sales: () => import("./Sales"),
  stacks: () => import("./Stacks"),
  pull: () => import("./PullSheet"),
  shows: () => import("./ShowDesk"),
  streamstock: () => import("./StreamStock"),
  cardmarket: () => import("./CardmarketStock"),
  showhistory: () => import("./ShowHistory"),
  sheets: () => import("./SellSheet"),
  buy: () => import("./Buy"),
  accounts: () => import("./Accounts"),
  browse: () => import("./Browse"),
  scan: () => import("./Scan"),
  lab: () => import("./lab/LabCopies"),
  labadd: () => import("./lab/add/LabAdd"),
  labinventory: () => import("./lab/inventory/LabInventory"),
  labsettings: () => import("./lab/settings/ListingSettings"),
};
function ScreenLoading() {
  return <div className="screen-loading" role="status"><span className="spinner" /> Loading…</div>;
}
const QuickSearch = dynamic(SCREEN_LOADERS.single, { loading: ScreenLoading });
const Inventory = dynamic(SCREEN_LOADERS.inventory, { loading: ScreenLoading });
const Dashboard = dynamic(SCREEN_LOADERS.dashboard, { loading: ScreenLoading });
const Sales = dynamic(SCREEN_LOADERS.sales, { loading: ScreenLoading });
const Stacks = dynamic(SCREEN_LOADERS.stacks, { loading: ScreenLoading });
const PullSheet = dynamic(SCREEN_LOADERS.pull, { loading: ScreenLoading });
const ShowDesk = dynamic(SCREEN_LOADERS.shows, { loading: ScreenLoading });
const StreamStock = dynamic(SCREEN_LOADERS.streamstock, { loading: ScreenLoading });
const CardmarketStock = dynamic(SCREEN_LOADERS.cardmarket, { loading: ScreenLoading });
const ShowHistory = dynamic(SCREEN_LOADERS.showhistory, { loading: ScreenLoading });
const SellSheet = dynamic(SCREEN_LOADERS.sheets, { loading: ScreenLoading });
const Buy = dynamic(SCREEN_LOADERS.buy, { loading: ScreenLoading });
const Accounts = dynamic(SCREEN_LOADERS.accounts, { loading: ScreenLoading });
const Browse = dynamic(SCREEN_LOADERS.browse, { loading: ScreenLoading });
const Scan = dynamic(SCREEN_LOADERS.scan, { loading: ScreenLoading });
const LabCopies = dynamic(SCREEN_LOADERS.lab, { loading: ScreenLoading });
const LabAdd = dynamic(SCREEN_LOADERS.labadd, { loading: ScreenLoading });
const LabInventory = dynamic(SCREEN_LOADERS.labinventory, { loading: ScreenLoading });
const ListingSettings = dynamic(SCREEN_LOADERS.labsettings, { loading: ScreenLoading });

/**
 * Screens kept on the page after you leave them, so coming back is instant and
 * keeps where you were — for a while (KEEP_ALIVE_MS), then they are opened
 * fresh. Only screens where an old view can't cost a card: reports and
 * searches. Everything that says where stock IS or acts on it — My listings,
 * Stacks, the pull sheet, the Show Desk, the stream box, Cardmarket stock and
 * the lab — always opens fresh, because a Stacks view from before the pull
 * sheet was committed sends you to the wrong card. Scan is out because a
 * hidden camera is still a camera.
 */
const KEEP_ALIVE = new Set(["dashboard", "single", "sales", "accounts", "showhistory", "browse"]);
const KEEP_ALIVE_MS = 10 * 60 * 1000;

// Section <-> URL slug mapping so each stream has its own /panel/<slug>.
const STREAM_SLUG = {
  dashboard: "dashboard",
  single: "search",
  scan: "scan",
  browse: "browse",
  buy: "buy",
  inventory: "listings",
  sales: "sales",
  stacks: "stacks",
  pull: "pull",
  shows: "shows",
  showhistory: "show-history",
  streamstock: "stream-stock",
  sheets: "sheets",
  cardmarket: "cardmarket",
  // The lab keeps its own routes (/panel/lab/…); each renders this shell with
  // the lab screen inside, so the nav is there and the URLs don't change.
  lab: "lab",
  labadd: "lab/add",
  labinventory: "lab/inventory",
  labsettings: "lab/settings",
  accounts: "accounts"
};
const SLUG_STREAM = Object.fromEntries(Object.entries(STREAM_SLUG).map(([k, v]) => [v, k]));

// Sections grouped into modules for the two-level nav. `desc` is the one-line
// contextual description shown on hover (as a rail tooltip for single-section
// modules, and as a subtitle in the flyout for multi-section ones).
const MODULES = [
  { key: "dashboard", label: "Dashboard", icon: "home", desc: "Your portfolio & activity at a glance", sections: [{ key: "dashboard", label: "Dashboard" }] },
  {
    key: "lab",
    label: "Lab",
    icon: "flask",
    // Second, after the dashboard: the lab is where new stock comes in, gets
    // priced and goes on eBay, so it is the module to find first.
    desc: "One listing per card, every copy behind it",
    sections: [
      { key: "lab", label: "Overview", desc: "Where every batch and card is, and sales from eBay" },
      { key: "labadd", label: "Batches", desc: "Load CardUploader exports, price them and list" },
      { key: "labinventory", label: "Inventory", desc: "Lab listings and their copies" },
      { key: "labsettings", label: "Listing settings", desc: "How lab listings are written" }
    ]
  },
  {
    key: "pricing",
    label: "Pricing",
    icon: "search",
    desc: "Price one card by search or camera",
    sections: [
      { key: "single", label: "Quick search", desc: "Price a single card fast" },
      { key: "scan", label: "Scan", desc: "Point your camera to price instantly" }
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
      { key: "shows", label: "Show desk", desc: "Check stock out to shows & back in" },
      { key: "showhistory", label: "Show history", desc: "Sell-through and takings, show by show" },
      { key: "streamstock", label: "Stream stock", desc: "Pick, pull and rotate the eBay Live box" }
    ]
  },
  {
    key: "sheets",
    label: "Cardmarket",
    icon: "sheet",
    desc: "Sell sheets and the Magic chaos sort",
    sections: [
      { key: "sheets", label: "Sell sheets", desc: "Build CSV imports for Cardmarket listing tools" },
      { key: "cardmarket", label: "Cardmarket stock", desc: "Load the MTG boxes and pick the day's orders" }
    ]
  },

  { key: "accounts", label: "Accounts", icon: "chart", desc: "Profit & loss and tax-ready reports", sections: [{ key: "accounts", label: "P&L" }] }
];
const moduleForStream = (s) => MODULES.find((m) => m.sections.some((sec) => sec.key === s)) || MODULES[0];

export default function Panel({ initialSection = "dashboard" }) {
  const [stream, setStream] = useState(SLUG_STREAM[initialSection] || "dashboard");
  const [openModule, setOpenModule] = useState(null);
  const [navSheet, setNavSheet] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [seed, setSeed] = useState(null);
  const seedNonce = useRef(0);
  const pathname = usePathname();

  // Navigate a section: update state + the URL so each has a distinct page.
  // In place, not a router.push: no server round trip and no remount (see
  // lib/client-nav.js). The URL still changes, so Back, reload and a shared
  // link all land on the same section.
  const go = useCallback((s) => {
    navigate(`/panel/${STREAM_SLUG[s] || "dashboard"}`);
    setStream(s);
  }, []);

  // Navigate + close any open nav overlay (rail flyout / full sheet / context).
  const nav = useCallback((s) => {
    go(s);
    setOpenModule(null);
    setNavSheet(false);
    setCtxOpen(false);
  }, [go]);

  // A navigation in place: screens that read the URL at mount (the lab's
  // batch, a new batch) are keyed on this, so a new URL is a fresh screen.
  const [navCount, setNavCount] = useState(0);
  useEffect(() => {
    const bump = () => setNavCount((n) => n + 1);
    window.addEventListener(NAV_EVENT, bump);
    window.addEventListener("popstate", bump);
    return () => { window.removeEventListener(NAV_EVENT, bump); window.removeEventListener("popstate", bump); };
  }, []);

  // Any ordinary link to a panel page — the lab's tabs, a batch tile, a
  // screen's "open the pull sheet" — is switched in place rather than
  // reloading the whole app. A link the server has to answer (?wish), a new
  // tab, a modified click or another site
  // is left to the browser. Only a path that names a known section is taken.
  useEffect(() => {
    const onClick = (e) => {
      if (!isPlainClick(e)) return;
      const a = e.target?.closest?.("a[href]");
      const url = inPlaceTarget(a, window.location.origin);
      if (!url) return;
      const parts = url.split(/[?#]/)[0].replace(/^\/panel\/?/, "").split("/");
      const st = SLUG_STREAM[parts.slice(0, 2).join("/")] || SLUG_STREAM[parts[0] || "dashboard"];
      if (!st) return;
      e.preventDefault();
      if (navigate(url)) setStream(st);
      else setNavCount((n) => n + 1);
      setOpenModule(null);
      setNavSheet(false);
      setCtxOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Fetch every screen's code once the panel has settled, so the first visit
  // to each is as quick as the rest. Idle time only; a failure is ignored (the
  // screen just loads when opened).
  useEffect(() => {
    const warm = () => Object.values(SCREEN_LOADERS).forEach((load) => { load().catch(() => {}); });
    const id = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(warm, { timeout: 5000 }) : window.setTimeout(warm, 3000);
    return () => (typeof window.cancelIdleCallback === "function" ? window.cancelIdleCallback(id) : window.clearTimeout(id));
  }, []);

  // Screens kept alive after you leave them (KEEP_ALIVE): when each was left,
  // and a generation that is bumped to open one fresh once it has been away
  // longer than KEEP_ALIVE_MS.
  const [kept, setKept] = useState({});
  const prevStream = useRef(stream);
  useEffect(() => {
    const was = prevStream.current;
    prevStream.current = stream;
    if (was === stream) return;
    setKept((k) => {
      const next = { ...k };
      if (KEEP_ALIVE.has(was)) next[was] = { gen: k[was]?.gen || 0, leftAt: Date.now() };
      const back = next[stream];
      if (back && back.leftAt && Date.now() - back.leftAt > KEEP_ALIVE_MS) next[stream] = { gen: back.gen + 1, leftAt: null };
      else if (back) next[stream] = { ...back, leftAt: null };
      return next;
    });
  }, [stream]);
  /** A screen: always while it is the current one; kept, hidden, after it if it may be. */
  const screen = (key, node) => {
    const here = stream === key;
    if (!KEEP_ALIVE.has(key)) return here ? node : null;
    if (!here && !kept[key]) return null;
    return (
      <div key={`${key}-${kept[key]?.gen || 0}`} style={{ display: here ? "contents" : "none" }} aria-hidden={here ? undefined : true}>
        {node}
      </div>
    );
  };

  // Keep the active section in sync with the URL (back/forward, direct links).
  useEffect(() => {
    const parts = (pathname || "").replace(/^\/panel\/?/, "").split("/");
    // Two-segment slugs (lab/add) first, so /panel/lab/add isn't read as the lab overview.
    const st = SLUG_STREAM[parts.slice(0, 2).join("/")] || SLUG_STREAM[parts[0] || "dashboard"];
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
  // The payload is stashed in sessionStorage as well as React state. Section
  // changes no longer remount the panel (lib/client-nav.js), so the seed prop
  // reaches Quick Search directly; sessionStorage still covers a reload, and
  // Quick Search reads the seed by its nonce, so a kept-alive one hears a new
  // deep dive too.
  const deepDiveCard = useCallback((query, opts = {}) => {
    seedNonce.current += 1;
    const payload = { query, nonce: seedNonce.current, game: opts.game || null, card: opts.card || null };
    try { sessionStorage.setItem("cf-deepdive", JSON.stringify(payload)); } catch { /* private mode */ }
    setSeed(payload);
    navigate(`/panel/${STREAM_SLUG.single}`);
    setStream("single");
  }, []);

  const currentModule = moduleForStream(stream);


  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
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
                      <button key={sec.key} role="menuitem" className={stream === sec.key ? "on" : ""} onClick={() => nav(sec.key)} onMouseEnter={() => SCREEN_LOADERS[sec.key]?.().catch(() => {})} title={sec.desc || undefined}>
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
      {(() => {
        // The module's tabs over the screen (SectionTabs.js). The lab draws its
        // own (LabHeader, the same strip), and a one-screen module has nothing
        // to switch between.
        const m = moduleForStream(stream);
        if (m.key === "lab" || m.sections.length < 2) return null;
        const sec = m.sections.find((x) => x.key === stream);
        return (
          <SectionTabs
            label={m.label}
            current={stream}
            desc={sec?.desc}
            tabs={m.sections.map((x) => ({ key: x.key, label: x.label, href: `/panel/${STREAM_SLUG[x.key] || x.key}` }))}
          />
        );
      })()}
      {screen("dashboard", <Dashboard onNavigate={go} />)}
      {screen("single", <QuickSearch seed={seed} />)}
      {stream === "scan" && <Scan onDeepDive={deepDiveCard} />}
      {stream === "inventory" && <Inventory onDeepDive={deepDiveCard} />}
      {screen("sales", <Sales />)}
      {stream === "stacks" && <Stacks />}
      {stream === "pull" && <PullSheet />}
      {stream === "shows" && <ShowDesk />}
      {screen("showhistory", <ShowHistory />)}
      {stream === "streamstock" && <StreamStock />}
      {stream === "sheets" && <SellSheet />}
      {stream === "cardmarket" && <CardmarketStock />}
      {stream === "buy" && <Buy />}
      {screen("browse", <Browse onDeepDive={deepDiveCard} />)}
      {screen("accounts", <Accounts />)}
      {stream === "lab" && <LabCopies key={`lab-${navCount}`} />}
      {stream === "labadd" && <LabAdd key={`labadd-${navCount}`} />}
      {stream === "labinventory" && <LabInventory key={`labinv-${navCount}`} />}
      {stream === "labsettings" && <ListingSettings key={`labset-${navCount}`} />}
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
