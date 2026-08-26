/**
 * Stage 0: how good is the card reader we already ship?
 *
 *   node scripts/audit-identify.mjs                       # score the corpus
 *   node scripts/audit-identify.mjs --model claude-sonnet-5
 *   node scripts/audit-identify.mjs --json out.json       # keep the run
 *   node scripts/audit-identify.mjs --stub photos/        # start a corpus
 *
 * WHY THIS EXISTS BEFORE ANY MODEL DOES. /api/identify has been reading cards
 * off the camera since it shipped and nobody has ever counted how often it is
 * right, so every argument about training something better starts from two
 * anecdotes. This puts a number on the thing that already works, in the same
 * shape the replacement would be scored in, so the next decision is made on
 * data — the house rule, and the one that has already reversed two "obvious"
 * pricing rules. See docs/CARD_IMAGE_RECOGNITION.md.
 *
 * It calls exactly what the app calls: lib/identify.js, the same prompt, the
 * same schema, the same model unless --model says otherwise. It does NOT go
 * through /api/identify, which wants a signed-in session — the route is auth
 * and transport, and there is nothing in it worth a cookie jar to test.
 *
 * Costs money, not SoldComps quota: it spends ANTHROPIC_API_KEY, a fraction of
 * a penny a photo at Haiku rates, and prints the bill at the end.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, basename, relative } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { identifyCard, IDENTIFY_MODEL } from "../apps/app/lib/identify.js";
import { runPool } from "../apps/app/lib/pace.js";
import { gradeRead, summarise, summaryLines, costOf } from "./lib/identify-grade.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CORPUS = resolve(argOf("--corpus", join(HERE, "fixtures/identify/corpus.json")));
const LIMIT = Number(argOf("--limit", "9999"));
const MODEL = argOf("--model", IDENTIFY_MODEL);
const CONCURRENCY = Math.max(1, Number(argOf("--concurrency", "4")));
const JSON_OUT = argOf("--json", null);
const STUB = argOf("--stub", null);

const MEDIA = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const isPhoto = (f) => extname(f).toLowerCase() in MEDIA;

/**
 * The browser sends a JPEG whose longest edge is 1024 (see Scan.js). A corpus
 * of 4000px originals would be measuring a model on an image the app will
 * never send it — flattering, and expensive, since the bill is per input
 * token. Only PNG and JPEG carry their size somewhere cheap to read; anything
 * else is left alone rather than guessed at.
 */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0-SOF15 carry the frame size; C4/C8/CC are Huffman/arithmetic
      // tables that share the range and do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// --- --stub: turn a folder of photos into a manifest to fill in -------------
//
// Labelling is the real cost of this corpus and there is no way around doing
// it by hand — the whole point is that the labels are not the model's opinion.
// This just saves the typing, and refuses to overwrite work already done.
if (STUB) {
  const dir = resolve(STUB);
  const files = readdirSync(dir).filter(isPhoto).sort();
  if (!files.length) { console.error(`No photos in ${dir}`); process.exit(1); }
  let existing = [];
  try { existing = JSON.parse(readFileSync(CORPUS, "utf8")); } catch { /* first run */ }
  const known = new Set(existing.map((r) => r.file));
  const rel = (f) => relative(dirname(CORPUS), join(dir, f)).split("\\").join("/");
  const added = files.filter((f) => !known.has(rel(f))).map((f) => ({
    file: rel(f), name: "", number: "", set: "", note: "TODO — read the card and fill these in"
  }));
  writeFileSync(CORPUS, JSON.stringify([...existing, ...added], null, 2) + "\n");
  console.log(`${CORPUS}: ${added.length} new photo(s) added, ${existing.length} kept.`);
  console.log("Fill in name / number / set from the CARD, not from what the tool says.");
  process.exit(0);
}

