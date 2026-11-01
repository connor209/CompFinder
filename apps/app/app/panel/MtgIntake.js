"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { fileableStacks } from "@/lib/toploader";
import {
  planMtgIntake, listingFor, refusedLabel, CONDITION_NAMES, PLACEHOLDER_PENCE
} from "@/lib/mtgstock";

const DEFAULTS_KEY = "cf-list-defaults"; // the bulk lister's postage/returns defaults, shared

function loadDefaults() {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") || {}; } catch { return {}; }
}

const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;
const toPence = (v) => {
  const n = Number(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const finishLabel = (f) => (f === "foil" ? "Foil" : f === "etched" ? "Etched" : "Non-foil");

/**
 * Into MTG stock — a CardUploader export becomes copies in a stack and
 * quantity on eBay.
 *
 * Every row of the file is read into a card (mtgstock.js), copies of the same
 * card are counted together, and each card either ADDS to the listing we
 * already have for it or CREATES one at quantity N. The copies go to the back
 * of one chosen stack, carrying the listing's SKU, so the pull sheet can send
 * you to whichever stack holds them when an order comes in.
 *
 * **Reading the file costs nothing; only the button does** — the same rule the
 * Batch screen learned. The plan is on screen, refusals named, before anything
 * is filed or sent to eBay, and the button confirms.
 *
 * **A placeholder price is not a price.** CardUploader writes £2.49 on every
 * row, the same figure as the engine's floor (see zero-price.js). A new
 * listing at a price nobody chose is the fault that file exists for, so a
 * card with no real price blocks the run and is named.
 */
export default function MtgIntake({ items, label, onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stacks, setStacks] = useState([]);
  const [stackCards, setStackCards] = useState([]);
  const [listings, setListings] = useState([]);
  const [scanGuard, setScanGuard] = useState(true);
  const [stackId, setStackId] = useState("");
  const [newStack, setNewStack] = useState("");
  const [choices, setChoices] = useState({}); // key -> { include, price, title, target }
  const [blankPrice, setBlankPrice] = useState("");
  const [status, setStatus] = useState({});   // key -> { state, msg }
  const [running, setRunning] = useState(false);
  const [showRefused, setShowRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const { data: st, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", user.id);
        if (stErr) throw stErr;
        // The scan column is migration 027's. Without it the copies still file;
        // what is lost is recognising a file uploaded twice, and that is said.
        const cols = "id,stack_id,sku,title,ebay_item_id,pulled_at,checked_out_at";
        let guard = true;
        let cards;
        const probe = await sb.from("stack_cards").select("scan_url").limit(1);
        if (probe.error) {
          guard = false;
          cards = await pagedSelect(() => sb.from("stack_cards").select(cols).eq("user_id", user.id));
        } else {
          cards = await pagedSelect(() => sb.from("stack_cards").select(`${cols},scan_url`).eq("user_id", user.id));
        }
        const ls = await pagedSelect(() => sb.from("ebay_listings").select("id,ebay_item_id,sku,title,quantity").eq("user_id", user.id));
        if (cancelled) return;
        setStacks(st || []);
        setStackCards(cards || []);
        setListings(ls || []);
        setScanGuard(guard);
        const mtg = fileableStacks(st || []).filter((s) => /^mtg/i.test(s.name));
        if (mtg.length) setStackId(mtg[mtg.length - 1].id);
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || "Couldn't read your stacks and listings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const plan = useMemo(
    () => planMtgIntake({ items, listings, stackCards, scanGuard }),
    [items, listings, stackCards, scanGuard]
  );

  const choiceOf = (g) => {
    const c = choices[g.id.key] || {};
    return {
      include: c.include ?? g.action !== "ambiguous",
      price: c.price ?? (g.pricePence != null ? (g.pricePence / 100).toFixed(2) : ""),
      title: c.title ?? g.title,
      target: c.target ?? (g.action === "add" ? String(g.listing.ebay_item_id) : "new")
    };
  };
  const setChoice = (key, patch) => setChoices((cur) => ({ ...cur, [key]: { ...(cur[key] || {}), ...patch } }));

  const pickable = fileableStacks(stacks).slice().sort((a, b) => {
    const am = /^mtg/i.test(a.name) ? 0 : 1;
    const bm = /^mtg/i.test(b.name) ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const todo = plan.groups.filter((g) => g.action !== "ambiguous" && choiceOf(g).include && status[g.id.key]?.state !== "done");
  const copies = todo.reduce((n, g) => n + g.copies, 0);
  const unpriced = todo.filter((g) => {
    const c = choiceOf(g);
    if (c.target !== "new") return false;
    const p = toPence(c.price);
    return p == null || p === PLACEHOLDER_PENCE;
  });
  const untitled = todo.filter((g) => choiceOf(g).target === "new" && !choiceOf(g).title.trim());
  const stackName = stackId === "__new" ? newStack.trim() : stacks.find((s) => s.id === stackId)?.name || "";
  const blockers = [];
  if (!stackName) blockers.push("Choose a stack to file the copies into.");
  if (unpriced.length) {
    const names = unpriced.slice(0, 3).map((g) => g.id.name).join(", ");
    blockers.push(`No price yet for ${names}${unpriced.length > 3 ? ` and ${unpriced.length - 3} more` : ""} — a new listing needs one (CardUploader's £2.49 is its placeholder, not a price).`);
  }
  if (untitled.length) blockers.push(`${untitled.length} new listing${untitled.length === 1 ? " has" : "s have"} no title.`);

  function applyBlankPrice() {
    const p = toPence(blankPrice);
    if (p == null) return;
    setChoices((cur) => {
      const next = { ...cur };
      for (const g of plan.groups) {
        const c = choiceOf(g);
        const have = toPence(c.price);
        if (c.target === "new" && (have == null || have === PLACEHOLDER_PENCE)) next[g.id.key] = { ...(next[g.id.key] || {}), price: (p / 100).toFixed(2) };
      }
      return next;
    });
  }

  async function ensureStack() {
    if (stackId !== "__new") return stackId;
    const name = newStack.trim();
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const existing = stacks.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await sb.from("card_stacks").insert({ user_id: user.id, name }).select("id,name").single();
    if (error) throw new Error(`Couldn't make stack ${name}: ${error.message}`);
    setStacks((cur) => [...cur, data]);
    setStackId(data.id);
    return data.id;
  }

  async function run() {
    if (blockers.length || !todo.length) return;
    const adds = todo.filter((g) => choiceOf(g).target !== "new").length;
    if (!confirm(
      `File ${copies} cop${copies === 1 ? "y" : "ies"} into ${stackName}, ` +
      `add to ${adds} existing listing${adds === 1 ? "" : "s"} and create ${todo.length - adds} new one${todo.length - adds === 1 ? "" : "s"} on eBay?`
    )) return;
    setRunning(true);
    let sid;
    try {
      sid = await ensureStack();
    } catch (e) {
      setLoadError(e.message);
      setRunning(false);
      return;
    }
    const defaults = loadDefaults();
    for (const g of todo) {
      const key = g.id.key;
      const c = choiceOf(g);
      setStatus((s) => ({ ...s, [key]: { state: "busy", msg: "…" } }));
      const body = { stackId: sid, copies: { title: c.title || g.title, scans: g.scans } };
      if (c.target === "new") {
        body.action = "create";
        body.listing = listingFor(g, { pricePence: toPence(c.price), title: c.title, defaults });
      } else {
        body.action = "add";
        body.itemId = c.target;
      }
      try {
        const res = await fetch("/api/mtg/intake", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        }).then((r) => r.json());
        if (res.ok) {
          const where = res.positions?.length
            ? `${res.stackName} ${res.positions[0]}${res.positions.length > 1 ? `–${res.positions[res.positions.length - 1]}` : ""}`
            : res.stackName;
          const verb = res.action === "create" ? "listed" : "listing now";
          const extra = res.orphans ? ` (incl. ${res.orphans} filed earlier)` : "";
          setStatus((s) => ({ ...s, [key]: { state: "done", msg: `✓ Filed at ${where} · ${verb} ×${res.quantity}${extra}${res.itemId ? ` · #${res.itemId}` : ""}` } }));
          if (res.scanGuard === false) setScanGuard(false);
        } else if (res.ended) {
          setChoice(key, { target: "new" });
          setStatus((s) => ({ ...s, [key]: { state: "error", msg: "That listing has ended on eBay — switched to a new listing. Check the price and run again." } }));
        } else {
          setStatus((s) => ({ ...s, [key]: { state: "error", msg: res.error || "Failed." } }));
        }
      } catch (e) {
        setStatus((s) => ({ ...s, [key]: { state: "error", msg: `Couldn't reach the server (${e.message}). Run again — a card that was filed is recognised by its scan.` } }));
      }
    }
    setRunning(false);
  }

  const doneCount = plan.groups.filter((g) => status[g.id.key]?.state === "done").length;
  const failCount = plan.groups.filter((g) => status[g.id.key]?.state === "error").length;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="eyebrow">🃏 Into MTG stock · {label}</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={running}>Close</button>
      </div>

      <p className="hint">
        Each card becomes <b>one eBay listing</b> with a quantity, and its copies go to the back of the stack you
        choose, carrying that listing&rsquo;s SKU. When an order comes in, the pull sheet sends you to whichever
        stack holds a copy — the whole order from one stack where it can.
      </p>

      {loading ? <p className="hint hint-small">Reading your stacks and listings…</p> : null}
      {loadError ? <p className="hint hint-small compfinder-error">{loadError}</p> : null}

      {!loading && !loadError ? (
        <>
          <div className="mi-bar">
            <label className="field">
              <span>File the copies into</span>
              <select value={stackId} onChange={(e) => setStackId(e.target.value)} disabled={running}>
                <option value="">Choose a stack…</option>
                {pickable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new">＋ New stack…</option>
              </select>
            </label>
            {stackId === "__new" ? (
              <label className="field">
                <span>New stack name</span>
                <input type="text" value={newStack} placeholder="MTG-B" onChange={(e) => setNewStack(e.target.value)} disabled={running} />
              </label>
            ) : null}
            <label className="field">
              <span>Price any card without one</span>
              <span className="mi-inline">
                <input type="text" inputMode="decimal" value={blankPrice} placeholder="0.99" onChange={(e) => setBlankPrice(e.target.value)} disabled={running} />
                <button type="button" className="btn btn-ghost" onClick={applyBlankPrice} disabled={running || toPence(blankPrice) == null}>Apply</button>
              </span>
            </label>
          </div>

          <p className="hint hint-small">
            {items.length} row{items.length === 1 ? "" : "s"} → <b>{plan.groups.length}</b> card{plan.groups.length === 1 ? "" : "s"}:{" "}
            {plan.groups.filter((g) => g.action === "add").length} already listed,{" "}
            {plan.groups.filter((g) => g.action === "create").length} new
            {plan.already.length ? ` · ${plan.already.length} row${plan.already.length === 1 ? "" : "s"} already in stock (same scan), skipped` : ""}
            {plan.refused.length ? ` · ${plan.refused.length} refused` : ""}
          </p>
          {!scanGuard ? (
            <p className="hint hint-small compfinder-error">
              <b>Migration 027 is still to run</b>, so a file uploaded twice can&rsquo;t be recognised — running this
              import again would add every copy a second time. Paste <code>supabase/migrations/027_listing_copies.sql</code> into
              the Supabase SQL editor first if you might.
            </p>
          ) : null}

          {plan.refused.length ? (
            <div className="mi-refused">
              <button type="button" className="btn btn-ghost" onClick={() => setShowRefused((v) => !v)}>
                {showRefused ? "Hide" : "Show"} the {plan.refused.length} refused row{plan.refused.length === 1 ? "" : "s"}
              </button>
              {showRefused ? (
                <ul className="hint hint-small">
                  {plan.refused.map((r, i) => <li key={i}>{refusedLabel(r)}</li>)}
                </ul>
              ) : (
                <p className="hint hint-small">
                  Not filed and not listed — fix them on the import (title, set or condition) and run it again.
                </p>
              )}
            </div>
          ) : null}

          <div className="mi-list">
            {plan.groups.map((g) => {
              const c = choiceOf(g);
              const st = status[g.id.key];
              const isNew = c.target === "new";
              const priceP = toPence(c.price);
              return (
                <div key={g.id.key} className={`mi-row${st?.state === "done" ? " mi-row-done" : ""}`}>
                  <label className="mi-tick">
                    <input
                      type="checkbox" checked={c.include && g.action !== "ambiguous"}
                      disabled={running || g.action === "ambiguous" || st?.state === "done"}
                      onChange={(e) => setChoice(g.id.key, { include: e.target.checked })}
                    />
                  </label>
                  {g.images[0] ? <img className="mi-scan" src={g.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="mi-scan mi-noscan">no scan</span>}
                  <div className="mi-main">
                    <div className="mi-name">
                      <b>{g.id.name}</b> <span className="mi-count">×{g.copies}</span>
                    </div>
                    <div className="mi-meta">
                      {g.id.set} · #{g.id.number} · {CONDITION_NAMES[g.id.condition]} · {finishLabel(g.id.finish)}
                      {g.id.language !== "EN" ? ` · ${g.id.language}` : ""} · <code>{g.id.sku}</code>
                    </div>

                    {g.action === "ambiguous" ? (
                      <div className="mi-meta compfinder-error">{g.reason}</div>
                    ) : g.action === "add" ? (
                      <div className="mi-meta">
                        ➕ Adds {g.copies} to listing #{g.listing.ebay_item_id}
                        {g.listing.quantity != null ? ` (now ×${g.listing.quantity})` : ""}
                        {g.orphans ? ` · plus ${g.orphans} filed earlier with nothing on sale` : ""}
                      </div>
                    ) : (
                      <div className="mi-edit">
                        {g.candidates.length ? (
                          <label className="field">
                            <span>Listing</span>
                            <select value={c.target} disabled={running} onChange={(e) => setChoice(g.id.key, { target: e.target.value })}>
                              <option value="new">Create a new listing</option>
                              {g.candidates.map((l) => (
                                <option key={l.ebay_item_id} value={String(l.ebay_item_id)} disabled={!l.sku}>
                                  Add to: {l.title}{l.sku ? ` (${l.sku})` : " — no SKU, can't link"}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {isNew ? (
                          <>
                            <label className="field mi-title">
                              <span>Title</span>
                              <input type="text" maxLength={80} value={c.title} disabled={running} onChange={(e) => setChoice(g.id.key, { title: e.target.value })} />
                            </label>
                            <label className="field mi-price">
                              <span>Price</span>
                              <input
                                type="text" inputMode="decimal" value={c.price} placeholder="£" disabled={running}
                                onChange={(e) => setChoice(g.id.key, { price: e.target.value })}
                              />
                            </label>
                            <span className="mi-meta">
                              New listing ×{g.copies + (g.orphans || 0)}
                              {g.orphans ? ` (incl. ${g.orphans} filed earlier)` : ""}
                              {priceP != null && priceP !== PLACEHOLDER_PENCE ? ` at ${gbp(priceP)}` : ""}
                              {g.priceConflict ? " · the file's copies disagree on price" : ""}
                            </span>
                          </>
                        ) : (
                          <span className="mi-meta">➕ Adds {g.copies} to that listing, filed under its SKU.</span>
                        )}
                      </div>
                    )}
                    {st ? <div className={`mi-meta${st.state === "error" ? " compfinder-error" : ""}`}>{st.msg}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>

          {blockers.length && todo.length ? (
            <ul className="hint hint-small compfinder-error">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          ) : null}
          <div className="mi-bar">
            <button type="button" className="btn btn-primary" onClick={run} disabled={running || !todo.length || blockers.length > 0}>
              {running ? "Working…" : `▶ File ${copies} cop${copies === 1 ? "y" : "ies"} and update eBay`}
            </button>
            {doneCount || failCount ? (
              <span className="hint-small">{doneCount} done{failCount ? ` · ${failCount} failed — fix and run again` : ""}</span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
