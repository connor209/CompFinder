/**
 * Per-query diff of two resolver audits.
 *
 *   node scripts/diff-resolve.mjs before.json after.json
 *
 * The same discipline as diff-runs.mjs for pricing: a change that resolves
 * three hundred more queries while quietly breaking twenty is not an
 * improvement, and only a per-query comparison shows that. The sections are
 * ordered so the regressions are impossible to skim past.
 *
 * "Wrong and confident" is the metric that decides whether a change was worth
 * making. Everything else is context.
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/diff-resolve.mjs before.json after.json");
  process.exit(1);
}

const load = (p) => {
  const rows = JSON.parse(readFileSync(p, "utf8"));
  const by = new Map();
  for (const r of rows) by.set(`${r.card.id}|${r.shape}`, r);
  return by;
};
const before = load(beforePath);
const after = load(afterPath);

const shared = [...before.keys()].filter((k) => after.has(k));
console.log(`${shared.length} queries in both runs`);
console.log("=".repeat(72));

const wrongConf = (r) => r && !r.error && r.confident && r.topId !== r.card.id && r.shape !== "name only";
const found = (r) => r && !r.error && r.rank === 0;

const stat = (pred) => {
  let b = 0, a = 0;
  for (const k of shared) { if (pred(before.get(k))) b++; if (pred(after.get(k))) a++; }
  return [b, a];
};

const [wcB, wcA] = stat(wrongConf);
const [f1B, f1A] = stat(found);
const [misB, misA] = stat((r) => r && !r.error && r.rank === -1);
const [cB, cA] = stat((r) => r && !r.error && r.confident);

console.log(`  WRONG AND CONFIDENT: ${wcB} -> ${wcA}   <- the one that matters`);
console.log(`  right card ranked first: ${f1B} -> ${f1A}`);
console.log(`  right card never returned: ${misB} -> ${misA}`);
console.log(`  confident (any): ${cB} -> ${cA}`);

// Regressions first.
const lost = shared.filter((k) => found(before.get(k)) && !found(after.get(k)));
console.log(`\nLOST the top spot: ${lost.length}   <- regressions, if any`);
for (const k of lost.slice(0, 25)) {
  const b = before.get(k), a = after.get(k);
  console.log(`  "${a.q}"`);
  console.log(`     was rank 0, now rank ${a.rank} — top is ${a.topName} · ${a.topSet}`);
}
if (lost.length > 25) console.log(`  … ${lost.length - 25} more`);

const newlyWrong = shared.filter((k) => !wrongConf(before.get(k)) && wrongConf(after.get(k)));
console.log(`\nNEWLY wrong and confident: ${newlyWrong.length}`);
for (const k of newlyWrong.slice(0, 15)) {
  const a = after.get(k);
  console.log(`  "${a.q}" -> ${a.topName} · ${a.topSet}  (meant ${a.card.name} · ${a.card.set})`);
}

const gained = shared.filter((k) => !found(before.get(k)) && found(after.get(k)));
console.log(`\nGained the top spot: ${gained.length}`);
const byShape = {};
for (const k of gained) { const s = after.get(k).shape; byShape[s] = (byShape[s] || 0) + 1; }
for (const [s, n] of Object.entries(byShape).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
for (const k of gained.slice(0, 6)) console.log(`     e.g. "${after.get(k).q}"`);

// Confidence movements, both directions.
const nowConf = shared.filter((k) => !before.get(k).confident && after.get(k).confident && found(after.get(k)));
const nowAsk = shared.filter((k) => before.get(k).confident && !after.get(k).confident);
console.log(`\nNow answered without a picker (and correct): ${nowConf.length}`);
console.log(`Now shows a picker where it used to decide:  ${nowAsk.length}`);
const askRight = nowAsk.filter((k) => found(before.get(k)));
console.log(`  ...of those, ${askRight.length} had been deciding CORRECTLY (friction added)`);
for (const k of nowAsk.filter((k) => !found(before.get(k))).slice(0, 8)) {
  const b = before.get(k);
  console.log(`  now asks: "${b.q}" — used to pick ${b.topName} · ${b.topSet}`);
}
