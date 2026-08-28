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
import { cardPageDirectives, publishedCards, NOT_FOR_INDEX } from "../apps/public/lib/card-page.js";
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

// --- 4. which card URLs are pages for the index -----------------------------
// The sitemap has always refused to submit a thin page ("a thin page submitted
// in bulk demotes the good ones with it") while the pages themselves stayed
// indexable if a crawler found them any other way. Same split as robots.txt
// disagreeing with the metadata, one level down: the site's own two lists of
// what is worth indexing have to say the same thing.
{
  const PUBLISHED_Q = publishedCards()[0].q;
  const cases = [
    [PUBLISHED_Q, true, "a published card"],
    [PUBLISHED_Q.toUpperCase(), true, "…under a different spelling"],
    // The unbounded space: any string is a valid card URL, and since the grade
    // started riding in one, every "PSA 10 …" variant of all 455 as well.
    [`PSA 10 ${PUBLISHED_Q}`, false, "a graded ask"],
    ["Umbreon VMAX 215 Evolvingg Skiess", false, "a typo nobody publishes"],
    ["a card that does not exist", false, "an arbitrary string"],
    ["", false, "an empty query"]
  ];
  for (const [query, shouldIndex, why] of cases) {
    const { canonical, robots } = cardPageDirectives(query);
    const indexed = robots === null;
    if (indexed !== shouldIndex) {
      fail(`${why} (${JSON.stringify(query)}): want ${shouldIndex ? "indexable" : "noindex"}, got the other`);
    }
    // THE INVARIANT. noindex plus a canonical pointing elsewhere is the one
    // combination Google names as conflicting — the noindex can carry across
    // to the target, which here would be a page we DO stand behind. The two
    // come off one lookup so this cannot happen; pinned because a later hand
    // adding "a canonical costs nothing" would make it happen quietly.
    if (canonical && robots) fail(`${why}: emitted BOTH a canonical and robots — conflicting signals`);
    if (!canonical && !robots) fail(`${why}: emitted neither a canonical nor a noindex`);
  }
  if (NOT_FOR_INDEX.index !== false) fail("NOT_FOR_INDEX does not say noindex");
  // follow, so the long tail still passes what little it has up to the
  // published pages it links to.
  if (NOT_FOR_INDEX.follow !== true) fail("NOT_FOR_INDEX drops follow — the set links are the point of it");

  // The two surfaces that must actually use it.
  const cardPage = readFileSync(join(ROOT, "apps/public/app/card/[q]/page.js"), "utf8");
  const workings = readFileSync(join(ROOT, "apps/public/app/card/[q]/workings/page.js"), "utf8");
  if (!/cardPageDirectives\s*\(/.test(cardPage)) fail("the card page doesn't consult cardPageDirectives()");
  if (/findPublished[\s\S]{0,120}canonical/.test(cardPage)) {
    fail("the card page builds its own canonical instead of taking the one from cardPageDirectives()");
  }
  // The workings screen fetches on the client, so what leaves the server is a
  // spinner — on every card, published or not.
  if (!/NOT_FOR_INDEX/.test(workings)) fail("the workings screen doesn't carry a noindex");
}

if (failures) {
  console.error(`\nindexing: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log("indexing: default is closed, the flag reads as intended, robots and metadata share one answer, and only pages that answer are for the index.");
