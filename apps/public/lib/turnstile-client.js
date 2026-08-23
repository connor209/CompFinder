"use client";

/**
 * The browser half of the bot check.
 *
 * Nothing here runs until a search actually needs it: the script isn't
 * fetched, the widget isn't mounted, and a visitor whose searches all hit the
 * cache never loads a byte of it. That ordering is deliberate — the page's job
 * is to answer a question fast, and a third-party script on first paint is a
 * cost paid by every visitor to catch the few who aren't one.
 *
 * The whole module is inert without NEXT_PUBLIC_TURNSTILE_SITE_KEY, matching
 * the server: with no key configured there is no challenge to solve, and
 * /api/price isn't asking for one.
 *
 * @see lib/turnstile.js for the server side and why a pass, not a token, is
 *      what /api/price checks.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const challengeAvailable = () => Boolean(SITE_KEY);

let scriptPromise = null;
let widgetId = null;
let container = null;
let passPromise = null;
// The widget's callbacks are registered once at render and reused for every
// execute after it, so they can't close over one attempt's resolve/reject.
// This is the current attempt, whichever that is.
let pending = null;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later search try again: a blocked or flaky first load shouldn't
      // permanently convince the page that pricing is impossible.
      scriptPromise = null;
      reject(new Error("Couldn't load the human check."));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * The script's onload fires a moment before window.turnstile is assigned in
 * some browsers, so wait for the object rather than assuming it. Bounded, so a
 * script that loads but never initialises fails instead of hanging a search.
 */
async function ready(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!window.turnstile) {
    if (Date.now() > deadline) throw new Error("The human check didn't start.");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Bottom-right, above everything. Usually invisible: `interaction-only` means
 * the widget shows itself only when Cloudflare wants a click, and if that
 * happens the visitor has to be able to see and reach it.
 */
function mount() {
  if (container && container.isConnected) return container;
  container = document.createElement("div");
  container.setAttribute("aria-live", "polite");
  Object.assign(container.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "2147483647"
  });
  document.body.appendChild(container);
  return container;
}

function solve() {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    const opts = {
      sitekey: SITE_KEY,
      // Nothing happens until execute() is called, so mounting the widget
      // doesn't interrupt anyone mid-search.
      execution: "execute",
      appearance: "interaction-only",
      callback: (token) => pending && pending.resolve(token),
      "error-callback": () => pending && pending.reject(new Error("The human check failed.")),
      "timeout-callback": () => pending && pending.reject(new Error("The human check timed out."))
    };
    try {
      if (widgetId === null) widgetId = window.turnstile.render(mount(), opts);
      // A token is single-use, so a second challenge needs the widget reset
      // before it will produce another one.
      else window.turnstile.reset(widgetId);
      window.turnstile.execute(widgetId, {});
    } catch (err) {
      reject(err);
    }
  }).finally(() => {
    pending = null;
  });
}

/**
 * Solve a challenge and trade it for the pass cookie /api/price checks.
 *
 * Single-flight. A search fires two price requests in parallel and both can be
 * told to challenge; without this they would race, and the second token would
 * arrive after the first had already been spent. Both callers await the same
 * attempt, and it clears afterwards so a pass that expires half an hour later
 * can be re-earned.
 *
 * Resolves false rather than throwing: the caller's next move is to surface
 * the original pricing error, not a second one about the check itself.
 */
export function ensurePass() {
  if (!SITE_KEY) return Promise.resolve(false);
  if (passPromise) return passPromise;

  passPromise = (async () => {
    try {
      await loadScript();
      await ready();
      const token = await solve();
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      }).then((r) => r.json());
      return Boolean(res && res.ok);
    } catch (err) {
      console.warn("human check failed:", err.message);
      return false;
    }
  })();

  passPromise.finally(() => {
    passPromise = null;
  });
  return passPromise;
}
