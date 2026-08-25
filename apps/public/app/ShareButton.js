"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The answer as a PNG — saved, copied, or handed to the share sheet.
 *
 * The job this replaces is the snipping tool: someone answering "what's this
 * worth?" in a group screenshots the screen, and a snipped rectangle carries
 * no mark, no date and whatever else was on screen at the time.
 *
 * DESKTOP MUST NOT GET THE SHARE SHEET. The first version gated on
 * `navigator.canShare({files})`, which reads like a mobile check and is not:
 * Chrome and Edge on Windows implement Web Share with files, so a desktop
 * click opened the Windows share dialog — from which the only route to a
 * pasteable image was, of all things, the snipping tool. The pointer is the
 * signal that actually matters here, not the API's presence.
 *
 * So: a coarse pointer gets Share, because a saved file on a phone is three
 * taps from the conversation it was meant for. Everything else gets a plain
 * download, plus Copy where the clipboard takes images — which is the whole
 * job in one click for anyone pasting into a Facebook comment box.
 */
export default function ShareButton({ payload, filename }) {
  const [state, setState] = useState("idle");
  const [touch, setTouch] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  // The rendered PNG, kept so Copy-then-Save doesn't draw it twice.
  const cached = useRef({ key: null, blob: null });

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    setCanCopy(
      typeof window.ClipboardItem === "function" &&
      !!(navigator.clipboard && navigator.clipboard.write)
    );
  }, []);

  const png = useCallback(async () => {
    const key = JSON.stringify(payload);
    if (cached.current.key === key && cached.current.blob) return cached.current.blob;
    const res = await fetch(`/card/${encodeURIComponent(payload.query)}/share.png`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`share.png ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const blob = await res.blob();
    cached.current = { key, blob };
    return blob;
  }, [payload]);

  function flash(next) {
    setState(next);
    setTimeout(() => setState("idle"), next === "error" ? 3200 : 2400);
  }

  function fail(err) {
    // AbortError is the visitor dismissing the share sheet, which is not a
    // failure and must not be reported as one.
    if (err && err.name === "AbortError") {
      setState("idle");
      return;
    }
    console.error("Save image failed:", err);
    flash("error");
  }

  async function save() {
    if (state === "working") return;
    setState("working");
    try {
      const blob = await png();

      if (touch && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: "image/png" })] })) {
        await navigator.share({ files: [new File([blob], filename, { type: "image/png" })] });
        setState("idle");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked late: Safari has been known to cancel the download if the URL
      // dies in the same tick as the click.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      flash("saved");
    } catch (err) {
      fail(err);
    }
  }

  async function copy() {
    if (state === "working") return;
    setState("working");
    try {
      // The blob is passed as a PROMISE. Safari requires the ClipboardItem to
      // be constructed synchronously inside the gesture, and Chrome accepts
      // the same shape — awaiting the fetch first works in one and not the
      // other.
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": png() })]);
      flash("copied");
    } catch (err) {
      fail(err);
    }
  }

  const label =
    state === "working" ? "Making it…"
      : state === "saved" ? "Saved ✓"
      : state === "copied" ? "Copied ✓"
      : state === "error" ? "Didn't work — try again"
      : touch ? "Share image"
      : "Save image";

  return (
    <span style={{ display: "inline-flex", gap: 8 }}>
      <button className="sharebtn" type="button" onClick={save} disabled={state === "working"}>
        {label}
      </button>
      {canCopy && !touch && state !== "copied" && state !== "saved" && state !== "error" ? (
        <button className="sharebtn" type="button" onClick={copy} disabled={state === "working"}
                title="Copy the image, ready to paste">
          Copy
        </button>
      ) : null}
    </span>
  );
}
