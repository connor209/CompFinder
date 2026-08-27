import { createHmac, timingSafeEqual, createHash } from "node:crypto";

/**
 * Bot protection for the one endpoint that spends money.
 *
 * The per-IP rate limit bounds one IP. That is the whole of its job and it
 * does it well, but a scraper that wants the catalogue does not have to use
 * one IP — a few hundred residential proxies each make 120 perfectly
 * well-behaved requests an hour and walk the entire card list at our expense.
 * Turnstile is the guard that asks a different question: is there a browser
 * here at all?
 *
 * INERT UNTIL CONFIGURED. With no TURNSTILE_SECRET_KEY the whole mechanism is
 * off and /api/price behaves exactly as it did — same reasoning as the EPN
 * campaign ID. A half-configured deployment (secret set, site key missing)
 * would lock every visitor out of pricing, so the client half is what decides
 * whether a challenge can be solved and the server half only enforces what the
 * client can satisfy.
 *
 * TWO STEPS, NOT ONE. A Turnstile token is single-use and short-lived, and a
 * single search fires two price requests (sold and active) in parallel — so
 * "attach a token to every request" means two challenges per search and a race
 * between them. Instead /api/challenge trades one token for a signed pass
 * cookie, and /api/price checks the pass. One challenge, then thirty quiet
 * minutes.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

/** How long a solved challenge is good for. */
export const PASS_TTL_SECONDS = 30 * 60;
export const PASS_COOKIE = "cf_pass";

const SECRET = process.env.TURNSTILE_SECRET_KEY || "";

/** Off unless a secret is configured. Checked everywhere rather than assumed. */
export function turnstileEnabled() {
  return Boolean(SECRET);
}

/**
 * Signing key for the pass cookie. Derived from the Turnstile secret rather
 * than adding a second env var to keep in sync — it is already server-only and
 * already rotates when Turnstile does. Hashed rather than used directly so the
 * cookie signature can't be used as an oracle on the secret itself.
 */
function signingKey() {
  return createHash("sha256").update(`compfinder-pass|${SECRET}`).digest();
}

/**
 * The NETWORK a pass was earned on, not the exact address it arrived from.
 *
 * A pass bound to one address is a pass a phone loses mid-search, and that is
 * how the check turned into a dead end on mobile: a carrier moves a handset
 * between CGNAT egress addresses, and a dual-stack phone can answer one
 * request over IPv4 and the next over IPv6. Either way /api/price is asked by
 * an address that never solved a challenge, so it asks for another one — a
 * second challenge on a search that had already passed the first.
 *
 * A /24, or a /64 on IPv6, is "the same network" rather than "the same
 * socket". It keeps what the binding is actually for: a fleet of residential
 * proxies is spread across the internet, not across 256 neighbouring
 * addresses, so one solved challenge still can't be handed round a fleet.
 *
 * Anything that doesn't parse as an address — "unknown" from a missing
 * x-forwarded-for included — is used whole. A tag we can't narrow is still a
 * tag, and guessing at the shape of one would be the way to make two
 * different visitors share a pass.
 */
export function clientNetwork(ip) {
  const raw = String(ip || "unknown").trim();
  if (raw.includes(":")) {
    // A zone id ("%eth0") is the receiving host's business, never the peer's.
    const groups = expandIpv6(raw.split("%")[0]);
    if (!groups) return raw;
    // "::ffff:203.0.113.7" is an IPv4 address wearing an IPv6 spelling, and
    // its top four groups are zero — so treating it as IPv6 would file every
    // mapped address on the internet under one tag and let any of them present
    // any other's pass. Unwrap it and bucket it as the IPv4 address it is.
    if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
      const [a, b] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
      return `${a >> 8}.${a & 255}.${b >> 8}.0/24`;
    }
    return `${groups.slice(0, 4).join(":")}::/64`;
  }
  const octets = raw.split(".");
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) < 256)) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  return raw;
}

