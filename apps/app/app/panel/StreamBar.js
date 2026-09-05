"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lotFrom, lotBlockers, streamValue, relayUrl, RELAY_ORIGIN } from "@/lib/livestream.js";

/**
 * Comp Finder — sending a card to the live stream.
 *
 * An eBay Live auction runs off the listing's own photographs rather than the
 * card being pulled and held up to a lens. The screen the audience sees is an
 * OBS browser source pointed at the relay in tools/stream-relay; this is the
 * other end of that — the button on a listing that puts it in the queue.
 *
 * Three things worth knowing before changing anything here.
 *
 * **It is OFF by default and remembered.** Nobody who is not streaming should
 * have a tab polling a port every few seconds, and a relay that is not running
 * would otherwise fill the console with failed requests on the busiest screen
 * in the app.
 *
 * **The lot is built HERE**, by lotFrom() in lib/livestream.js, and the relay
 * only ever refuses or accepts it. That is what keeps one answer to "what may
 * be said on air" — see the rules in that file, and check-livestream.mjs,
 * which greps the relay for any sign of it building one itself.
 *
 * **A held price is reported to the host, in prose, at the moment of
 * queueing.** The audience will see no figure on that lot, and the person
 * about to talk over it for thirty seconds is the one who needs to know why —
 * a blank where the last lot had a number is the host's problem to talk
 * around, not a surprise to have on air.
 */

const ENABLED_KEY = "cf-stream-on";
const ORIGIN_KEY = "cf-stream-origin";
const POLL_MS = 4000;

function readStored(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * The relay, as this screen sees it.
 *
 * Called ONCE per screen and handed down — the same rule useDeal() runs on,
 * and for the same reason: a hook per row is two hundred timers on a list
 * that was already fixed once for doing too much per row.
 */
export function useRelay() {
  const [on, setOn] = useState(false);
  const [origin, setOrigin] = useState(RELAY_ORIGIN);
  const [state, setState] = useState({ up: false, count: 0, at: -1, checked: false });
  const originRef = useRef(origin);
  originRef.current = origin;

  useEffect(() => {
    setOn(readStored(ENABLED_KEY, "") === "1");
    setOrigin(readStored(ORIGIN_KEY, RELAY_ORIGIN) || RELAY_ORIGIN);
  }, []);

  const check = useCallback(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    try {
      const res = await fetch(relayUrl("/state", originRef.current), { signal: ctl.signal, cache: "no-store" });
      const json = await res.json();
      setState({ up: true, count: json.count || 0, at: json.at ?? -1, holding: !!json.holding, checked: true });
    } catch {
      // Down, blocked by its origin allow-list, or simply not started yet.
      // They are one state on this screen because the remedy is the same
      // line: start the relay, and it prints what it accepts.
      setState({ up: false, count: 0, at: -1, checked: true });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!on) { setState({ up: false, count: 0, at: -1, checked: false }); return; }
    check();
    const t = setInterval(check, POLL_MS);
    return () => clearInterval(t);
  }, [on, origin, check]);

  const enable = useCallback((next) => {
    setOn(next);
    try { window.localStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* private mode */ }
  }, []);

  const setRelayOrigin = useCallback((next) => {
    const clean = String(next || "").trim().replace(/\/+$/, "") || RELAY_ORIGIN;
    setOrigin(clean);
    try { window.localStorage.setItem(ORIGIN_KEY, clean); } catch { /* private mode */ }
  }, []);

  const send = useCallback(async (lot) => {
    const res = await fetch(relayUrl("/queue", originRef.current), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lot })
    });
    const json = await res.json().catch(() => ({}));
    await check();
    return json;
  }, [check]);

  return { on, enable, origin, setOrigin: setRelayOrigin, ...state, send, check };
}

/**
 * "＋ Stream" — the button on a listing row.
 *
 * Two round trips and neither is cheap enough to do speculatively, which is
 * why this is a button and not something a list does for every row: the
 * pictures are one eBay GetItem call, and the lot itself is a POST to the
 * relay. Both happen when somebody decides this card is going in the auction.
 */
