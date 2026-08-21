/**
 * Digs into an audit JSON for patterns worth acting on, rather than just
 * restating the summary. The question this answers is "what should change",
 * so it groups failures by shape and shows examples of each.
 */
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ok = rows.filter((r) => !r.fatal);
const gbp = (p) => (p == null ? "—" : "£" + (p / 100).toFixed(2));
const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;

console.log(`\n${ok.length} cards analysed\n` + "=".repeat(70));

// 1. Where does the pipeline lose cards?
const noComps = ok.filter((r) => r.fetched === 0);
const allExcluded = ok.filter((r) => r.fetched > 0 && r.used === 0);
const thin = ok.filter((r) => r.used > 0 && r.used <= 2);
console.log("\nPipeline:");
console.log(`  fetched nothing        ${pct(noComps.length, ok.length)}`);
console.log(`  fetched, all excluded  ${pct(allExcluded.length, ok.length)}`);
console.log(`  priced off 1-2 comps   ${pct(thin.length, ok.length)}`);
console.log(`  priced off 3+          ${pct(ok.filter((r) => r.used >= 3).length, ok.length)}`);

// 2. For the all-excluded cases, which rule did it?
if (allExcluded.length) {
  const why = {};
  for (const r of allExcluded) {
    const top = Object.entries(r.reasons || {}).sort((a, b) => b[1] - a[1])[0];
    const k = top ? top[0] : "(none recorded — dropped before recommend)";
    (why[k] = why[k] || []).push(r);
  }
  console.log("\nWhy everything was excluded:");
  for (const [k, list] of Object.entries(why).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(3)}  ${k}`);
    for (const r of list.slice(0, 4)) console.log(`         ${r.card.q.slice(0, 58)}  (${r.fetched} fetched)`);
  }
}

// 3. Thin pricing — the quiet failure, since it still produces a number.
if (thin.length) {
  console.log(`\nPriced off 1-2 comps (${thin.length}) — a number, but a fragile one:`);
  for (const r of thin.slice(0, 12)) {
    console.log(`  ${r.card.q.slice(0, 46).padEnd(47)} ${gbp(r.price).padStart(9)} from ${r.used} of ${r.fetched} fetched`);
  }
}

// 4. Would a wider market have helped?
const ukThin = ok.filter((r) => r.ukUsed === 0 && r.used > 0);
console.log(`\nCards with NO UK comps but a worldwide price: ${pct(ukThin.length, ok.length)}`);

// 5. Variant listings present but not asked for — potential mispricing.
const withVar = ok.filter((r) => Object.keys(r.variants || {}).length);
console.log(`Cards whose comps contain variant printings: ${pct(withVar.length, ok.length)}`);
const varHeavy = withVar.filter((r) => {
  const n = Object.values(r.variants).reduce((a, b) => a + b, 0);
  return r.fetched && n / r.fetched > 0.3;
});
console.log(`  …where >30% of comps are a variant: ${varHeavy.length}`);
for (const r of varHeavy.slice(0, 8)) {
  console.log(`     ${r.card.q.slice(0, 46).padEnd(47)} ${JSON.stringify(r.variants)} of ${r.fetched}`);
}

// 6. Wide spans — is the comp set actually one card?
const wide = ok.filter((r) => r.lo && r.hi && r.hi / r.lo > 15);
if (wide.length) {
  console.log(`\nWide price spans (>15x) — probably several cards pooled (${wide.length}):`);
  for (const r of wide.slice(0, 12)) {
    console.log(`  ${r.card.q.slice(0, 44).padEnd(45)} ${gbp(r.lo)}–${gbp(r.hi)}  ${r.used} comps`);
  }
}

// 7. Exclusion totals, to see which rule is doing the most work.
const all = {};
for (const r of ok) for (const [k, v] of Object.entries(r.reasons || {})) all[k] = (all[k] || 0) + v;
const total = Object.values(all).reduce((a, b) => a + b, 0);
console.log(`\nExclusions (${total} comps dropped across the run):`);
for (const [k, v] of Object.entries(all).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${String(Math.round(v / total * 100)).padStart(2)}%  ${k}`);
}
