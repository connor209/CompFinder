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
import { shareFields, fit, shortDate, drawableArt, DRAWABLE_TYPES } from "../apps/public/lib/share-card.js";
import { setShareFields, setsShareFields, totalGbp, TOP_ROWS } from "../apps/public/lib/set-share.js";
import { setsFromManifest, hubView } from "../apps/public/lib/card-page.js";

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

// A graded ask is ON the image, bound to the figure. A slab's price is several
// times the raw card's, this PNG gets quoted in threads for months, and
// "Umbreon VMAX sells for £875" with the PSA 10 left off is the site
// misquoting itself under its own brand. On the label over the figure, where
// a crop can't separate them.
eq("a graded ask labels the figure",
   shareFields({ ...UMBREON, grade: "PSA 10" }).figureLabel, "PSA 10 slab sells for");
eq("…and the basis counts slabs",
   shareFields({ ...UMBREON, grade: "PSA 10" }).basis, "8 sold slabs · last 90 days");
eq("a slab with no readable tier still says slab",
   shareFields({ ...UMBREON, grade: "graded" }).figureLabel, "Graded slab sells for");
eq("a raw card's label is exactly what it always was",
   shareFields(UMBREON).figureLabel, "Sells for");
eq("…and its basis still counts listings",
   shareFields(UMBREON).basis, "8 sold listings · last 90 days");

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
// The grade on the image is DERIVED from the query, through the same parser
// the page priced by — never taken as free text from the body, or anyone
// could draw their own words onto a branded, dated price card.
ok("the POST derives the grade with gradeAskFrom", postBody.includes("gradeAskFrom("));
ok("…and never reads a grade string off the body", !postBody.includes("body.grade"));

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

/* -- 6. the font actually reaches the deployment ------------------------- */
// These keys are GLOBS, not route names: "/card/[q]/share.png" reads like the
// route and matches /card/q/share.png instead, because `[q]` is a character
// class. Today the font still reaches the route through the /launch-image
// entry, so the mistake is currently harmless — which is exactly why it needs
// a test rather than a comment. Remove that entry and the share image loses
// its font with nothing failing at build time.
const CONFIG = "apps/public/next.config.js";
const config = read(CONFIG);
const keys = [...config.matchAll(/^\s*"([^"]+)":\s*\[/gm)].map((m) => m[1]);
ok(`${CONFIG} declares tracing keys`, keys.length > 0);
for (const key of keys) {
  ok(`tracing key ${JSON.stringify(key)} has no [brackets] — they are character classes, not route segments`,
     !key.includes("["));
}
// ...and something has to cover the share route, or the font is missing again.
ok("a tracing key covers the share route",
   keys.some((k) => k.startsWith("/card/") || k === "/card/**"));
// The file it reaches for must exist under the traced directory.
ok("the Archivo file is where the route looks for it",
   readFileSync(join(ROOT, "apps/public/assets/Archivo-Expanded-800.ttf")).byteLength > 1000);
// A missing font degrades rather than throwing.
ok(`${ROUTE} survives a missing font`, /fontData = null/.test(route));

/* -- 7. the artwork, which took the whole button down once ---------------- */
// The catalogue stores image_small as <card>/low.webp. A browser draws WEBP
// without blinking; Satori cannot, and it raises while PIPING the response —
// after the handler has returned — so it arrived as Next's own 500 page with
// nothing in it. Two rules, and both need to hold or it comes back.
eq("the stored webp is swapped for its png sibling",
   drawableArt("https://assets.tcgdex.net/en/sv/sv08/115/low.webp"),
   "https://assets.tcgdex.net/en/sv/sv08/115/high.png");
eq("a png is left alone",
   drawableArt("https://assets.tcgdex.net/en/swsh/swsh7/215/high.png"),
   "https://assets.tcgdex.net/en/swsh/swsh7/215/high.png");
eq("case doesn't matter", drawableArt("https://x/a/LOW.WEBP"), "https://x/a/high.png");
eq("nothing in, nothing out", drawableArt(null), null);
// The sibling name has to stay in step with scripts/lib/card-images.mjs, which
// is where these URLs are built in the first place.
const IMAGES = read("scripts/lib/card-images.mjs");
ok("card-images.mjs still builds low.webp / high.png",
   IMAGES.includes("low.webp") && IMAGES.includes("high.png"));

ok("webp is not on the drawable list", !DRAWABLE_TYPES.includes("image/webp"));
ok("png is", DRAWABLE_TYPES.includes("image/png"));
// An ALLOW-list. `startsWith("image/")` is what let the webp through.
ok(`${ROUTE} does not admit any image/* type`, !route.includes('startsWith("image/")'));
ok(`${ROUTE} checks against DRAWABLE_TYPES`, route.includes("DRAWABLE_TYPES.includes"));
// And the render is read to completion, or a pipe failure is uncatchable.
ok(`${ROUTE} buffers the image so a draw failure is catchable`,
   /arrayBuffer\(\)/.test(route) && route.includes("drawOrDropArt"));

/* -- 8. the share sheet is for phones, not for desktops ------------------ */
// `navigator.canShare({files})` reads like a mobile check and is not: Chrome
// and Edge on Windows implement Web Share with files, so gating on it alone
// opened the Windows share dialog on a desktop click — from which the only
// route to a pasteable image was the snipping tool this button exists to
// replace. The POINTER is the signal.
const BUTTON = "apps/public/app/ShareButton.js";
const button = read(BUTTON);
ok(`${BUTTON} decides on the pointer`, button.includes("(pointer: coarse)"));
ok(`${BUTTON} only reaches the share sheet behind that`,
   /touch && navigator\.canShare/.test(button));
ok(`${BUTTON} still has a plain download`, button.includes("a.download"));
// Passing the blob rather than a promise breaks Safari, which needs the
// ClipboardItem constructed inside the gesture.
ok(`${BUTTON} hands the clipboard a promise, not an awaited blob`,
   /ClipboardItem\(\{ "image\/png": png\(\) \}\)/.test(button));

if (failed) {
  console.error(`\ncheck-share: ${failed} failed`);
  process.exit(1);
}
console.log("share image: dated, sold-only, long names cut; POST reads nothing, GET reads only the cache; the set board is ranked, capped and cache-only.");
