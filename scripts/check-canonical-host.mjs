/**
 * The canonical-host redirect: who gets bounced, who must never be.
 *
 *   node scripts/check-canonical-host.mjs      (or: npm run check)
 *
 * The redirect exists because an iOS Home Screen icon keeps the origin it was
 * installed from — a stale icon opens every page on an old vercel.app host,
 * where Turnstile refuses the human check and every uncached search dies.
 * The remedy is one hop at the door, and each case below is a way that hop
 * becomes its own outage:
 *
 *   1. A PREVIEW THAT BOUNCES TO LIVE is unreviewable. Anything but
 *      VERCEL_ENV=production must serve where it stands — dev included.
 *   2. THE FALLBACK HOST IS A LOOP. siteUrl() defaults to the apex, and
 *      Vercel 308s the apex to www: a redirect built from the fallback would
 *      ping-pong forever, exactly when NEXT_PUBLIC_SITE_URL went missing.
 *      No explicit site URL, no redirect — ever.
 *   3. A REDIRECT THAT DROPS THE PATH strands the visitor on the home page;
 *      one that drops the query changes the answer (?days=30).
 *   4. A 307 WOULD TURN A POST INTO A RETRY PROMPT and a 302 into a GET —
 *      the middleware must say 308.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };

const { canonicalRedirect, canonicalHost } = await import("../apps/public/lib/canonical-host.js");

const CANON = "https://www.lastcomp.co.uk";
const STALE = "compfinder-public.vercel.app";

function env(vercelEnv, siteUrl) {
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
}

// --- 1. only production redirects -------------------------------------------
for (const notProd of [undefined, "", "preview", "development", "Production"]) {
  env(notProd, CANON);
  const got = canonicalRedirect(STALE, "/card/x", "");
  if (got !== null) fail(`VERCEL_ENV=${JSON.stringify(notProd)} redirected (${got}) — a preview or dev must serve where it stands`);
}

// --- 2. production, wrong host: the hop this file exists for -----------------
env("production", CANON);
const cases = [
  [STALE, "/", "", `${CANON}/`],
  [STALE, "/card/umbreon-vmax-215", "?days=30", `${CANON}/card/umbreon-vmax-215?days=30`],
  ["lastcomp.co.uk", "/privacy", "", `${CANON}/privacy`],
  ["WWW.LASTCOMP.CO.UK", "/card/x", "", null],           // same host, someone else's casing
  ["www.lastcomp.co.uk", "/api/price", "", null]         // already home
];
for (const [host, path, search, want] of cases) {
  const got = canonicalRedirect(host, path, search);
  if (got !== want) fail(`host=${host} path=${path}${search}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

// --- 3. no explicit site URL, no redirect (the loop hazard) ------------------
for (const bad of [undefined, "", "   ", "not a url", "www.lastcomp.co.uk"]) {
  env("production", bad);
  const got = canonicalRedirect(STALE, "/", "");
  if (got !== null) fail(`NEXT_PUBLIC_SITE_URL=${JSON.stringify(bad)} still redirected (${got}) — the fallback host loops through Vercel's apex 308`);
  if (canonicalHost() !== null) fail(`canonicalHost() invented a host from ${JSON.stringify(bad)}`);
}

// --- 4. lenient about the URL's dressing, strict about its host --------------
env("production", "https://www.lastcomp.co.uk/");
if (canonicalHost() !== "www.lastcomp.co.uk") fail(`trailing slash broke the host: ${canonicalHost()}`);
env("production", CANON);
for (const noHost of [null, undefined, "", "  "]) {
  if (canonicalRedirect(noHost, "/", "") !== null) fail(`a missing host header caused a redirect — must fail open`);
}

// --- 5. the middleware actually wires it, and says 308 -----------------------
const mw = readFileSync(join(ROOT, "apps/public/middleware.js"), "utf8");
if (!/canonicalRedirect\s*\(/.test(mw)) fail("middleware.js doesn't consult canonicalRedirect()");
if (!/redirect\([^)]*,\s*308\s*\)/.test(mw)) fail("middleware.js doesn't redirect with 308 — a POST would lose its body or its method");
if (/process\.env\.(VERCEL_ENV|NEXT_PUBLIC_SITE_URL)/.test(mw)) {
  fail("middleware.js reads the env vars directly instead of going through canonical-host.js");
}
// And nothing else may grow a second copy of the decision.
const indexing = readFileSync(join(ROOT, "apps/public/lib/indexing.js"), "utf8");
if (/VERCEL_ENV/.test(indexing)) fail("indexing.js reads VERCEL_ENV — the redirect decision lives in canonical-host.js");

if (failures) {
  console.error(`\ncanonical-host: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log("canonical-host: production bounces to one host, previews stand, no site URL means no redirect.");
