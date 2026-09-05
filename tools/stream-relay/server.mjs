#!/usr/bin/env node
/**
 * Comp Finder — the live stream relay.
 *
 *   node tools/stream-relay/server.mjs
 *
 * OBS's Browser Source is its own isolated Chromium process. It cannot be
 * messaged by the page you have open in your own browser, and it has no
 * session with our app — so something has to sit between the screen where you
 * pick a card and the screen the audience sees. This is that something: a
 * server on the loopback interface of the machine running OBS.
 *
 *   the app  ──POST /queue──▶  relay  ──SSE /events──▶  /overlay  (OBS source)
 *                               │
 *                               └────────────────────▶  /        (the host's desk)
 *
 * Four decisions worth knowing before changing anything here.
 *
 * **It never builds a lot.** The producer decides what may be broadcast —
 * apps/app/lib/livestream.js is the one definition of that, and this file
 * imports its sanitiseLot() as a BOUNCER: a body whose shape it does not
 * recognise is refused whole rather than half-rendered on a stream. The day
 * this file starts filling in a missing field is the day there are two
 * answers to "what may go on air", and the quieter one is the one on the
 * broadcast. scripts/check-livestream.mjs greps for it.
 *
 * **Server-Sent Events, not a WebSocket.** The brief said WebSocket and this
 * is the one place it deviates. The traffic is entirely one-directional —
 * lots and state go to the screens, and the host's controls are ordinary
 * POSTs — so a socket buys nothing and costs either a dependency or a
 * hand-rolled frame parser. What EventSource adds is the thing that actually
 * matters in a hall: it RECONNECTS on its own, forever, with no code. OBS
 * routinely opens a browser source before the relay is running, and a stream
 * whose overlay went blank because you restarted the relay is a stream you
 * end early.
 *
 * **The clock is the server's.** The overlay derives which picture it is on
 * from the lot's own elapsed time rather than running its own timer, so a
 * reconnect mid-lot lands on the picture the desk says is showing instead of
 * starting the cycle again. Both processes are on one machine, so Date.now()
 * agrees to the millisecond.
 *
 * **127.0.0.1 only, never 0.0.0.0.** The machine running OBS is on hall or
 * hotel wifi. Bound to every interface this serves the queue, the stock and
 * the prices to everyone else on that network.
 *
 * No dependencies, on purpose: this has to start on a laptop in a venue with
 * no npm install behind it.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { sanitiseLot, MAX_QUEUE, LOT_MS, RELAY_PORT, cycleTiming } from "../../apps/app/lib/livestream.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const PORT = Number(process.env.STREAM_PORT || RELAY_PORT);
const HOST = "127.0.0.1";

/**
 * Who may talk to the relay from a browser.
 *
 * The relay is on loopback, so the only things that can reach it are on this
 * machine — but that includes every page you have open, and `*` would let any
 * of them READ the queue (your stock and your prices) as well as push junk
 * onto your stream. So it is an allow-list, and the allowed origins are
 * printed at startup: a blocked app is otherwise a button that does nothing,
 * which is the failure this repo has already paid to learn about once.
 */
const ALLOWED = new Set([
  // The relay's OWN pages. A browser sends an Origin header on every POST,
  // same-origin included, so without these the desk's buttons are refused by
  // the server that served them — and every curl test passes, because curl
  // sends no Origin at all. That is precisely how this shipped: the demo
  // button, Hold, Next and Clear were all dead in the browser and green in
  // every test.
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...String(process.env.STREAM_ALLOW_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean)
]);

/* --------------------------------------------------------------- the state
 *
 * In memory, and gone when the relay stops. A queue is a session: the lots in
 * it are the next twenty minutes of an auction, they are re-added in seconds
 * from the screen they came from, and a queue restored from disk after a
 * crash would be a list of cards that may already have sold. The same
 * reasoning DEAL_TTL_MS runs on, with a shorter fuse.
 */
const state = {
  queue: [],
  at: -1,            // index of the lot on air; -1 when nothing is
  lotMs: LOT_MS,
  elapsedMs: 0,      // time this lot has been on air, excluding holds
  runningSince: null // null while held; a timestamp while running
};

let timer = null;
const clients = new Set();

function currentLot() {
  return state.at >= 0 && state.at < state.queue.length ? state.queue[state.at] : null;
}

