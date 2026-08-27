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
 * TWO THINGS ARE LOAD-BEARING AND BOTH WERE LEARNED THE HARD WAY ON A PHONE.
 *
 * A challenge that wants a tap has to be IMPOSSIBLE TO MISS. Cloudflare
 * decides per visitor whether the check can be silent, and it asks a phone far
 * more often than it asks a desktop. This used to pin the widget in the
 * bottom-right corner at 12px, which on a phone is a small box in the home
 * indicator's lap, on a page still showing a spinner — so nobody tapped it,
 * `timeout-callback` fired thirty seconds later, and the search died with
 * "Just checking you're human" on screen as if it were an error message.
 * `before-interactive-callback` is Cloudflare telling us a tap is needed;
 * that is the moment to stop hiding and say so.
 *
 * NOTHING HERE MAY WAIT FOREVER. Every await below is bounded, because the
 * failure this module has to degrade into is a page that says what went wrong
 * and offers another go — not a spinner that never resolves. A content
 * blocker that eats the script, an iOS home-screen app where the widget's
 * frame gets no storage, a flaky mobile connection: all of them end in a
 * timeout that the caller can report and retry.
 *
 * @see lib/turnstile.js for the server side and why a pass, not a token, is
 *      what /api/price checks.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Fetching a third-party script over a phone connection, worst case. */
const SCRIPT_TIMEOUT_MS = 12000;
/**
 * How long a challenge may take once it has started. Generous, because this
 * covers a real person noticing the panel and tapping a checkbox — but finite,
 * because the alternative is a spinner with no end.
 */
const SOLVE_TIMEOUT_MS = 45000;

export const challengeAvailable = () => Boolean(SITE_KEY);

let scriptPromise = null;
let widgetId = null;
let root = null;
let slot = null;
let passPromise = null;
// The widget's callbacks are registered once at render and reused for every
// execute after it, so they can't close over one attempt's resolve/reject.
// This is the current attempt, whichever that is.
let pending = null;

/** Reject a promise if it hasn't settled in time, with our own wording. */
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = withTimeout(
    new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();
      const el = document.createElement("script");
      el.src = SCRIPT_SRC;
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("Couldn't load the human check."));
      document.head.appendChild(el);
    }),
    SCRIPT_TIMEOUT_MS,
    "The human check didn't load."
  );
  // Let a later search try again: a blocked, slow or flaky first load
  // shouldn't permanently convince the page that pricing is impossible.
  scriptPromise.catch(() => { scriptPromise = null; });
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
 * Where the widget lives.
 *
 * Two states, and the difference between them is the whole point. Silent, it
 * is parked out of the way and nobody should ever see it. Interactive, it is a
 * panel in the middle of the screen with a line of copy above it, because at
 * that moment it is the only thing standing between the visitor and their
 * answer — and a phone screen is exactly where a discreet corner widget goes
 * unnoticed.
 */
function mount() {
  if (slot && slot.isConnected) return slot;

  root = document.createElement("div");
  root.setAttribute("aria-live", "polite");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
    padding: "24px",
    // Below the fold of a phone's rounded corners and home indicator.
    paddingBottom: "max(24px, env(safe-area-inset-bottom))",
    zIndex: "2147483647",
    // Silent by default: rendered, but nothing to look at and nothing to hit.
    background: "transparent",
    pointerEvents: "none",
    visibility: "hidden"
  });

  const note = document.createElement("p");
  note.textContent = "Quick check that you're a person — tap the box, and we'll carry on.";
  Object.assign(note.style, {
    margin: "0",
    maxWidth: "18em",
    textAlign: "center",
    font: "500 13.5px/1.55 var(--font-sans, system-ui, sans-serif)",
    color: "var(--ink, #E9F1EF)"
  });

  slot = document.createElement("div");
  root.append(note, slot);
  document.body.appendChild(root);
  return slot;
}

/**
 * Cloudflare has decided this visitor has to do something. Show the panel.
 * Reversed on `after-interactive-callback` so a widget that goes quiet again
 * doesn't leave a backdrop over the answer.
 */
function setInteractive(on) {
  if (!root) return;
  root.style.visibility = on ? "visible" : "hidden";
  root.style.pointerEvents = on ? "auto" : "none";
  root.style.background = on ? "rgba(6, 12, 13, .88)" : "transparent";
}

/**
 * @param interactive may this challenge take over the screen to ask for a tap?
 *   False where the page is already showing the visitor's answer — see
 *   ensurePass below for why that distinction is the whole of it.
 */
function solve({ interactive }) {
  return withTimeout(
    new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const opts = {
        sitekey: SITE_KEY,
        // Nothing happens until execute() is called, so mounting the widget
        // doesn't interrupt anyone mid-search.
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => pending && pending.resolve(token),
        "before-interactive-callback": () => {
          // Cloudflare wants a tap. Where we're not allowed to ask for one,
          // that is the end of this attempt rather than a modal thrown over a
          // page the visitor is already reading.
          if (!interactive) return pending && pending.reject(new Error("The human check wanted a tap."));
          setInteractive(true);
        },
        "after-interactive-callback": () => setInteractive(false),
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
    }),
    SOLVE_TIMEOUT_MS,
    "The human check didn't finish."
  ).finally(() => {
    pending = null;
    // Whatever happened, the panel is not the visitor's problem any more.
    setInteractive(false);
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
 *
 * `interactive` is what stops the panel appearing over an answer. A card we
 * publish server-renders its price and then fetches live listings, which are
 * the upsell rather than the answer — nobody should be made to tap a checkbox
 * for an affiliate row on a page that has already told them what their card is
 * worth. So that call asks silently and takes no for an answer; the calls that
 * a blank screen is waiting on are the ones allowed to interrupt.
 *
 * The flight carries the mode of whoever started it and joiners take it as
 * they find it — the two never overlap in practice, since a page is either
 * waiting on an answer or showing one.
 */
export function ensurePass({ interactive = true } = {}) {
  if (!SITE_KEY) return Promise.resolve(false);
  if (passPromise) return passPromise;

  passPromise = (async () => {
    try {
      await loadScript();
      await ready();
      const token = await solve({ interactive });
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
