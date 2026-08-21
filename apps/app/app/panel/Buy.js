"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { pagedSelect } from "@/lib/pagedSelect";
import { resizeImage } from "@/lib/resizeImage";
import CameraCapture from "./CameraCapture";
import Icon from "./icons";

const BUCKET = "purchase-photos";
const toPence = CompFinderPricing.toPence;
const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const qtyOf = (v) => Math.max(1, parseInt(v, 10) || 1);

const CATEGORIES = ["Singles", "Sealed / boxes", "Supplies", "Postage", "Fees", "Other"];
const emptyDeal = () => ({ source: "", purchased_at: todayStr(), note: "", totalAmount: "", entryMode: "cards", description: "", bulkQty: "", cards: [{ name: "", amount: "", quantity: "1" }] });
const emptyExpense = () => ({ description: "", category: "Singles", amount: "", source: "", purchased_at: todayStr(), note: "" });

/**
 * Buy — a purchase ledger. Log a DEAL (either itemised cards — priced per-card
 * or split from a lump sum — or a BULK LOT logged as one line with no card
 * list) or a general spend line. Photos of the haul attach to either. Any
 * entry can be reopened with ✎ and fully edited after the fact (a bulk lot
 * can even be itemised later once you've sorted it). The deal is one
 * `purchases` row (the total + count) with its cards in `deal_cards`.
 */
