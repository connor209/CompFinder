/**
 * Measures a candidate exclusion rule across every comp the audit has seen,
 * before the rule goes anywhere near packages/core.
 *
 *   node scripts/probe-rules.mjs [--set scripts/bigset-en2.json]
 *
 * Sold comps cache for 24 hours, so running this straight after an audit is
 * free and touches nothing at SoldComps. Anything it reports as a LIVE FETCH
 * is a cache miss and is counted separately, since a partial corpus would
 * quietly understate every rate below.
 *
 * The point is the denominator. "custom-art" looks obviously safe until you
 * find it in the title of a genuine card; the only way to know is to run it
 * over a few thousand real titles and read what it would have removed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const SET = argOf("--set", join(HERE, "bigset-en2.json"));
const gbp = (p) => CompFinderPricing.toPoundsStr(p);

// Same tier sampling as audit-big.mjs, so the corpus matches what was priced
// and every comp below is one already in the cache.
const ALL = JSON.parse(readFileSync(SET, "utf8"));
const TIER = (r) => /special illustration|secret|hyper|amazing|shiny/i.test(r) ? 0
  : /illustration rare|art rare/i.test(r) ? 1
  : /ultra rare|rare ultra/i.test(r) ? 2 : 3;
const CARDS = [];
for (const tier of [0, 1, 2, 3]) {
  const g = ALL.filter((c) => TIER(c.rarity) === tier);
  CARDS.push(...(tier <= 1 ? g : g.filter((_, i) => i % (tier === 2 ? 2 : 3) === 0)));
}

const pacer = createPacer({ onWait: () => {} });
const corpus = [];   // { card, title, itemPence, postPence, location, epid }
let misses = 0;

for (const [i, c] of CARDS.entries()) {
  process.stdout.write(`\r  ${i + 1}/${CARDS.length} · ${corpus.length} comps · ${misses} cache misses   `);
  const q = `${c.name} ${c.number} ${c.set}`;
  let res;
  try {
    res = await pacer.call(async () => {
      const r = await fetch(`${BASE}/api/price`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, sold: true, soldAfterDays: 90 })
      });
      return { status: r.status, body: await r.json().catch(() => ({ ok: false })) };
    });
  } catch { continue; }
  // pacer.call resolves to { status, body }: returning the bare body here meant
  // the pacer never saw a status and could not retry a 502.
  const body = res && res.body;
  if (!body || !body.ok) continue;
  if (!body.cached) misses++;
  for (const comp of body.comps || []) {
    corpus.push({
      card: c, q, title: comp.title || "",
      itemPence: comp.itemPricePence || 0,
      postPence: comp.postagePence || 0,
      location: comp.itemLocation || ""
    });
  }
}
console.log(`\n\n${corpus.length} comps across ${CARDS.length} cards (${misses} cache misses)\n`);
// Written so a candidate regex can be re-tested against the same titles
// offline, without another pass over the API.
if (process.env.CORPUS_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.CORPUS_OUT, JSON.stringify(corpus.map((c) => ({
    q: c.q, title: c.title, itemPence: c.itemPence, postPence: c.postPence, location: c.location
  }))));
  console.log(`corpus written to ${process.env.CORPUS_OUT}\n`);
}

/** Prints how many titles a pattern hits, with a sample, so it can be judged. */
function probe(label, re, { sample = 6 } = {}) {
  const hits = corpus.filter((c) => re.test(c.title));
  const pct = ((hits.length / corpus.length) * 100).toFixed(2);
  console.log(`${String(hits.length).padStart(5)}  (${pct.padStart(5)}%)  ${label}`);
  for (const h of hits.slice(0, sample)) {
    console.log(`         ${gbp(h.itemPence).padStart(9)}  ${h.title.slice(0, 82)}`);
  }
  if (hits.length > sample) console.log(`         … ${hits.length - sample} more`);
  return hits;
}

console.log("=".repeat(100));
console.log("CANDIDATE notACard TERMS — seen in the low tail of a wide span");
console.log("=".repeat(100));
for (const [label, re] of [
  ["custom art / custom-art", /custom[\s-]?art/i],
  ["handmade", /\bhand[\s-]?made\b/i],
  ["fan art", /\bfan[\s-]?art\b/i],
  ["DIY / D-I-Y", /\bd[\s.-]?i[\s.-]?y\b/i],
  ["inspired art / inspired by", /\binspired\b/i],
  ["metal card / gold metal", /\b(gold|silver|metal)\s+metal\b|\bmetal\s+card\b/i],
  ["gold plated / 24k", /\b(gold[\s-]?plated|24k|24\s?carat)\b/i],
  ["read description", /\bread\s+(the\s+)?desc/i],
  ["not genuine / fake", /\b(not\s+genuine|fake)\b/i],
  ["sticker", /\bsticker\b/i],
  ["poster / print", /\b(poster|art print)\b/i]
]) probe(label, re);