// --- the corpus -------------------------------------------------------------
let corpus;
try {
  corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
} catch (e) {
  console.error(`Couldn't read the corpus at ${CORPUS}: ${e.message}`);
  console.error("Start one with:  node scripts/audit-identify.mjs --stub <folder-of-photos>");
  console.error("See scripts/fixtures/identify/README.md.");
  process.exit(1);
}
// A decoy row (expect: "abstain") is a photo with no card in it and has
// nothing to label — see gradeRead().
const unlabelled = corpus.filter((r) => r.expect !== "abstain" && (!r.name || !r.number));
if (unlabelled.length) {
  console.error(`${unlabelled.length} row(s) have no name or number yet — label them or drop them:`);
  for (const r of unlabelled.slice(0, 5)) console.error(`   ${r.file}`);
  process.exit(1);
}
const rows = corpus.slice(0, LIMIT);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY isn't set — this run spends it, so there is nothing to do without one.");
  process.exit(1);
}

const client = new Anthropic();
const results = new Array(rows.length).fill(null);
const costs = new Array(rows.length).fill(null);
let fatal = null;

console.log(`Reading ${rows.length} photo(s) with ${MODEL}, ${CONCURRENCY} at a time.\n`);

const MARK = { right: "✓", "name-only": "~", abstained: "·", wrong: "✗", error: "!" };

await runPool(rows.length, CONCURRENCY, async (i) => {
  const truth = rows[i];
  const path = resolve(dirname(CORPUS), truth.file);
  let buf;
  try { buf = readFileSync(path); } catch (e) {
    results[i] = { ...gradeRead(null, truth), notes: `couldn't read ${truth.file}: ${e.message}` };
    console.log(`  ! ${basename(truth.file)}  no such photo (paths are relative to the corpus file)`);
    return;
  }
  const size = imageSize(buf);
  const warn = size && Math.max(size.w, size.h) > 1400
    ? `  ⚠ ${size.w}x${size.h} — the app sends 1024 max, so this measures a photo it will never send`
    : "";

  const outcome = await identifyCard(client, {
    image: buf.toString("base64"),
    mediaType: MEDIA[extname(path).toLowerCase()] || "image/jpeg",
    model: MODEL
  });
  if (!outcome.ok) {
    // An expired or unfunded key fails every row identically; stopping on it
    // beats printing 150 identical errors and a 0% score that looks like a
    // measurement.
    if (outcome.status === 401 || outcome.status === 403) fatal = outcome.error;
    results[i] = { ...gradeRead(null, truth), notes: outcome.error };
    console.log(`  ! ${basename(truth.file)}  ${outcome.error}`);
    return;
  }
  costs[i] = costOf(outcome.usage, outcome.model);
  const row = gradeRead(outcome.result, truth);
  row.read = outcome.result;
  row.usage = outcome.usage;
  results[i] = row;
  console.log(`  ${MARK[row.outcome]} ${basename(truth.file).padEnd(26)} want ${row.want.padEnd(38)} got ${row.got}${warn}`);
}, () => fatal != null);

if (fatal) {
  console.error(`\nStopped: ${fatal}`);
  process.exit(1);
}

const scored = results.filter(Boolean);
const summary = summarise(scored, { costs: costs.filter((c) => c != null) });
console.log(`\n${MODEL}\n`);
for (const line of summaryLines(summary)) console.log(line);

// The ones worth looking at by hand. A wrong read is the only outcome that
// costs somebody money, so it is the only one printed twice.
const wrong = scored.filter((r) => r.outcome === "wrong");
if (wrong.length) {
  console.log("\nWrong reads — every one of these prices a different card:");
  for (const r of wrong) {
    console.log(`  ${r.file}\n     want ${r.want}\n     got  ${r.got}${r.notes ? `\n     note ${r.notes}` : ""}`);
  }
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ model: MODEL, corpus: CORPUS, at: new Date().toISOString(), summary, rows: scored }, null, 2) + "\n");
  console.log(`\nWrote ${JSON_OUT}`);
}
if (summary.error === scored.length && scored.length) process.exit(1);