/** What both screens are handed. The overlay ignores most of it. */
function snapshot() {
  const lot = currentLot();
  return {
    lot,
    at: state.at,
    count: state.queue.length,
    holding: state.runningSince === null,
    lotMs: state.lotMs,
    elapsedMs: state.elapsedMs,
    runningSince: state.runningSince,
    serverNow: Date.now(),
    perImageMs: lot ? cycleTiming(lot.imageCount, state.lotMs).perImageMs : state.lotMs,
    // The pictures of the lot AFTER this one, so the overlay can warm them
    // while the host is still talking about this one. Four full-size eBay
    // photographs is most of a megabyte, and fetching them at the moment of
    // the swap is a blank rectangle on the broadcast.
    nextImages: state.queue[state.at + 1] ? state.queue[state.at + 1].images : [],
    // The desk's list. The overlay never renders it; it is here so the host
    // can see what is coming without a second request.
    queue: state.queue.map((l, i) => ({ i, id: l.id, name: l.name, valueText: l.valueText, held: l.valueHeld }))
  };
}

function publish() {
  const line = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { clients.delete(res); }
  }
}

/** Elapsed time on the current lot, holds excluded. */
function elapsed() {
  return state.elapsedMs + (state.runningSince === null ? 0 : Date.now() - state.runningSince);
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Arm the auto-advance for whatever is left of the current lot. */
function arm() {
  clearTimer();
  if (state.runningSince === null || !currentLot()) return;
  const left = Math.max(50, state.lotMs - elapsed());
  timer = setTimeout(() => { go(state.at + 1); }, left);
  if (timer.unref) timer.unref();
}

/**
 * Put a lot on air. Out of range parks the stream on nothing rather than
 * wrapping: the end of the queue is the end of the queue, and a stream that
 * silently started the list again is a stream selling the same card twice.
 */
function go(index, { hold = false } = {}) {
  const i = Number(index);
  state.at = Number.isFinite(i) && i >= 0 && i < state.queue.length ? i : -1;
  state.elapsedMs = 0;
  state.runningSince = state.at >= 0 && !hold ? Date.now() : null;
  arm();
  publish();
}

function setHold(holding) {
  if (holding && state.runningSince !== null) {
    state.elapsedMs = elapsed();
    state.runningSince = null;
  } else if (!holding && state.runningSince === null && currentLot()) {
    state.runningSince = Date.now();
  }
  arm();
  publish();
}

/**
 * Take lots into the queue, whoever sent them.
 *
 * The one path in. Everything arriving here has already been through
 * sanitiseLot(), which is the bouncer — this decides only about the QUEUE:
 * duplicates, the cap, and what goes on air as a result.
 */
function acceptLots(incoming) {
  const firstNew = state.queue.length;
  const accepted = [];
  const refused = [];
  for (const raw of incoming || []) {
    const lot = sanitiseLot(raw);
    if (!lot) { refused.push(raw?.name || raw?.id || "a lot"); continue; }
    // One card, one place in the queue. Re-sending a lot MOVES nothing — the
    // host may have it queued deliberately behind another card.
    if (state.queue.some((l) => l.id === lot.id)) { refused.push(`${lot.name} (already queued)`); continue; }
    if (state.queue.length >= MAX_QUEUE) { refused.push(`${lot.name} (queue full)`); continue; }
    state.queue.push(lot);
    accepted.push(lot.name);
  }
  // Nothing on air and something just arrived: air THAT, not index 0. A relay
  // that waited to be told is one more thing to remember with a stream
  // running — but the first version aired the front of the queue, so a lot
  // added after the queue had run off the end re-auctioned the card the
  // stream opened with. What is new is what goes up.
  if (state.at < 0 && accepted.length) go(firstNew);
  else publish();
  return { accepted, refused, count: state.queue.length };
}

/* ------------------------------------------------------------------- HTTP */

function cors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  // Chrome's Private Network Access check: a page on the public internet
  // asking anything of a loopback server gets a preflight first, and without
  // this header the request is blocked with nothing useful in the console.
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  return origin;
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

async function serveFile(res, name) {
  const path = normalize(join(PUBLIC, name));
  if (!path.startsWith(PUBLIC)) return json(res, 403, { ok: false, error: "no" });
  try {
    const body = await readFile(path);
    const ext = name.slice(name.lastIndexOf("."));
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    json(res, 404, { ok: false, error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;
  const origin = cors(req, res);

  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // Pages, same-origin, no CORS involved.
  if (req.method === "GET" && (path === "/" || path === "/desk")) return serveFile(res, "desk.html");
  if (req.method === "GET" && path === "/overlay") return serveFile(res, "overlay.html");

  if (req.method === "GET" && path === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      // OBS sits behind nothing, but a proxy that buffers an event stream is
      // an overlay that updates in bursts a minute late.
      "x-accel-buffering": "no"
    });
    // Reconnect fast: the gap between "the relay restarted" and "the overlay
    // is live again" is dead air.
    res.write("retry: 1000\n\n");
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* dropped below */ } }, 15_000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === "GET" && path === "/state") {
    if (origin && !ALLOWED.has(origin)) return json(res, 403, { ok: false, error: "origin not allowed" });
    return json(res, 200, { ok: true, ...snapshot() });
  }

  if (req.method === "POST" && path === "/queue") {
    if (origin && !ALLOWED.has(origin)) {
      return json(res, 403, { ok: false, error: `origin ${origin} is not allowed — start the relay with STREAM_ALLOW_ORIGIN=${origin}` });
    }
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: "bad body" }); }
    const incoming = Array.isArray(body.lots) ? body.lots : [body.lot ?? body];
    const out = acceptLots(incoming);
    return json(res, out.accepted.length ? 200 : 400, { ok: out.accepted.length > 0, ...out });
  }

  if (req.method === "POST" && path === "/control") {
    if (origin && !ALLOWED.has(origin)) return json(res, 403, { ok: false, error: "origin not allowed" });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: "bad body" }); }
    const action = String(body.action || "");
    switch (action) {
      case "next": go(state.at + 1); break;
      case "prev": go(Math.max(0, state.at - 1)); break;
      case "select": go(body.index); break;
      case "hold": setHold(true); break;
      case "resume": setHold(false); break;
      case "restart": go(state.at); break;
      case "remove": {
        const i = Number(body.index);
        if (Number.isFinite(i) && i >= 0 && i < state.queue.length) {
          state.queue.splice(i, 1);
          if (i < state.at) state.at -= 1;
          else if (i === state.at) go(Math.min(state.at, state.queue.length - 1));
        }
        publish();
        break;
      }
      case "clear": state.queue = []; go(-1); break;
      case "demo": {
        /**
         * Fill the queue with fixtures, so an OBS scene can be laid out with
         * no app, no eBay account and no database in the way.
         *
         * Refused once anything is queued, which is the whole safety story:
         * during a stream there is always something in the queue, so this can
         * never put four fake cards in front of an audience. The desk hides
         * the button then too, but the rule lives here rather than in the
         * page, because a page is one stale tab away from not having it.
         *
         * The fixtures are demo.mjs's, imported rather than written out — one
         * definition — and they go in through acceptLots() like anything
         * else, so sanitiseLot() vets them exactly as it vets a real lot.
         */
        if (state.queue.length) {
          return json(res, 409, { ok: false, error: "there is already something queued — clear it first" });
        }
        const { DEMO_LOTS } = await import("./demo.mjs");
        acceptLots(DEMO_LOTS);
        break;
      }
      case "lotMs": {
        const ms = Number(body.ms);
        if (Number.isFinite(ms) && ms >= 3000 && ms <= 600_000) state.lotMs = Math.round(ms);
        arm();
        publish();
        break;
      }
      default: return json(res, 400, { ok: false, error: `unknown action ${action}` });
    }
    return json(res, 200, { ok: true, ...snapshot() });
  }

  json(res, 404, { ok: false, error: "not found" });
});

