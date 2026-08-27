/**
 * The Turnstile pass is the only thing standing between a script and an
 * endpoint that spends money per call, so it gets a table test.
 *
 *   node scripts/check-turnstile.mjs      (or: npm run check)
 *
 * Everything here is offline: issuePass/passIsValid are HMAC arithmetic with
 * no network in them. Cloudflare's half (siteverify) is not tested — it can't
 * be without a live key — which is exactly why the half we own has to be.
 *
 * The cases that matter are the forgeries. A signature check that throws
 * instead of returning false, or one that compares the wrong bytes, fails open
 * and takes the whole guard with it silently.
 */

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
process.env.TURNSTILE_SECRET_KEY = SECRET;

const ts = await import("../apps/public/lib/turnstile.js");
// A second instance under a different secret, to prove a pass minted by one
// deployment can't be presented to another. The query string is what gets
// past the ESM module cache.
process.env.TURNSTILE_SECRET_KEY = "a-completely-different-secret-value";
const other = await import("../apps/public/lib/turnstile.js?instance=other");
process.env.TURNSTILE_SECRET_KEY = SECRET;

const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.9";
const good = ts.issuePass(IP);

/**
 * What the pass is bound to.
 *
 * The tag is a NETWORK, not an address, and both halves of that need pinning.
 * Too tight and a phone loses its pass mid-search — a carrier moves it between
 * CGNAT addresses, a dual-stack handset answers one request over IPv4 and the
 * next over IPv6 — which is exactly how a solved challenge turned into a dead
 * end on mobile. Too loose and one solved challenge is a pass for strangers.
 *
 * [label, address the pass is presented from, expected]
 */
const BINDING = [
  // The drift this exists to absorb: same /24, different address.
  ["a neighbour on the same /24", "203.0.113.200", true],
  ["the same address", "203.0.113.7", true],

  // ...and the line it must not cross.
  ["the next /24 along", "203.0.114.7", false],
  ["a different network entirely", OTHER_IP, false],

  // Junk in the address must never widen the bucket. Each of these has to fall
  // through to "use it whole" rather than being parsed into something coarser.
  ["a 999 octet", "203.0.113.999", false],
  ["a truncated address", "203.0.113", false],
  ["an empty address", "", false],
  ["unknown", "unknown", false]
];

const V6 = "2a00:23c6:5c8a:e300:1c2b:9f4a:0011:7e21";
const v6pass = ts.issuePass(V6);
const BINDING_V6 = [
  // Privacy extensions rotate the bottom half on a timer; the /64 is the one
  // stable thing a handset has, which is why it is what gets bound.
  ["a rotated interface id in the same /64", "2a00:23c6:5c8a:e300:99ff:2211:abcd:0001", true],
  ["the same address compressed", "2a00:23c6:5c8a:e300:1c2b:9f4a:11:7e21", true],
  ["the same address in capitals", "2A00:23C6:5C8A:E300:1C2B:9F4A:0011:7E21", true],
  ["a zone id on the end", "2a00:23c6:5c8a:e300:1c2b:9f4a:0011:7e21%en0", true],
  ["the next /64 along", "2a00:23c6:5c8a:e301:1c2b:9f4a:0011:7e21", false],
  ["a different /48", "2a00:23c6:ffff:e300:1c2b:9f4a:0011:7e21", false],
  ["an IPv4 pass presented as IPv6", IP, false]
];

// "::ffff:a.b.c.d" is an IPv4 address in IPv6 clothing, and its top four
// groups are all zero. Bucketing it by /64 would file every mapped address
// under one tag — a pass any of them could present to any other. It has to
// come out as the IPv4 network it actually is.
const MAPPED = [
  ["a mapped form of the address that solved it", "::ffff:203.0.113.7", true],
  ["a mapped neighbour on the same /24", "::ffff:203.0.113.200", true],
  ["a mapped address on another network", "::ffff:198.51.100.9", false],
  ["a mapped address from the next /24", "::ffff:203.0.114.7", false]
];

