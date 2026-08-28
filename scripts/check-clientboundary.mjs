/**
 * Nothing rendering on the server may CALL a function out of a "use client"
 * module.
 *
 *   node scripts/check-clientboundary.mjs      (or: npm run check)
 *
 * This is the fault that took /set/<slug> and /sets down in production, and it
 * is worth understanding rather than just fixing, because every property of it
 * is designed to escape notice.
 *
 * A `"use client"` module's exports are client REFERENCES. A server component
 * may render one as a component; calling one throws at request time:
 *
 *   Attempted to call gbp() from the server but gbp is on the client.
 *
 * It compiles. It builds. `npm run build:public` is clean, because nothing is
 * wrong until the call actually happens — and both pages only reached the call
 * when a card HAD a price to format. A cold cache renders a dash and never
 * invokes it, so an unwarmed set page and an unwarmed hub both look perfect.
 * The page breaks when the DATA arrives, which is the reverse of the order
 * anyone tests in, and it broke a page that had been live for days without
 * anyone touching it.
 *
 * So: a grep, over every server file under app/. Components are fine — that is
 * the whole point of a client component — but a bare function is not.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/public/app");
let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Exports of a "use client" module that are NOT components — the callable ones. */
const CLIENT_FUNCTIONS = ["gbp"];

const files = walk(APP);
let serverFiles = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (/^\s*["']use client["']/.test(src)) continue;   // a client file may call them
  serverFiles++;
  const rel = relative(ROOT, file);
  for (const fn of CLIENT_FUNCTIONS) {
    // Imported from a ui module — the "use client" one — rather than lib/money.
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*["'][^"']*\\bui["']`);
    if (imported.test(src)) {
      fail(`${rel} imports ${fn}() from the client ui module — server-side that throws at request time, and only once the data has a value to format. Import it from @/lib/money.`);
    }
  }
}

// ...and the server-safe home has to actually be server-safe.
const money = readFileSync(join(ROOT, "apps/public/lib/money.js"), "utf8");
if (/^\s*["']use client["']/.test(money)) fail("lib/money.js is a client module — then it is no safer than ui.js was");
if (!/export function gbp/.test(money)) fail("lib/money.js no longer defines gbp");
// One definition: ui.js must re-export rather than declare its own.
const ui = readFileSync(join(ROOT, "apps/public/app/ui.js"), "utf8");
if (/export const gbp\s*=/.test(ui)) fail("ui.js declares its own gbp again — two formatters will disagree about a price");

if (!serverFiles) fail("no server files were scanned — the walk is broken, not the code");

if (failures) {
  console.error(`\nclient boundary: ${failures} problem(s).`);
  process.exit(1);
}
console.log(`client boundary: ${serverFiles} server files, none calling a client function.`);
