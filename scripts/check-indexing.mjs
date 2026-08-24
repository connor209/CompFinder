/**
 * Whether the site invites search engines in, and whether it says so
 * consistently.
 *
 *   node scripts/check-indexing.mjs      (or: npm run check)
 *
 * Two failures worth catching, neither of which shows up in a browser:
 *
 *   1. THE DEFAULT DRIFTING OPEN. Off is the safe direction — the cost of
 *      being wrong that way is some indexing we didn't get yet, and the cost
 *      the other way is the content indexed against a preview hostname and a
 *      domain migration for pages that had just started to rank. It is also
 *      the thing SoldComps have not yet said we may do.
 *   2. robots.txt AND THE PAGE METADATA DISAGREEING. Crawling and indexing are
 *      different permissions: a robots.txt that says "don't crawl" while the
 *      pages carry no noindex leaves a URL discovered elsewhere indexable
 *      anyway. Both must come from one answer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };

/** Re-imported per case, because the module reads the env var at call time. */
async function indexing() {
  return import(`../apps/public/lib/indexing.js?${Math.random()}`);
}

// --- 1. the default is shut -------------------------------------------------
delete process.env.PUBLIC_ALLOW_INDEXING;
let { indexingAllowed, siteUrl } = await indexing();
if (indexingAllowed()) fail("indexing is ON with the flag unset — the default must be closed");

for (const off of ["", "0", "false", "no", "off", " ", "maybe"]) {
  process.env.PUBLIC_ALLOW_INDEXING = off;
  ({ indexingAllowed } = await indexing());
  if (indexingAllowed()) fail(`PUBLIC_ALLOW_INDEXING=${JSON.stringify(off)} was read as ON`);
}
for (const on of ["1", "true", "TRUE", "yes", " 1 "]) {
  process.env.PUBLIC_ALLOW_INDEXING = on;
  ({ indexingAllowed } = await indexing());
  if (!indexingAllowed()) fail(`PUBLIC_ALLOW_INDEXING=${JSON.stringify(on)} was read as OFF`);
}

// --- 2. the canonical host --------------------------------------------------
delete process.env.PUBLIC_ALLOW_INDEXING;
process.env.NEXT_PUBLIC_SITE_URL = "https://lastcomp.co.uk/";
({ siteUrl } = await indexing());
if (siteUrl() !== "https://lastcomp.co.uk") fail(`trailing slash not trimmed: ${siteUrl()}`);
delete process.env.NEXT_PUBLIC_SITE_URL;
({ siteUrl } = await indexing());
if (!/^https:\/\//.test(siteUrl())) fail(`default site URL is not absolute: ${siteUrl()}`);

// --- 3. both surfaces read the same answer ----------------------------------
// A grep, in the spirit of the liquidity check: neither file may decide this
// for itself, and nothing else may read the flag directly.
const robots = readFileSync(join(ROOT, "apps/public/app/robots.js"), "utf8");
const layout = readFileSync(join(ROOT, "apps/public/app/layout.js"), "utf8");
const sitemap = readFileSync(join(ROOT, "apps/public/app/sitemap.js"), "utf8");

if (!/indexingAllowed\s*\(/.test(robots)) fail("robots.js doesn't consult indexingAllowed()");
if (!/indexingAllowed\s*\(/.test(layout)) fail("layout.js doesn't consult indexingAllowed() — pages would stay indexable");
if (!/robots:/.test(layout)) fail("layout.js sets no robots metadata, so nothing emits noindex");
for (const [name, text] of [["robots.js", robots], ["layout.js", layout], ["sitemap.js", sitemap]]) {
  if (/process\.env\.PUBLIC_ALLOW_INDEXING/.test(text)) {
    fail(`${name} reads the flag directly instead of going through indexingAllowed()`);
  }
}
// The sitemap must not hardcode a host either, or robots.txt and the sitemap
// can advertise two different sites.
if (/NEXT_PUBLIC_SITE_URL/.test(sitemap) || /NEXT_PUBLIC_SITE_URL/.test(robots)) {
  fail("robots.js or sitemap.js builds its own base URL instead of using siteUrl()");
}

if (failures) {
  console.error(`\nindexing: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log("indexing: default is closed, the flag reads as intended, robots and metadata share one answer.");
