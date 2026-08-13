"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

  const supabase = () => createClient();

  async function loadStacks() {
    const sb = supabase();
    const { data: st } = await sb.from("card_stacks").select("id,name,created_at").order("created_at", { ascending: true });
    setStacks(st || []);
    // live counts per stack
    const { data: rows } = await sb.from("stack_cards").select("stack_id,position").not("position", "is", null);
    const c = new Map();
    (rows || []).forEach((r) => c.set(r.stack_id, (c.get(r.stack_id) || 0) + 1));
    setCounts(c);
    // eBay listing SKU→title for auto-fill
    const { data: listings } = await sb.from("ebay_listings").select("sku,title").not("sku", "is", null);
    setSkuTitle(new Map((listings || []).filter((l) => l.sku).map((l) => [String(l.sku).toLowerCase(), l.title])));
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

  useEffect(() => {
    loadStacks();
  }, []);
  useEffect(() => {
    loadCards(selId);
  }, [selId]);

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
    if (!confirm(`Mark "${card.sku}" as pulled? Cards behind it shift down one.`)) return;
    setBusy(true);
    const sb = supabase();
    const P = card.position;
    await sb.from("stack_cards").update({ pulled_at: new Date().toISOString(), position: null }).eq("id", card.id);
    const after = cards.filter((c) => c.position != null && c.position > P);
    await Promise.all(after.map((c) => sb.from("stack_cards").update({ position: c.position - 1 }).eq("id", c.id)));
    setBusy(false);
    await loadCards(selId);
    await loadStacks();
  }

  async function runFind() {
    const q = find.trim().toLowerCase();
    setFinderMsg(null);
    if (!q) return;
    const { data } = await supabase()
      .from("stack_cards")
      .select("sku,title,position,stack_id")
      .is("pulled_at", null)
      .ilike("sku", `%${q}%`);
    if (!data || data.length === 0) {
      setFinderMsg({ ok: false, text: `No unpulled card matches SKU “${find}”.` });
      return;
    }
    const byStack = new Map(stacks.map((s) => [s.id, s.name]));
    const hits = data.slice(0, 5).map((r) => `${byStack.get(r.stack_id) || "Stack"} · position ${r.position}${r.sku ? ` (${r.sku})` : ""}`);
    setFinderMsg({ ok: true, text: hits.join(" · ") });
  }

  const sel = useMemo(() => stacks.find((s) => s.id === selId), [stacks, selId]);

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
        {stacks.map((s) => (
          <button key={s.id} className={`stack-tab${s.id === selId ? " on" : ""}`} onClick={() => setSelId(s.id)}>
            {s.name} <span className="stack-count">{counts.get(s.id) || 0}</span>
          </button>
        ))}
        <button className="stack-tab stack-new" onClick={createStack}>+ New stack</button>
      </div>

      {!sel ? (
        <div className="panel"><p className="dd-empty">Create a stack to start ingesting cards.</p></div>
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
            {cards.length === 0 ? (
              <p className="dd-empty">No cards in this stack yet.</p>
            ) : (
              <div className="stack-list rise-group">
                {cards.map((c) => (
                  <div className="stack-row" key={c.id}>
                    <span className="stack-pos">{c.position}</span>
                    <span className="stack-sku">{c.sku}</span>
                    <span className="stack-title">{c.title || <em>—</em>}</span>
                    <button className="stack-pull" onClick={() => pullCard(c)} disabled={busy}>Pull</button>
                  </div>
                ))}
              </div>
            )}
            {cards.length >= 50 ? <p className="hint hint-small">This stack has {cards.length} cards — consider starting a new one for easy counting.</p> : null}
          </div>
        </>
      )}
    </>
  );
}
