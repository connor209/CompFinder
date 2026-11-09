"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";
import { imageAt } from "@/lib/showcounter.js";
import {
  startCheck, confirmCurrent, notHere, bringHere, addHere, moveCard, setCursor, unmissing,
  locateSku, restoreCheck, savePlan, checkSummary, loadCheck, storeCheck, clearCheck
} from "@/lib/stackcheck.js";

/**
 * The stack checker: you go through the stack in your hand one card at a time,
 * against the order the app has. The rules are in lib/stackcheck.js. Nothing
 * is written until Save order. Until then the check is a draft on this device,
 * and it resumes if you leave and come back.
 */
export default function StackCheck({ stack, stackNames, onClose, onSaved }) {
  const [all, setAll] = useState(null); // every unpulled stack_cards row
  const [listing, setListing] = useState(new Map()); // sku -> { title, image }
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [resumeNote, setResumeNote] = useState("");
  const [sku, setSku] = useState("");
  const [answer, setAnswer] = useState(null); // what the typed SKU turned out to be
  const [pullSel, setPullSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const skuRef = useRef(null);

  const supabase = () => createClient();

  async function readCards() {
    const sb = supabase();
    return pagedSelect(() => sb.from("stack_cards").select("*").is("pulled_at", null));
  }

  useEffect(() => {
    let live = true;
    (async () => {
      const sb = supabase();
      const [rows, listings] = await Promise.all([
        readCards(),
        pagedSelect(() => sb.from("ebay_listings").select("sku,title,image_url").not("sku", "is", null))
      ]);
      if (!live) return;
      setAll(rows);
      setListing(new Map(listings.filter((l) => l.sku).map((l) => [String(l.sku).toLowerCase(), { title: l.title, image: l.image_url }])));
      const back = restoreCheck(loadCheck(stack.id), rows);
      if (back && back.session.stackId === stack.id) {
        setSession(back.session);
        const bits = [`Resumed your check — ${back.session.cursor} of ${back.session.order.length} already done.`];
        if (back.dropped) bits.push(`${back.dropped} card(s) pulled or checked out since have dropped out of it.`);
        if (back.arrived) bits.push(`${back.arrived} card(s) added to the stack since are at the back.`);
        setResumeNote(bits.join(" "));
      } else {
        setSession(startCheck(stack.id, rows));
      }
    })();
    return () => { live = false; };
  }, [stack.id]);

  useEffect(() => {
    if (session) storeCheck(session);
  }, [session]);

  const byId = useMemo(() => new Map((all || []).map((c) => [c.id, c])), [all]);
  const summary = useMemo(() => (session && all ? checkSummary(session, all) : null), [session, all]);

  function info(id) {
    const e = session?.extra[id];
    const row = byId.get(id);
    const s = e?.sku ?? row?.sku ?? "";
    const l = listing.get(String(s).toLowerCase());
    return {
      sku: s,
      title: e?.title || row?.title || l?.title || "",
      image: l?.image || null,
      tag: e ? (e.fromName ? `from ${e.fromName}` : e.fromStack ? "from another stack" : "new") : null
    };
  }

  function act(next) {
    if (next === session) return;
    setHistory((h) => [...h.slice(-49), session]);
    setSession(next);
    setAnswer(null);
    setMsg("");
  }

  function undo() {
    if (!history.length) return;
    setSession(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setAnswer(null);
  }

  function lookUp() {
    const typed = sku.trim();
    if (!typed) return;
    const r = locateSku(session, typed, all);
    if (r.kind === "here" && !r.seen) {
      act(bringHere(session, r.id));
      setSku("");
      skuRef.current?.focus();
      return;
    }
    if (r.kind === "missing") {
      act(bringHere(session, r.id));
      setSku("");
      return;
    }
    setAnswer({ ...r, typed });
  }

  function takeAnswer() {
    if (!answer) return;
    if (answer.kind === "here") act(bringHere(session, answer.id));
    else if (answer.kind === "elsewhere") act(addHere(session, { ...answer.card, stackName: stackNames.get(answer.card.stack_id) || null }));
    else if (answer.kind === "unknown") act(addHere(session, { sku: answer.typed, title: listing.get(answer.typed.toLowerCase())?.title || "" }));
    setSku("");
    skuRef.current?.focus();
  }

  async function save() {
    if (!session || busy) return;
    setBusy(true);
    setMsg("Reading the stack again before saving…");
    let fresh;
    try {
      fresh = await readCards();
    } catch (e) {
      setBusy(false);
      setMsg(`Couldn't read the stack — nothing saved. ${e.message || ""}`);
      return;
    }
    // Saved against the stack as it is NOW, never as it was when the check began.
    const back = restoreCheck({ ...session, touchedAt: Date.now() }, fresh);
    if (!back) { setBusy(false); setMsg("That check could not be read back — nothing saved."); return; }
    const s = back.session;
    const plan = savePlan(s, fresh, [...pullSel]);
    const sum = checkSummary(s, fresh);
    const keptMissing = s.missing.length - plan.pulls.length;
    const lines = [
      `Save the order of ${stack.name}?`,
      "",
      `${plan.updates.length} card(s) get a new place${sum.fromElsewhere ? ` (${sum.fromElsewhere} moved in from another stack)` : ""}.`,
      plan.inserts.length ? `${plan.inserts.length} new card(s) added.` : null,
      plan.pulls.length ? `${plan.pulls.length} not-found card(s) marked pulled.` : null,
      keptMissing ? `${keptMissing} not-found card(s) moved to the back of the stack.` : null,
      back.dropped ? `${back.dropped} card(s) pulled or checked out since you started are left out.` : null,
      s.cursor < s.order.length ? `You have checked ${s.cursor} of ${s.order.length}. The rest keep their order.` : null
    ].filter((x) => x !== null);
    if (!plan.updates.length && !plan.inserts.length && !plan.pulls.length) {
      setBusy(false);
      if (confirm(`Nothing to change. The stack in your hand matches the app.\n\nFinish this check?`)) {
        clearCheck(stack.id);
        onSaved?.("Checked — the stack matches the app.");
      } else setMsg("");
      return;
    }
    if (!confirm(lines.join("\n"))) { setBusy(false); setMsg(""); return; }

    const sb = supabase();
    const failed = [];
    setMsg("Saving…");
    // Each row has its own position, so these are separate updates, a few at a
    // time to stay polite on venue wifi.
    for (let i = 0; i < plan.updates.length; i += 8) {
      const chunk = plan.updates.slice(i, i + 8);
      const res = await Promise.all(chunk.map(({ id, ...patch }) => sb.from("stack_cards").update(patch).eq("id", id)));
      res.forEach((r, j) => { if (r.error) failed.push(byId.get(chunk[j].id)?.sku || chunk[j].id); });
    }
    if (plan.inserts.length) {
      const { data: { user } } = await sb.auth.getUser();
      const rows = plan.inserts.map((n) => ({
        user_id: user?.id, stack_id: stack.id, position: n.position, sku: n.sku, title: n.title, ebay_item_id: null
      }));
      const { error } = await sb.from("stack_cards").insert(rows);
      if (error) failed.push(...plan.inserts.map((n) => n.sku));
    }
    if (plan.pulls.length) {
      const { error } = await sb.from("stack_cards").update({ pulled_at: new Date().toISOString() }).in("id", plan.pulls);
      if (error) failed.push(...plan.pulls.map((id) => byId.get(id)?.sku || id));
    }
    setBusy(false);
    if (failed.length) {
      // The draft is kept: saving again rewrites positions from scratch, so a
      // retry is safe.
      setMsg(`⚠ ${failed.length} card(s) didn't save (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}). Your check is kept. Press Save order again.`);
      return;
    }
    clearCheck(stack.id);
    onSaved?.(`Saved ${stack.name}: ${plan.updates.length} moved, ${plan.inserts.length} added, ${plan.pulls.length} pulled.`);
  }

  function discard() {
    if (!confirm("Throw this check away? Nothing has been saved, and the stack stays as the app had it.")) return;
    clearCheck(stack.id);
    onClose?.();
  }

  if (!session || !all) {
    return <div className="panel"><span className="spinner" /> &nbsp;Loading {stack.name}…</div>;
  }

  const cur = session.order[session.cursor];
  const curInfo = cur ? info(cur) : null;
  const upcoming = session.order.slice(session.cursor + 1, session.cursor + 5);
  const listIds = showAll ? session.order : session.order.slice(Math.max(0, session.cursor - 3), session.cursor + 12);
  const listStart = showAll ? 0 : Math.max(0, session.cursor - 3);

  return (
    <div className="panel sc-panel">
      <div className="panel-head">
        <h3>✓ Checking {stack.name}</h3>
        <span className="badge2">{summary.seen} of {summary.total}</span>
      </div>
      <p className="hint hint-small" style={{ marginTop: 0 }}>
        Hold the stack and go from the top. Nothing changes until <b>Save order</b>. If you leave, this check is kept on this device.
        {summary.missing ? <> &nbsp;<b>{summary.missing} not found</b>.</> : null}
        {summary.moved ? <> &nbsp;{summary.moved} moved.</> : null}
        {summary.fromElsewhere ? <> &nbsp;{summary.fromElsewhere} from other stacks.</> : null}
        {summary.added ? <> &nbsp;{summary.added} new.</> : null}
      </p>
      {resumeNote ? <p className="hint hint-small" style={{ color: "var(--accent-2)" }}>{resumeNote}</p> : null}

      <div className="sc-progress" aria-hidden="true"><span style={{ width: `${summary.total ? (100 * summary.seen) / summary.total : 100}%` }} /></div>

      {curInfo ? (
        <div className="sc-current">
          {curInfo.image ? <img className="sc-img" src={imageAt(curInfo.image, 500)} alt="" referrerPolicy="no-referrer" /> : <div className="sc-img sc-noimg">no photo</div>}
          <div className="sc-cur-body">
            <span className="eyebrow">Next should be · #{session.cursor + 1}</span>
            <div className="sc-cur-sku">{curInfo.sku || "—"}</div>
            <div className="sc-cur-title">{curInfo.title || <em>no title</em>}</div>
            {curInfo.tag ? <span className="badge2">{curInfo.tag}</span> : null}
            <div className="sc-actions">
              <button className="btn btn-primary sc-big" onClick={() => act(confirmCurrent(session))} disabled={busy}>✓ Matches</button>
              <button className="btn sc-big" onClick={() => act(notHere(session))} disabled={busy}>✗ Not in my hand</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="sc-current sc-end">
          <div className="sc-cur-body">
            <span className="eyebrow">End of the stack in the app</span>
            <div className="sc-cur-title">Any cards left in your hand? Type each SKU below and it goes on the end. Then save.</div>
          </div>
        </div>
      )}

      {upcoming.length ? (
        <div className="sc-instead">
          <span className="hint-small">Card in your hand is one of these?</span>
          <div className="sc-chips">
            {upcoming.map((id) => {
              const i = info(id);
              return (
                <button key={id} className="sc-chip" onClick={() => act(bringHere(session, id))} disabled={busy} title={i.title}>
                  <b>{i.sku || "—"}</b> <span>{i.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="dd-search sc-sku">
        <div className="dd-combo"><div className="dd-inp"><span className="mag" aria-hidden="true">#</span>
          <input ref={skuRef} value={sku} onChange={(e) => { setSku(e.target.value); setAnswer(null); }} onKeyDown={(e) => { if (e.key === "Enter") lookUp(); }} placeholder="Or type the SKU on the card in your hand" aria-label="SKU of the card in your hand" autoCapitalize="characters" autoCorrect="off" />
        </div></div>
        <button className="btn btn-primary" onClick={lookUp} disabled={busy || !sku.trim()}>Put it here</button>
      </div>
      {answer ? (
        <div className="sc-answer">
          {answer.kind === "here" ? (
            <>
              <span>{answer.typed} was already checked further up (#{session.order.indexOf(answer.id) + 1}). Is that copy really here instead?</span>
              <button className="btn btn-ghost" onClick={takeAnswer}>Move it here</button>
            </>
          ) : answer.kind === "elsewhere" ? (
            <>
              <span><b>{answer.card.sku}</b> is in <b>{stackNames.get(answer.card.stack_id) || "another stack"}</b> in the app. It's in your hand here, so move it into {stack.name}?</span>
              <button className="btn btn-ghost" onClick={takeAnswer}>Move it here</button>
            </>
          ) : answer.kind === "away" ? (
            <span><b>{answer.card.sku}</b> is checked out to a show. Check it back in from the Show desk first. It can't be filed from here while it's out.</span>
          ) : (
            <>
              <span>No card in the app has SKU <b>{answer.typed}</b>{listing.get(answer.typed.toLowerCase()) ? <> (it's listed on eBay as “{listing.get(answer.typed.toLowerCase()).title}”)</> : null}. Add it here as a new card?</span>
              <button className="btn btn-ghost" onClick={takeAnswer}>Add it here</button>
            </>
          )}
        </div>
      ) : null}

      {session.missing.length ? (
        <div className="sc-missing">
          <span className="eyebrow">Not found ({session.missing.length})</span>
          <p className="hint hint-small" style={{ marginTop: 4 }}>Tick the ones that have gone (sold, lost) to pull them. Unticked ones go to the back of the stack. Tap ↩ if one turns up.</p>
          {session.missing.map((id) => {
            const i = info(id);
            return (
              <label className="ps-row" key={id}>
                <input type="checkbox" checked={pullSel.has(id)} onChange={() => setPullSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
                <span className="stack-sku">{i.sku || "—"}</span>
                <span className="stack-title">{i.title || <em>—</em>}</span>
                <button className="stack-pull sc-mini" onClick={(e) => { e.preventDefault(); act(unmissing(session, id)); setPullSel((p) => { const n = new Set(p); n.delete(id); return n; }); }}>↩</button>
              </label>
            );
          })}
        </div>
      ) : null}

      <div className="sc-bar">
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "💾 Save order"}</button>
        <button className="btn btn-ghost" onClick={undo} disabled={busy || !history.length}>↶ Undo</button>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close (keep check)</button>
        <button className="btn btn-ghost" onClick={discard} disabled={busy}>Discard</button>
      </div>
      {msg ? <p className="hint hint-small" style={{ color: msg.startsWith("⚠") ? "var(--warn-ink)" : "var(--accent-2)" }}>{msg}</p> : null}

      <div className="sc-list-head">
        <span className="eyebrow">The stack as it will be saved</span>
        <button className="btn btn-ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show near here" : `Show all ${session.order.length}`}</button>
      </div>
      <div className="stack-list">
        {listIds.map((id, k) => {
          const idx = listStart + k;
          const i = info(id);
          const state = idx < session.cursor ? "seen" : idx === session.cursor ? "next" : "todo";
          return (
            <div className={`stack-row sc-row sc-${state}`} key={id}>
              <button className="stack-pos sc-pos" onClick={() => act(setCursor(session, idx))} title="Carry on checking from this card">{idx + 1}</button>
              <span className="sc-state" aria-label={state}>{state === "seen" ? "✓" : state === "next" ? "▶" : ""}</span>
              <span className="stack-sku">{i.sku || "—"}</span>
              <span className="stack-title">{i.title || <em>—</em>}{i.tag ? <span className="badge2 sc-tag">{i.tag}</span> : null}</span>
              <span className="sc-arrows">
                <button className="stack-pull sc-mini" onClick={() => act(moveCard(session, id, -1))} disabled={busy || idx === 0} aria-label="Move up">↑</button>
                <button className="stack-pull sc-mini" onClick={() => act(moveCard(session, id, +1))} disabled={busy || idx === session.order.length - 1} aria-label="Move down">↓</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
