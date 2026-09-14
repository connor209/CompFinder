/**
 * The link out to eBay, and the filter that makes it the same question.
 *
 *   node scripts/check-marketlinks.mjs      (or: npm run check)
 *
 * Every 🔍 in this codebase promises the same thing: here are the listings
 * behind that number. The engine asks SoldComps for `itemLocation=domestic` on
 * `ebay.co.uk`, so a link without eBay's own location filter opens a WIDER
 * search than the one the price came from — US and EU sellers, converted
 * currency, international postage — and a page full of comps the row never saw
 * reads as the engine being wrong rather than the link being loose. It is the
 * expensive direction of the same fault `assessLiquidity()` was built for: two
 * copies of one question, silently answering differently.
 *
 * Four things are pinned:
 *
 *   1. The parameters themselves, as literals, on sold and active links alike.
 *      They are eBay's spelling and nothing here can derive them, so a typo is
 *      a filter that quietly does nothing — the search still returns a page.
 *   2. That domestic is the DEFAULT rather than something a call site opts
 *      into. Six call sites already exist; opt-in is one new screen away from
 *      being wrong again.
 *   3. That the engine still asks the same question. If soldcomps.js ever
 *      stops sending `itemLocation=domestic`, the link is the half that is now
 *      lying, and this is where that gets noticed.
 *   4. A grep against a second URL builder. One hand-written /sch/ link is a
 *      screen whose button behaves differently from every other copy of it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { ebaySearchUrl } from "../packages/core/marketplace.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function ok(label, cond) {
  if (!cond) {
    console.error(`  ${label}`);
    failed += 1;
  }
}

/* -- 1. the parameters, as eBay spells them ------------------------------- */
const sold = ebaySearchUrl("Umbreon VMAX 215/203 Evolving Skies", { customId: "batch" });
ok("a sold link asks for sold listings", sold.includes("&LH_Sold=1"));
ok("a sold link asks for completed listings", sold.includes("&LH_Complete=1"));
ok("a sold link asks for UK sellers only", sold.includes("&LH_PrefLoc=1"));
ok("the query is encoded, not pasted (215/203 is not a path)",
   sold.includes("_nkw=Umbreon%20VMAX%20215%2F203%20Evolving%20Skies")
   || sold.includes("_nkw=Umbreon+VMAX+215%2F203+Evolving+Skies"));

const active = ebaySearchUrl("Umbreon VMAX 215/203", { sold: false });
ok("an active link does NOT ask for sold listings", !active.includes("LH_Sold"));
ok("an active link is domestic too — the buy module's own figures are",
   active.includes("&LH_PrefLoc=1"));

/* -- 2. domestic is the default, and opting OUT is the only way past it ---- */
ok("no option needed: the plain call is already filtered",
   ebaySearchUrl("Charizard 4/102").includes("LH_PrefLoc=1"));
ok("domesticOnly:false is the documented escape hatch and still works",
   !ebaySearchUrl("Charizard 4/102", { domesticOnly: false }).includes("LH_PrefLoc"));

/* -- 3. the engine still asks the same question --------------------------- */
const soldcomps = read("packages/core/soldcomps.js");
ok("soldcomps.js still defaults to itemLocation=domestic — the link mirrors it",
   /itemLocation\s*=\s*"domestic"/.test(soldcomps));
ok("soldcomps.js still defaults to ebay.co.uk",
   /ebaySite\s*=\s*"ebay\.co\.uk"/.test(soldcomps));

/* -- 4. one builder, not six ---------------------------------------------- */
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".vercel"]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}
const OWNER = "packages/core/marketplace.js";
const offenders = walk(ROOT)
  .filter((f) => /\/sch\/i\.html/.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f).split("\\").join("/"))
  .filter((rel) => rel !== OWNER && !rel.startsWith("scripts/check-"));
ok(`nobody hand-writes an eBay search URL — ${OWNER} owns it (found: ${offenders.join(", ") || "none"})`,
   offenders.length === 0);

if (failed) {
  console.error(`\ncheck-marketlinks: ${failed} failure(s)`);
  process.exit(1);
}
console.log("check-marketlinks: ok");
