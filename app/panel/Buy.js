"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";
import { pagedSelect } from "@/lib/pagedSelect";

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

/**
 * Downscale a captured photo to a sensible max dimension and re-encode as JPEG
 * before upload — phone photos are several MB, and a haul snapshot doesn't need
 * more than ~1600px. Returns a Blob. Throws if the file isn't a decodable image.
 */
function resizeImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a supported image.")); };
    img.src = url;
  });
}

const CATEGORIES = ["Singles", "Sealed / boxes", "Supplies", "Postage", "Fees", "Other"];
const emptyForm = () => ({ kind: "card", description: "", quantity: "1", amount: "", category: "Singles", source: "", purchased_at: todayStr(), note: "" });

/**
 * Buy — a purchase ledger. Log either a specific card bought (name, quantity,
 * price paid, source) or a general spend line (a sealed box, sleeves, fees…),
 * and optionally snap a photo of the haul as a visual record. Everything rolls
 * into a running spend total. Rows live in the `purchases` table; photos live
 * in a private Storage bucket (RLS: each user owns their own).
 */
export default function Buy() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("month"); // month | year | all
  const [photoUrls, setPhotoUrls] = useState({}); // path -> signed URL
  const [formFile, setFormFile] = useState(null);
  const [formPreview, setFormPreview] = useState(null);
  const [attaching, setAttaching] = useState(null); // row id currently uploading
  const [lightbox, setLightbox] = useState(null);

  async function load() {
    const sb = createClient();
    const data = await pagedSelect(() =>
      sb.from("purchases").select("id,kind,description,quantity,amount_pence,category,source,purchased_at,note,photo_path").order("purchased_at", { ascending: false })
    );
    setRows(data || []);
    // Sign the photo paths so <img> can load them from the private bucket.
    const paths = (data || []).map((r) => r.photo_path).filter(Boolean);
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

  async function uploadPhoto(sb, file, userId) {
    const blob = await resizeImage(file);
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) throw new Error(upErr.message);
    return path;
  }

  function onPickFormPhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (formPreview) URL.revokeObjectURL(formPreview);
    setFormFile(f);
    setFormPreview(URL.createObjectURL(f));
  }
  function clearFormPhoto() {
    if (formPreview) URL.revokeObjectURL(formPreview);
    setFormFile(null);
    setFormPreview(null);
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
      let photo_path = null;
      if (formFile) photo_path = await uploadPhoto(sb, formFile, user.id);
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
        photo_path
      };
      const { error: err } = await sb.from("purchases").insert(row);
      if (err) throw new Error(err.message);
      setForm((f) => ({ ...emptyForm(), kind: f.kind, purchased_at: f.purchased_at, source: f.source }));
      clearFormPhoto();
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save that purchase.");
    }
    setSaving(false);
  }

  // Attach (or replace) a photo on an existing purchase.
  async function attachPhoto(row, file) {
    setAttaching(row.id);
    try {
      const sb = createClient();
      const {
        data: { user }
      } = await sb.auth.getUser();
      const path = await uploadPhoto(sb, file, user.id);
      const { error: err } = await sb.from("purchases").update({ photo_path: path }).eq("id", row.id);
      if (err) throw new Error(err.message);
      if (row.photo_path) await sb.storage.from(BUCKET).remove([row.photo_path]).catch(() => {});
      await load();
    } catch (err) {
      setError(err.message || "Couldn't attach that photo.");
    }
    setAttaching(null);
  }

  async function remove(row) {
    if (!confirm("Delete this purchase?")) return;
    const sb = createClient();
    await sb.from("purchases").delete().eq("id", row.id);
    if (row.photo_path) await sb.storage.from(BUCKET).remove([row.photo_path]).catch(() => {});
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
    let cards = 0;
    let cardUnits = 0;
    let expense = 0;
    for (const r of inPeriod) {
      spend += r.amount_pence || 0;
      if (r.kind === "card") { cards += 1; cardUnits += r.quantity || 1; }
      else expense += r.amount_pence || 0;
    }
    return { spend, cards, cardUnits, expense, count: inPeriod.length };
  }, [inPeriod]);

  const allTimeSpend = useMemo(() => (rows || []).reduce((s, r) => s + (r.amount_pence || 0), 0), [rows]);

  if (rows === null) return <div className="panel"><span className="spinner" /> &nbsp;Loading purchases…</div>;

  const periodLabel = period === "month" ? "this month" : period === "year" ? "this year" : "all time";

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
            <span>Photo of the haul <span className="buy-opt">(optional)</span></span>
            {formPreview ? (
              <div className="buy-photo-preview">
                <img src={formPreview} alt="Purchase preview" />
                <button type="button" className="buy-photo-x" onClick={clearFormPhoto} aria-label="Remove photo">✕</button>
              </div>
            ) : (
              <label className="buy-photo-btn">
                📷 Snap or upload a photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={onPickFormPhoto} />
              </label>
            )}
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
                <tr><th aria-label="Photo"></th><th>Date</th><th>Type</th><th>Description</th><th>Qty</th><th>Source</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {inPeriod.map((r) => (
                  <tr key={r.id}>
                    <td className="buy-photo-cell">
                      {r.photo_path && photoUrls[r.photo_path] ? (
                        <button type="button" className="buy-thumb" onClick={() => setLightbox(photoUrls[r.photo_path])} title="View photo">
                          <img src={photoUrls[r.photo_path]} alt="Purchase" loading="lazy" />
                        </button>
                      ) : (
                        <label className="buy-thumb-add" title="Add a photo">
                          {attaching === r.id ? <span className="spinner" /> : "📷"}
                          <input type="file" accept="image/*" capture="environment" hidden disabled={attaching === r.id} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attachPhoto(r, f); }} />
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lightbox ? (
        <div className="buy-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Purchase photo">
          <img src={lightbox} alt="Purchase" onClick={(e) => e.stopPropagation()} />
          <button className="buy-lightbox-x" onClick={() => setLightbox(null)} aria-label="Close">✕</button>
        </div>
      ) : null}
    </div>
  );
}
