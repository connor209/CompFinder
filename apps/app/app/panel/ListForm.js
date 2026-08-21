"use client";

import { useState } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/resizeImage";

const CONDITIONS = [
  { l: "Near mint or better", v: "400010" },
  { l: "Lightly played", v: "400011" },
  { l: "Moderately played", v: "400012" },
  { l: "Heavily played", v: "400013" },
  { l: "Damaged", v: "400014" }
];
const SHIPPING = [
  { l: "Royal Mail 2nd Class", v: "UK_RoyalMailSecondClassStandard" },
  { l: "Royal Mail 1st Class", v: "UK_RoyalMailFirstClassStandard" },
  { l: "Royal Mail Signed For 1st", v: "UK_RoyalMailFirstClassRecorded" }
];

function loadDefaults() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("cf-list-defaults") || "{}") || {};
  } catch {
    return {};
  }
}

/**
 * Create-an-eBay-listing form (BETA). Prefilled from a card + recommended
 * price; the account/shipping fields persist to localStorage so they're set
 * once. eBay validates category/condition specifics, so errors surface here.
 */
export default function ListForm({ card, suggestedPence, language, imageUrl, onClose }) {
  const d = loadDefaults();
  const [title, setTitle] = useState(`${card.name} ${card.number || ""} ${card.set || ""}`.replace(/\s+/g, " ").trim());
  const [price, setPrice] = useState(suggestedPence != null ? (suggestedPence / 100).toFixed(2) : "");
  const [quantity, setQuantity] = useState(1);
  const [conditionId, setConditionId] = useState(d.conditionId || "400010");
  const [categoryId, setCategoryId] = useState(d.categoryId || "183454");
  const [postcode, setPostcode] = useState(d.postcode || "");
  const [shippingService, setShippingService] = useState(d.shippingService || SHIPPING[0].v);
  const [shippingCost, setShippingCost] = useState(d.shippingCost || "1.50");
  const [returnsDays, setReturnsDays] = useState(d.returnsDays ?? "30");
  const [dispatchDays, setDispatchDays] = useState(d.dispatchDays || "3");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState(imageUrl || "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function uploadPhoto(file) {
    if (!file) return;
    setUploading(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const blob = await resizeImage(file);
      const path = `${user.id}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await sb.storage.from("listing-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);
      setImage(sb.storage.from("listing-photos").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      alert(e.message || "Photo upload failed.");
    }
    setUploading(false);
  }

  function persist() {
    try {
      localStorage.setItem("cf-list-defaults", JSON.stringify({ conditionId, categoryId, postcode, shippingService, shippingCost, returnsDays, dispatchDays }));
    } catch {
      /* ignore */
    }
  }

  async function submit() {
    setBusy(true);
    setResult(null);
    persist();
    const payload = {
      title,
      price: Number(price),
      quantity,
      conditionId,
      categoryId,
      postcode,
      location: postcode || "United Kingdom",
      shippingService,
      shippingCost: Number(shippingCost) || 0,
      returnsDays,
      dispatchDays,
      description: description || title,
      imageUrls: image ? [image] : [],
      specifics: [
        { name: "Game", value: "Pokémon TCG" },
        { name: "Set", value: card.set || "" },
        { name: "Card Number", value: card.number || "" },
        { name: "Language", value: language || "English" },
        { name: "Character", value: card.name || "" }
      ]
    };
    try {
      const res = await fetch("/api/ebay/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
      setResult(res);
    } catch (e) {
      setResult({ ok: false, error: e.message || "Listing failed." });
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="eyebrow">List on eBay <span className="badge2" style={{ marginLeft: 6 }}>beta</span></span>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>

      {result?.ok ? (
        <div className="mine-note mine-note-ok" style={{ display: "block" }}>
          ✓ Listed{result.itemId ? <> — <a href={`https://www.ebay.co.uk/itm/${result.itemId}`} target="_blank" rel="noopener noreferrer">view item {result.itemId}</a></> : ""}.
          {result.warnings?.length ? <div className="hint hint-small">Note: {result.warnings.join(" ")}</div> : null}
        </div>
      ) : (
        <>
          <label className="field" style={{ marginBottom: 10 }}>
            <span>Title (max 80)</span>
            <input type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div className="filter-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label className="field"><span>Price £</span><input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label className="field"><span>Quantity</span><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
            <label className="field"><span>Condition</span>
              <select value={conditionId} onChange={(e) => setConditionId(e.target.value)}>
                {CONDITIONS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </label>
            <label className="field"><span>Category ID</span><input type="text" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} /></label>
            <label className="field"><span>Postcode</span><input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. SW1A 1AA" /></label>
            <label className="field"><span>Dispatch (days)</span><input type="number" min="0" value={dispatchDays} onChange={(e) => setDispatchDays(e.target.value)} /></label>
            <label className="field"><span>Postage</span>
              <select value={shippingService} onChange={(e) => setShippingService(e.target.value)}>
                {SHIPPING.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </label>
            <label className="field"><span>Postage £</span><input type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} /></label>
            <label className="field"><span>Returns</span>
              <select value={returnsDays} onChange={(e) => setReturnsDays(e.target.value)}>
                <option value="30">30 days</option>
                <option value="14">14 days</option>
                <option value="">No returns</option>
              </select>
            </label>
          </div>

          <label className="field" style={{ marginTop: 10 }}>
            <span>Photo</span>
            <div className="bulk-img-row">
              <input type="text" value={image} onChange={(e) => setImage(e.target.value)} placeholder="Photo URL, or upload your own →" />
              <label className="bulk-img-up" title="Upload your own photo">
                {uploading ? <span className="spinner" /> : "📷"}
                <input type="file" accept="image/*" capture="environment" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadPhoto(f); }} />
              </label>
            </div>
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Description (optional)</span>
            <textarea className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={title} />
          </label>

          <p className="hint hint-small">
            Category & condition IDs are eBay-validated — the defaults suit UK Pokémon singles, but if eBay rejects them,
            adjust here. If you&apos;ve linked eBay business policies in <a href="/settings">Settings</a>, those are applied and these postage/returns fields are ignored.
          </p>

          {result && !result.ok ? <p className="compfinder-error" style={{ marginTop: 8 }}>{result.error}</p> : null}

          <button className="btn btn-primary" onClick={submit} disabled={busy || !title || !(Number(price) > 0)} style={{ marginTop: 10 }}>
            {busy ? "Listing…" : "List on eBay"}
          </button>
        </>
      )}
    </div>
  );
}
