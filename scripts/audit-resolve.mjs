/**
 * Resolution audit: typed text -> the right catalogue card.
 *
 *   node scripts/audit-resolve.mjs [--json out.json] [--limit N]
 *
 * The pipeline is type -> resolve -> search -> price, and until now only the
 * last two stages had ever been measured. Resolution sits upstream of both: if
 * it picks the wrong card, a perfectly computed price is a wrong answer, and
 * the visitor has no way to tell. A ten-query spot check found "moonbreon"
 * returning nothing at all and "umbreon 161" landing a confidence gap of 38
 * against a threshold of 40 — two points from auto-pricing rather than asking.
 *
 * This costs NOTHING at SoldComps. /api/resolve reads Supabase only, so the
 * whole set can be re-run as often as we like.
 *
 * THE METRIC THAT MATTERS is wrongConfident: we skipped the picker AND named
 * the wrong card. A wrong price behind a picker is recoverable — the visitor
 * sees the set and the number and can pick again. A wrong price behind
 * confident:true is silent, and silent is the failure mode this whole tool
 * cannot afford. Everything else here is secondary.
 *
 * Ground truth is the catalogue's own cardmarket_id, taken from the same
 * bigset the pricing audit uses, so a "failure" is the resolver's rather than
 * my recollection of a collector number.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const SET = argOf("--set", join(HERE, "bigset-en2.json"));
const LIMIT = Number(argOf("--limit", "9999"));
const JSON_OUT = argOf("--json", null);
const GAP_MS = 120;   // Supabase, not SoldComps — but still our own database

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

/**
 * The shapes people actually type. Deliberately no random edits: the typo is a
 * fixed transformation so two runs are comparable.
 */
function shapesFor(card) {
  const name = card.name;
  const num = String(card.number || "").replace(/^0+(?=\d)/, "");
  const out = [
    { shape: "name+number", q: `${name} ${num}` },
    { shape: "name+number+set", q: `${name} ${num} ${card.set}` },
    { shape: "name only", q: name },
    // No number, set name instead — what you type when you can read the set
    // but the number is too small to make out across a table.
    { shape: "name+set", q: `${name} ${card.set}` },
    { shape: "lowercase", q: `${name} ${num}`.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() }
  ];
  // Drop one letter from the middle of the first word — the commonest real
  // typo shape, and one a trigram index should still survive.
  const first = name.split(" ")[0];
  if (first.length >= 6) {
    const typo = first.slice(0, 3) + first.slice(4);
    out.push({ shape: "typo", q: `${name.replace(first, typo)} ${num}` });
  }
  return out;
}

const ALL = JSON.parse(readFileSync(SET, "utf8"));
const CARDS = ALL.slice(0, LIMIT);
const rows = [];
let done = 0;

console.log(`Resolving ${CARDS.length} cards in ${shapesFor(CARDS[0]).length} query shapes against ${BASE}\n`);

for (const card of CARDS) {
  for (const { shape, q } of shapesFor(card)) {
    let res;
    try {
      res = await fetch(`${BASE}/api/resolve?q=${encodeURIComponent(q)}`).then((r) => r.json());
    } catch (err) {
      rows.push({ card, shape, q, error: err.message });
      continue;
    }
    const cands = res.candidates || [];
    const rank = cands.findIndex((c) => c.id === card.id);
    const top = cands[0] || null;

    // Is this query genuinely ambiguous? Two catalogue cards sharing a name
    // AND a number in different sets cannot be told apart from the text typed,
    // so the picker is the CORRECT answer and confidence would be the fault.
    //
    // Same LANGUAGE only. The first version counted any shared name+number and
    // immediately "found" a collision on "Leafeon ex 6" between the English
    // 006 and the Chinese 006 — but the language penalty separates those by 75
    // points and the resolver picks the English one correctly. Counting them
    // was the metric being wrong, not the product.
    const key = (c) => `${norm(c.name)}|${String(c.number || "").replace(/^0+(?=\d)/, "")}|${c.language}`;
    const collisions = top ? cands.filter((c) => key(c) === key(top)).length : 0;

    rows.push({
      card, shape, q,
      confident: !!res.confident,
      n: cands.length,
      rank,                                  // -1 when the right card never appeared
      topId: top ? top.id : null,
      topName: top ? top.name : null,
      topSet: top ? top.set : null,
      topLang: top ? top.language : null,
      gap: cands.length > 1 ? cands[0].score - cands[1].score : null,
      topScore: top ? top.score : null,
      collisions,
      // Kept so a metric can be recomputed offline without another pass — the
      // collision definition above was wrong first time round and re-running
      // 2,700 queries to find that out is a waste.
      candidates: cands.map((c) => ({ id: c.id, score: c.score, name: c.name, number: c.number, set: c.set, language: c.language }))
    });
    done++;
    if (done % 50 === 0) process.stdout.write(`\r  ${done} queries · ${rows.filter((r) => r.rank === 0).length} exact   `);
    await sleep(GAP_MS);
  }
}
console.log(`\n`);
report(rows);
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1)); console.log(`\nWrote ${JSON_OUT}`); }

