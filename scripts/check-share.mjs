/**
 * The shareable price image.
 *
 *   node scripts/check-share.mjs      (or: npm run check)
 *
 * This picture outlives every other surface on the site. A card page is read
 * once and closed; a PNG dropped into a Facebook thread is still being quoted
 * at people in March. That asymmetry is what the cases below defend:
 *
 *   1. It is always dated. A price screenshot with no date is the thing two
 *      people argue about six months later.
 *   2. It never carries "buy it today for". Sold prices are facts about
 *      things that already happened; an asking price is two hours fresh at
 *      best, and CLAUDE.md already forbids server-rendering one for exactly
 *      this reason — an image that persists makes it worse, not better.
 *   3. Long names are cut rather than overrunning, because Satori has no
 *      ellipsis and no overflow.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shareFields, fit, shortDate } from "../apps/public/lib/share-card.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const ROUTE = "apps/public/app/card/[q]/share.png/route.js";
const SCREEN = "apps/public/app/card/[q]/CardScreen.js";

let failed = 0;
function eq(label, got, want) {
  if (got !== want) {
    console.error(`  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    failed += 1;
  }
}
function ok(label, cond) {
  if (!cond) { console.error(`  ${label}`); failed += 1; }
}

/* -- 1. the fields ------------------------------------------------------- */
const NOW = new Date("2026-08-25T09:00:00Z");
const UMBREON = {
  card: { name: "Umbreon VMAX", set: "Evolving Skies", number: "215" },
  marketPence: 83748,
  used: 8,
  windowDays: 90,
  lastSale: { pence: 94995, endedAt: "2026-08-23T10:00:00Z" },
  now: NOW
};
const f = shareFields(UMBREON);
eq("the figure", f.figure, "£837.48");
eq("the set line", f.setLine, "Evolving Skies · #215");
eq("the basis line", f.basis, "8 sold listings · last 90 days");
eq("the last sale", f.lastSale, "Last one £949.95 on 23 Aug 2026");
eq("the stamp carries the date", f.stamp, "eBay UK sold prices · 25 Aug 2026");

// One sale is not "1 sold listings".
eq("one sale reads singular",
   shareFields({ ...UMBREON, used: 1 }).basis, "1 sold listing · last 90 days");
// No sales is a real state, not an empty string.
eq("no sales says so",
   shareFields({ ...UMBREON, used: 0 }).basis, "No sales in the last 90 days");
// A card with no recent sale must not print "Last one —".
eq("a missing last sale is omitted entirely",
   shareFields({ ...UMBREON, lastSale: null }).lastSale, null);
eq("a last sale with no price is omitted too",
   shareFields({ ...UMBREON, lastSale: { pence: null } }).lastSale, null);
// The window is whatever the screen was showing.
ok("the basis follows the window",
   shareFields({ ...UMBREON, windowDays: 30 }).basis.includes("30 days"));

// However broken the input, the date survives — see the note at the top.
for (const broken of [{}, { card: null }, { marketPence: null, used: 0 }]) {
  const s = shareFields({ ...broken, now: NOW });
  ok(`a stamp survives ${JSON.stringify(broken)}`, /\d{4}/.test(s.stamp));
}
eq("an unparseable date is null rather than 'Invalid Date'", shortDate("not a date"), null);

/* -- 2. long text is cut, not overrun ------------------------------------ */
eq("short text is untouched", fit("Umbreon VMAX", 34), "Umbreon VMAX");
eq("exact length is untouched", fit("x".repeat(34), 34), "x".repeat(34));
ok("over-long text is cut to the limit", fit("x".repeat(80), 34).length <= 34);
ok("over-long text is marked as cut", fit("x".repeat(80), 34).endsWith("…"));
eq("a trailing space is not left before the ellipsis",
   fit("Iron Hands ex Special Illustration Rare", 20).endsWith(" …"), false);

/* -- 3. the standing rule: no asking price on a durable image ------------ */
// The hero figure everywhere else on the site. Wrong here for the same reason
// it is wrong on the server: by the time this is read, the listing may be gone.
const LIVE_ONLY = ["cheapest", "listings", "askPence", "buy-hero", "buy it today", "epnLink"];
const route = read(ROUTE);
for (const term of LIVE_ONLY) {
  ok(`${ROUTE} does not reach for "${term}"`, !route.includes(term));
}
// ...and the payload the screen sends must not offer it either.
const screen = read(SCREEN);
const payload = screen.slice(screen.indexOf("const sharePayload"), screen.indexOf("const searchUrl"));
ok("the share payload is actually built on the answer screen", payload.length > 40);
for (const term of ["cheapest", "listings", "askPence"]) {
  ok(`the share payload does not carry ${term}`, !payload.includes(term));
}
/* -- 4. the two methods, and which may touch the cache ------------------- */
// POST is handed its figures, so it must never read anything: that is what
// keeps a button click free, and what leaves nothing on it to scrape.
const postBody = route.slice(route.indexOf("export async function POST"));
ok("the route still has a POST", postBody.length > 40);
for (const term of ["serverCard", "loadCachedSold", "createPublicClient"]) {
  ok(`the POST handler does not read the cache (${term})`, !postBody.includes(term));
}

// GET is the OpenGraph image and may read the cache — but only read it. The
// standing rule is that a crawler never costs a SoldComps request, so an
// unfurl must not be able to reach the fetch path.
const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
ok("the route has a GET", getBody.length > 40);
ok("the GET reads the cache through serverCard", getBody.includes("serverCard"));
ok("the GET 404s rather than inventing a card", /404/.test(getBody));
for (const term of ["fetchSold", "/api/price", "soldcomps", "SoldComps("]) {
  ok(`the GET cannot reach SoldComps (${term})`, !getBody.includes(term));
}

// One picture. Two renderers would eventually disagree about which is the
// shareable card.
ok(`${ROUTE} draws through a single image()`,
   (route.match(/new ImageResponse\(/g) || []).length === 1);

/* -- 5. the page only claims an image it can actually draw --------------- */
const PAGE = "apps/public/app/card/[q]/page.js";
const page = read(PAGE);
ok(`${PAGE} gates the OG image on findPublished`,
   /function ogImageFor[\s\S]{0,400}findPublished/.test(page));
ok(`${PAGE} points at the share route`, page.includes("/share.png"));
ok(`${PAGE} declares the size platforms expect`,
   page.includes("width: 1200") && page.includes("height: 630"));
// summary_large_image on a card with no image renders as a broken box.
ok(`${PAGE} only claims summary_large_image when there is an image`,
   /og \? "summary_large_image" : "summary"/.test(page));

if (failed) {
  console.error(`\ncheck-share: ${failed} failed`);
  process.exit(1);
}
console.log("share image: dated, sold-only, long names cut; POST reads nothing, GET reads only the cache.");