/**
 * The eight groups of an IPv6 address, "::" expanded and an IPv4-mapped tail
 * folded back into the two groups it stands for.
 *
 * Written out rather than split on ":" because the compressed forms are the
 * whole difficulty: "2a00:23c6::1" and "2a00:23c6:0:0:0:0:0:1" are one address
 * and have to produce one tag, or the drift this function exists to absorb
 * comes back as a re-challenge.
 */
function expandIpv6(addr) {
  if (!addr || !/^[0-9a-fA-F:.]+$/.test(addr)) return null;
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const split = (s) => (s ? s.split(":").filter(Boolean) : []);
  let head = split(halves[0]);
  let tail = halves.length === 2 ? split(halves[1]) : [];

  // "::ffff:203.0.113.7" — the dotted tail is worth two groups, not one.
  const from = tail.length ? tail : head;
  const last = from[from.length - 1];
  if (last && last.includes(".")) {
    const o = last.split(".");
    if (o.length !== 4 || !o.every((x) => /^\d{1,3}$/.test(x) && Number(x) < 256)) return null;
    const pair = [
      ((Number(o[0]) << 8) | Number(o[1])).toString(16),
      ((Number(o[2]) << 8) | Number(o[3])).toString(16)
    ];
    if (tail.length) tail = tail.slice(0, -1).concat(pair);
    else head = head.slice(0, -1).concat(pair);
  }

  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = head.concat(Array(fill).fill("0"), tail);
  if (groups.length !== 8) return null;
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  // Normalised, so "2A00" and "2a00:0000" can't tag as different networks.
  return groups.map((g) => g.replace(/^0+(?=.)/, "").toLowerCase());
}

/**
 * Passes are bound to the client, so solving one challenge and handing the
 * cookie to a hundred workers doesn't buy a hundred exemptions. Hashed because
 * a network in a cookie is still personal data sitting in someone's browser
 * for no reason — the server only ever needs to compare, never to read.
 */
function clientTag(ip) {
  return createHash("sha256").update(`${clientNetwork(ip)}|${SECRET}`).digest("hex").slice(0, 16);
}

function sign(payload) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** `<expiry>.<clientTag>.<signature>` — opaque to the client, cheap to check. */
export function issuePass(ip) {
  const exp = Math.floor(Date.now() / 1000) + PASS_TTL_SECONDS;
  const payload = `${exp}.${clientTag(ip)}`;
  return `${payload}.${sign(payload)}`;
}

export function passIsValid(value, ip) {
  if (!value) return false;
  const parts = String(value).split(".");
  if (parts.length !== 3) return false;
  const [exp, tag, sig] = parts;

  const expected = Buffer.from(sign(`${exp}.${tag}`));
  const presented = Buffer.from(sig);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a thrown comparison is a way past the check.
  if (expected.length !== presented.length) return false;
  if (!timingSafeEqual(expected, presented)) return false;

  if (!Number(exp) || Number(exp) * 1000 < Date.now()) return false;
  // Compared, never trusted: a valid signature over someone else's tag is
  // still someone else's pass.
  return tag === clientTag(ip);
}

/**
 * Ask Cloudflare whether this token is real.
 *
 * A failure to REACH Cloudflare is treated as a failure to verify, not as a
 * pass. This is the one place in the route that fails closed: everything else
 * here degrades towards serving the visitor, but a bot check that waves people
 * through whenever it can't see straight is not a bot check. The cost of being
 * wrong is bounded — the visitor is told to try again, and the rate limit and
 * the pacer are both still standing behind it.
 */
export async function verifyTurnstileToken(token, ip) {
  if (!SECRET) return { ok: false, reason: "not-configured" };
  if (!token || typeof token !== "string" || token.length > 2048) {
    return { ok: false, reason: "missing-token" };
  }

  const form = new URLSearchParams({ secret: SECRET, response: token });
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  let json;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    });
    json = await res.json();
  } catch (err) {
    console.error("Turnstile siteverify unreachable:", err.message);
    return { ok: false, reason: "verify-unreachable" };
  }

  if (json && json.success) return { ok: true };
  return { ok: false, reason: (json && json["error-codes"] && json["error-codes"].join(",")) || "rejected" };
}
