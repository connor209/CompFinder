/**
 * Compares two audit runs so a change can be judged on what it actually moved,
 * rather than on the headline count. A fix that prices ten more cards while
 * quietly breaking three others is not an improvement, and only a per-card
 * diff shows that.
 *
 *   node scripts/diff-runs.mjs before.json after.json
 */
import { readFileSync } from "node:fs";
const key = (r) => r.card.q;
const load = (f) => Object.fromEntries(JSON.parse(readFileSync(f, "utf8")).filter((r) => !r.fatal).map((r) => [key(r), r]));
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const gbp = (p) => (p == null ? "—" : "£" + (p / 100).toFixed(2));

const shared = Object.keys(a).filter((k) => k in b);
const gained = shared.filter((k) => a[k].price == null && b[k].price != null);
const lost = shared.filter((k) => a[k].price != null && b[k].price == null);
const moved = shared.filter((k) => a[k].price != null && b[k].price != null && Math.abs(b[k].price / a[k].price - 1) > 0.1);
const compsUp = shared.filter((k) => b[k].used > a[k].used);
const compsDown = shared.filter((k) => b[k].used < a[k].used);

console.log(`${shared.length} cards in both runs\n` + "=".repeat(64));
console.log(`  priced before: ${shared.filter((k) => a[k].price != null).length}`);
console.log(`  priced after:  ${shared.filter((k) => b[k].price != null).length}`);
console.log(`  GAINED a price: ${gained.length}`);
console.log(`  LOST a price:   ${lost.length}   <- regressions, if any`);
console.log(`  price moved >10%: ${moved.length}`);
console.log(`  comps used up:  ${compsUp.length}   down: ${compsDown.length}`);

const flagBefore = shared.filter((k) => a[k].issues.length).length;
const flagAfter = shared.filter((k) => b[k].issues.length).length;
console.log(`  flagged: ${flagBefore} -> ${flagAfter}`);

const show = (label, keys, n = 12) => {
  if (!keys.length) return;
  console.log(`\n${label}:`);
  for (const k of keys.slice(0, n)) {
    console.log(`  ${k.slice(0, 46).padEnd(47)} ${gbp(a[k].price).padStart(9)} -> ${gbp(b[k].price).padStart(9)}  (${a[k].used} -> ${b[k].used} comps)`);
  }
  if (keys.length > n) console.log(`  … and ${keys.length - n} more`);
};
show("LOST a price (investigate first)", lost);
show("Gained a price", gained);
show("Price moved >10%", moved);
