"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";
import { pagedSelect } from "@/lib/pagedSelect";
import { resizeImage } from "@/lib/resizeImage";

const BUCKET = "purchase-photos";
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

const CATEGORIES = ["Singles", "Sealed / boxes", "Supplies", "Postage", "Fees", "Other"];
const emptyForm = () => ({ kind: "card", description: "", quantity: "1", amount: "", category: "Singles", source: "", purchased_at: todayStr(), note: "" });

/**
 * Buy — a purchase ledger. Log either a specific card bought (name, quantity,
 * price paid, source) or a general spend line (a sealed box, sleeves, fees…),
 * and optionally attach one or more photos of the haul as a visual record.
 * Everything rolls into a running spend total. Rows live in the `purchases`
 * table; photos live in a private Storage bucket (RLS: each user owns theirs).
 */
export default function Buy() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month"); // month | year | all
  const [photoUrls, setPhotoUrls] = useState({}); // path -> signed URL
  const [formPhotos, setFormPhotos] = useState([]); // [{ file, url }]
  const [attaching, setAttaching] = useState(null); // row id currently uploading
  const [gallery, setGallery] = useState(null); // { rowId, index }

  async function load() {
    const sb = createClient();
    const data = await pagedSelect(() =>
      sb.from("purchases").select("id,kind,description,quantity,amount_pence,category,source,purchased_at,note,photo_paths").order("purchased_at", { ascending: false })
    );
    setRows(data || []);
    // Sign every photo path so <img> can load them from the private bucket.
    const paths = (data || []).flatMap((r) => r.photo_paths || []);
    if (paths.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      const map = {};
      for (const s of signed || []) if (s.signedUrl && !s.error) map[s.path] = s.signedUrl;
      setPhotoUrls(map);
    } else {
      setPhotoUrls({});
    }
  }

  useEffect(() => {
    load();
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function uploadOne(sb, file, userId) {
    const blob = await resizeImage(file);
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) throw new Error(upErr.message);
    return path;
  }

  function onPickFormPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setFormPhotos((prev) => [...prev, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }
  function removeFormPhoto(i) {
    setFormPhotos((prev) => {
      const p = prev[i];
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((_, idx) => idx !== i);
    });
  }
  function clearFormPhotos() {
    setFormPhotos((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }

  async function add(e) {
    e?.preventDefault();
    setError("");
    const amountPence = CompFinderPricing.toPence(form.amount);
    if (!form.description.trim()) return setError("Add a description.");
    if (!Number.isFinite(amountPence) || amountPence <= 0) return setError("Enter an amount greater than £0.");
    setSaving(true);
    try {
      const sb = createClient();
      const {
        data: { user }
      } = await sb.auth.getUser();
      const photo_paths = [];
      for (const p of formPhotos) photo_paths.push(await uploadOne(sb, p.file, user.id));
      const row = {
        user_id: user.id,
        kind: form.kind,
        description: form.description.trim(),
        quantity: form.kind === "card" ? Math.max(1, parseInt(form.quantity, 10) || 1) : null,
        amount_pence: amountPence,
        category: form.kind === "expense" ? form.category : null,
        source: form.source.trim() || null,
        purchased_at: form.purchased_at || todayStr(),
        note: form.note.trim() || null,
        photo_paths
      };
      const { error: err } = await sb.from("purchases").insert(row);
      if (err) throw new Error(err.message);
      setForm((f) => ({ ...emptyForm(), kind: f.kind, purchased_at: f.purchased_at, source: f.source }));
      clearFormPhotos();
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save that purchase.");
    }
    setSaving(false);
  }

  // Append one or more photos to an existing purchase.
  async function attachPhotos(row, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setAttaching(row.id);
    setError("");
    try {
      const sb = createClient();
      const {
        data: { user }
      } = await sb.auth.getUser();
      const added = [];
      for (const f of list) added.push(await uploadOne(sb, f, user.id));
      const next = [...(row.photo_paths || []), ...added];
      const { error: err } = await sb.from("purchases").update({ photo_paths: next }).eq("id", row.id);
      if (err) throw new Error(err.message);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't attach that photo.");
    }
    setAttaching(null);
  }

  // Remove a single photo from a purchase (from the gallery).
  async function deletePhoto(row, path) {
    const sb = createClient();
    const next = (row.photo_paths || []).filter((p) => p !== path);
    await sb.from("purchases").update({ photo_paths: next }).eq("id", row.id);
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    await load();
    if (next.length === 0) setGallery(null);
    else setGallery((g) => (g ? { ...g, index: Math.min(g.index, next.length - 1) } : g));
  }

  async function remove(row) {
    if (!confirm("Delete this purchase?")) return;
    const sb = createClient();
    await sb.from("purchases").delete().eq("id", row.id);
    if ((row.photo_paths || []).length) await sb.storage.from(BUCKET).remove(row.photo_paths).catch(() => {});
    setRows((r) => (r || []).filter((x) => x.id !== row.id));
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
    let spend = 0;
    let cardUnits = 0;
    let expense = 0;
    for (const r of inPeriod) {
      spend += r.amount_pence || 0;
      if (r.kind === "card") cardUnits += r.quantity || 1;
      else expense += r.amount_pence || 0;
    }
    return { spend, cardUnits, expense, count: inPeriod.length };
  }, [inPeriod]);

  const allTimeSpend = useMemo(() => (rows || []).reduce((s, r) => s + (r.amount_pence || 0), 0), [rows]);

  if (rows === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading purchases…</div>;

  const periodLabel = period === "month" ? "this month" : period === "year" ? "this year" : "all time";

  // Resolve the gallery against live rows so it reflects adds/deletes.
  const galRow = gallery ? (rows || []).find((r) => r.id === gallery.rowId) : null;
  const galPaths = galRow ? galRow.photo_paths || [] : [];
  const galIdx = gallery ? Math.min(gallery.index, Math.max(0, galPaths.length - 1)) : 0;

  return (
    <div className="rise-group">
      <div className="stat-row">
        <div className="stat"><div className="k">Spend ({periodLabel})</div><div className="v">{pounds(totals.spend)}</div></div>
        <div className="stat"><div className="k">Cards bought</div><div className="v">{totals.cardUnits}</div></div>
        <div className="stat"><div className="k">Other spend</div><div className="v">{pounds(totals.expense)}</div></div>
        <div className="stat"><div className="k">Total invested</div><div className="v">{pounds(allTimeSpend)}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Log a purchase</h3></div>
        <div className="pills" role="group" aria-label="Purchase type" style={{ marginBottom: 12 }}>
          <button aria-pressed={form.kind === "card"} onClick={() => set("kind", "card")}>🎴 Card</button>
          <button aria-pressed={form.kind === "expense"} onClick={() => set("kind", "expense")}>💷 Other spend</button>
        </div>
        <form className="buy-form" onSubmit={add}>
          <label className="buy-field buy-desc">
            <span>{form.kind === "card" ? "Card / description" : "Description"}</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={form.kind === "card" ? "e.g. Charizard ex 006/165" : "e.g. Bulk lot / Scarlet & Violet box"}
            />
          </label>

          {form.kind === "card" ? (
            <label className="buy-field buy-qty">
              <span>Qty</span>
              <input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </label>
          ) : (
            <label className="buy-field">
              <span>Category</span>
              <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}

          <label className="buy-field buy-amt">
            <span>Amount paid (£)</span>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
          </label>

          <label className="buy-field">
            <span>Date</span>
            <input type="date" value={form.purchased_at} onChange={(e) => set("purchased_at", e.target.value)} />
          </label>

          <label className="buy-field">
            <span>Source <span className="buy-opt">(optional)</span></span>
            <input type="text" value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="e.g. eBay, card fair, wholesale" />
          </label>

          <label className="buy-field buy-note">
            <span>Note <span className="buy-opt">(optional)</span></span>
            <input type="text" value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Anything worth remembering" />
          </label>

          <div className="buy-field buy-photo-field">
            <span>Photos of the haul <span className="buy-opt">(optional — add as many as you like)</span></span>
            <div className="buy-photo-tray">
              {formPhotos.map((p, i) => (
                <div className="buy-photo-preview" key={i}>
                  <img src={p.url} alt={`Preview ${i + 1}`} />
                  <button type="button" className="buy-photo-x" onClick={() => removeFormPhoto(i)} aria-label="Remove photo">✕</button>
                </div>
              ))}
              <label className="buy-photo-btn">
                📷 <span>{formPhotos.length ? "Add another" : "Snap or upload"}</span>
                <input type="file" accept="image/*" multiple hidden onChange={onPickFormPhotos} />
              </label>
            </div>
          </div>

          <div className="buy-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "+ Add purchase"}</button>
          </div>
        </form>
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
                <tr><th aria-label="Photos"></th><th>Date</th><th>Type</th><th>Description</th><th>Qty</th><th>Source</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {inPeriod.map((r) => {
                  const photos = r.photo_paths || [];
                  const cover = photos.find((p) => photoUrls[p]);
                  return (
                    <tr key={r.id}>
                      <td className="buy-photo-cell">
                        {cover ? (
                          <button type="button" className="buy-thumb" onClick={() => setGallery({ rowId: r.id, index: 0 })} title={`View ${photos.length} photo(s)`}>
                            <img src={photoUrls[cover]} alt="Purchase" loading="lazy" />
                            {photos.length > 1 ? <span className="buy-thumb-badge">{photos.length}</span> : null}
                          </button>
                        ) : (
                          <label className="buy-thumb-add" title="Add photo(s)">
                            {attaching === r.id ? <span className="spinner" /> : "📷"}
                            <input type="file" accept="image/*" multiple hidden disabled={attaching === r.id} onChange={(e) => { const fs = e.target.files; e.target.value = ""; attachPhotos(r, fs); }} />
                          </label>
                        )}
                      </td>
                      <td className="mono">{fmtDate(r.purchased_at)}</td>
                      <td>{r.kind === "card" ? <span className="badge2">Card</span> : <span className="badge2 badge-muted">{r.category || "Spend"}</span>}</td>
                      <td className="itbl-title">
                        {r.description}
                        {r.note ? <span className="buy-rownote"> · {r.note}</span> : null}
                      </td>
                      <td>{r.kind === "card" ? (r.quantity || 1) : "—"}</td>
                      <td>{r.source || "—"}</td>
                      <td className="mono">{pounds(r.amount_pence)}</td>
                      <td><button className="itbl-del" title="Delete" onClick={() => remove(r)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {galRow && galPaths.length ? (
        <div className="buy-lightbox" onClick={() => setGallery(null)} role="dialog" aria-label="Purchase photos">
          <button className="buy-lightbox-x" onClick={() => setGallery(null)} aria-label="Close">✕</button>
          <div className="buy-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            {galPaths.length > 1 ? (
              <button className="buy-lb-nav prev" onClick={() => setGallery((g) => ({ ...g, index: (galIdx - 1 + galPaths.length) % galPaths.length }))} aria-label="Previous">‹</button>
            ) : null}
            <img src={photoUrls[galPaths[galIdx]]} alt={`Purchase photo ${galIdx + 1}`} />
            {galPaths.length > 1 ? (
              <button className="buy-lb-nav next" onClick={() => setGallery((g) => ({ ...g, index: (galIdx + 1) % galPaths.length }))} aria-label="Next">›</button>
            ) : null}
          </div>
          <div className="buy-lb-bar" onClick={(e) => e.stopPropagation()}>
            <span className="buy-lb-count">{galIdx + 1} / {galPaths.length}</span>
            <label className="btn btn-ghost buy-lb-add">
              {attaching === galRow.id ? "Uploading…" : "＋ Add photo"}
              <input type="file" accept="image/*" multiple hidden disabled={attaching === galRow.id} onChange={(e) => { const fs = e.target.files; e.target.value = ""; attachPhotos(galRow, fs); }} />
            </label>
            <button className="btn btn-ghost buy-lb-del" onClick={() => { if (confirm("Delete this photo?")) deletePhoto(galRow, galPaths[galIdx]); }}>🗑 Delete</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
