"use client";

import { useEffect, useRef, useState } from "react";
import { TIMELINE } from "@/lib/splash-frame";

/**
 * The launch splash.
 *
 * On iOS the system has already drawn frame one as a static PNG before any of
 * this runs, so nothing here ENTERS or moves position — the mark is already
 * where it belongs. Only colour and the rule change, which is what makes the
 * swap from PNG to DOM invisible even if it lands mid-animation.
 *
 * It ends by shrinking the wordmark into the header rather than fading it out,
 * so the brand travels to where it lives instead of vanishing and reappearing.
 *
 * Shown on a home-screen launch every time, and once a session in a browser.
 * A splash on every page view is an obstacle, not an identity.
 */
export default function Splash() {
  const [stage, setStage] = useState("frame-one");
  const [gone, setGone] = useState(true);
  const markRef = useRef(null);

  useEffect(() => {
    // Decorative: under reduced motion there is nothing to gain and a second
    // of held-back content to lose.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const installed = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;

    let seen = false;
    try { seen = sessionStorage.getItem("lc-splash") === "1"; } catch { /* private mode */ }
    if (still || (seen && !installed)) return undefined;
    try { sessionStorage.setItem("lc-splash", "1"); } catch { /* fine */ }

    setGone(false);
    const timers = [
      setTimeout(() => setStage("warm"), TIMELINE.compWarms),
      setTimeout(() => setStage("rule"), TIMELINE.ruleFills),
      setTimeout(() => setStage("tag"), TIMELINE.taglineIn),
      setTimeout(() => {
        // Measure where the header wordmark actually sits and travel there,
        // rather than guessing a transform that drifts when the header does.
        const target = document.getElementById("lc-header-mark");
        const mark = markRef.current;
        if (target && mark) {
          const a = mark.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          mark.style.transformOrigin = "top left";
          mark.style.transform =
            `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.height / a.height})`;
        }
        setStage("out");
      }, TIMELINE.handoff),
      setTimeout(() => setGone(true), TIMELINE.handoff + TIMELINE.handoffMs)
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  if (gone) return null;

  return (
    <div className="splash" data-stage={stage} aria-hidden="true">
      <span className="sp-holo" />
      <span className="sp-mark" ref={markRef}>
        <span className="sp-last">Last</span>
        <span className="sp-comp">Comp</span>
        <span className="sp-rule"><i /></span>
      </span>
      <span className="sp-tag">Real eBay UK sold prices</span>
    </div>
  );
}
