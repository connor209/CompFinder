"use client";

import { useEffect, useMemo, useState } from "react";
import LabHeader, { LAB_HEADER_CSS } from "../LabHeader";
import { createClient } from "@/lib/supabase/client";
import { resizeImage } from "@/lib/resizeImage";
import {
  FIELDS, MAX_DESCRIPTIONS, MAX_SHOP_IMAGES, TITLE_MAX, withDefaults, buildTitle, renderDescription,
  descriptionProblem, settingsProblems, bestOfferFor, PHOTO_PROMISE
} from "@/lib/listing-template.js";

/**
 * The lab's listing settings: defaults, Best Offer, the title builder, the
 * description templates, the shop images and subtypes. Saved as one document
 * through /api/lab (which validates it again before storing). Previews use
 * the same functions the server lists with.
 */

const box = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16 };
const row = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const small = { fontSize: 13, color: "var(--ink-soft)" };
const chip = { display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "4px 8px", fontSize: 13, background: "var(--surface-2)" };
const BUCKET = "listing-photos";
const label = (key) => (FIELDS.find(([k]) => k === key) || [key, key])[1];

/** A card to preview against until the lab has real ones. */
const SAMPLE = {
  name: "Mareep", number: "002/020", set: "Zeraora Deck", setCode: "", rarity: "Common", finish: "Holo",
  condition: "NM", language: "Japanese", game: "Pokémon TCG", year: "2022", illustrator: "Miki Tanaka",
  type: "Lightning", stage: "Basic", sku: "TEST2-1", subtype: ""
};