export default function Buy() {
  const [rows, setRows] = useState(null);
  const [dealCards, setDealCards] = useState({}); // purchaseId -> [cards]
  const [kind, setKind] = useState("deal"); // deal | expense
  const [deal, setDeal] = useState(emptyDeal);
  const [expense, setExpense] = useState(emptyExpense);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month"); // month | year | all
  const [photoUrls, setPhotoUrls] = useState({});
  const [formHaul, setFormHaul] = useState([]); // "what you took in" photos
  const [formReceipts, setFormReceipts] = useState([]); // proof of purchase
  const [attaching, setAttaching] = useState(null); // `${id}:${field}`
  const [gallery, setGallery] = useState(null); // { rowId, field, index }
  const [camTarget, setCamTarget] = useState(null); // {mode:'form',setter} | {mode:'row',row,field}
  const [expanded, setExpanded] = useState(new Set());
  const [editing, setEditing] = useState(null); // purchases row being edited (null = adding new)
  const [addTarget, setAddTarget] = useState(null); // photo-source chooser target (same shape as camTarget)
  const fileRef = useRef(null); // shared hidden file input behind the chooser
  const uploadTargetRef = useRef(null);
  const formRef = useRef(null);

  async function load() {
    const sb = createClient();
    const data = await pagedSelect(() =>
      sb.from("purchases").select("id,kind,description,quantity,amount_pence,category,source,purchased_at,note,photo_paths,receipt_paths,pricing_mode").order("purchased_at", { ascending: false })
    );
    setRows(data || []);
    const dcs = await pagedSelect(() => sb.from("deal_cards").select("id,purchase_id,name,amount_pence,quantity,allocated,position").order("position", { ascending: true }));
    const map = {};
    for (const d of dcs || []) (map[d.purchase_id] ||= []).push(d);
    setDealCards(map);
    const paths = (data || []).flatMap((r) => [...(r.photo_paths || []), ...(r.receipt_paths || [])]);
    if (paths.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      const m = {};
      for (const s of signed || []) if (s.signedUrl && !s.error) m[s.path] = s.signedUrl;
      setPhotoUrls(m);
    } else {
      setPhotoUrls({});
    }
  }

  useEffect(() => {
    load();
  }, []);

  // ---- deal form helpers ----
  const setDealField = (k, v) => setDeal((d) => ({ ...d, [k]: v }));
  const setCard = (i, patch) => setDeal((d) => ({ ...d, cards: d.cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  const addCard = () => setDeal((d) => ({ ...d, cards: [...d.cards, { name: "", amount: "", quantity: "1" }] }));
  const removeCard = (i) => setDeal((d) => ({ ...d, cards: d.cards.length > 1 ? d.cards.filter((_, idx) => idx !== i) : d.cards }));

  // ---- photos ----
  async function uploadOne(sb, file, userId) {
    const blob = await resizeImage(file);
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) throw new Error(upErr.message);
    return path;
  }
  function removePhoto(setter, i) {
    setter((prev) => { const p = prev[i]; if (p) URL.revokeObjectURL(p.url); return prev.filter((_, idx) => idx !== i); });
  }
  function clearPhotos(setter) {
    setter((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }
  // In-app camera (works inside the iOS Home Screen app, unlike the native
  // capture). Targets either a form tray (stash locally, uploaded on save) or a
  // ledger row (uploaded immediately via attachPhotos).
  // One "add" button per tray/cell opens a chooser: take a photo (in-app
  // camera) or upload a file. Both routes share the same target shape.
  function chooseCamera() {
    const t = addTarget;
    setAddTarget(null);
    if (t) setCamTarget(t);
  }
  function chooseUpload() {
    uploadTargetRef.current = addTarget;
    setAddTarget(null);
    fileRef.current?.click();
  }
  function onHiddenFiles(e) {
    const t = uploadTargetRef.current;
    uploadTargetRef.current = null;
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!t || !files.length) return;
    if (t.mode === "form") t.setter((prev) => [...prev, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    else attachPhotos(t.row, files, t.field);
  }
  async function onCameraCapture(file) {
    const t = camTarget;
    setCamTarget(null);
    if (!t) return;
    if (t.mode === "form") t.setter((prev) => [...prev, { file, url: URL.createObjectURL(file) }]);
    else if (t.mode === "row") await attachPhotos(t.row, [file], t.field);
  }

  // Derived deal maths (live). Agreed per-card prices stand; any card left blank
  // shares the remainder of the deal total evenly (a "thrown-in" card). If no
  // deal total is entered, the total is just the sum of the priced cards.
  const dealCardsFilled = deal.cards.filter((c) => c.name.trim());
  const dealCardCount = dealCardsFilled.reduce((s, c) => s + qtyOf(c.quantity), 0);
  const pricedSum = dealCardsFilled.reduce((s, c) => (toPence(c.amount) > 0 ? s + toPence(c.amount) * qtyOf(c.quantity) : s), 0);
  const unpricedUnits = dealCardsFilled.reduce((s, c) => (toPence(c.amount) > 0 ? s : s + qtyOf(c.quantity)), 0);
  const totalEntered = toPence(deal.totalAmount) > 0 ? toPence(deal.totalAmount) : null;
  const useTotal = totalEntered != null && unpricedUnits > 0; // total drives the split only when there are cards to absorb it
  const dealComputedTotal = useTotal ? totalEntered : pricedSum;
  const remainder = useTotal ? totalEntered - pricedSum : 0;
  const perUnpriced = useTotal && unpricedUnits > 0 ? remainder / unpricedUnits : 0;
  const dealOver = useTotal && remainder < 0;
  const totalIgnored = totalEntered != null && unpricedUnits === 0; // every card priced, so the sum wins

  async function add(e) {
    e?.preventDefault();
    setError("");
    setSaving(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const newHaul = [];
      for (const p of formHaul) newHaul.push(await uploadOne(sb, p.file, user.id));
      const newReceipts = [];
      for (const p of formReceipts) newReceipts.push(await uploadOne(sb, p.file, user.id));
      // When editing, existing attachments stay and new ones append.
      const photo_paths = editing ? [...(editing.photo_paths || []), ...newHaul] : newHaul;
      const receipt_paths = editing ? [...(editing.receipt_paths || []), ...newReceipts] : newReceipts;

      if (kind === "deal") {
        let dealRow;
        let cardRows = []; // deal_cards to write (empty for a bulk lot)
        if (deal.entryMode === "bulk") {
          const total = toPence(deal.totalAmount);
          if (!deal.description.trim()) { setError("Describe the lot — e.g. “MTG block lot, mixed rares & bulk”."); setSaving(false); return; }
          if (!(total > 0)) { setError("Enter the total price paid for the lot."); setSaving(false); return; }
          const qty = parseInt(deal.bulkQty, 10) > 0 ? parseInt(deal.bulkQty, 10) : null;
          dealRow = {
            kind: "card",
            description: deal.description.trim(),
            quantity: qty,
            amount_pence: total,
            category: null,
            source: deal.source.trim() || null,
            purchased_at: deal.purchased_at || todayStr(),
            note: deal.note.trim() || null,
            photo_paths,
            receipt_paths,
            pricing_mode: "total"
          };
        } else {
          const cards = deal.cards.filter((c) => c.name.trim());
          if (!cards.length) { setError("Add at least one card — or switch the deal type to “Bulk lot” to log it as one line."); setSaving(false); return; }
          if (dealOver) { setError(`The agreed card prices (${pounds(pricedSum)}) already exceed the deal total (${pounds(totalEntered)}).`); setSaving(false); return; }
          if (!(dealComputedTotal > 0)) { setError("Enter a deal total, or a price on at least one card."); setSaving(false); return; }
          dealRow = {
            kind: "card",
            description: deal.source.trim() || "Deal",
            quantity: dealCardCount,
            amount_pence: dealComputedTotal,
            category: null,
            source: deal.source.trim() || null,
            purchased_at: deal.purchased_at || todayStr(),
            note: deal.note.trim() || null,
            photo_paths,
            receipt_paths,
            pricing_mode: useTotal ? "mixed" : "per_card"
          };
          cardRows = cards.map((c, i) => {
            const p = toPence(c.amount);
            const isPriced = p > 0;
            return {
              user_id: user.id,
              name: c.name.trim(),
              amount_pence: isPriced ? p : useTotal ? Math.max(0, Math.round(perUnpriced)) : null,
              quantity: qtyOf(c.quantity),
              allocated: !isPriced && useTotal,
              position: i
            };
          });
        }

        let purchaseId;
        if (editing) {
          const { error: e1 } = await sb.from("purchases").update(dealRow).eq("id", editing.id);
          if (e1) throw new Error(e1.message);
          purchaseId = editing.id;
          // Replace the card list wholesale (also clears it when switching to bulk).
          const { error: eDel } = await sb.from("deal_cards").delete().eq("purchase_id", purchaseId);
          if (eDel) throw new Error(eDel.message);
        } else {
          const { data: inserted, error: e1 } = await sb.from("purchases").insert({ ...dealRow, user_id: user.id }).select("id").single();
          if (e1) throw new Error(e1.message);
          purchaseId = inserted.id;
        }
        if (cardRows.length) {
          const { error: e2 } = await sb.from("deal_cards").insert(cardRows.map((c) => ({ ...c, purchase_id: purchaseId })));
          if (e2) throw new Error(e2.message);
        }
        setDeal((d) => (editing ? emptyDeal() : { ...emptyDeal(), purchased_at: d.purchased_at, source: d.source, entryMode: d.entryMode }));
      } else {
        const amountPence = toPence(expense.amount);
        if (!expense.description.trim()) { setError("Add a description."); setSaving(false); return; }
        if (!(amountPence > 0)) { setError("Enter an amount greater than £0."); setSaving(false); return; }
        const row = {
          kind: "expense",
          description: expense.description.trim(),
          quantity: null,
          amount_pence: amountPence,
          category: expense.category,
          source: expense.source.trim() || null,
          purchased_at: expense.purchased_at || todayStr(),
          note: expense.note.trim() || null,
          photo_paths,
          receipt_paths
        };
        if (editing) {
          const { error: err } = await sb.from("purchases").update(row).eq("id", editing.id);
          if (err) throw new Error(err.message);
        } else {
          const { error: err } = await sb.from("purchases").insert({ ...row, user_id: user.id });
          if (err) throw new Error(err.message);
        }
        setExpense((x) => (editing ? emptyExpense() : { ...emptyExpense(), purchased_at: x.purchased_at, source: x.source, category: x.category }));
      }
      setEditing(null);
      clearPhotos(setFormHaul);
      clearPhotos(setFormReceipts);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save that.");
    }
    setSaving(false);
  }

  // Reopen an entry in the form for after-the-fact editing (fix a price, add
  // detail to a bulk lot, itemise it later…). Existing photos stay attached.
  function startEdit(row) {
    setError("");
    if (row.kind === "card") {
      const dcs = dealCards[row.id] || [];
      setKind("deal");
      setDeal({
        source: row.source || "",
        purchased_at: row.purchased_at || todayStr(),
        note: row.note || "",
        totalAmount: row.pricing_mode === "per_card" ? "" : row.amount_pence != null ? (row.amount_pence / 100).toFixed(2) : "",
        entryMode: dcs.length ? "cards" : "bulk",
        description: row.description || "",
        bulkQty: row.quantity ? String(row.quantity) : "",
        cards: dcs.length
          ? dcs.map((d) => ({
              name: d.name || "",
              amount: d.allocated || d.amount_pence == null ? "" : (d.amount_pence / 100).toFixed(2),
              quantity: String(d.quantity || 1)
            }))
          : [{ name: "", amount: "", quantity: "1" }]
      });
    } else {
      setKind("expense");
      setExpense({
        description: row.description || "",
        category: row.category || "Singles",
        amount: row.amount_pence != null ? (row.amount_pence / 100).toFixed(2) : "",
        source: row.source || "",
        purchased_at: row.purchased_at || todayStr(),
        note: row.note || ""
      });
    }
    setEditing(row);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function cancelEdit() {
    setEditing(null);
    setDeal(emptyDeal());
    setExpense(emptyExpense());
    clearPhotos(setFormHaul);
    clearPhotos(setFormReceipts);
    setError("");
  }

  // Attach to either the haul photos (field='photo_paths') or receipts
  // (field='receipt_paths') of a purchase.
  async function attachPhotos(row, files, field) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setAttaching(`${row.id}:${field}`);
    setError("");
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const added = [];
      for (const f of list) added.push(await uploadOne(sb, f, user.id));
      const next = [...(row[field] || []), ...added];
      const { error: err } = await sb.from("purchases").update({ [field]: next }).eq("id", row.id);
      if (err) throw new Error(err.message);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't attach that image.");
    }
    setAttaching(null);
  }

  async function deletePhoto(row, field, path) {
    const sb = createClient();
    const next = (row[field] || []).filter((p) => p !== path);
    await sb.from("purchases").update({ [field]: next }).eq("id", row.id);
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    await load();
    if (next.length === 0) setGallery(null);
    else setGallery((g) => (g ? { ...g, index: Math.min(g.index, next.length - 1) } : g));
  }

  async function remove(row) {
    if (!confirm("Delete this purchase?")) return;
    const sb = createClient();
    await sb.from("purchases").delete().eq("id", row.id); // deal_cards cascade
    const all = [...(row.photo_paths || []), ...(row.receipt_paths || [])];
    if (all.length) await sb.storage.from(BUCKET).remove(all).catch(() => {});
    setRows((r) => (r || []).filter((x) => x.id !== row.id));
  }

  function toggleExpand(id) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const inPeriod = useMemo(() => {
    if (!rows) return [];
    if (period === "all") return rows;
    const now = new Date();
    const from = period === "month" ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), 0, 1);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    return rows.filter((r) => (r.purchased_at || "") >= fromStr);
  }, [rows, period]);

  const totals = useMemo(() => {
    let spend = 0, cardUnits = 0, expenseTot = 0;
    for (const r of inPeriod) {
      spend += r.amount_pence || 0;
      if (r.kind === "card") cardUnits += r.quantity || 1;
      else expenseTot += r.amount_pence || 0;
    }
    return { spend, cardUnits, expense: expenseTot, count: inPeriod.length };
  }, [inPeriod]);

  const allTimeSpend = useMemo(() => (rows || []).reduce((s, r) => s + (r.amount_pence || 0), 0), [rows]);

  if (rows === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading purchases…</div>;

  const periodLabel = period === "month" ? "this month" : period === "year" ? "this year" : "all time";
  const galRow = gallery ? (rows || []).find((r) => r.id === gallery.rowId) : null;
  const galField = gallery ? gallery.field : "photo_paths";
  const galPaths = galRow ? galRow[galField] || [] : [];
  const galIdx = gallery ? Math.min(gallery.index, Math.max(0, galPaths.length - 1)) : 0;
  const galIsReceipt = galField === "receipt_paths";

  // Cards for a deal row (from deal_cards, or a 1-card fallback for legacy rows).
  const cardsFor = (r) => dealCards[r.id] || [{ id: "legacy", name: r.description, amount_pence: r.amount_pence, quantity: r.quantity || 1 }];

  const tray = (items, setter, label, hint) => (
    <div className="buy-field buy-photo-field">
      <span>{label} <span className="buy-opt">{hint}</span></span>
      <div className="buy-photo-tray">
        {items.map((p, i) => (
          <div className="buy-photo-preview" key={i}>
            <img src={p.url} alt={`Preview ${i + 1}`} />
            <button type="button" className="buy-photo-x" onClick={() => removePhoto(setter, i)} aria-label="Remove">✕</button>
          </div>
        ))}
        <button type="button" className="buy-photo-btn" onClick={() => setAddTarget({ mode: "form", setter })}>
          ＋ <span>{items.length ? "Add more" : "Add"}</span>
        </button>
      </div>
    </div>
  );
  const attachments = (
    <>
      {tray(formHaul, setFormHaul, "Photos of the haul", "(optional — a snap of what you took in)")}
      {tray(formReceipts, setFormReceipts, "Receipt / invoice", "(optional — proof of purchase: receipt, Amazon invoice, PayPal…)")}
    </>
  );

  return (
    <div className="rise-group">
      {camTarget ? (
        <CameraCapture label="Snap the receipt or haul" onCapture={onCameraCapture} onClose={() => setCamTarget(null)} />
      ) : null}
      {addTarget ? (
        <div className="buy-sheet-backdrop" onClick={() => setAddTarget(null)}>
          <div className="buy-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add a photo">
            <button type="button" className="buy-sheet-btn" onClick={chooseCamera}><Icon name="camera" size={20} /> Take a photo</button>
            <button type="button" className="buy-sheet-btn" onClick={chooseUpload}><Icon name="upload" size={20} /> Upload from device</button>
            <button type="button" className="buy-sheet-cancel" onClick={() => setAddTarget(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onHiddenFiles} />
      <div className="stat-row">
        <div className="stat"><div className="k">Spend ({periodLabel})</div><div className="v">{pounds(totals.spend)}</div></div>
        <div className="stat"><div className="k">Cards bought</div><div className="v">{totals.cardUnits}</div></div>
        <div className="stat"><div className="k">Other spend</div><div className="v">{pounds(totals.expense)}</div></div>
        <div className="stat"><div className="k">Total invested</div><div className="v">{pounds(allTimeSpend)}</div></div>
      </div>

      <div className="panel" ref={formRef}>
        <div className="panel-head">
          <h3>{editing ? "Edit purchase" : "Log a purchase"}</h3>
          {editing ? <button className="btn btn-ghost" onClick={cancelEdit}>Cancel edit</button> : null}
        </div>
        {editing ? (
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Editing the {fmtDate(editing.purchased_at)} entry — change anything and save. Existing photos stay attached; anything added below is appended.
          </p>
        ) : null}
        <div className="pills" role="group" aria-label="Purchase type" style={{ marginBottom: 12 }}>
          <button aria-pressed={kind === "deal"} onClick={() => setKind("deal")} disabled={!!editing}>🎴 Deal</button>
          <button aria-pressed={kind === "expense"} onClick={() => setKind("expense")} disabled={!!editing}>💷 Other spend</button>
        </div>

        {kind === "deal" ? (
          <form className="buy-form" onSubmit={add}>
            <label className="buy-field">
              <span>Bought from <span className="buy-opt">(person / source)</span></span>
              <input type="text" value={deal.source} onChange={(e) => setDealField("source", e.target.value)} placeholder="e.g. John @ card fair, eBay seller, wholesale" />
            </label>
            <label className="buy-field">
              <span>Date</span>
              <input type="date" value={deal.purchased_at} onChange={(e) => setDealField("purchased_at", e.target.value)} />
            </label>
            <label className="buy-field buy-note">
              <span>Note <span className="buy-opt">(optional)</span></span>
              <input type="text" value={deal.note} onChange={(e) => setDealField("note", e.target.value)} placeholder="Anything worth remembering" />
            </label>

            <label className="buy-field">
              <span>Deal type</span>
              <select value={deal.entryMode} onChange={(e) => setDealField("entryMode", e.target.value)}>
                <option value="cards">List individual cards</option>
                <option value="bulk">Bulk lot — one line, no card list</option>
              </select>
            </label>

            {deal.entryMode === "bulk" ? (
              <>
                <label className="buy-field buy-desc">
                  <span>What did you buy?</span>
                  <input type="text" value={deal.description} onChange={(e) => setDealField("description", e.target.value)} placeholder="e.g. MTG block lot — mixed rares & bulk" />
                </label>
                <label className="buy-field">
                  <span>Approx. card count <span className="buy-opt">(optional)</span></span>
                  <input type="number" min="1" step="1" value={deal.bulkQty} onChange={(e) => setDealField("bulkQty", e.target.value)} placeholder="e.g. 400" />
                </label>
                <label className="buy-field buy-amt">
                  <span>Total paid (£)</span>
                  <input type="number" min="0" step="0.01" value={deal.totalAmount} onChange={(e) => setDealField("totalAmount", e.target.value)} placeholder="0.00" />
                </label>
                <div className="buy-field buy-desc">
                  <span className="buy-opt">You can reopen this later with ✎ and itemise the cards once you&apos;ve sorted through the lot.</span>
                </div>
              </>
            ) : (
              <>
                <label className="buy-field buy-amt">
                  <span>Total deal price (£) <span className="buy-opt">— optional; leave blank to total up the card prices</span></span>
                  <input type="number" min="0" step="0.01" value={deal.totalAmount} onChange={(e) => setDealField("totalAmount", e.target.value)} placeholder="e.g. 100.00 for the whole lot" />
                </label>

                <div className="buy-field buy-desc">
                  <span>Cards in this deal <span className="buy-opt">— price the ones you agreed; leave the rest blank</span></span>
                  <div className="deal-entry">
                    {deal.cards.map((c, i) => (
                      <div className="deal-entry-row" key={i}>
                        <input className="deal-name-inp" type="text" value={c.name} onChange={(e) => setCard(i, { name: e.target.value })} placeholder={`Card ${i + 1} — e.g. Charizard ex 006/165`} />
                        <input className="deal-qty-inp" type="number" min="1" step="1" value={c.quantity} onChange={(e) => setCard(i, { quantity: e.target.value })} title="Quantity" placeholder="Qty" aria-label="Quantity" />
                        <input className="deal-price-inp" type="number" min="0" step="0.01" value={c.amount} onChange={(e) => setCard(i, { amount: e.target.value })} placeholder="£ (blank = split)" />
                        <button type="button" className="itbl-del" title="Remove card" aria-label="Remove card" onClick={() => removeCard(i)} disabled={deal.cards.length === 1}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-ghost deal-add-card" onClick={addCard}>+ Add card</button>
                  </div>
                </div>

                <div className="buy-field buy-desc">
                  <span>Deal summary</span>
                  <div className={`deal-summary${dealOver ? " over" : ""}`}>
                    <div className="deal-total">{pounds(dealComputedTotal)} <span className="buy-opt">· {dealCardCount} card{dealCardCount === 1 ? "" : "s"}</span></div>
                    {dealOver ? (
                      <div className="deal-sum-warn">⚠ Agreed prices ({pounds(pricedSum)}) exceed the deal total ({pounds(totalEntered)}).</div>
                    ) : useTotal ? (
                      <div className="deal-sum-line">
                        {pricedSum > 0 ? <>{pounds(pricedSum)} agreed · </> : null}
                        <b>{pounds(remainder)}</b> split across {unpricedUnits} card{unpricedUnits === 1 ? "" : "s"} = <b>{pounds(Math.round(perUnpriced))}</b> each
                      </div>
                    ) : totalIgnored ? (
                      <div className="deal-sum-line">Every card priced — total taken from the card prices.</div>
                    ) : unpricedUnits > 0 ? (
                      <div className="deal-sum-line">{unpricedUnits} unpriced card{unpricedUnits === 1 ? "" : "s"} logged at £0 (add a deal total to share a cost across them).</div>
                    ) : null}
                  </div>
                </div>
              </>
            )}

            {attachments}
            <div className="buy-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "+ Add deal"}</button>
            </div>
          </form>
        ) : (
          <form className="buy-form" onSubmit={add}>
            <label className="buy-field buy-desc">
              <span>Description</span>
              <input type="text" value={expense.description} onChange={(e) => setExpense((x) => ({ ...x, description: e.target.value }))} placeholder="e.g. Scarlet & Violet booster box, sleeves, postage" />
            </label>
            <label className="buy-field">
              <span>Category</span>
              <select value={expense.category} onChange={(e) => setExpense((x) => ({ ...x, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="buy-field buy-amt">
              <span>Amount paid (£)</span>
              <input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense((x) => ({ ...x, amount: e.target.value }))} placeholder="0.00" />
            </label>
            <label className="buy-field">
              <span>Date</span>
              <input type="date" value={expense.purchased_at} onChange={(e) => setExpense((x) => ({ ...x, purchased_at: e.target.value }))} />
            </label>
            <label className="buy-field">
              <span>Source <span className="buy-opt">(optional)</span></span>
              <input type="text" value={expense.source} onChange={(e) => setExpense((x) => ({ ...x, source: e.target.value }))} placeholder="e.g. Amazon, eBay" />
            </label>
            <label className="buy-field buy-note">
              <span>Note <span className="buy-opt">(optional)</span></span>
              <input type="text" value={expense.note} onChange={(e) => setExpense((x) => ({ ...x, note: e.target.value }))} placeholder="Anything worth remembering" />
            </label>
            {attachments}
            <div className="buy-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "+ Add spend"}</button>
            </div>
          </form>
        )}
        {error ? <p className="compfinder-error" style={{ marginTop: 8 }}>{error}</p> : null}
      </div>

      <div className="inv-bar">
        <div className="pills" role="group" aria-label="Period">
          <button aria-pressed={period === "month"} onClick={() => setPeriod("month")}>This month</button>
          <button aria-pressed={period === "year"} onClick={() => setPeriod("year")}>This year</button>
          <button aria-pressed={period === "all"} onClick={() => setPeriod("all")}>All time</button>
        </div>
        <div className="inv-meta"><span className="chip">{totals.count} entr{totals.count === 1 ? "y" : "ies"}</span></div>
      </div>

      {inPeriod.length === 0 ? (
        <div className="panel"><p className="dd-empty">No purchases logged {periodLabel}. Add one above to start tracking spend.</p></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="itbl">
              <thead>
                <tr><th aria-label="Haul photo"></th><th aria-label="Receipt"></th><th>Date</th><th>Type</th><th>Description</th><th>Cards</th><th>From</th><th>Amount</th><th aria-label="Actions"></th></tr>
              </thead>
              <tbody>
                {inPeriod.map((r) => {
                  const isDeal = r.kind === "card";
                  const hasCards = isDeal && (dealCards[r.id] || []).length > 0;
                  const cards = isDeal ? cardsFor(r) : null;
                  const cardCount = isDeal ? (r.quantity || (hasCards ? cards.reduce((s, c) => s + (c.quantity || 1), 0) : null)) : null;
                  const isOpen = expanded.has(r.id);
                  const photoCell = (field, icon, addTitle) => {
                    const paths = r[field] || [];
                    const cover = paths.find((p) => photoUrls[p]);
                    const busy = attaching === `${r.id}:${field}`;
                    return (
                      <td className="buy-photo-cell">
                        {cover ? (
                          <button type="button" className="buy-thumb" onClick={() => setGallery({ rowId: r.id, field, index: 0 })} title={`View ${paths.length} ${addTitle}(s)`}>
                            <img src={photoUrls[cover]} alt={addTitle} loading="lazy" />
                            {paths.length > 1 ? <span className="buy-thumb-badge">{paths.length}</span> : null}
                          </button>
                        ) : (
                          <button type="button" className="buy-thumb-mini" title={`Add ${addTitle}`} disabled={busy} onClick={() => setAddTarget({ mode: "row", row: r, field })}>
                            {busy ? <span className="spinner" /> : icon}
                          </button>
                        )}
                      </td>
                    );
                  };
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        {photoCell("photo_paths", "📷", "photo")}
                        {photoCell("receipt_paths", "🧾", "receipt")}
                        <td className="mono">{fmtDate(r.purchased_at)}</td>
                        <td>{isDeal ? <span className="badge2">Deal</span> : <span className="badge2 badge-muted">{r.category || "Spend"}</span>}</td>
                        <td className="itbl-title">
                          {isDeal && hasCards ? (
                            <button type="button" className="deal-toggle" onClick={() => toggleExpand(r.id)} aria-expanded={isOpen}>
                              <span className="deal-caret">{isOpen ? "▾" : "▸"}</span> {cardCount} card{cardCount === 1 ? "" : "s"}
                              {r.pricing_mode === "total" ? <span className="buy-opt"> · lump sum</span> : null}
                            </button>
                          ) : isDeal ? (
                            <>{r.description}<span className="buy-opt"> · bulk lot</span></>
                          ) : (
                            r.description
                          )}
                          {r.note ? <span className="buy-rownote"> · {r.note}</span> : null}
                        </td>
                        <td>{isDeal && cardCount != null ? cardCount : "—"}</td>
                        <td>{r.source || "—"}</td>
                        <td className="mono">{pounds(r.amount_pence)}</td>
                        <td>
                          <div className="itbl-actbtns">
                            <button className="itbl-edit" title="Edit this entry" aria-label="Edit purchase" onClick={() => startEdit(r)}>✎</button>
                            <button className="itbl-del" title="Delete" aria-label="Delete purchase" onClick={() => remove(r)}>✕</button>
                          </div>
                        </td>
                      </tr>
                      {hasCards && isOpen ? (
                        <tr className="deal-detail-row">
                          <td></td>
                          <td></td>
                          <td colSpan={7}>
                            <div className="deal-cards-list">
                              {cards.map((c, i) => (
                                <div className="deal-card-line" key={c.id || i}>
                                  <span className="deal-card-name">{c.name || <em>—</em>}</span>
                                  {(c.quantity || 1) > 1 ? <span className="deal-card-qty">×{c.quantity}</span> : null}
                                  {c.allocated ? <span className="deal-card-tag">split</span> : null}
                                  <span className="deal-card-price">{c.amount_pence != null ? pounds(c.amount_pence) : "—"}</span>
                                </div>
                              ))}
                              {r.pricing_mode === "mixed" ? <div className="deal-card-note">“split” cards share the leftover of the {pounds(r.amount_pence)} deal total.</div> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {galRow && galPaths.length ? (
        <div className="buy-lightbox" onClick={() => setGallery(null)} role="dialog" aria-label={galIsReceipt ? "Receipts" : "Purchase photos"}>
          <button className="buy-lightbox-x" onClick={() => setGallery(null)} aria-label="Close">✕</button>
          <div className="buy-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            {galPaths.length > 1 ? (
              <button className="buy-lb-nav prev" onClick={() => setGallery((g) => ({ ...g, index: (galIdx - 1 + galPaths.length) % galPaths.length }))} aria-label="Previous">‹</button>
            ) : null}
            <img src={photoUrls[galPaths[galIdx]]} alt={`${galIsReceipt ? "Receipt" : "Purchase photo"} ${galIdx + 1}`} />
            {galPaths.length > 1 ? (
              <button className="buy-lb-nav next" onClick={() => setGallery((g) => ({ ...g, index: (galIdx + 1) % galPaths.length }))} aria-label="Next">›</button>
            ) : null}
          </div>
          <div className="buy-lb-bar" onClick={(e) => e.stopPropagation()}>
            <span className="buy-lb-count">{galIsReceipt ? "Receipt" : "Photo"} {galIdx + 1} / {galPaths.length}</span>
            <button type="button" className="btn btn-ghost buy-lb-add" disabled={attaching === `${galRow.id}:${galField}`} onClick={() => setAddTarget({ mode: "row", row: galRow, field: galField })}>
              {attaching === `${galRow.id}:${galField}` ? "Uploading…" : "＋ Add"}
            </button>
            <button className="btn btn-ghost buy-lb-del" onClick={() => { if (confirm(`Delete this ${galIsReceipt ? "receipt" : "photo"}?`)) deletePhoto(galRow, galField, galPaths[galIdx]); }}>🗑 Delete</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