function report(rs) {
  const errs = rs.filter((r) => r.error);
  console.log("=".repeat(80));
  console.log(`${rs.length} queries across ${CARDS.length} cards`);
  if (errs.length) console.log(`!!  ${errs.length} queries errored — this run is incomplete`);
  console.log("=".repeat(80));

  const shapes = [...new Set(rs.map((r) => r.shape))];
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${pad("shape", 17)} ${pad("n", 5)} ${pad("top1", 7)} ${pad("top3", 7)} ${pad("missed", 7)} ${pad("confident", 10)} WRONG+CONFIDENT`);
  for (const shape of shapes) {
    const g = rs.filter((r) => r.shape === shape && !r.error);
    const pct = (x) => `${Math.round((x / g.length) * 100)}%`;
    const top1 = g.filter((r) => r.rank === 0).length;
    const top3 = g.filter((r) => r.rank >= 0 && r.rank < 3).length;
    const missed = g.filter((r) => r.rank === -1).length;
    const conf = g.filter((r) => r.confident).length;
    const wrong = g.filter((r) => r.confident && r.topId !== r.card.id).length;
    console.log(`${pad(shape, 17)} ${pad(g.length, 5)} ${pad(pct(top1), 7)} ${pad(pct(top3), 7)} ${pad(pct(missed), 7)} ${pad(pct(conf), 10)} ${wrong} (${pct(wrong)})`);
  }

  // The headline. Name-only queries are excluded: many cards share a name, so
  // "wrong" there means the visitor was not asked, not that we misread them.
  const identifying = rs.filter((r) => !r.error && r.shape !== "name only");
  const wrongConf = identifying.filter((r) => r.confident && r.topId !== r.card.id);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`WRONG AND CONFIDENT (identifying queries): ${wrongConf.length} of ${identifying.length}`);
  console.log("=".repeat(80));
  for (const r of wrongConf.slice(0, 25)) {
    console.log(`  typed  "${r.q}"`);
    console.log(`   got   ${r.topName} · ${r.topSet} · ${r.topLang}   (gap ${r.gap}, wanted rank ${r.rank})`);
    console.log(`  meant  ${r.card.name} · ${r.card.set}`);
  }
  if (wrongConf.length > 25) console.log(`  … ${wrongConf.length - 25} more`);

  // Confident on a query that cannot be disambiguated from the text.
  const ambigConf = identifying.filter((r) => r.confident && r.collisions > 1);
  console.log(`\nConfident despite a real name+number collision: ${ambigConf.length}`);
  for (const r of ambigConf.slice(0, 8)) console.log(`  "${r.q}" -> ${r.topName} · ${r.topSet} (${r.collisions} share it)`);

  // The opposite cost: asked when there was nothing to ask about.
  const friction = identifying.filter((r) => !r.confident && r.rank === 0 && r.collisions === 1);
  console.log(`\nPicker shown though the top hit was right and unique: ${friction.length} of ${identifying.length}`);
  const gaps = friction.map((r) => r.gap).filter((g) => g != null).sort((a, b) => a - b);
  if (gaps.length) {
    const q = (p) => gaps[Math.floor(gaps.length * p)];
    console.log(`  their score gaps: min ${gaps[0]}, p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, max ${gaps[gaps.length - 1]}`);
    console.log(`  (the confidence threshold is 40 — see rankCards)`);
  }

  const missed = identifying.filter((r) => r.rank === -1);
  console.log(`\nRight card never appeared at all: ${missed.length}`);
  for (const r of missed.slice(0, 12)) console.log(`  "${r.q}"  -> ${r.n} candidates, top was ${r.topName || "(none)"} · ${r.topSet || "-"}`);
  if (missed.length > 12) console.log(`  … ${missed.length - 12} more`);
}
