/**
 * A state setter that was never declared.
 *
 *   node scripts/check-panelstate.mjs      (or: npm run check)
 *
 * This exists because it happened. The Show Desk shipped calling `setPhoto()`
 * and reading `photo` with no `useState` behind either, and the Show Desk
 * white-screened on every visit: "Application error: a client-side exception
 * has occurred".
 *
 * What makes it worth a check rather than more care is which safety nets it
 * walked straight through. `next build` compiles it — webpack does not resolve
 * free identifiers, it just emits them. A JSX parse passes, because it is
 * valid syntax. Every grep in this repo passes, because the string is right
 * there in the file. The failure only appears when React renders the
 * component, which nothing here does. Same shape as the `gbp()` client
 * boundary bug: builds perfectly clean, throws at request time.
 *
 * The rule is narrow on purpose. It does not attempt scope analysis; it asks
 * one question of every panel component — is every `setSomething()` you call
 * actually declared somewhere in this file? Setters legitimately arrive by
 * import (`setHideMode` from checkout.js) or as a prop, so those count as
 * declarations too.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Setters that are not state setters. The first run of this check reported
 * `setTimeout` in three components, which is the sort of noise that gets a
 * check switched off — and the false positives matter more than the true ones
 * here for the same reason they do in check-exclusions.
 */
const GLOBALS = new Set([
  "setTimeout", "setInterval", "setImmediate", "setRequestHeader",
  "setAttribute", "setItem", "setProperty", "setCustomValidity",
  "setSelectionRange", "setDate", "setHours", "setMinutes", "setMonth",
  "setFullYear", "setPointerCapture", "setData", "setTransform"
]);

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };

const dir = fileURLToPath(new URL("../apps/app/app/panel/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) fail("no panel components found — has the folder moved?");

let checked = 0;
for (const file of files) {
  const src = readFileSync(join(dir, file), "utf8");
  // Every setter this file CALLS, ignoring member calls like `foo.setBar()`
  // which belong to something else.
  const called = new Set();
  for (const m of src.matchAll(/(?<![.\w])(set[A-Z]\w*)\s*\(/g)) {
    if (!GLOBALS.has(m[1])) called.add(m[1]);
  }
  if (called.size === 0) continue;
  checked++;

  for (const setter of called) {
    const declared =
      // const [thing, setThing] = useState(...)
      new RegExp(`\\[\\s*\\w+\\s*,\\s*${setter}\\s*\\]`).test(src) ||
      // imported, destructured from props, or a plain function/const
      new RegExp(`\\b(function|const|let|var)\\s+${setter}\\b`).test(src) ||
      new RegExp(`import[^;]*\\b${setter}\\b[^;]*from`, "s").test(src) ||
      new RegExp(`\\{[^{}]*\\b${setter}\\b[^{}]*\\}\\s*(=|\\))`).test(src);
    if (!declared) {
      fail(`${file} calls ${setter}() but never declares it — that is a ReferenceError the moment the component renders`);
    }
  }
}

if (checked === 0) fail("no panel component called a setter — this check is not looking at anything");

// --- A row of buttons that cannot wrap is a button off the edge -----------
//
// The results actions shipped as an inline `style={{ display: "flex" }}` inside
// a space-between header. On a desktop all five fit; on a phone the last ones
// went off the side of the screen with nothing to scroll to reach them — and
// one of them spends money. The filter row had the matching fault: five fixed
// grid columns, no breakpoint, and a sixth control added to it.
{
  const at = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const panel = at("apps/app/app/panel/Panel.js");
  const css = at("apps/app/app/globals.css");

  if (/style=\{\{\s*display:\s*"flex"/.test(panel)) {
    fail("Panel.js has an inline flex row again — give it a class with flex-wrap, or its last button goes off the edge of a phone");
  }
  if (!/\.results-actions\s*\{[^}]*flex-wrap:\s*wrap/.test(css)) {
    fail(".results-actions does not wrap — the buttons that do not fit are simply off the screen");
  }
  if (/\.filter-grid\s*\{[^}]*grid-template-columns:\s*[^;]*fr\s+[^;]*fr\s+[^;]*fr\s+[^;]*fr\s+[^;]*fr/.test(css)) {
    fail(".filter-grid is back to fixed columns — adding a control to it then pushes the row off a narrow screen");
  }
  // Re-running spends a request per card, on a screen held in one hand.
  if (!/function rerunCurrent\(/.test(panel)) {
    fail("Panel.js has no re-run — the only way back to a re-price is finding the CSV again, which loses every correction since");
  }
  if (!/if \(!confirm\([\s\S]{0,200}again with the current filters/.test(panel)) {
    fail("re-run does not confirm — it spends a SoldComps request per card and one mis-tap on a phone starts the lot");
  }
}

if (failures) {
  console.error(`\ncheck-panelstate: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log(`check-panelstate: OK — every setter called in ${checked} panel components is declared.`);
