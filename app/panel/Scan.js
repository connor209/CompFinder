"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CompFinderPricing from "@/lib/pricing.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
const pounds = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

/**
 * Scan-to-price — the sourcing tool. Point the phone's camera at a card, tap
 * capture, and it identifies the card (Claude vision) then prices it from sold
 * comps in one shot. Built for speed at fairs/car boots: big price, quick
 * re-scan, a running strip of what you've scanned this session.
 */
export default function Scan({ onDeepDive }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const [camera, setCamera] = useState("starting"); // starting | live | denied | unsupported
  const [phase, setPhase] = useState("idle"); // idle | reading | pricing
  const [result, setResult] = useState(null); // { query, name, number, set, rec, med, lo, hi, count }
  const [error, setError] = useState("");
  const [recent, setRecent] = useState([]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      // If we navigated away while the permission/stream was resolving, release
      // it immediately — otherwise the camera stays live with nothing to stop it.
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamera("live");
    } catch {
      if (mountedRef.current) setCamera("denied");
    }
  }, []);

  // Attach the stream once the <video> actually exists. On first start the
  // video isn't rendered yet (camera === "starting"), so startCamera can't set
  // srcObject — this effect runs when camera flips to "live" and the element
  // has mounted, which is what makes the feed appear instead of staying black.
  useEffect(() => {
    if (camera === "live" && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [camera]);

  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    // Release the camera when the tab is hidden/backgrounded, and resume it on
    // return (only if it was stopped, to avoid opening a second stream).
    const onVis = () => {
      if (document.visibilityState === "hidden") stopCamera();
      else if (mountedRef.current && !streamRef.current) startCamera();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  function frameToBase64FromVideo() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(v, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxEdge = 1024;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
      img.src = url;
    });
  }

  async function identifyAndPrice(base64) {
    setError("");
    setResult(null);
    setPhase("reading");
    try {
      const idRes = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType: "image/jpeg" })
      }).then((r) => r.json());
      if (!idRes.ok) throw new Error(idRes.error || "Couldn't read the card.");
      const card = idRes.result;
      if (!card.identified || !card.suggested_query) {
        setError(card.notes || "Couldn't read a card — fill the frame, hold steady, good light.");
        setPhase("idle");
        return;
      }
      const query = card.suggested_query;
      setPhase("pricing");
      const nameTokens = CompFinderPricing.extractNameTokens(CompFinderPricing.simplifyTitle(query, settings.stripWords));
      const pr = await fetch("/api/soldcomps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, options: { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 } })
      }).then((r) => r.json());
      if (!pr.ok) throw new Error(pr.error || "Pricing failed.");
      const rec = CompFinderPricing.recommend(pr.comps || [], settings, nameTokens, "sold", card.number || null, card.set || null);
      const totals = (rec.included || []).map((c) => c.totalPence).sort((a, b) => a - b);
      const med = totals.length ? totals[Math.floor(totals.length / 2)] : null;
      const view = {
        query,
        name: card.name || query,
        number: card.number || "",
        set: card.set || "",
        variant: card.variant || "",
        rec,
        med,
        lo: totals[0] ?? null,
        hi: totals[totals.length - 1] ?? null,
        count: rec.included ? rec.included.length : 0
      };
      setResult(view);
      setRecent((prev) => [{ name: view.name, number: view.number, price: rec.finalPence, count: view.count }, ...prev].slice(0, 8));
      setPhase("idle");
    } catch (e) {
      setError(e.message || "Scan failed.");
      setPhase("idle");
    }
  }

  function capture() {
    const b64 = frameToBase64FromVideo();
    if (!b64) { setError("Camera not ready yet — give it a second."); return; }
    identifyAndPrice(b64);
  }

  async function onUpload(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const b64 = await fileToBase64(f);
      identifyAndPrice(b64);
    } catch (err) {
      setError(err.message || "Couldn't read that image.");
    }
  }

  const busy = phase !== "idle";
  const confClass = result ? `conf-badge conf-${(result.rec.confidence || "low").toLowerCase()}` : "";

  return (
    <div className="scan-wrap rise-group">
      <div className="scan-stage">
        {camera === "live" ? (
          <>
            <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
            <div className="scan-guide" aria-hidden="true" />
            {busy ? (
              <div className="scan-busy">
                <span className="spinner" /> &nbsp;{phase === "reading" ? "Reading card…" : "Pricing…"}
              </div>
            ) : null}
          </>
        ) : camera === "starting" ? (
          <div className="scan-msg"><span className="spinner" /> &nbsp;Starting camera…</div>
        ) : (
          <div className="scan-msg">
            <p style={{ margin: "0 0 10px" }}>
              {camera === "denied" ? "Camera access was blocked." : "No camera available on this device."}
            </p>
            {camera === "denied" ? <button className="btn btn-ghost" onClick={startCamera}>Try camera again</button> : null}
            <label className="btn btn-primary scan-upload-btn">
              📷 Upload a photo instead
              <input type="file" accept="image/*" capture="environment" hidden onChange={onUpload} />
            </label>
          </div>
        )}
      </div>

      {camera === "live" ? (
        <div className="scan-controls">
          <label className="btn btn-ghost scan-upload-inline" title="Upload a photo">
            🖼️<span className="sr-only">Upload a photo</span>
            <input type="file" accept="image/*" hidden aria-label="Upload a photo" onChange={onUpload} />
          </label>
          <button className="scan-shutter" onClick={capture} disabled={busy} aria-label="Scan card">
            {busy ? <span className="spinner" /> : <span className="scan-shutter-dot" />}
          </button>
          <span className="scan-hint">{busy ? "" : "Fill the frame · tap to price"}</span>
        </div>
      ) : null}

      {error ? <p className="compfinder-error" style={{ textAlign: "center" }}>{error}</p> : null}

      {result ? (
        <div className="panel scan-result">
          <div className="scan-result-head">
            <div>
              <div className="scan-name">{result.name}</div>
              <div className="scan-sub">
                {result.number ? <span className="badge2"># {result.number}</span> : null}
                {result.set ? <span className="badge2 badge-muted">{result.set}</span> : null}
                {result.variant ? <span className="badge2 badge-muted">{result.variant}</span> : null}
              </div>
            </div>
            <span className={confClass}>{result.rec.confidence}</span>
          </div>
          <div className="scan-price">{result.rec.finalPence != null ? pounds(result.rec.finalPence) : "No price"}</div>
          <div className="scan-meta">
            {result.count > 0
              ? <>from <b>{result.count}</b> sold comp(s){result.med != null ? <> · median {pounds(result.med)}{result.lo !== result.hi ? <> · {pounds(result.lo)}–{pounds(result.hi)}</> : null}</> : null}</>
              : "No UK sold comps in the last 90 days — try a deep dive."}
          </div>
          <div className="scan-actions">
            <button className="btn btn-ghost" onClick={() => onDeepDive?.(result.query)}>🔍 Deep dive</button>
            <button className="btn btn-primary" onClick={() => setResult(null)} disabled={busy}>Scan another</button>
          </div>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="panel">
          <div className="panel-head"><span className="eyebrow">This session ({recent.length})</span></div>
          <div className="scan-recent">
            {recent.map((r, i) => (
              <div className="scan-recent-row" key={i}>
                <span className="scan-recent-name">{r.name}{r.number ? ` · ${r.number}` : ""}</span>
                <span className="scan-recent-price">{r.price != null ? pounds(r.price) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="hint hint-small" style={{ textAlign: "center" }}>
          Point the camera at a single card, fill the frame, and tap the shutter. It reads the card and prices it from recent sold listings — great for sourcing on the go.
        </p>
      )}
    </div>
  );
}
