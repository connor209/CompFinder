"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openRearCameraStream } from "@/lib/camera.js";

/**
 * In-app camera capture (getUserMedia) — a full-screen overlay that returns a
 * JPEG File via onCapture. Built to work inside iOS Home Screen (standalone)
 * web apps, where the NATIVE file-capture camera shows black: it gesture-starts
 * getUserMedia (required in standalone) and forces the rear camera.
 */
export default function CameraCapture({ onCapture, onClose, label = "Take a photo" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState("prompt"); // prompt | starting | live | error
  const [needsTap, setNeedsTap] = useState(false);
  const [diag, setDiag] = useState("");
  const [dbg, setDbg] = useState("");
  const [dbgCams, setDbgCams] = useState("");

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const attach = useCallback(async () => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    try { await v.play(); setNeedsTap(false); } catch { setNeedsTap(true); }
  }, []);

  const start = useCallback(async () => {
    setDiag("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error"); setDiag("Camera isn't supported on this device."); return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setState("error"); setDiag("The camera needs a secure (https) connection."); return;
    }
    setState("starting");
    let stream, lastErr;
    try { stream = await openRearCameraStream(); } catch (e) { lastErr = e; }
    if (!mountedRef.current) { stream?.getTracks().forEach((t) => t.stop()); return; }
    if (!stream) {
      const name = lastErr?.name || "";
      setState("error");
      setDiag(
        name === "NotAllowedError" || name === "SecurityError" ? "Camera permission was blocked — allow it in your browser settings, then retry."
          : name === "NotReadableError" ? "The camera is already in use by another app or tab."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found on this device."
          : name ? `Camera error: ${name}.` : "Couldn't start the camera."
      );
      return;
    }
    streamRef.current = stream;
    setState("live");
    requestAnimationFrame(() => attach());
  }, [attach]);

  useEffect(() => {
    mountedRef.current = true;
    // Auto-start in a normal browser tab; in iOS standalone the camera only
    // opens from a user gesture, so wait for the "Start camera" tap.
    const standalone =
      (typeof navigator !== "undefined" && navigator.standalone === true) ||
      (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    if (!standalone) start();
    return () => { mountedRef.current = false; stop(); };
  }, [start, stop]);

  useEffect(() => { if (state === "live") attach(); }, [state, attach]);

  useEffect(() => {
    if (state !== "live") { setDbgCams(""); return; }
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
      const cams = ds.filter((d) => d.kind === "videoinput").map((d) => d.label || "(no label)");
      setDbgCams(`${cams.length} cam(s): ${cams.join(" | ")}`);
    }).catch(() => setDbgCams("enumerate failed"));
  }, [state]);

  useEffect(() => {
    if (state !== "live") { setDbg(""); return; }
    const id = setInterval(() => {
      const v = videoRef.current;
      const t = streamRef.current?.getVideoTracks?.()[0];
      const st = t?.getSettings ? t.getSettings() : {};
      setDbg(`track:${t ? t.readyState : "none"} muted:${t ? t.muted : "-"} · cam:${((t?.label) || st.facingMode || "?").slice(0, 24)} · ${v ? v.videoWidth : 0}x${v ? v.videoHeight : 0} paused:${v ? v.paused : "-"}`);
    }, 600);
    return () => clearInterval(id);
  }, [state]);

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setDiag("Camera not ready — give it a second."); return; }
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(v, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      onCapture(new File([blob], `photo-${w}x${h}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  }

  function close() { stop(); onClose(); }

  return (
    <div className="cam-overlay" role="dialog" aria-label={label}>
      <div className="cam-stage">
        {state === "live" ? (
          <>
            <video ref={videoRef} className="cam-video" playsInline muted autoPlay onLoadedMetadata={() => attach()} />
            {dbg ? <div className="scan-dbg">{dbg}{dbgCams ? <><br />{dbgCams}</> : null}</div> : null}
            {needsTap ? <button className="scan-tap" onClick={attach}>▶ Tap to start the camera</button> : null}
          </>
        ) : state === "starting" ? (
          <div className="cam-msg"><span className="spinner" /> &nbsp;Starting camera…</div>
        ) : state === "prompt" ? (
          <div className="cam-msg">
            <p style={{ margin: "0 0 14px", maxWidth: 280 }}>{label}</p>
            <button className="btn btn-primary" onClick={start}>📸 Start camera</button>
          </div>
        ) : (
          <div className="cam-msg">
            <p style={{ margin: "0 0 8px" }}>Camera unavailable.</p>
            {diag ? <p className="hint hint-small" style={{ maxWidth: 300, margin: "0 0 12px" }}>{diag}</p> : null}
            <button className="btn btn-ghost" onClick={start}>Try again</button>
          </div>
        )}
      </div>
      <div className="cam-controls">
        <button className="btn btn-ghost cam-cancel" onClick={close}>Cancel</button>
        {state === "live" ? (
          <button className="scan-shutter" onClick={snap} aria-label="Take photo"><span className="scan-shutter-dot" /></button>
        ) : <span className="cam-spacer" />}
        <span className="cam-spacer" />
      </div>
    </div>
  );
}
