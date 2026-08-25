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
 *
 * WHETHER it shows is decided in layout.js, in a blocking script that runs
 * before the first paint. This component only animates what that decision
 * already made visible — see the note on `done` below.
 */
export default function Splash() {
  const [stage, setStage] = useState("frame-one");
  // Starts VISIBLE, and that is the fix. It used to start hidden and be
  // switched on inside the effect — but an effect runs after the browser has
  // painted, so the page appeared and then the splash landed on top of it.
  // Now the markup is in the server HTML, CSS keeps it hidden unless the
  // decider in layout.js opted this visitor in before the first paint, and
  // nothing here can make it arrive late.
  const [done, setDone] = useState(false);
  const markRef = useRef(null);

  useEffect(() => {
    // The decision was already made, before paint. This only reads it.
    if (document.documentElement.getAttribute("data-splash") !== "show") {
      setDone(true);
      return undefined;
    }

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
      setTimeout(() => {
        // Clear the flag as well as the DOM: a client-side navigation back to
        // the home page must not find it still saying "show".
        document.documentElement.removeAttribute("data-splash");
        setDone(true);
      }, TIMELINE.handoff + TIMELINE.handoffMs)
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  if (done) return null;

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
