/**
 * The sold window is one list, and both card screens read it from the URL.
 *
 *   node scripts/check-windows.mjs      (or: npm run check)
 *
 * The answer screen offers 30 or 90 days. The workings screen exists to show
 * the arithmetic behind the answer's number, so it has to count the same
 * sales — and until the window was in the URL it could not, because it had no
 * way to know which one had been asked for. A local `days` state on the answer
 * screen looks identical on that screen and silently makes the workings
 * explain a different figure.
 *
 * Three things are tested, two of them by grep, because the failure is never a
 * wrong calculation:
 *
 *   1. windowFromParam/cardHref behave — including that a bad param falls back
 *      rather than reaching /api/price, which would fragment the cache.
 *   2. Nobody re-declares the window list. It has been written out three times
 *      already (the route, the toggle, the loading copy).
 *   3. Neither card screen holds the window in component state.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SOLD_WINDOWS, DEFAULT_SOLD_WINDOW, windowFromParam, cardHref
} from "../apps/public/lib/windows.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function eq(label, got, want) {
  if (got !== want) {
    console.error(`  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    failed += 1;
  }
}

/* -- 1. the parser and the URL builder ----------------------------------- */
const PARAM_CASES = [
  // [what arrives in the URL, the window we honour, why]
  ["30", 30, "the short window, as the toggle writes it"],
  ["90", 90, "the long window, though it is also the default"],
  [undefined, DEFAULT_SOLD_WINDOW, "no param at all — the ordinary shared link"],
  ["", DEFAULT_SOLD_WINDOW, "empty string, from ?days="],
  ["60", DEFAULT_SOLD_WINDOW, "a plausible window we do not offer"],
  ["1", DEFAULT_SOLD_WINDOW, "someone walking the cache one day at a time"],
  ["90; DROP", DEFAULT_SOLD_WINDOW, "parseInt would take the 90 — the allow-list is what stops it"],
  ["30.9", 30, "parseInt truncates to a window we do offer"],
  ["NaN", DEFAULT_SOLD_WINDOW, "unparseable"],
  [["30", "90"], DEFAULT_SOLD_WINDOW, "a repeated ?days=, which Next hands over as an array"]
];
for (const [input, want, why] of PARAM_CASES) {
  eq(`windowFromParam(${JSON.stringify(input)}) — ${why}`, windowFromParam(input), want);
}

// The default is left off the URL, so the ordinary link is the one people have
// always shared. Anything else has to survive the round trip.
eq("cardHref at the default carries no param",
   cardHref("Charizard ex 199/165", DEFAULT_SOLD_WINDOW), "/card/Charizard%20ex%20199%2F165");
eq("cardHref at 30 days carries the param",
   cardHref("Charizard ex 199/165", 30), "/card/Charizard%20ex%20199%2F165?days=30");
eq("the workings link keeps the window",
   cardHref("Mew ex 232/091", 30, "/workings"), "/card/Mew%20ex%20232%2F091/workings?days=30");
eq("the workings link at the default does not",
   cardHref("Mew ex 232/091", 90, "/workings"), "/card/Mew%20ex%20232%2F091/workings");
for (const w of SOLD_WINDOWS) {
  const href = cardHref("Pikachu 58/102", w);
  const back = windowFromParam(new URL(href, "https://x").searchParams.get("days"));
  eq(`${w}d survives the round trip through the URL`, back, w);
}

/* -- 2. nobody re-declares the list -------------------------------------- */
const OWNS_THE_LIST = "apps/public/lib/windows.js";
const MUST_IMPORT = [
  "apps/public/app/api/price/route.js",
  "apps/public/app/card/[q]/CardScreen.js",
  "apps/public/app/card/[q]/page.js",
  "apps/public/app/card/[q]/workings/page.js",
  "apps/public/app/card/[q]/workings/Workings.js"
];
for (const rel of MUST_IMPORT) {
  const src = read(rel);
  if (!/from "[^"]*windows(\.js)?"/.test(src)) {
    console.error(`  ${rel} does not import the window list from lib/windows.js`);
    failed += 1;
  }
  // A second literal [30, 90] anywhere is the drift this file exists to stop.
  if (/\[\s*30\s*,\s*90\s*\]|\[\s*90\s*,\s*30\s*\]/.test(src)) {
    console.error(`  ${rel} declares its own window list — import SOLD_WINDOWS instead`);
    failed += 1;
  }
}
if (!/export const SOLD_WINDOWS/.test(read(OWNS_THE_LIST))) {
  console.error(`  ${OWNS_THE_LIST} no longer exports SOLD_WINDOWS`);
  failed += 1;
}

/* -- 3. the window is not component state -------------------------------- */
// useState(90) on the answer screen renders identically and quietly leaves the
// workings on the default. The URL is the only place it may live.
for (const rel of ["apps/public/app/card/[q]/CardScreen.js",
                   "apps/public/app/card/[q]/workings/Workings.js"]) {
  const src = read(rel);
  if (/useState\s*\(\s*(?:SOLD_WINDOWS|DEFAULT_SOLD_WINDOW|30|90)\b/.test(src)) {
    console.error(`  ${rel} holds the sold window in component state — it belongs in the URL`);
    failed += 1;
  }
}

// The copy on both screens has to be generated from the window on screen, not
// from a number typed into a sentence.
for (const rel of ["apps/public/app/card/[q]/CardScreen.js",
                   "apps/public/app/card/[q]/workings/Workings.js"]) {
  for (const [i, line] of read(rel).split("\n").entries()) {
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*")) continue;
    if (/(?:last|past)\s+90\s+days/i.test(code)) {
      console.error(`  ${rel}:${i + 1} hardcodes "90 days" in copy — print the window instead`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n${failed} sold-window case(s) failed.`);
  process.exit(1);
}
console.log(`windows: ${PARAM_CASES.length} param cases + URL round trip, one list, no local window state.`);
