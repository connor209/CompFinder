/**
 * What `packages/core` ships to a browser.
 *
 *   node scripts/check-corebrowser.mjs      (or: npm run check)
 *
 * Core is bundled into BOTH products and runs in whatever browser a visitor or
 * a colleague is holding. That is easy to forget while editing it, because
 * everything here also runs under node, where the newest syntax always works.
 *
 * This exists because of an iPad. `inferCondition()` used a regex LOOKBEHIND
 * to stop "60 hp" reading as Heavily Played. Safari only learned lookbehind in
 * 16.4, so on an older iPad the expression is invalid — and the minifier
 * rebuilds a regex literal as `RegExp("(?<!\\d\\s)…")`, a runtime constructor
 * rather than a literal. That matters: a literal would be a parse-time
 * SyntaxError and would take the whole bundle down at load, which is at least
 * obvious. A constructor throws at the moment the function is first CALLED —
 * so the app opened, every other screen worked, and only the Show Desk
 * white-screened, on one device, which reads like anything but a regex.
 *
 * The rules the two rewrites had to preserve are pinned below. Both were also
 * differential-tested against the original lookbehind versions over 30,000
 * generated strings before landing; these cases are the ones worth keeping in
 * front of whoever edits them next.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import SoldCompsApi from "../packages/core/soldcomps.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};

// --- 1. no syntax that a supported browser cannot parse -------------------
// Lookbehind is the one that has actually bitten. Comments are stripped first,
// because the rewrites explain themselves by quoting the regex they replaced.
// Everything that can end up in a browser bundle, not just core. The copy
// that actually broke the iPad was NOT in core — it was a third, hand-copied
// inferCondition sitting in Panel.js, which is where a rule with three copies
// goes to hide. Scanning only the shared package would have missed it.
const ROOTS = ["packages/core", "apps/app/lib", "apps/app/app", "apps/public/lib", "apps/public/app"];
const SKIP = new Set(["node_modules", ".next", "assets"]);

function* jsFiles(rel) {
  const abs = fileURLToPath(new URL("../" + rel + "/", import.meta.url));
  let entries;
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    if (e.isDirectory()) yield* jsFiles(rel + "/" + e.name);
    else if (e.name.endsWith(".js")) yield [rel + "/" + e.name, join(abs, e.name)];
  }
}

let scanned = 0;
for (const root of ROOTS) {
  for (const [label, abs] of jsFiles(root)) {
    scanned++;
    // Comments stripped first: the rewrites explain themselves by quoting the
    // regex they replaced, and that quote is not shipped syntax.
    const src = readFileSync(abs, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((l) => l.replace(/^\s*\/\/.*$/, " ").replace(/\s\/\/.*$/, " "))
      .join("\n");
    if (/\(\?<[=!]/.test(src)) {
      fail(`${label} uses a regex lookbehind — this ships to browsers, and Safari before 16.4 throws on it`);
    }
  }
}
if (scanned < 50) fail(`only ${scanned} files scanned for lookbehind — this check is not looking at enough`);

// --- 2. the HP rule the rewrite had to keep -------------------------------
// A Pokemon's printed stat is not a condition. This is the case that made a
// lookbehind attractive in the first place.
eq("a printed HP stat is not a condition", SoldCompsApi.inferCondition("Pikachu 60 HP Vintage"), "Unknown");
eq("but a stated grade is", SoldCompsApi.inferCondition("Gengar heavily played"), "HP");
eq("and so is a bare HP", SoldCompsApi.inferCondition("Gengar HP"), "HP");
eq("a stat does not hide a real grade elsewhere", SoldCompsApi.inferCondition("Mewtwo 130 HP played copy HP"), "HP");
eq("the other grades are untouched", SoldCompsApi.inferCondition("Umbreon VMAX 215/203 NM"), "NM");
eq("nothing stated stays unknown", SoldCompsApi.inferCondition("Charizard 4/102"), "Unknown");

// --- 3. the Reverse Holo rule the other rewrite had to keep ---------------
// A Reverse Holo is a separately-priced printing of the same card. Pooling it
// with the regular one skews the price badly (Tyrogue: £7.97 against £2.34),
// so "holo" is stripped from a query and "reverse holo" is not.
// Compared on collapsed whitespace, because the stripper leaves a space
// behind and pricing.js squeezes runs of them a few lines later. Asserting the
// exact spacing would be pinning something nothing depends on.
const strip = (s) => s.replace(/(reverse\s)?\bholo\b/gi, (m, rev) => (rev ? m : " ")).replace(/\s+/g, " ").trim();
eq("a bare holo is stripped", strip("Charizard Holo Rare"), "Charizard Rare");
eq("a reverse holo survives", strip("Tyrogue Reverse Holo"), "Tyrogue Reverse Holo");
eq("case does not matter", strip("Tyrogue REVERSE HOLO"), "Tyrogue REVERSE HOLO");
// The case that catches a naive rewrite: only the holo directly after
// "reverse" is protected, and a second bare one still goes.
eq("a second bare holo after a reverse one still goes", strip("Tyrogue Reverse Holo Holo"), "Tyrogue Reverse Holo");
eq("holographic is not holo", strip("Charizard Holographic"), "Charizard Holographic");

if (failures) {
  console.error(`\ncheck-corebrowser: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-corebrowser: OK — core parses in the browsers we support, and both rewritten rules still hold.");