export function StreamButton({ relay, item, className = "inv-act" }) {
  const [phase, setPhase] = useState("idle"); // idle | working | done | error
  const [note, setNote] = useState("");

  if (!relay?.on || !item?.itemId) return null;

  async function queue() {
    setPhase("working");
    setNote("");
    try {
      const res = await fetch(`/api/ebay/pictures?itemId=${encodeURIComponent(item.itemId)}`).then((r) => r.json());
      const lot = lotFrom({
        id: item.itemId,
        title: item.title,
        source: item.source || null,
        images: res.pictures || [],
        rec: item.rec || null,
        graded: !!item.graded,
        condition: item.condition || null
      });
      const blockers = lotBlockers(lot);
      if (blockers.length) {
        setPhase("error");
        setNote(blockers.join("; "));
        return;
      }
      const out = await relay.send(lot);
      if (!out?.ok) {
        setPhase("error");
        setNote((out?.refused || []).join("; ") || out?.error || "the relay refused it");
        return;
      }
      setPhase("done");
      // Rule 3: nothing is held quietly. The audience gets no figure on this
      // lot, so the person about to talk over it hears why, now, rather than
      // finding an empty box on air.
      const value = item.rec ? streamValue(item.rec, { graded: !!item.graded }) : { held: true, reason: "not priced yet" };
      const degraded = res.degraded ? " · gallery shot only, eBay wouldn't give the full set" : "";
      setNote(value.held ? `queued with no figure — ${value.reason}${degraded}` : `queued · ${lot.imageCount} picture${lot.imageCount === 1 ? "" : "s"}${degraded}`);
    } catch (err) {
      setPhase("error");
      setNote(err?.message || "couldn't reach the relay");
    }
  }

  const label = phase === "working" ? "…" : phase === "done" ? "✓ Queued" : "＋ Stream";
  return (
    <>
      <button
        className={className}
        onClick={(e) => { e.preventDefault(); queue(); }}
        disabled={phase === "working" || !relay.up}
        title={relay.up ? "Send this card to the live stream queue" : "The relay isn't running — start it with: node tools/stream-relay/server.mjs"}
      >
        {label}
      </button>
      {note ? <span className={phase === "error" ? "hint-small sb-bad" : "hint-small"}>{note}</span> : null}
    </>
  );
}

/**
 * The strip at the top of a screen that can feed the stream.
 *
 * It says three things and nothing else: whether the relay is up, how many
 * lots are waiting, and where to point OBS. When the relay is down it says the
 * command — the failure this repo has already paid to learn about is a button
 * that silently does nothing, and one line of small print naming the actual
 * cause settles in one try what inference gets wrong twice.
 */
export function StreamBar({ relay }) {
  if (!relay) return null;
  if (!relay.on) {
    return (
      <div className="sb-strip">
        <button className="inv-act" onClick={() => relay.enable(true)}>🔴 Live stream mode</button>
        <span className="hint-small">Off. Turn it on to queue cards for an eBay Live auction.</span>
      </div>
    );
  }
  return (
    <div className="sb-strip">
      <button className="inv-act" onClick={() => relay.enable(false)}>Stop stream mode</button>
      <span className={relay.up ? "sb-dot sb-dot-live" : "sb-dot"} aria-hidden="true" />
      {relay.up ? (
        <>
          <span className="hint-small">
            Relay up · {relay.count} lot{relay.count === 1 ? "" : "s"} queued{relay.holding ? " · holding" : ""}
          </span>
          <a className="hint-small" href={relayUrl("/", relay.origin)} target="_blank" rel="noreferrer">host&rsquo;s desk</a>
          <span className="hint-small">OBS source: <code>{relayUrl("/overlay", relay.origin)}</code></span>
        </>
      ) : (
        <span className="hint-small sb-bad">
          {relay.checked ? <>Relay not reachable at <code>{relay.origin}</code> — run <code>node tools/stream-relay/server.mjs</code> and make sure it accepts <code>{typeof window === "undefined" ? "" : window.location.origin}</code>.</> : "Looking for the relay…"}
        </span>
      )}
    </div>
  );
}
