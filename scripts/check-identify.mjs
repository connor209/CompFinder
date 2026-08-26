/**
 * How a photo read is scored, and where the reader is allowed to live.
 *
 *   node scripts/check-identify.mjs      (or: npm run check)
 *
 * No network, no key, no photos — this is the grader's own table, plus a grep
 * that keeps the prompt in one file. Same shape as check-images.mjs, and for
 * the same reason: the cases that matter are the FALSE POSITIVES, each one a
 * read a lenient grader would have called correct. A grader that flatters the
 * model ends the investigation with a number nobody should have believed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  numeratorOf, fullNumberOf, numbersAgree, namesAgree, nameIsNear, setsAgree, gradeRead, summarise
} from "./lib/identify-grade.mjs";
import { SYSTEM_PROMPT, CARD_SCHEMA, IDENTIFY_MODEL } from "../apps/app/lib/identify.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const ok = (label, cond) => { if (!cond) fail(label); };

// --- numbers ----------------------------------------------------------------
// The numerator is what the engine matches on; the denominator is a weaker
// hint about the set. Scored apart, so "215" for a card printed 215/203 counts
// as a complete read rather than a partial one.
eq("numeratorOf 215/203", numeratorOf("215/203"), "215");
eq("numeratorOf strips padding", numeratorOf("009/195"), "9");
eq("numeratorOf bare", numeratorOf("60"), "60");
eq("numeratorOf promo prefix", numeratorOf("SWSH001"), "swsh1");
eq("numeratorOf blank", numeratorOf(""), "");
eq("fullNumberOf pads both halves", fullNumberOf("009/195"), "9/195");
eq("fullNumberOf without a denominator", fullNumberOf("215"), null);

ok("215/203 reads 215", numbersAgree("215", "215/203").numerator);
ok("215 is not exact against 215/203", !numbersAgree("215", "215/203").exact);
ok("215/203 both halves is exact", numbersAgree("215/203", "215/203").exact);
// The case the whole scan exists to get right: two Charizard ex, same
// numerator, different print run. The denominator is the only thing that
// separates them, so a read that gets it wrong is not "nearly right".
ok("223/165 vs 223/197 is not exact", !numbersAgree("223/165", "223/197").exact);
ok("...though the numerator does match", numbersAgree("223/165", "223/197").numerator);
ok("a blank number agrees with nothing", !numbersAgree("", "215/203").numerator);
ok("1 and 10 stay apart", !numbersAgree("1", "10").numerator);

// --- names ------------------------------------------------------------------
// Forgiven: the catalogue's own spelling quirks, which nameKey() already
// settled for the image backfill and which are the same card either way.
const SAME = [
  ["Nidoran [M]", "Nidoran♂"],
  ["MAggron EX", "M Aggron EX"],
  ["Dialga Lv.68", "Dialga"],
  ["Pikachu δ Delta Species", "Pikachu δ"],
  ["charizard ex", "Charizard ex"],
  ["Mr. Mime", "Mr Mime"]
];
for (const [a, b] of SAME) ok(`same card: ${a} / ${b}`, namesAgree(a, b));

// NOT forgiven, and this is the half that matters. Every pair below is two
// cards at two prices, and a grader that waves any of them through reports an
// accuracy the scan does not have. Note the suffix cases especially: the
// catalogue's nameAgrees() accepts these in one direction, because there set
// and number have already identified the card. Here the suffix IS the
// identification.
const DIFFERENT = [
  ["Charizard", "Charizard ex"],
  ["Charizard ex", "Charizard"],
  ["Eevee", "Eevee V"],
  ["Umbreon V", "Umbreon VMAX"],
  ["Nidoran♂", "Nidoran♀"],
  ["Mew", "Mewtwo"],
  ["Rayquaza VMAX", "Rayquaza VSTAR"],
  ["Espeon", "Espeon Gold Star"]
];
for (const [a, b] of DIFFERENT) ok(`different cards: ${a} / ${b}`, !namesAgree(a, b));

// A typo is worth telling apart from a wrong Pokémon: the catalogue's fuzzy
// resolve recovers the first and cannot recover the second.
ok("Impostor/Imposter is a typo", nameIsNear("Imposter Professor Oak", "Impostor Professor Oak"));
ok("Blastoise is not a typo for Charizard", !nameIsNear("Blastoise", "Charizard"));
ok("a variant suffix is never a typo", !nameIsNear("Eevee", "Eevee V"));
ok("a correct name is not near-miss", !nameIsNear("Charizard", "Charizard"));

// --- sets -------------------------------------------------------------------
// Lenient on purpose: sellers rarely write the full set name and no price
// depends on it. It is counted because it is what would narrow an art search.
ok("partial set name", setsAgree("Evolving Skies", "Sword & Shield Evolving Skies"));
ok("punctuation and case", setsAgree("team rocket", "Team Rocket"));
ok("a blank set agrees with nothing", !setsAgree("", "Base Set"));
ok("different sets", !setsAgree("Base Set", "Jungle"));

// --- outcomes ---------------------------------------------------------------
const TRUTH = { file: "a.jpg", name: "Umbreon VMAX", number: "215/203", set: "Evolving Skies" };
const readOf = (o) => ({ identified: true, name: "", number: "", set: "", variant: "", suggested_query: "", notes: "", ...o });

eq("a clean read is right",
  gradeRead(readOf({ name: "Umbreon VMAX", number: "215/203", set: "Evolving Skies" }), TRUTH).outcome, "right");
eq("the numerator alone is enough",
  gradeRead(readOf({ name: "Umbreon VMAX", number: "215" }), TRUTH).outcome, "right");
eq("no number, right name, is name-only",
  gradeRead(readOf({ name: "Umbreon VMAX", number: "" }), TRUTH).outcome, "name-only");
eq("no number, wrong name, is wrong",
  gradeRead(readOf({ name: "Umbreon V", number: "" }), TRUTH).outcome, "wrong");
// The dangerous one. A right name with a wrong number is the most confident
// failure there is: the query is clean, the panel prices it, and the figure is
// for a different printing with nothing on screen to say so.
eq("right name, wrong number, is wrong",
  gradeRead(readOf({ name: "Umbreon VMAX", number: "95/203" }), TRUTH).outcome, "wrong");
eq("right number, wrong name, is wrong",
  gradeRead(readOf({ name: "Sylveon VMAX", number: "215/203" }), TRUTH).outcome, "wrong");
// Abstention beats a guess, and is scored as its own thing rather than as a
// miss — a model that abstains more and is wrong less is the better model for
// a price somebody pays cash against.
eq("identified=false abstains",
  gradeRead(readOf({ identified: false, notes: "blurry" }), TRUTH).outcome, "abstained");
eq("an abstention outranks whatever else it filled in",
  gradeRead(readOf({ identified: false, name: "Umbreon VMAX", number: "215/203" }), TRUTH).outcome, "abstained");
eq("a failed call is an error, not a wrong answer", gradeRead(null, TRUTH).outcome, "error");
// Decoys: a photo with no card in it. The panel prices whatever comes back, so
// a card invented from an empty frame is priced and shown like any other.
const DECOY = { file: "b.jpg", expect: "abstain" };
eq("a decoy refused is an abstention",
  gradeRead(readOf({ identified: false, notes: "no card in frame" }), DECOY).outcome, "abstained");
eq("a card invented from a decoy is wrong",
  gradeRead(readOf({ name: "Pikachu", number: "58/102" }), DECOY).outcome, "wrong");
ok("a decoy says what it wants", /no card/.test(gradeRead(readOf({ identified: false }), DECOY).want));
eq("the exact-number flag survives grading",
  gradeRead(readOf({ name: "Umbreon VMAX", number: "215/203" }), TRUTH).exactNumber, true);

// --- the summary ------------------------------------------------------------
// Hand-counted: 5 right, 2 name-only, 2 wrong, 3 abstained. The headline rate
// is wrong-over-priced (9 reads reached a price), NOT wrong-over-all — an
// abstention costs a re-scan, so counting it in the denominator would reward a
// model for refusing to answer.
const MIX = [
  ...Array(5).fill({ outcome: "right", name: true, numerator: true, exactNumber: true, set: true }),
  ...Array(2).fill({ outcome: "name-only", name: true, numerator: false, exactNumber: false, set: false }),
  ...Array(2).fill({ outcome: "wrong", name: false, numerator: false, exactNumber: false, set: false }),
  ...Array(3).fill({ outcome: "abstained", name: false, numerator: false, exactNumber: false, set: false })
];
const s = summarise(MIX, { costs: [0.0001, 0.0002] });
eq("summary counts photos", s.n, 12);
eq("summary counts right", s.right, 5);
eq("summary counts wrong", s.wrong, 2);
eq("summary counts abstentions", s.abstained, 3);
eq("wrong is over the reads that priced something", s.wrongWhenPriced.toFixed(4), (2 / 9).toFixed(4));
eq("name rate is over every photo", s.nameRate.toFixed(4), (7 / 12).toFixed(4));
eq("cost adds up", s.costUsd.toFixed(4), "0.0003");
eq("an all-abstain run divides by zero safely", summarise([{ outcome: "abstained" }]).wrongWhenPriced, 0);

// --- one definition ---------------------------------------------------------
// The prompt used to live in the route, which imports Next and Supabase and so
// cannot be loaded by a script. Anything that wants to MEASURE the reader has
// to have its own copy of the prompt — and two prompts drift the moment one is
// tuned, invisibly, because both still return well-formed JSON.
const route = read("apps/app/app/api/identify/route.js");
ok("the route imports the shared reader", /from ["']@\/lib\/identify["']/.test(route));
ok("the route defines no prompt of its own", !/You identify Pok/.test(route));
ok("the route defines no schema of its own", !/suggested_query\s*:/.test(route));
ok("the route hardcodes no model id", !/claude-[a-z0-9-]+/.test(route));
ok("the route calls identifyCard", /identifyCard\(/.test(route));

// The reader has to load under bare node or the harness can't import it —
// the same rule packages/core lives by, for the same reason.
const lib = read("apps/app/lib/identify.js");
ok("the reader imports nothing", !/^\s*import\s/m.test(lib));
ok("the reader requires nothing either", !/\brequire\(/.test(lib));
ok("the prompt says never to guess a number", /never guess it/.test(SYSTEM_PROMPT));
ok("the model is a real id", /^claude-[a-z0-9-]+$/.test(IDENTIFY_MODEL));
ok("the schema requires every field it defines",
  Object.keys(CARD_SCHEMA.properties).every((k) => CARD_SCHEMA.required.includes(k)));

// The corpus measures what the panel actually calls.
ok("Scan.js still posts to /api/identify", /\/api\/identify/.test(read("apps/app/app/panel/Scan.js")));

// --- the corpus shape -------------------------------------------------------
// The example is the documentation, so it is checked against the loader's own
// requirements rather than left to rot beside them.
const example = JSON.parse(read("scripts/fixtures/identify/corpus.example.json"));
ok("the example corpus has rows", Array.isArray(example) && example.length > 0);
for (const row of example) {
  ok(`example row ${row.file || "(no file)"} has a file`, !!row.file);
  ok(`example row ${row.file} is labelled or is a decoy`,
    row.expect === "abstain" ? !row.name && !row.number : !!row.name && !!row.number);
}
ok("the example carries at least one decoy", example.some((r) => r.expect === "abstain"));
eq("no duplicate files in the example", new Set(example.map((r) => r.file)).size, example.length);
const audit = read("scripts/audit-identify.mjs");
ok("the runner rejects unlabelled rows", /!r\.name \|\| !r\.number/.test(audit));
ok("...but not decoys", /expect !== "abstain"/.test(audit));

if (failures) {
  console.error(`\nidentify: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`identify: ${SAME.length + DIFFERENT.length} name, ${MIX.length}-photo summary, outcome, number, set and one-definition cases hold.`);
