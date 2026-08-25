/**
 * Measures the name-token filter against real listing titles, and tests
 * candidate repairs offline before any of them touches packages/core.
 *
 *   node scripts/probe-nametokens.mjs
 *
 * Writes nothing and changes nothing — same posture as probe-rules.mjs.
 *
 * WHY. The 2026-08-25 Neo-era Japanese batch excluded 47-85 comps per card as
 * "nameMismatch" and priced most cards off one or two survivors. The titles
 * below are the rows the app's own results panel showed for three of those
 * cards, verbatim. Run through classifyExclusion() they reproduce that split
 * exactly, and the thing separating a kept comp from a thrown-away one turns
 * out to be whether the seller typed "No.178" or "No. 178".
 *
 * `want` is a judgement about the CARD, not a prediction of the code: given a
 * query for Xatu No. 178 from Neo Genesis, should this listing count toward
 * the price? It is recorded here so a candidate fix is scored against the
 * cards rather than against the current behaviour.
 *
 * The false-positive rows matter more than the true ones, exactly as in
 * check-exclusions.mjs. Two of them — a Walkers Tazo and a Neo Destiny print —
 * are currently excluded BY ACCIDENT, by the same bug that is throwing away
 * the good comps. Any repair that admits them without something else standing
 * behind it makes the price worse, not better.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import { appNameTokens } from "../apps/app/lib/matching.js";

const { extractNameTokens, classifyExclusion, DEFAULT_SETTINGS } = CompFinderPricing;

// want: "keep" — a genuine sold comp for the card that was searched for.
//       "drop"  — a different card, a different print, or not a card at all.
// why:  the reason it should be dropped, so a fix that drops it for the WRONG
//       reason (and therefore mis-reports the exclusion counts) is visible.
const CASES = [
  { q: "Xatu No. 178", set: "Neo Genesis", rows: [
    { want: "keep", t: "Pokémon TCG Xatu Neo Genesis No.178 Japanese Card LP" },
    { want: "drop", why: "Neo Discovery, not Neo Genesis", t: "Xatu No.178 Non Holo Pokemon Card Japanese Played Neo Discovery Old Back NM" },
    { want: "keep", t: "Xatu #178, Neo Genesis, Pokemon, Japanese, MP" },
    { want: "drop", why: "US seller", loc: "United States", t: "HP/DMG Pokemon TCG Xatu No. 178 Neo Genesis Japanese US Seller" },
    { want: "keep", t: "Xatu No. 178 Japanese Neo Genesis Pokemon Card" }
  ]},
  { q: "Gligar No. 207", set: "Neo Genesis", rows: [
    { want: "keep", t: "Pokemon Gligar Japanese Neo Genesis No.207 NM" },
    { want: "keep", t: "Gligar No.207 | Neo Genesis | Japanese Pokemon Card | LP - NM 3" },
    { want: "drop", why: "a Walkers Tazo, not a card", t: "2001 POKEMON TAZO'S - Vintage- Walkers Tazos/Pogs - Gligar no 24 #207" },
    { want: "drop", why: "Neo Destiny, not Neo Genesis", loc: "United States", t: "Gligar No. 207 Japanese Neo Destiny Pokémon Card" }
  ]},
  { q: "Snubbull No. 209", set: "Neo Genesis", rows: [
    { want: "drop", why: "Neo Destiny, not Neo Genesis", t: "Snubbull No.209 Non Holo Pokemon Card Japanese Played Neo Destiny Old Back" },
    { want: "drop", why: "Neo Revelation, not Neo Genesis", t: "Snubbull Japanese Pokémon Common Card Neo Revelations No.209" },
    { want: "drop", why: "Neo Revelation, not Neo Genesis", t: "Pokemon TCG - Snubbull No.209 - Japanese - Neo Revelation - NM" },
    { want: "keep", t: "SNUBBULL NO. 209 C NEO GENESIS JAPANESE LP - UK SELLER" }
  ]}
];

// ── Candidate token treatments ──────────────────────────────────────────────
// Each takes the simplified query and returns the tokens to match on. Only the
// PREFIX handling differs; nothing here loosens the card name or the number.
const CANDIDATES = {
  "current (shipped)": (q) => extractNameTokens(q),

  // What shipped: apps/app/lib/matching.js. A numbering prefix is punctuation
  // with a word in it, not part of the card's name. The number itself is still
  // a required token and already tolerates leading zeros, so dropping the
  // prefix loses no identifying signal.
  "drop the numbering prefix (shipped)": appNameTokens,

  // Considered and rejected: strictly weaker than dropping the prefix, since a
  // title reading "Xatu 178" with no prefix at all is still thrown away.
  "match every spelling of the prefix (rejected)": (q) =>
    extractNameTokens(q).map((t) => (/^(no\.?|nr\.?|#)$/i.test(t) ? "__PREFIX__" : t))
};

// __PREFIX__ needs its own matcher, so this mirrors what nameTokensMatch does
// rather than calling classifyExclusion for that one candidate.
const PREFIX_RE = /(\bno\.?\s*|\bnr\.?\s*|#\s*)(?=\d)/i;
function classify(title, tokens, set) {
  if (tokens.includes("__PREFIX__")) {
    if (!PREFIX_RE.test(title)) return "nameMismatch";
    tokens = tokens.filter((t) => t !== "__PREFIX__");
  }
  return classifyExclusion(title, DEFAULT_SETTINGS.excludeKeywords, tokens, null);
}

const setPresent = (title, set) => new RegExp(`\\b${set.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title);

console.log(`Name-token filter vs ${CASES.reduce((n, c) => n + c.rows.length, 0)} real listing titles from the 2026-08-25 batch\n`);

const score = {};
for (const [label, tokenize] of Object.entries(CANDIDATES)) {
  console.log(`\n${label}`);
  console.log("─".repeat(label.length));
  let keptRight = 0, keptWrong = 0, droppedRight = 0, droppedWrong = 0, wrongReason = 0;
  for (const group of CASES) {
    const tokens = tokenize(group.q);
    console.log(`  ${group.q}  → tokens ${JSON.stringify(tokens)}`);
    for (const row of group.rows) {
      // splitByNonUkLocation runs before any of this on a real comp and needs
      // no title at all, so a row eBay itself places outside the UK is already
      // settled. Scoring it against the token filter would credit or blame the
      // wrong rule.
      const reason = classify(row.t, tokens, group.set) || (row.loc ? "nonUkLocation" : null);
      const got = reason ? "drop" : "keep";
      const ok = got === row.want;
      // A comp dropped for the right verdict but the wrong reason still
      // mis-reports the counts on screen and, where the real reason is the
      // set, hides that the whole pool is a different print.
      const reasonOff = ok && row.want === "drop" && reason === "nameMismatch" && row.why && !/name/i.test(row.why);
      if (row.loc && reason === "nonUkLocation") {
        droppedRight++;
        console.log(`    · want drop  got drop nonUkLocation  (settled by eBay's location field, before titles) ${row.t.slice(0, 40)}`);
        continue;
      }
      if (ok && got === "keep") keptRight++;
      else if (ok) { droppedRight++; if (reasonOff) wrongReason++; }
      else if (got === "keep") keptWrong++;
      else droppedWrong++;
      console.log(
        `    ${ok ? (reasonOff ? "~" : "✓") : "✗"} want ${row.want}  got ${got.padEnd(4)} ${(reason || "").padEnd(13)}` +
        ` set:${setPresent(row.t, group.set) ? "yes" : "no "}  ${row.t.slice(0, 62)}`
      );
    }
  }
  score[label] = { keptRight, keptWrong, droppedRight, droppedWrong, wrongReason };
  console.log(
    `  → good comps kept ${keptRight}, good comps THROWN AWAY ${droppedWrong}, ` +
    `bad comps dropped ${droppedRight} (${wrongReason} of them for the wrong reason), bad comps ADMITTED ${keptWrong}`
  );
}

console.log("\n\nWhat each candidate costs and buys");
console.log("──────────────────────────────────");
console.log("  candidate".padEnd(38) + "kept ✓  lost ✗  dropped ✓  admitted ✗");
for (const [label, s] of Object.entries(score)) {
  console.log(`  ${label.padEnd(36)}${String(s.keptRight).padStart(6)}${String(s.droppedWrong).padStart(8)}${String(s.droppedRight).padStart(11)}${String(s.keptWrong).padStart(12)}`);
}

// ── The part that decides whether any of this is safe ────────────────────────
// Every "bad comp ADMITTED" above is a wrong-set print or a non-card that the
// name-token bug is currently catching by accident. Whether a repair is safe
// depends entirely on whether the set guard picks them up afterwards — so
// measure that rather than assume it.
console.log("\n\nWould splitSetMismatch catch what a repair lets through?");
console.log("───────────────────────────────────────────────────────");
console.log(`  thresholds: fires only when ≥1 comp matches the set, the match ratio is ≤ ` +
  `${DEFAULT_SETTINGS.setMismatchExcludeBelowRatio}, and ≥ ${DEFAULT_SETTINGS.setMismatchMinKept} comps would survive\n`);
for (const group of CASES) {
  const tokens = CANDIDATES["drop the numbering prefix (shipped)"](group.q);
  const kept = group.rows.filter((r) => !classify(r.t, tokens, group.set));
  const matching = kept.filter((r) => setPresent(r.t, group.set));
  const ratio = kept.length ? matching.length / kept.length : 0;
  const blockers = [];
  if (matching.length === 0) blockers.push("no comp names the set at all");
  if (kept.length - matching.length === 0) blockers.push("nothing to exclude");
  if (ratio > DEFAULT_SETTINGS.setMismatchExcludeBelowRatio)
    blockers.push(`match ratio ${ratio.toFixed(2)} is above ${DEFAULT_SETTINGS.setMismatchExcludeBelowRatio}`);
  if (matching.length < DEFAULT_SETTINGS.setMismatchMinKept)
    blockers.push(`only ${matching.length} set-matching comp(s), needs ${DEFAULT_SETTINGS.setMismatchMinKept}`);
  console.log(
    `  ${group.q.padEnd(18)} ${kept.length} comps reach the set guard, ${matching.length} say "${group.set}" → ` +
    (blockers.length === 0
      ? `FIRES, keeps ${matching.length}`
      : `STANDS DOWN (${blockers.join("; ")}). The wrong-set comps are priced, with a ⚠ note and nothing else.`)
  );
}
console.log(
  "\n  Note the shape of that: the guard is at its weakest exactly where the pool\n" +
  "  is thinnest, which is the same place the name-token bug leaves every card in\n" +
  "  this batch. Repairing the tokens without also giving the set guard something\n" +
  "  to stand on trades one silent failure for another."
);
