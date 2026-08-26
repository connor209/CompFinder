/**
 * Can we put card art on the public page, and would it be the RIGHT card?
 *
 *   node scripts/probe-images.mjs [--json out.json]
 *
 * Our catalogue is Cardmarket-derived and carries no images. pokemontcg.io has
 * them, but it is a different index with its own set names and number
 * conventions, so the question isn't "do they have pictures" — it's how many
 * of our cards can be matched to one, and how often that match would be the
 * wrong card. A missing image is a gap; a wrong image is a lie about what
 * you're pricing.
 *
 * Matching is set + collector number. The NAME is then checked as a guard
 * rather than used to match: if set and number agree but the names don't, the
 * mapping is wrong and the image is refused.
 *
 * ENGLISH IS THE DENOMINATOR. pokemontcg.io indexes English printings only,
 * and our audit sets are deliberately multilingual — half of them exist to
 * stress language detection. Measuring against all of them would report a
 * coverage failure that is really a scope difference, so the two are counted
 * apart, using the page's own languageOf().
 *
 * This only measures. Nothing is written anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { languageOf } from "../apps/public/lib/resolve.js";
import { setFamily } from "./lib/card-images.mjs";
import { tcgdex, pokemontcg, readySources, matchSet } from "./lib/image-sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const JSON_OUT = argOf("--json", null);

// Two sources, asked in that order, both defined in lib/image-sources.mjs —
// the same module and the same order the backfill uses, so what this reports
// is what a backfill would actually write. Measuring through a second copy of
// that logic is how the probe ended up reporting a coverage failure the
// backfill didn't have: it looked our set names up EXACTLY, which the backfill
// never did, so every "EX Unseen Forces"-style name came back as a set tcgdex
// has never heard of. setFamily is where that rule lives.
const sources = [tcgdex(), pokemontcg()];

// --- our side ---------------------------------------------------------------
const ours = [
  ...JSON.parse(readFileSync(join(HERE, "bigset.json"), "utf8")),
  ...JSON.parse(readFileSync(join(HERE, "wideset.json"), "utf8"))
].filter((c) => (c.game || "pokemon") === "pokemon")
 .map((c) => ({ ...c, language: languageOf({ expansion: c.set, expansion_code: c.code }) }));

const english = ours.filter((c) => c.language === "English");
const bySet = new Map();
for (const c of english) {
  if (!bySet.has(c.set)) bySet.set(c.set, []);
  bySet.get(c.set).push(c);
}
console.log(`${ours.length} catalogue cards — ${english.length} English across ${bySet.size} sets`);
console.log(`(${ours.length - english.length} non-English are out of scope: pokemontcg.io indexes English printings)\n`);

// --- their sets -------------------------------------------------------------
console.log("asking the sources what they have:");
const ready = await readySources(sources);
if (!ready.length) { console.error("No image source would answer."); process.exit(1); }
console.log("");

// --- match set by set -------------------------------------------------------
const rows = [];
const unmatchedSets = [];
const incompleteSets = [];
for (const [setName, cards] of bySet) {
  const results = await matchSet(ready, setName, cards);
  let ok = 0;
  for (const { row, match, source } of results) {
    if (match.outcome === "matched") ok++;
    rows.push({ ...row, ...match, source, image: match.small || null, imageLarge: match.large || null });
  }
  const placed = ready
    .map((src) => setFamily(setName, src.setList).map((f) => f.id).join(" + "))
    .filter(Boolean).join(" / ");
  if (!placed) unmatchedSets.push({ setName, cards: cards.length });
  if (results.some((r) => r.match.outcome === "unknown")) incompleteSets.push({ setName, cards: cards.length });
  console.log(`  ${String(ok).padStart(3)}/${String(cards.length).padEnd(3)} ${setName}  →  ${placed || "no source has this set"}`);
}

// --- what that adds up to ---------------------------------------------------
const count = (o) => rows.filter((r) => r.outcome === o).length;
const known = rows.length - count("unknown");
const pct = (n) => (known ? `${Math.round((n / known) * 100)}%` : "—");
console.log(`\n${"-".repeat(64)}`);
console.log(`English cards                ${rows.length}`);
if (count("unknown")) console.log(`  couldn't be measured       ${count("unknown")}  (their API wouldn't answer)`);
console.log(`measured                     ${known}`);
console.log(`  matched, names agree       ${count("matched")}  (${pct(count("matched"))})`);
console.log(`  set found, number missing  ${count("no-number")}  (${pct(count("no-number"))})`);
console.log(`  set not in their index     ${count("no-set")}  (${pct(count("no-set"))})`);
console.log(`  NAMES DISAGREE             ${count("name-clash")}   <- would show the wrong card`);
console.log(`  listed but no art on file  ${count("no-art")}`);
for (const source of sources) {
  const { calls, failed } = source.stats;
  if (!calls) continue;
  const found = rows.filter((r) => r.source === source.name).length;
  console.log(`  via ${source.name.padEnd(11)} ${String(found).padStart(4)}   (${calls} calls${failed ? `, gave up on ${failed}` : ""})`);
}

const show = (title, list, fmt) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const r of list.slice(0, 20)) console.log(`  ${fmt(r)}`);
};
show("English sets with no counterpart", unmatchedSets.sort((a, b) => b.cards - a.cards),
  (s) => `${String(s.cards).padStart(3)} cards  ${s.setName}`);
show("sets a source wouldn't return", incompleteSets, (s) => `${s.setName} (${s.cards} cards)`);
show("name clashes", rows.filter((r) => r.outcome === "name-clash"),
  (r) => `${r.set} ${r.number}: ours "${r.name}" vs theirs "${r.theirName}"`);
show("numbers missing from a matched set", rows.filter((r) => r.outcome === "no-number"),
  (r) => `${r.set} #${r.number} ${r.name}`);

if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2)); console.log(`\nwrote ${JSON_OUT}`); }