export default function ListingSettings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null); // JSON of the last saved state
  const [meta, setMeta] = useState({});
  const [sample, setSample] = useState(SAMPLE);
  const [samples, setSamples] = useState([SAMPLE]);
  const [tab, setTab] = useState(0);
  const [view, setView] = useState("code");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newText, setNewText] = useState("");
  const [newSubtype, setNewSubtype] = useState("");

  useEffect(() => {
    fetch("/api/lab").then((r) => r.json()).then((j) => {
      const ls = withDefaults(j.listingSettings);
      setS(ls);
      setSaved(JSON.stringify(ls));
      setMeta({ missing: j.listingSettingsMissing, wasSaved: j.listingSettingsSaved, labMissing: j.missing });
      // Real cards from the lab's own listings to preview against.
      const real = (j.listings || []).filter((l) => l.card).slice(-8).reverse()
        .map((l) => ({ ...SAMPLE, ...l.card, condition: l.condition, sku: "", subtype: l.subtype || "" }));
      if (real.length) { setSamples([...real, SAMPLE]); setSample(real[0]); }
    }).catch((e) => setMsg({ bad: true, text: e.message }));
  }, []);

  const dirty = s && saved !== JSON.stringify(s);
  const problems = useMemo(() => (s ? settingsProblems(s) : []), [s]);
  const title = useMemo(() => (s ? buildTitle(s.title, sample) : null), [s, sample]);
  const desc = s ? s.descriptions[Math.min(tab, s.descriptions.length - 1)] : null;
  const rendered = useMemo(() => (desc ? renderDescription(desc.html, sample) : null), [desc, sample]);

  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const setTitle = (patch) => setS((x) => ({ ...x, title: { ...x.title, ...patch } }));
  const setParts = (fn) => setS((x) => ({ ...x, title: { ...x.title, parts: fn(x.title.parts.slice()) } }));

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveSettings", settings: s }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
    setBusy(false);
    if (r.ok) { setS(withDefaults(r.settings)); setSaved(JSON.stringify(withDefaults(r.settings))); setMsg({ text: "Saved. New lab listings use these settings." }); }
    else setMsg({ bad: true, text: r.error || "Couldn't save." });
  }

  async function upload(i, file) {
    if (!file) return;
    setBusy(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const blob = await resizeImage(file);
      // A new path every time: eBay caches pictures by URL, so replacing the
      // bytes at an old path would change nothing on a listing.
      const path = `${user.id}/shop/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message);
      const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      setS((x) => {
        const imgs = x.shopImages.slice();
        imgs[i] = { url, position: imgs[i]?.position || "last", enabled: true };
        return { ...x, shopImages: imgs.filter(Boolean) };
      });
    } catch (e) {
      setMsg({ bad: true, text: `Upload failed: ${e.message}` });
    }
    setBusy(false);
  }

  if (!s) return <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>Loading settings…</main>;

  const bo = bestOfferFor(s.bestOffer, 1000);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16, color: "var(--ink)" }}>
      <style>{LAB_HEADER_CSS}</style>
      <LabHeader current="settings" />
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: "4px 0" }}>Listing settings</h1>
          <p style={small}>How a new listing&apos;s title, description and photos are written. Listings already live aren&apos;t changed when you save.</p>
        </div>
        <button className="btn btn-primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>
          {busy ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </button>
      </div>
      {meta.missing && <p style={{ color: "var(--warn)" }}>Run <code>supabase/migrations/041_listing_studio.sql</code> in Supabase first — until then these settings can&apos;t be saved.</p>}
      {problems.map((p) => <div key={p} style={{ color: "var(--bad)", fontSize: 14 }}>✗ {p}</div>)}
      {msg && <p style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }}>{msg.text}</p>}

      <div style={{ ...row, margin: "8px 0 16px" }}>
        <span style={small}>Preview on</span>
        <select value={samples.indexOf(sample)} onChange={(e) => setSample(samples[Number(e.target.value)])}>
          {samples.map((c, i) => <option key={i} value={i}>{c.name} {c.number} · {c.condition}{c === SAMPLE ? " (example)" : ""}</option>)}
        </select>
      </div>

      {/* ---------------- A. Defaults ---------------- */}
      <section style={box}>
        <strong>Listing defaults</strong>
        <p style={small}>
          Payment, postage and returns come from your eBay business policies, chosen under <a href="/settings">Settings → Listing policies</a>.
          The postage, dispatch and returns boxes below are used only if no policies are linked there.
        </p>
        <div style={row}>
          <label className="field"><span>Category ID</span><input value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })} /></label>
          <label className="field"><span>Postcode</span><input value={s.postcode} onChange={(e) => set({ postcode: e.target.value })} /></label>
          <label className="field"><span>Postage £ (no policies)</span><input value={s.shippingCost} onChange={(e) => set({ shippingCost: e.target.value })} /></label>
          <label className="field"><span>Dispatch days (no policies)</span><input value={s.dispatchDays} onChange={(e) => set({ dispatchDays: e.target.value })} /></label>
          <label className="field"><span>Returns days (no policies)</span><input value={s.returnsDays} onChange={(e) => set({ returnsDays: e.target.value })} /></label>
        </div>
      </section>

      <section style={box}>
        <label style={{ ...row, fontWeight: 600 }}>
          <input type="checkbox" checked={s.bestOffer.enabled} onChange={(e) => set({ bestOffer: { ...s.bestOffer, enabled: e.target.checked } })} />
          Allow Best Offer
        </label>
        {s.bestOffer.enabled && (
          <>
            <div style={{ ...row, marginTop: 8 }}>
              <label className="field"><span>Auto-accept at % of price</span><input inputMode="numeric" value={s.bestOffer.autoAcceptPct} onChange={(e) => set({ bestOffer: { ...s.bestOffer, autoAcceptPct: e.target.value } })} /></label>
              <label className="field"><span>Auto-decline below % of price</span><input inputMode="numeric" value={s.bestOffer.minPct} onChange={(e) => set({ bestOffer: { ...s.bestOffer, minPct: e.target.value } })} /></label>
            </div>
            <p style={small}>
              {bo?.error ? <span style={{ color: "var(--bad)" }}>{bo.error}</span> :
                `On a £10.00 card: ${bo?.autoAcceptPence != null ? `offers of £${(bo.autoAcceptPence / 100).toFixed(2)}+ accepted` : "nothing auto-accepted"}, ${bo?.minPence != null ? `under £${(bo.minPence / 100).toFixed(2)} declined` : "nothing auto-declined"}. Blank means eBay asks you.`}
            </p>
          </>
        )}
      </section>

      {/* ---------------- B. Title ---------------- */}
      <section style={box}>
        <strong>Title</strong>
        <p style={small}>The order of the parts below. Tap <strong>AA</strong> to put a part in capitals; ✕ removes it.</p>
        <div style={{ ...row, minHeight: 40, padding: 8, border: "1px dashed var(--line-strong)", borderRadius: 8 }}>
          {s.title.parts.map((p, i) => (
            <span key={i} style={chip}>
              <button className="btn btn-ghost" style={{ padding: "0 4px" }} disabled={i === 0} onClick={() => setParts((a) => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} aria-label="Move left">‹</button>
              {p.type === "text" ? `"${p.value}"` : label(p.key)}
              {p.type === "field" && (
                <button className="btn btn-ghost" style={{ padding: "0 4px", fontWeight: p.upper ? 700 : 400, color: p.upper ? "var(--accent)" : undefined }}
                  onClick={() => setParts((a) => { a[i] = { ...a[i], upper: !a[i].upper }; return a; })}>AA</button>
              )}
              <button className="btn btn-ghost" style={{ padding: "0 4px" }} disabled={i === s.title.parts.length - 1} onClick={() => setParts((a) => { [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })} aria-label="Move right">›</button>
              <button className="btn btn-ghost" style={{ padding: "0 4px" }} onClick={() => setParts((a) => { a.splice(i, 1); return a; })} aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
        <div style={{ ...row, marginTop: 8 }}>
          <select value="" onChange={(e) => { if (e.target.value) setParts((a) => [...a, { type: "field", key: e.target.value }]); }}>
            <option value="">＋ Add a part…</option>
            {FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input placeholder="Custom text, e.g. TCG Card" value={newText} onChange={(e) => setNewText(e.target.value)} />
          <button className="btn" disabled={!newText.trim()} onClick={() => { setParts((a) => [...a, { type: "text", value: newText.trim() }]); setNewText(""); }}>＋ Add text</button>
          <label style={row}><input type="checkbox" checked={s.title.abbreviateCondition} onChange={(e) => setTitle({ abbreviateCondition: e.target.checked })} /> Abbreviate condition (NM, not Near Mint)</label>
        </div>
        <div style={{ marginTop: 10, padding: 10, background: "var(--surface-2)", borderRadius: 8, fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
          {title.text}
          {title.cut && <span style={{ color: "var(--bad)", textDecoration: "line-through" }}>{title.full.slice(title.text.length)}</span>}
        </div>
        <div style={{ ...small, marginTop: 4, color: title.cut ? "var(--bad)" : undefined }}>
          {title.full.length} of {TITLE_MAX} characters{title.cut ? " — eBay's limit cuts the struck-out part; it's cut at a whole word" : ""}
        </div>
      </section>

      {/* ---------------- B. Description ---------------- */}
      <section style={box}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong>Description</strong>
          <div style={row}>
            <button className={`btn ${view === "code" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("code")}>Code</button>
            <button className={`btn ${view === "preview" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("preview")}>Preview</button>
          </div>
        </div>
        <div style={{ ...row, marginTop: 8 }}>
          {s.descriptions.map((d, i) => (
            <button key={i} className={`btn ${tab === i ? "" : "btn-ghost"}`} onClick={() => setTab(i)}>
              {d.name || `Template ${i + 1}`}{s.activeDescription === i ? " ★" : ""}
            </button>
          ))}
          {s.descriptions.length < MAX_DESCRIPTIONS && (
            <button className="btn btn-ghost" onClick={() => { set({ descriptions: [...s.descriptions, { name: `Template ${s.descriptions.length + 1}`, html: "" }] }); setTab(s.descriptions.length); }}>＋ Add tab</button>
          )}
        </div>
        <div style={{ ...row, marginTop: 8 }}>
          <label className="field"><span>Name</span>
            <input value={desc.name} onChange={(e) => set({ descriptions: s.descriptions.map((d, i) => (i === tab ? { ...d, name: e.target.value } : d)) })} />
          </label>
          <button className="btn" disabled={s.activeDescription === tab} onClick={() => set({ activeDescription: tab })}>{s.activeDescription === tab ? "★ In use" : "Use this one"}</button>
          {s.descriptions.length > 1 && (
            <button className="btn btn-ghost" onClick={() => {
              if (!window.confirm(`Delete "${desc.name}"?`)) return;
              const next = s.descriptions.filter((_, i) => i !== tab);
              set({ descriptions: next, activeDescription: Math.min(s.activeDescription > tab ? s.activeDescription - 1 : s.activeDescription === tab ? 0 : s.activeDescription, next.length - 1) });
              setTab(0);
            }}>Delete</button>
          )}
        </div>
        {view === "code" ? (
          <>
            <textarea style={{ width: "100%", minHeight: 220, marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
              value={desc.html} onChange={(e) => set({ descriptions: s.descriptions.map((d, i) => (i === tab ? { ...d, html: e.target.value } : d)) })} />
            <div style={{ ...row, marginTop: 6 }}>
              <span style={small}>Insert:</span>
              {FIELDS.map(([k, l]) => (
                <button key={k} className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 6px" }}
                  onClick={() => set({ descriptions: s.descriptions.map((d, i) => (i === tab ? { ...d, html: `${d.html}{${k}}` } : d)) })}>{l}</button>
              ))}
            </div>
            {descriptionProblem(desc.html) && <div style={{ color: "var(--bad)", fontSize: 13 }}>✗ {descriptionProblem(desc.html)}</div>}
            {rendered?.unknown.length > 0 && <div style={{ color: "var(--bad)", fontSize: 13 }}>✗ Not a placeholder: {rendered.unknown.map((k) => `{${k}}`).join(", ")}</div>}
          </>
        ) : (
          // A sandboxed frame: the template is shown as eBay would show it,
          // and nothing in it can run against this page.
          <iframe title="Description preview" sandbox="" style={{ width: "100%", minHeight: 320, marginTop: 8, background: "#fff", borderRadius: 8, border: "1px solid var(--line)" }}
            srcDoc={`<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;font-size:14px;color:#111;padding:12px">${rendered?.html || ""}</body>`} />
        )}
        <p style={small}>
          Plain text keeps its line breaks, as CardUploader does. Or write HTML (no scripts), and the breaks are yours to place.
          The lab always adds this line at the end: <em>{PHOTO_PROMISE}</em>
        </p>
      </section>

      {/* ---------------- B. Shop images ---------------- */}
      <section style={box}>
        <strong>Shop images</strong>
        <p style={small}>
          Up to {MAX_SHOP_IMAGES} of your own images (a banner, a condition guide) added to every new listing, before the card&apos;s scans, straight after the
          first scan, or at the end. When a listing moves on to the next copy, only the scans change.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {Array.from({ length: MAX_SHOP_IMAGES }, (_, i) => {
            const img = s.shopImages[i];
            return (
              <div key={i} style={{ border: "1px dashed var(--line-strong)", borderRadius: 8, padding: 8, textAlign: "center", opacity: img && img.enabled === false ? 0.5 : 1 }}>
                <div style={small}>Image {i + 1}</div>
                {img ? <img src={img.url} alt="" style={{ width: "100%", height: 100, objectFit: "contain" }} /> : (
                  <label style={{ display: "block", padding: "30px 0", cursor: "pointer", ...small }}>
                    ＋ Upload
                    <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy || i > s.shopImages.length} onChange={(e) => upload(i, e.target.files?.[0])} />
                  </label>
                )}
                {img && (
                  <>
                    <select value={img.position || "last"} onChange={(e) => set({ shopImages: s.shopImages.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)) })}>
                      <option value="first">First</option>
                      <option value="second">After the first scan</option>
                      <option value="last">Last</option>
                    </select>
                    <div style={{ ...row, justifyContent: "center", marginTop: 4 }}>
                      <label style={{ ...row, fontSize: 12 }}><input type="checkbox" checked={img.enabled !== false} onChange={(e) => set({ shopImages: s.shopImages.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} /> On</label>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => set({ shopImages: s.shopImages.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------- B. Subtypes ---------------- */}
      <section style={box}>
        <strong>Subtypes</strong>
        <p style={small}>Your own labels, like Stamped or Promo. Pick one for a card on the lab page before listing; it can go in the title as the Subtype part.</p>
        <div style={row}>
          {s.subtypes.map((t) => (
            <span key={t} style={chip}>{t}<button className="btn btn-ghost" style={{ padding: "0 4px" }} onClick={() => set({ subtypes: s.subtypes.filter((x) => x !== t) })}>✕</button></span>
          ))}
          <input placeholder="e.g. Stamped" value={newSubtype} onChange={(e) => setNewSubtype(e.target.value)} />
          <button className="btn" disabled={!newSubtype.trim() || s.subtypes.includes(newSubtype.trim())} onClick={() => { set({ subtypes: [...s.subtypes, newSubtype.trim()] }); setNewSubtype(""); }}>＋ Add</button>
        </div>
      </section>
    </main>
  );
}