/** [label, value, ip, expected] */
const CASES = [
  ["a fresh pass, same visitor", good, IP, true],

  // Bound to the client: solving one challenge and handing the cookie to a
  // fleet of workers is the exact attack the pass exists to stop.
  ["the same pass from another IP", good, OTHER_IP, false],

  // Signature forgeries. Each of these is a plausible tamper, and each must
  // return false rather than throw — passIsValid sits inside an `if`, so an
  // exception here is a 500, and a 500 is not a denial.
  ["a flipped signature byte", good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A"), IP, false],
  ["a truncated signature", good.split(".").slice(0, 2).join(".") + ".short", IP, false],
  ["a longer signature", good + "padding", IP, false],
  ["an extended expiry, old signature", (() => {
    const [exp, tag, sig] = good.split(".");
    return `${Number(exp) + 86400}.${tag}.${sig}`;
  })(), IP, false],
  ["someone else's tag, our signature", (() => {
    const [exp, , sig] = good.split(".");
    return `${exp}.0123456789abcdef.${sig}`;
  })(), IP, false],
  ["no signature at all", good.split(".").slice(0, 2).join("."), IP, false],

  // Shapes a cookie can genuinely arrive in.
  ["an empty cookie", "", IP, false],
  ["a missing cookie", undefined, IP, false],
  ["a null cookie", null, IP, false],
  ["junk", "not-a-pass", IP, false],
  ["too many segments", `${good}.extra`, IP, false],
  ["a non-numeric expiry", (() => {
    const [, tag, sig] = good.split(".");
    return `never.${tag}.${sig}`;
  })(), IP, false],

  // A pass minted under a different TURNSTILE_SECRET_KEY.
  ["a pass from another deployment", other.issuePass(IP), IP, false]
];

let failures = 0;
for (const [label, ip, expected] of [...BINDING, ...MAPPED]) {
  const got = ts.passIsValid(good, ip);
  if (got !== expected) {
    console.error(`  WRONG  binding: ${label} — expected ${expected}, got ${got}`);
    failures++;
  }
}
for (const [label, ip, expected] of BINDING_V6) {
  const got = ts.passIsValid(v6pass, ip);
  if (got !== expected) {
    console.error(`  WRONG  binding (v6): ${label} — expected ${expected}, got ${got}`);
    failures++;
  }
}

for (const [label, value, ip, expected] of CASES) {
  let got;
  try {
    got = ts.passIsValid(value, ip);
  } catch (err) {
    console.error(`  THREW  ${label} — ${err.message}`);
    failures++;
    continue;
  }
  if (got !== expected) {
    console.error(`  WRONG  ${label} — expected ${expected}, got ${got}`);
    failures++;
  }
}

// Expiry. Minted in the past rather than waited for, which is the only way to
// test a 30-minute TTL in a test that has to finish.
const realNow = Date.now;
Date.now = () => realNow() - (ts.PASS_TTL_SECONDS + 60) * 1000;
const stale = ts.issuePass(IP);
Date.now = realNow;
if (ts.passIsValid(stale, IP) !== false) {
  console.error("  WRONG  an expired pass — expected false, got true");
  failures++;
}

// A pass that was valid a moment ago must still be valid now: an off-by-one
// on the expiry comparison would re-challenge every visitor on every search.
Date.now = () => realNow() - 60 * 1000;
const recent = ts.issuePass(IP);
Date.now = realNow;
if (ts.passIsValid(recent, IP) !== true) {
  console.error("  WRONG  a pass minted a minute ago — expected true, got false");
  failures++;
}

// Off means off. With no secret configured there is nothing to enable, and
// nothing that can be presented as a pass either.
process.env.TURNSTILE_SECRET_KEY = "";
const off = await import("../apps/public/lib/turnstile.js?instance=off");
if (off.turnstileEnabled() !== false) {
  console.error("  WRONG  turnstileEnabled() with no secret — expected false");
  failures++;
}
if (off.passIsValid(good, IP) !== false) {
  console.error("  WRONG  passIsValid with no secret — expected false");
  failures++;
}
process.env.TURNSTILE_SECRET_KEY = SECRET;
if (ts.turnstileEnabled() !== true) {
  console.error("  WRONG  turnstileEnabled() with a secret — expected true");
  failures++;
}

// verifyTurnstileToken short-circuits before the network on anything that
// obviously isn't a token, so these cost nothing and prove no request is made
// on an empty body.
for (const [label, token] of [["no token", undefined], ["an empty token", ""], ["an oversized token", "x".repeat(2049)]]) {
  const verdict = await ts.verifyTurnstileToken(token, IP);
  if (verdict.ok !== false || verdict.reason !== "missing-token") {
    console.error(`  WRONG  verify with ${label} — expected missing-token, got ${JSON.stringify(verdict)}`);
    failures++;
  }
}

if (failures) {
  console.error(`\nturnstile: ${failures} case(s) failed.`);
  process.exit(1);
}
const bindingCases = BINDING.length + MAPPED.length + BINDING_V6.length;
console.log(
  `turnstile: ${CASES.length + bindingCases + 8} pass cases hold ` +
  `(forgery, network binding v4/v6, expiry, off-switch).`
);
