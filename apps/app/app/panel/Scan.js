"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { APP_SETTINGS, appNameTokens, applyNumberGuards, dropForeignPostage, settingsForText } from "@/lib/matching";
import { openRearCameraStream } from "@/lib/camera.js";

const settings = APP_SETTINGS;
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
  const standaloneRef = useRef(false);
  const [camera, setCamera] = useState("starting"); // starting | live | denied | unsupported | blocked
  const [phase, setPhase] = useState("idle"); // idle | reading | pricing
  const [result, setResult] = useState(null); // { query, name, number, set, rec, med, lo, hi, count }
  const [error, setError] = useState("");
  const [diag, setDiag] = useState(""); // human-readable reason when the camera won't start
  const [needsTap, setNeedsTap] = useState(false); // playback blocked until a user gesture
  const [recent, setRecent] = useState([]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Attach the current stream to the <video> and start playback. play() can
  // reject when the browser wants a user gesture (common on iOS Safari) — we
  // then show a "tap to start" overlay rather than sitting on a black frame.
  const attach = useCallback(async () => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    try {
      await v.play();
      setNeedsTap(false);
    } catch {
      setNeedsTap(true);
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError("");
    setDiag("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setCamera("blocked");
      setDiag("The camera needs a secure (https) connection.");
      return;
    }
    // Force the REAR camera (iOS ignores facingMode hints and even { exact:
    // "environment" } is unreliable, so the helper enumerates and picks the
    // back-facing device explicitly).
    let stream, lastErr;
    try { stream = await openRearCameraStream(); } catch (e) { lastErr = e; }
    if (!stream) {
      failCamera(lastErr);
      return;
    }
    // If we navigated away while the permission/stream was resolving, release it
    // immediately — otherwise the camera stays live with nothing to stop it.
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    setCamera("live");
    // The <video> mounts on the next render; attach after it commits. The
    // onLoadedMetadata handler and the [camera] effect are belt-and-braces.
    requestAnimationFrame(() => attach());
  }, [attach]);

  function failCamera(e) {
    if (!mountedRef.current) return;
    const name = (e && e.name) || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setCamera("denied");
      setDiag("Camera permission was blocked — allow it in your browser's site settings, then retry.");
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      setCamera("unsupported");
      setDiag("No camera was found on this device.");
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      setCamera("denied");
      setDiag("The camera is already in use by another app or tab. Close it and retry.");
    } else {
      setCamera("denied");
      setDiag(name ? `Camera error: ${name}.` : "Couldn't start the camera.");
    }
  }

  // Belt-and-braces: also attach when camera flips to "live" and the element
  // exists, in case the rAF attach raced the commit.
  useEffect(() => {
    if (camera === "live") attach();
  }, [camera, attach]);

  useEffect(() => {
    mountedRef.current = true;
    // iOS Home Screen (standalone) web apps only grant camera access when
    // getUserMedia is called from a user gesture — auto-starting on mount gives
    // a black/blocked feed. So in standalone we wait for a tap ("prompt"); in a
    // normal browser tab we can start immediately.
    const standalone =
      (typeof navigator !== "undefined" && navigator.standalone === true) ||
      (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    standaloneRef.current = !!standalone;
    if (standalone) setCamera("prompt");
    else startCamera();
    // Release the camera when the tab is hidden/backgrounded, and resume it on
    // return (only if it was stopped, to avoid opening a second stream). In
    // standalone we go back to the tap prompt instead of auto-resuming.
    const onVis = () => {
      if (document.visibilityState === "hidden") stopCamera();
      else if (mountedRef.current && !streamRef.current) {
        if (standaloneRef.current) setCamera("prompt");
        else startCamera();
      }
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
      const nameTokens = appNameTokens(CompFinderPricing.simplifyTitle(query, settings.stripWords));
      const pr = await fetch("/api/soldcomps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, options: { ebaySite: "ebay.co.uk", itemLocation: "worldwide", soldAfterDays: 90 } })
      }).then((r) => r.json());
      if (!pr.ok) throw new Error(pr.error || "Pricing failed.");
      const rec = CompFinderPricing.recommend(dropForeignPostage(applyNumberGuards(pr.comps || [], card.number || null)).comps, settingsForText(query), nameTokens, "sold", card.number || null, card.set || null);
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
        {camera === "prompt" ? (
          <div className="scan-msg">
            <p style={{ margin: "0 0 14px", maxWidth: 280 }}>Line up a card, then start the camera.</p>
            <button className="btn btn-primary scan-start-btn" onClick={startCamera}>📸 Start camera</button>
            <label className="btn btn-ghost scan-upload-btn" style={{ marginTop: 4 }}>
              🖼️ Upload a photo instead
              <input type="file" accept="image/*" hidden onChange={onUpload} />
            </label>
          </div>
        ) : camera === "live" ? (
          <>
            <video ref={videoRef} className="scan-video" playsInline muted autoPlay onLoadedMetadata={() => attach()} />
            <div className="scan-guide" aria-hidden="true" />
            {needsTap ? (
              <button className="scan-tap" onClick={attach}>▶ Tap to start the camera</button>
            ) : null}
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
            <p style={{ margin: "0 0 6px" }}>
              {camera === "denied" ? "Camera access was blocked." : camera === "blocked" ? "Camera unavailable." : "No camera available on this device."}
            </p>
            {diag ? <p className="hint hint-small" style={{ margin: "0 0 10px", maxWidth: 320 }}>{diag}</p> : null}
            {camera === "denied" || camera === "blocked" ? <button className="btn btn-ghost" onClick={startCamera} style={{ marginBottom: 8 }}>Try camera again</button> : null}
            <label className="btn btn-primary scan-upload-btn">
              📷 Upload a photo instead
              <input type="file" accept="image/*" hidden onChange={onUpload} />
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
