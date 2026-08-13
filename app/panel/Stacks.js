"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";

/**
 * Rolling stack inventory. Cards live unsleeved in entry order inside batches
 * ("stacks"); a card's position is its live rank, not a written number. Pulling
 * a card (sold/removed) shifts everything behind it down one, so the app always
 * shows where an unsold card currently sits. Plus a "where is this SKU?" finder.
 */
export default function Stacks() {
  const [stacks, setStacks] = useState([]);
  const [counts, setCounts] = useState(new Map());
  const [selId, setSelId] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skuTitle, setSkuTitle] = useState(new Map()); // sku -> title from eBay listings
  const [addSku, setAddSku] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [find, setFind] = useState("");
  const [finderMsg, setFinderMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pulled, setPulled] = useState([]);
  const [showPulled, setShowPulled] = useState(false);
  const [msg, setMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [showRecon, setShowRecon] = useState(false);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconRows, setReconRows] = useState([]);
  const [reconSel, setReconSel] = useState(new Set());

  const supabase = () => createClient();

  async function loadStacks() {
    const sb = supabase();
    const { data: st } = await sb.from("card_stacks").select("id,name,created_at").order("created_at", { ascending: true });
    setStacks(st || []);
    // live counts per stack (unpulled only) — paged past the 1000-row cap
    const rows = await pagedSelect(() => sb.from("stack_cards").select("stack_id").is("pulled_at", null));
    const c = new Map();
    rows.forEach((r) => c.set(r.stack_id, (c.get(r.stack_id) || 0) + 1));
    setCounts(c);
    // eBay listing SKU→title for auto-fill
    const listings = await pagedSelect(() => sb.from("ebay_listings").select("sku,title").not("sku", "is", null));
    setSkuTitle(new Map(listings.filter((l) => l.sku).map((l) => [String(l.sku).toLowerCase(), l.title])));
    setLoading(false);
    if (!selId && st && st.length) setSelId(st[0].id);
  }

  async function loadCards(stackId) {
    if (!stackId) return setCards([]);
    const { data } = await supabase()
      .from("stack_cards")
      .select("id,position,sku,title,ebay_item_id,pulled_at")
      .eq("stack_id", stackId)
      .is("pulled_at", null)
      .order("position", { ascending: true });
    setCards(data || []);
  }

  async function loadPulled(stackId) {
    if (!stackId) return setPulled([]);
    const { data } = await supabase()
      .from("stack_cards")
      .select("id,sku,title,pulled_at")
      .eq("stack_id", stackId)
      .not("pulled_at", "is", null)
      .order("pulled_at", { ascending: false })
      .limit(30);
    setPulled(data || []);
  }

  useEffect(() => {
    loadStacks();
  }, []);
  useEffect(() => {
    loadCards(selId);
    loadPulled(selId);
  }, [selId]);

  // Auto-create stacks from eBay listing SKUs (prefix = stack, number =
  // position). e.g. A50 -> Stack A, position 50. Reuses existing stacks and
  // skips SKUs already added.
  async function autoImport() {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    if (!confirm("Auto-create stacks from your eBay listing SKUs?\n\nEach SKU like A50 becomes Stack A, position 50. Existing stacks are reused and SKUs already added are skipped.")) return;
    setBusy(true);
    setMsg("");
    const listings = await pagedSelect(() => sb.from("ebay_listings").select("sku,title,ebay_item_id").not("sku", "is", null));
    let unparseable = 0;
    const parsed = [];
    for (const l of listings) {
      const m = String(l.sku).trim().match(/^([A-Za-z]+)[-_ ]?(\d{1,4})$/);
      if (!m) { unparseable += 1; continue; }
      parsed.push({ prefix: m[1].toUpperCase(), num: parseInt(m[2], 10), sku: String(l.sku).trim(), title: l.title || "", ebay_item_id: l.ebay_item_id || null });
    }
    const existing = await pagedSelect(() => sb.from("stack_cards").select("sku").not("sku", "is", null));
    const have = new Set(existing.map((e) => String(e.sku).toLowerCase()));
    const fresh = parsed.filter((p) => !have.has(p.sku.toLowerCase()));

    const byPrefix = new Map();
    for (const p of fresh) {
      if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, []);
      byPrefix.get(p.prefix).push(p);
    }
    const stackByName = new Map(stacks.map((s) => [s.name.toUpperCase(), s.id]));
    for (const prefix of byPrefix.keys()) {
      if (!stackByName.has(prefix)) {
        const { data } = await sb.from("card_stacks").insert({ user_id: user.id, name: prefix }).select("id,name").single();
        if (data) stackByName.set(prefix, data.id);
      }
    }
    const rows = [];
    for (const [prefix, cs] of byPrefix) {
      const sid = stackByName.get(prefix);
      if (!sid) continue;
      for (const c of cs) rows.push({ user_id: user.id, stack_id: sid, position: c.num, sku: c.sku, title: c.title, ebay_item_id: c.ebay_item_id });
    }
    for (let i = 0; i < rows.length; i += 500) await sb.from("stack_cards").insert(rows.slice(i, i + 500));

    setBusy(false);
    setMsg(`Imported ${rows.length} card(s) into ${byPrefix.size} stack(s). Skipped ${parsed.length - fresh.length} already added${unparseable ? `, ${unparseable} with non-standard SKUs` : ""}.`);
    await loadStacks();
    await loadCards(selId);
  }

  // Reconciliation: cards still in a stack but no longer in active listings
  // (sold / ended). "sold" = confirmed in sales history; "not listed" = gone
  // from active listings for another reason. Lets you bulk-pull to true up.
  async function runReconcile() {
    setShowRecon(true);
    setReconLoading(true);
    const sb = supabase();
    const active = await pagedSelect(() => sb.from("ebay_listings").select("sku").not("sku", "is", null));
    const activeSet = new Set(active.map((a) => String(a.sku).toLowerCase()));
    const sales = await pagedSelect(() => sb.from("ebay_sales").select("sku,sold_date").not("sku", "is", null));
    const saleMap = new Map();
    sales.forEach((s) => { const k = String(s.sku).toLowerCase(); if (!saleMap.has(k)) saleMap.set(k, s.sold_date); });
    const cards = await pagedSelect(() => sb.from("stack_cards").select("id,sku,stack_id,title").is("pulled_at", null));
    const nameMap = new Map(stacks.map((s) => [s.id, s.name]));
    const cand = cards
      .filter((c) => c.sku && !activeSet.has(String(c.sku).toLowerCase()))
      .map((c) => {
        const sold = saleMap.get(String(c.sku).toLowerCase());
        return { id: c.id, sku: c.sku, title: c.title, stack: nameMap.get(c.stack_id) || "", soldDate: sold || null, reason: sold ? "sold" : "notlisted" };
      })
      .sort((a, b) => (a.reason === b.reason ? (a.stack || "").localeCompare(b.stack || "") : a.reason === "sold" ? -1 : 1));
    setReconRows(cand);
    setReconSel(new Set(cand.filter((c) => c.reason === "sold").map((c) => c.id)));
    setReconLoading(false);
  }

  function toggleRecon(id) {
    setReconSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function pullReconSelected() {
    const ids = [...reconSel];
    if (ids.length === 0) return;
    if (!confirm(`Pull ${ids.length} card(s) from your stacks? They'll be marked pulled.`)) return;
    setBusy(true);
    const sb = supabase();
    for (let i = 0; i < ids.length; i += 200) await sb.from("stack_cards").update({ pulled_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
    setBusy(false);
    setShowRecon(false);
    setMsg(`Reconciled — pulled ${ids.length} card(s) that had left your listings.`);
    await loadStacks();
    await loadCards(selId);
    await loadPulled(selId);
  }

  async function undoPull(card) {
    setBusy(true);
    // Just clear the pulled flag — its stored position slots it back into its
    // original place in the order automatically.
    await supabase().from("stack_cards").update({ pulled_at: null }).eq("id", card.id);
    setBusy(false);
    await loadCards(selId);
    await loadPulled(selId);
    await loadStacks();
  }

  async function createStack() {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const name = `Stack ${stacks.length + 1}`;
    const { data } = await sb.from("card_stacks").insert({ user_id: user.id, name }).select("id,name,created_at").single();
    if (data) {
      setStacks((p) => [...p, data]);
      setSelId(data.id);
    }
  }

  function titleFor(sku, typed) {
    if (typed && typed.trim()) return typed.trim();
    return skuTitle.get(String(sku).toLowerCase()) || "";
  }

  async function addCards(entries) {
    // entries: [{ sku, title }]
    if (!selId || entries.length === 0) return;
    setBusy(true);
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    let next = (cards.reduce((m, c) => Math.max(m, c.position || 0), 0) || 0) + 1;
    const rows = entries
      .filter((e) => e.sku && e.sku.trim())
      .map((e) => ({
        user_id: user.id,
        stack_id: selId,
        position: next++,
        sku: e.sku.trim(),
        title: titleFor(e.sku, e.title),
        ebay_item_id: null
      }));
    if (rows.length) await sb.from("stack_cards").insert(rows);
    setBusy(false);
    setAddSku("");
    setAddTitle("");
    setBulk("");
    setShowBulk(false);
    await loadCards(selId);
    await loadStacks();
  }

  function addOne() {
    if (!addSku.trim()) return;
    addCards([{ sku: addSku, title: addTitle }]);
  }
  function addBulk() {
    const entries = bulk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sku, ...rest] = line.split(/[,\t]/);
        return { sku, title: rest.join(",").trim() };
      });
    addCards(entries);
  }

  async function pullCard(card) {
    if (!confirm(`Mark "${card.sku}" as pulled? Everything behind it moves up one.`)) return;
    setBusy(true);
    // Keep `position` as a stable sort key; just flag it pulled. The displayed
    // position is the live rank among unpulled cards, so everything re-flows
    // automatically — no renumbering needed.
    await supabase().from("stack_cards").update({ pulled_at: new Date().toISOString() }).eq("id", card.id);
    setBusy(false);
    await loadCards(selId);
    await loadPulled(selId);
    await loadStacks();
  }

  async function runFind() {
    const q = find.trim().toLowerCase();
    setFinderMsg(null);
    if (!q) return;
    const sb = supabase();
    const { data: hits } = await sb
      .from("stack_cards")
      .select("sku,title,position,stack_id")
      .is("pulled_at", null)
      .ilike("sku", `%${q}%`);
    if (!hits || hits.length === 0) {
      setFinderMsg({ ok: false, text: `No unpulled card matches SKU “${find}”.` });
      return;
    }
    // Live rank = how many present cards in the same stack sit at/before it.
    const stackIds = [...new Set(hits.map((h) => h.stack_id))];
    const positionsByStack = new Map();
    for (const sid of stackIds) {
      const { data: all } = await sb.from("stack_cards").select("position").eq("stack_id", sid).is("pulled_at", null);
      positionsByStack.set(sid, (all || []).map((a) => a.position).filter((v) => v != null).sort((a, b) => a - b));
    }
    const byStack = new Map(stacks.map((s) => [s.id, s.name]));
    const lines = hits.slice(0, 5).map((h) => {
      const positions = positionsByStack.get(h.stack_id) || [];
      const rank = positions.filter((p) => p <= h.position).length;
      return `${byStack.get(h.stack_id) || "Stack"} · position ${rank}${h.sku ? ` (${h.sku})` : ""}`;
    });
    setFinderMsg({ ok: true, text: lines.join(" · ") });
  }

  const sel = useMemo(() => stacks.find((s) => s.id === selId), [stacks, selId]);
  // Alphabetise: shorter names first (A–Z, then AA–AH, then longer like ACE /
  // GRADED), alphabetical within each length.
  const sortedStacks = useMemo(
    () => [...stacks].sort((a, b) => (a.name.length - b.name.length) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    [stacks]
  );
  const TAB_LIMIT = 12;
  const pickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return q ? sortedStacks.filter((s) => s.name.toLowerCase().includes(q)) : sortedStacks;
  }, [sortedStacks, pickerQuery]);

  if (loading) return <div className="panel"><span className="spinner" /> &nbsp;Loading stacks…</div>;

  return (
    <>
      <div className="panel">
        <div className="panel-head"><span className="eyebrow">Find a card by SKU</span></div>
        <div className="dd-search" style={{ marginBottom: 0 }}>
          <div className="dd-combo">
            <div className="dd-inp">
              <span className="mag" aria-hidden="true">🔍</span>
              <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runFind(); }} placeholder="Enter a SKU — e.g. AB11" aria-label="Find by SKU" />
            </div>
          </div>
          <button className="btn btn-primary" onClick={runFind}>Locate</button>
        </div>
        {finderMsg ? <p className={`hint hint-small ${finderMsg.ok ? "" : ""}`} style={{ color: finderMsg.ok ? "var(--conf-high)" : "var(--warn-ink)", marginTop: 8 }}>{finderMsg.text}</p> : null}
      </div>

      <div className="stack-tabs">
        {sortedStacks.length > TAB_LIMIT ? (
          <div className="stack-picker">
            <button className="stack-picker-btn" onClick={() => setPickerOpen((o) => !o)}>
              {sel ? sel.name : "Select stack"}
              {sel ? <span className="stack-count">{counts.get(sel.id) || 0}</span> : null}
              <span className="stack-picker-caret">▾</span>
            </button>
            {pickerOpen ? (
              <>
                <div className="col-menu-backdrop" onClick={() => { setPickerOpen(false); setPickerQuery(""); }} />
                <div className="stack-picker-menu">
                  <input className="stack-picker-search" autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search stacks…" />
                  <div className="stack-picker-list">
                    {pickerList.length === 0 ? (
                      <div className="stack-picker-empty">No match</div>
                    ) : (
                      pickerList.map((s) => (
                        <button key={s.id} className={`stack-picker-item${s.id === selId ? " on" : ""}`} onClick={() => { setSelId(s.id); setPickerOpen(false); setPickerQuery(""); }}>
                          <span>{s.name}</span>
                          <span className="stack-count">{counts.get(s.id) || 0}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          sortedStacks.map((s) => (
            <button key={s.id} className={`stack-tab${s.id === selId ? " on" : ""}`} onClick={() => setSelId(s.id)}>
              {s.name} <span className="stack-count">{counts.get(s.id) || 0}</span>
            </button>
          ))
        )}
        <button className="stack-tab stack-new" onClick={createStack}>+ New stack</button>
        <button className="stack-tab stack-new" onClick={autoImport} disabled={busy}>⤓ Auto-import from listings</button>
        <button className="stack-tab stack-new" onClick={runReconcile} disabled={busy}>🔄 Reconcile</button>
      </div>
      {msg ? <p className="hint hint-small" style={{ color: "var(--accent-2)", marginTop: -8 }}>{msg}</p> : null}

      {showRecon ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Reconcile — cards sold but still in stacks</span>
            <button className="btn btn-ghost" onClick={() => setShowRecon(false)}>Close</button>
          </div>
          {reconLoading ? (
            <p className="hint hint-small"><span className="spinner" /> &nbsp;Checking stacks against your listings & sales…</p>
          ) : reconRows.length === 0 ? (
            <p className="dd-empty">Everything&apos;s in sync — no sold cards sitting in stacks. 🎉</p>
          ) : (
            <>
              <p className="hint hint-small" style={{ marginTop: 0 }}>
                These are in a stack but no longer in your active listings. <b>sold</b> = matched in your sales history;
                <b> not listed</b> = gone from active listings (sold, ended or delisted). Sold ones are pre-ticked.
              </p>
              <div className="stack-list">
                {reconRows.map((r) => (
                  <label className="ps-row" key={r.id}>
                    <input type="checkbox" checked={reconSel.has(r.id)} onChange={() => toggleRecon(r.id)} />
                    <span className="stack-sku">{r.sku}</span>
                    <span className="stack-title">{r.title || <em>—</em>}</span>
                    <span className="badge2">{r.stack}</span>
                    <span className="hint-small" style={{ color: r.reason === "sold" ? "var(--conf-high)" : "var(--ink-faint)", flex: "none" }}>
                      {r.reason === "sold" ? `sold ${r.soldDate ? new Date(r.soldDate).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""}`.trim() : "not listed"}
                    </span>
                  </label>
                ))}
              </div>
              <button className="btn btn-primary" onClick={pullReconSelected} disabled={busy || reconSel.size === 0} style={{ marginTop: 10 }}>
                Pull selected ({reconSel.size})
              </button>
            </>
          )}
        </div>
      ) : null}

      {!sel ? (
        <div className="panel"><p className="dd-empty">Create a stack, or use <b>Auto-import from listings</b> to build stacks from your eBay SKUs automatically.</p></div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">Add to {sel.name}</span>
              <button className="btn btn-ghost" onClick={() => setShowBulk((v) => !v)}>{showBulk ? "Single" : "Bulk paste"}</button>
            </div>
            {showBulk ? (
              <>
                <p className="hint hint-small" style={{ marginTop: 0 }}>One card per line: <code>SKU</code> or <code>SKU, Title</code>. Titles auto-fill from your eBay listings where the SKU matches.</p>
                <textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"AB11\nAB12, Charizard 4/102\nAB13"} />
                <button className="btn btn-primary" onClick={addBulk} disabled={busy || !bulk.trim()} style={{ marginTop: 10 }}>{busy ? "Adding…" : "Add cards"}</button>
              </>
            ) : (
              <div className="dd-search" style={{ marginBottom: 0 }}>
                <div className="dd-combo"><div className="dd-inp"><span className="mag" aria-hidden="true">#</span>
                  <input value={addSku} onChange={(e) => setAddSku(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOne(); }} placeholder="SKU (e.g. AB11)" aria-label="SKU" />
                </div></div>
                <input className="stack-title-inp" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Title (optional — auto from listings)" />
                <button className="btn btn-primary" onClick={addOne} disabled={busy || !addSku.trim()}>Add</button>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>{sel.name}</h3>
              <span className="badge2">{cards.length} in stack</span>
            </div>
            <p className="hint hint-small" style={{ marginTop: 0 }}>Position = live count from the top; the SKU stays fixed. Pull a sold card and everything behind it moves up.</p>
            {cards.length === 0 ? (
              <p className="dd-empty">No cards in this stack yet.</p>
            ) : (
              <div className="stack-list rise-group">
                {cards.map((c, idx) => (
                  <div className="stack-row" key={c.id}>
                    <span className="stack-pos" title="Live position (count from top)">{idx + 1}</span>
                    <span className="stack-sku">{c.sku}</span>
                    <span className="stack-title">{c.title || <em>—</em>}</span>
                    <button className="stack-pull" onClick={() => pullCard(c)} disabled={busy}>Pull</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pulled.length > 0 ? (
            <div className="panel">
              <div className="panel-head">
                <span className="eyebrow">Recently pulled ({pulled.length})</span>
                <button className="btn btn-ghost" onClick={() => setShowPulled((v) => !v)}>{showPulled ? "Hide" : "Show"}</button>
              </div>
              {showPulled ? (
                <div className="stack-list">
                  {pulled.map((c) => (
                    <div className="stack-row" key={c.id}>
                      <span className="stack-sku">{c.sku}</span>
                      <span className="stack-title">{c.title || <em>—</em>}</span>
                      <button className="stack-pull" style={{ color: "var(--accent-2)", borderColor: "var(--line-strong)" }} onClick={() => undoPull(c)} disabled={busy}>↺ Undo</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
