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
import { norm, numKey, setFamily, indexByNumber, matchCard } from "./lib/card-images.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const JSON_OUT = argOf("--json", null);

// TCGdex, not pokemontcg.io. Both were tried:
//
//   pokemontcg.io  174 English sets, one call per 250 cards, an API key for
//                  20,000/day. It answered about a third of the time while
//                  this was being written and then 500'd on every request for
//                  an hour, paced at 3s. Its CDN stayed up throughout, so the
//                  pictures are fine — it's the metadata that can't be relied
//                  on, which rules it out of a request path either way.
//   tcgdex.net     218 English sets and 177 Japanese, no key, and a set
//                  endpoint that returns every card WITH its image in a single
//                  call — 218 calls for the whole English catalogue.
//
// Image URLs come without an extension by their convention: append /low.webp
// for a thumbnail (~35KB) or /high.png for the full card (~380KB).
const API = "https://api.tcgdex.net/v2/en";
const KEY = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Paced anyway. TCGdex publishes no limit and asks for politeness; a backfill
 * of the whole English catalogue is a couple of hundred calls, so there is no
 * reason to arrive all at once.
 *
 * (The first version of this probe ran against pokemontcg.io with no pacing at
 * all, took 132 failures in 199 calls, and reported that as "their API is
 * unreliable". Their documented keyless limit is 30 a minute and going over it
 * returns a bare 500 rather than a 429, so most of that was self-inflicted.)
 */
const GAP_MS = 250;
let last = 0, calls = 0, retries = 0;

async function api(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const since = Date.now() - last;
    if (since < GAP_MS) await sleep(GAP_MS - since);
    last = Date.now();
    calls++;
    try {
      const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(25000) });
      if (res.ok) return await res.json();
      retries++;
    } catch { retries++; }
    await sleep(1500 * (attempt + 1));
  }
  // null means "we don't know", NOT "empty". The first version returned an
  // empty page here and broke out of pagination, so a failed call looked
  // exactly like the end of a set and 32 cards were reported missing that
  // are not missing at all.
  return null;
}

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
const theirSets = await api("/sets");
if (!theirSets) { console.error("Couldn't reach tcgdex at all."); process.exit(1); }
const setIndex = new Map();
for (const s of theirSets) setIndex.set(norm(s.name), s);
console.log(`tcgdex knows ${theirSets.length} English sets\n`);

// --- match set by set -------------------------------------------------------
const rows = [];
const unmatchedSets = [];
const incompleteSets = [];
for (const [setName, cards] of bySet) {
  const theirs = setIndex.get(norm(setName));
  if (!theirs) {
    unmatchedSets.push({ setName, cards: cards.length });
    for (const c of cards) rows.push({ ...c, outcome: "no-set" });
    continue;
  }

  const family = setFamily(setName, theirSets);
  const cardsBySetId = new Map();
  let complete = true;
  for (const part of family) {
    const full = await api(`/sets/${encodeURIComponent(part.id)}`);
    if (!full) { complete = false; break; }
    cardsBySetId.set(part.id, full.cards || []);
  }
  if (!complete) {
    incompleteSets.push({ setName, id: theirs.id, cards: cards.length });
    for (const c of cards) rows.push({ ...c, outcome: "unknown", theirSet: theirs.id });
    console.log(`  ???/${String(cards.length).padEnd(3)} ${setName}  →  ${theirs.id}  (couldn't read their set)`);
    continue;
  }
  const byNumber = indexByNumber(family, cardsBySetId);

  let ok = 0;
  for (const c of cards) {
    const m = matchCard(c, byNumber);
    if (m.outcome === "matched") ok++;
    rows.push({ ...c, theirSet: theirs.id, ...m, image: m.small || null, imageLarge: m.large || null });
  }
  console.log(`  ${String(ok).padStart(3)}/${String(cards.length).padEnd(3)} ${setName}  →  ${family.map((f) => f.id).join(" + ")}`);
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
console.log(`\napi calls ${calls}, retried after a failure ${retries}`);

const show = (title, list, fmt) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const r of list.slice(0, 20)) console.log(`  ${fmt(r)}`);
};
show("English sets with no counterpart", unmatchedSets.sort((a, b) => b.cards - a.cards),
  (s) => `${String(s.cards).padStart(3)} cards  ${s.setName}`);
show("sets their API wouldn't return", incompleteSets, (s) => `${s.setName} (${s.id})`);
show("name clashes", rows.filter((r) => r.outcome === "name-clash"),
  (r) => `${r.set} ${r.number}: ours "${r.name}" vs theirs "${r.theirName}"`);
show("numbers missing from a matched set", rows.filter((r) => r.outcome === "no-number"),
  (r) => `${r.set} (${r.theirSet}) #${r.number} ${r.name}`);

if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2)); console.log(`\nwrote ${JSON_OUT}`); }
