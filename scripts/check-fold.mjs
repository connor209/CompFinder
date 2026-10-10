/**
 * Folds: what a shut section is allowed to hide.
 *
 *   node scripts/check-fold.mjs      (or: npm run check)
 *
 * `apps/app/app/panel/Fold.js` is how a long screen gets shorter, and the
 * one way it can do harm is by folding away the thing you had to see. This
 * repo's rule since "Show the working" is that the working folds and the
 * warnings never do — so:
 *
 * - Fold.js renders its header and its `alert` OUTSIDE the body, and keeps
 *   the body mounted (`hidden`) so a half-filled form survives a fold.
 * - It reads localStorage in an effect, never during render (a hydration
 *   mismatch, and the same class of bug check-panelstate exists for).
 * - Every <Fold> names an `id`, unique across the app, or two sections
 *   would share one remembered open/shut.
 * - No <Fold> BODY contains an error line (`compfinder-error`, role="alert")
 *   or a ⚠. Those go in `alert`, which shows shut or open.
 *
 * Offline, a text scan. No framework, non-zero exit on failure.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
let failures = 0;
const fail = (msg) => { console.error(`  WRONG  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok  ${msg}`);

// ---- Fold.js itself ------------------------------------------------------
const foldSrc = readFileSync(join(root, "apps/app/app/panel/Fold.js"), "utf8");
const body = foldSrc.slice(foldSrc.indexOf("return ("));
const iHead = body.indexOf("fold-head");
const iAlert = body.indexOf("{alert}");
const iBody = body.indexOf('className="fold-body"');
if (iHead < 0 || iAlert < 0 || iBody < 0) fail("Fold.js: header, alert and body are all rendered");
else if (!(iHead < iBody && iAlert < iBody)) fail("Fold.js: header and alert render before (outside) the body");
else ok("Fold.js: header and alert sit outside the body");
if (!/hidden=\{!open\}/.test(body)) fail("Fold.js: a shut body stays mounted via hidden={!open}");
else ok("Fold.js: a shut body stays mounted");
{
  const effect = foldSrc.indexOf("useEffect(");
  const get = foldSrc.indexOf("localStorage.getItem");
  if (effect < 0 || get < effect) fail("Fold.js: localStorage is read inside an effect, not during render");
  else ok("Fold.js: localStorage read in an effect");
}

// ---- every <Fold> in the app --------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

// End of a JSX opening tag starting at `i` (the "<"): the first ">" at brace
// depth 0 outside a string. Returns [endIndex, selfClosing].
function openTagEnd(src, i) {
  let depth = 0, quote = null;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === quote && src[j - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return [j, src[j - 1] === "/"];
  }
  return [-1, false];
}

const ids = new Map();
let folds = 0;
for (const file of walk(join(root, "apps/app/app"))) {
  if (file.endsWith("/Fold.js")) continue;
  const src = readFileSync(file, "utf8");
  if (!/<Fold\b/.test(src)) continue;
  const rel = relative(root, file);
  const re = /<Fold\b/g;
  let m;
  while ((m = re.exec(src))) {
    folds++;
    const [end, selfClosing] = openTagEnd(src, m.index);
    const line = src.slice(0, m.index).split("\n").length;
    if (end < 0) { fail(`${rel}:${line}: could not find the end of <Fold`); continue; }
    const tag = src.slice(m.index, end + 1);
    const idm = tag.match(/\bid="([^"]+)"/);
    if (!idm) fail(`${rel}:${line}: <Fold> names a literal id, so its open/shut is remembered`);
    else if (ids.has(idm[1])) fail(`${rel}:${line}: fold id "${idm[1]}" is also used at ${ids.get(idm[1])}`);
    else ids.set(idm[1], `${rel}:${line}`);
    if (selfClosing) continue;
    // Matching </Fold>, counting nested folds.
    let depth = 1, k = end + 1;
    const tok = /<Fold\b|<\/Fold>/g;
    tok.lastIndex = k;
    let t;
    while (depth > 0 && (t = tok.exec(src))) {
      if (t[0] === "</Fold>") depth--;
      else { const [e2, sc] = openTagEnd(src, t.index); if (!sc) depth++; tok.lastIndex = e2 + 1; }
      k = t.index;
    }
    const inner = src.slice(end + 1, k);
    for (const [what, pat] of [["an error line (compfinder-error)", /compfinder-error/], ['role="alert"', /role="alert"/], ["a ⚠ warning", /⚠/]]) {
      if (pat.test(inner)) fail(`${rel}:${line}: a fold body holds ${what} — put it in the fold's alert`);
    }
  }
}
ok(`${folds} folds scanned, ${ids.size} distinct ids`);

if (failures) {
  console.error(`\nfold: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nfold: all passed");
