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
 * Passes are bound to the client, so solving one challenge and handing the
 * cookie to a hundred workers doesn't buy a hundred exemptions. Hashed because
 * an IP in a cookie is personal data sitting in someone's browser for no
 * reason — the server only ever needs to compare, never to read.
 */
function clientTag(ip) {
  return createHash("sha256").update(`${ip}|${SECRET}`).digest("hex").slice(0, 16);
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