/**
 * Open the host's desk in the default browser.
 *
 * The relay is started by double-clicking a file, by somebody who does not
 * want to be in a terminal — so the thing they actually need next should be
 * on screen rather than in a line of console output they have to copy. Purely
 * best-effort: no browser, no display, a locked-down machine, all fine, the
 * URL is printed anyway. `STREAM_NO_OPEN=1` turns it off.
 */
function openDesk(url) {
  if (process.env.STREAM_NO_OPEN === "1") return;
  const cmd = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" });
    child.on("error", () => { /* no browser here; the URL is printed above */ });
    child.unref();
  } catch { /* same */ }
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Comp Finder live stream relay`);
  console.log(`  ─────────────────────────────`);
  console.log(`  host's desk    http://${HOST}:${PORT}/`);
  console.log(`  OBS source     http://${HOST}:${PORT}/overlay`);
  console.log(`  accepts from   ${[...ALLOWED].join("  ")}`);
  console.log(`\n  Add an origin with STREAM_ALLOW_ORIGIN=https://your-app.vercel.app`);
  console.log(`  Leave this window open while you stream. Close it to stop.\n`);
  openDesk(`http://${HOST}:${PORT}/`);
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use — the relay may already be running.`);
    console.error(`  Use another with STREAM_PORT=4456 (and point OBS at it).\n`);
    process.exit(1);
  }
  throw err;
});