console.log("\n" + "=".repeat(100));
console.log("FOREIGN-LANGUAGE PRINTS IN AN ENGLISH COMP SET");
console.log("=".repeat(100));
for (const [label, re] of [
  ["Russian", /\brussian\b/i],
  ["Italian / Italiano", /\b(italian|italiano)\b/i],
  ["French / Francais / Carte", /\b(french|fran[c\u00e7]ais|carte)\b/i],
  ["German / Deutsch", /\b(german|deutsch)\b/i],
  ["Spanish / Espanol", /\b(spanish|espa[n\u00f1]ol)\b/i],
  ["Portuguese", /\bportugu/i],
  ["Japanese", /\bjapanese\b|\bjapan\b/i],
  ["Korean", /\bkorean\b/i],
  ["Chinese", /\bchinese\b/i],
  ["Thai / Indonesian", /\b(thai|indonesian)\b/i]
]) probe(label, re, { sample: 4 });

console.log("\n" + "=".repeat(100));
console.log("TWO-CARD LOTS THE multiCardLot CHECK MISSES");
console.log("=".repeat(100));
// "Latias ex 93/97 & Latios ex 94/97 Holo Lot" survived every existing check:
// the name/number pair check needs the number to follow the name directly
// (the "ex" gets in the way) and the shared-denominator check needs the card
// number to carry its denominator, which the catalogue does not give us -
// bigset numbers are bare ("94"), so that check is dead on the public page.
// Requiring a full N/M on each side is what makes this safe: a set name like
// "Card 151" has no slash and cannot count towards the pair.
const LOT_PAIR = /\b[A-Z][a-zA-Z']+\s+(?:ex|EX|gx|GX|v|V|vmax|VMAX|vstar|VSTAR)?\s*(\d{1,4})\s*\/\s*\d{1,4}\b/g;
const lotHits = corpus.filter((c) => {
  const nums = new Set([...c.title.matchAll(LOT_PAIR)].map((m) => m[1]));
  return nums.size >= 2;
});
console.log(`${lotHits.length} of ${corpus.length} titles carry two or more distinct "Name <N>/<M>" groups`);
for (const h of lotHits.slice(0, 20)) console.log(`  ${gbp(h.itemPence).padStart(9)}  ${h.title.slice(0, 84)}`);
if (lotHits.length > 20) console.log(`  \u2026 ${lotHits.length - 20} more`);

console.log("\n" + "=".repeat(100));
console.log("CANDIDATE graded TERMS — graders the current list misses");
console.log("=".repeat(100));
const CURRENT_GRADED = /\b(psa|cgc|bgs|sgc|graded|slab|slabbed)\b|\b(psa|cgc|bgs|sgc|ace)\s*-?\s*\d{1,2}\b/i;
for (const [label, re] of [
  ["GRAAD", /\bgraad\b/i],
  ["MGC", /\bmgc\s*\d/i],
  ["TAG", /\btag\s*\d{1,2}\b/i],
  ["AGS", /\bags\s*\d/i],
  ["ACE Grading (word between)", /\bace\s+grading\b/i],
  ["GetGraded / GG", /\bget\s?graded\b/i],
  ["PG / Pristine", /\bpristine\s*\d/i],
  ["Rare Edition", /\brare\s+edition\s*\d/i],
  ["gem mint / gem mt", /\bgem\s*(mint|mt)\b/i],
  ["any 'grade N'", /\bgrade[ds]?\s*\d{1,2}\b/i]
]) {
  const hits = probe(label, re, { sample: 4 });
  const missed = hits.filter((h) => !CURRENT_GRADED.test(h.title));
  if (hits.length) console.log(`         -> ${missed.length} of ${hits.length} NOT already caught`);
}

console.log("\n" + "=".repeat(100));
console.log("POSTAGE THAT DWARFS THE CARD");
console.log("=".repeat(100));
const byCard = new Map();
for (const c of corpus) {
  if (!byCard.has(c.q)) byCard.set(c.q, []);
  byCard.get(c.q).push(c);
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
let cardsAffected = 0, compsFlagged = 0, cardsMostlyFlagged = 0;
const worst = [];
for (const [q, comps] of byCard) {
  if (comps.length < 6) continue;
  const medItem = med(comps.map((c) => c.itemPence));
  const threshold = Math.max(medItem * 2, 600);
  const flagged = comps.filter((c) => c.postPence > threshold && c.postPence > c.itemPence);
  if (!flagged.length) continue;
  cardsAffected++; compsFlagged += flagged.length;
  const share = flagged.length / comps.length;
  if (share > 0.5) cardsMostlyFlagged++;
  worst.push({ q, n: comps.length, flagged: flagged.length, share, medItem });
}
console.log(`postage > max(2x median item, £6) AND > the item's own price:`);
console.log(`  ${compsFlagged} comps on ${cardsAffected} of ${byCard.size} cards`);
console.log(`  ${cardsMostlyFlagged} cards would lose MORE THAN HALF their comps to it`);
for (const w of worst.sort((a, b) => b.share - a.share).slice(0, 15)) {
  console.log(`  ${(w.share * 100).toFixed(0).padStart(3)}%  ${String(w.flagged).padStart(2)}/${String(w.n).padStart(2)}  median item ${gbp(w.medItem).padStart(9)}  ${w.q.slice(0, 52)}`);
}
