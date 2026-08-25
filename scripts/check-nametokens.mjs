/**
 * Table check for the two rules added 2026-08-25 — the numbering prefix and
 * the set guard's ratio ceiling. See docs/APP_BATCH_RECURSION.md.
 *
 *   node scripts/check-nametokens.mjs      (or: npm run check)
 *
 * Every listing title below is real: read off the app's own batch results
 * panel for the Neo-era Japanese run that prompted this. The false-positive
 * cases at the bottom matter more than the true ones, same as
 * check-exclusions.mjs — each is something a draft of these rules got wrong,
 * kept so a later widening fails loudly instead of quietly pooling two cards.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

const { DEFAULT_SETTINGS, extractNameTokens, recommend } = CompFinderPricing;
const SHIPPED = { ...DEFAULT_SETTINGS, dropNumberingPrefixTokens: false, setMismatchPreferConfirmed: false };

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
  return ok;
};

// ── 1. The prefix is not part of the name ───────────────────────────────────
// A Japanese Neo card is numbered "No. 178" with no denominator, so the prefix
// reaches the token list. \bNo\.\b then demands a word character after the
// stop, which "No. 178" does not have and "No.178" does — so a comp survived
// on the seller's spacing alone.
const TOKENS = [
  ["Xatu No. 178", ["Xatu", "178"]],
  ["Snubbull No. 209", ["Snubbull", "209"]],
  ["Charizard #44", ["Charizard", "44"]],
  // Pre-existing and pinned here because both surprised a draft of this file:
  // a SLASHED number is stripped by extractNameTokens itself, so it is never a
  // token (the public page appends bareNumber separately, and the app passes
  // cardNumber to recommend for the lot check) — which is why an English card
  // never had a prefix problem. And a single character never survives the
  // length filter, so "#4" leaves the name alone either way.
  ["Umbreon VMAX 215/203", ["Umbreon", "VMAX"]],
  ["Charizard #4", ["Charizard"]],
  // FALSE POSITIVES. "NR" is the Neo Revelation SET CODE, measured across 2,132
  // catalogue cards by probe-tokenchange.mjs ("Shining Magikarp NR 66"), not a
  // numbering prefix — dropping a set code is a different and looser change.
  // "Nova" and "Number" must survive being anchored against.
  ["Shining Magikarp NR 66", ["Shining", "Magikarp", "NR", "66"]],
  ["Nova 12", ["Nova", "12"]],
  ["Number 39 Utopia", ["Number", "39", "Utopia"]]
];
for (const [query, want] of TOKENS) check(`tokens: ${query}`, extractNameTokens(query), want);

// The prefix reaching the tokens is what shipped, and is what the fixture in
// recurse-batch.mjs reproduces — so it has to stay reachable, or R0 stops
// being a reproduction of anything.
check("tokens under the shipped rules still carry the prefix",
  extractNameTokens("Xatu No. 178", SHIPPED), ["Xatu", "No.", "178"]);

// ── 2. A prefix in the LISTING must match a query without one ───────────────
// The whole point: every spelling a seller uses has to reach the same price.
const comp = (title) => ({ title, itemPricePence: 200, postagePence: 100 });
const SPELLINGS = ["Xatu No.178 Neo Genesis Japanese", "Xatu No. 178 Neo Genesis Japanese",
                   "Xatu #178, Neo Genesis, Japanese", "Pokemon Xatu 178 Neo Genesis Japanese"];
const tok = extractNameTokens("Xatu No. 178");
check("every spelling of the number now matches",
  SPELLINGS.map((t) => recommend([comp(t)], DEFAULT_SETTINGS, tok, "sold").included.length),
  [1, 1, 1, 1]);
check("...and only one of them did before",
  SPELLINGS.map((t) => recommend([comp(t)], SHIPPED, extractNameTokens("Xatu No. 178", SHIPPED), "sold").included.length),
  [1, 0, 0, 0]);

// ── 3. A confirmed set excludes even when it WINS its own vote ──────────────
// The guard fired only when the set-matching comps were a minority, so a Neo
// Discovery print sitting inside a 4-of-5 Neo Genesis pool was priced. It still
// stands down below setMismatchMinKept: a pool of two is not a mandate to
// exclude, it is a reason to stop claiming a price.
const pool = (setNames) => setNames.map((s, i) => comp(`Snubbull No.209 Japanese ${s} card ${i}`));
const usedUnder = (settings, sets) =>
  recommend(pool(sets), settings, extractNameTokens("Snubbull No. 209"), "sold", null, "Neo Genesis").included.length;

const MAJORITY = ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Destiny"];
check("majority-confirmed set now excludes the odd one out", usedUnder(DEFAULT_SETTINGS, MAJORITY), 4);
check("...and used to price it", usedUnder(SHIPPED, MAJORITY), 5);

const MINORITY = ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny"];
check("minority-confirmed set still excludes, as it always did", usedUnder(DEFAULT_SETTINGS, MINORITY), 4);
check("...unchanged from the shipped behaviour", usedUnder(SHIPPED, MINORITY), 4);

// FALSE POSITIVE. Too few confirmed comps to price from, so the guard must
// stand down and leave the ⚠ note rather than cut the pool to one.
const THIN = ["Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny"];
check("a thin confirmed set stands down rather than pricing off one comp", usedUnder(DEFAULT_SETTINGS, THIN), 4);

// FALSE POSITIVE. Nothing to exclude — every comp names the set — so the guard
// must not fire and must not touch the pool.
check("an all-matching pool is left alone", usedUnder(DEFAULT_SETTINGS, ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis"]), 4);

// FALSE POSITIVE. No confirmed set at all (the app's paste path passes none) —
// the guard has nothing to judge against and must be a no-op.
check("no confirmed set is a no-op",
  recommend(pool(["Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny"]),
    DEFAULT_SETTINGS, extractNameTokens("Snubbull No. 209"), "sold", null, null).included.length, 5);

if (failures) { console.error(`\nname tokens: ${failures} case(s) failed.`); process.exit(1); }
console.log("name tokens: prefix cases + set-guard cases pass (set codes, Nova/Number, thin and all-matching pools held).");
