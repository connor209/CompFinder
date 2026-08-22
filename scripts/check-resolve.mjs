/**
 * Table check for the resolver: typed text -> parsed query -> ranked cards.
 *
 *   node scripts/check-resolve.mjs      (or: npm run check)
 *
 * Resolution is upstream of everything. If it names the wrong card, a
 * perfectly computed price is a wrong answer and nothing downstream can tell.
 * The cases below are the failures a 2,730-query audit turned up, plus the
 * behaviour that must not regress while fixing them.
 *
 * rankCards is fed hand-built rows rather than the live catalogue so the check
 * runs offline and deterministically.
 */
import { parseQuery, rankCards, scoreCard, looksWeak } from "../apps/public/lib/resolve.js";

let failed = 0;
const fail = (msg) => { failed++; console.error(`FAIL  ${msg}`); };

// --- parseQuery --------------------------------------------------------------
const PARSE = [
  // The bug: a set name after the number swallowed the whole query.
  ["Umbreon ex 161 Prismatic Evolutions", { name: "Umbreon ex", number: "161", setHint: "Prismatic Evolutions" }],
  ["Umbreon ex 161/131 Prismatic Evolutions", { name: "Umbreon ex", number: "161", setHint: "Prismatic Evolutions" }],
  ["Mew ex 151 WCD 2025", { name: "Mew ex", number: "151", setHint: "WCD 2025" }],
  // Unchanged behaviour.
  ["Umbreon ex 161", { name: "Umbreon ex", number: "161", setHint: "" }],
  ["Charizard ex 223/165", { name: "Charizard ex", number: "223", setHint: "" }],
  ["Charizard", { name: "Charizard", number: null, setHint: "" }],
  // The 2 in Porygon2 is part of the name, not a collector number.
  ["Porygon2 105", { name: "Porygon2", number: "105", setHint: "" }],
  // A leading number must not be read as the collector number and leave no name.
  ["151 Charizard ex 183", { name: "151 Charizard ex", number: "183", setHint: "" }],

  // Shiny Vault, Trainer Gallery and Galarian Gallery cards are numbered with
  // a letter prefix ON THE CARD, so that is what people type. 20 of the 455
  // audit cards are numbered this way and every one was unreachable.
  ["Garchomp SV40", { name: "Garchomp", number: "SV40", setHint: "" }],
  ["Pikachu VMAX TG29", { name: "Pikachu VMAX", number: "TG29", setHint: "" }],
  ["Deoxys VMAX GG45", { name: "Deoxys VMAX", number: "GG45", setHint: "" }],
  ["Charizard VMAX SV107 Shining Fates", { name: "Charizard VMAX", number: "SV107", setHint: "Shining Fates" }],
  // The prefix has to be attached to the digits, or "ex" would be swallowed.
  ["Umbreon ex 161", { name: "Umbreon ex", number: "161", setHint: "" }]
];
for (const [q, want] of PARSE) {
  const got = parseQuery(q);
  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) fail(`parseQuery("${q}").${k}: want ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`);
  }
}

// --- ranking and confidence --------------------------------------------------
const row = (cardmarket_id, name, collector_number, expansion, expansion_code, rarity) =>
  ({ cardmarket_id, name, collector_number, expansion, expansion_code, rarity, game: "pokemon" });

const UMBREONS = [
  row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare"),
  row(2, "Umbreon ex", "059", "Prismatic Evolutions", "PRE", "Double Rare"),
  row(3, "Umbreon", "161", "Sword & Shield Promos", "S-P", "Promo"),
  row(4, "Umbreon", "86", "Undaunted", "UD", "Rare Holo")
];

{
  // Naming the set should settle it, not leave the visitor picking from six.
  const withSet = rankCards(UMBREONS, parseQuery("Umbreon ex 161 Prismatic Evolutions"));
  if (!withSet.confident) fail("naming the set should be confident");
  if (withSet.candidates[0].row.cardmarket_id !== 1) fail("naming the set should pick the 161 Prismatic Evolutions card");

  // The Japanese S-P promo must not outrank the English chase card.
  const noSet = rankCards(UMBREONS, parseQuery("Umbreon 161"));
  if (noSet.candidates[0].row.expansion_code === "S-P") fail("a Japanese promo outranked the English card");
}

{
  // A coincidental substring match with a contradicting number priced a
  // Quintessential Quintuplets card, because one candidate meant confident.
  const junk = [row(9, "Unexpected Response, Miku Nakano", "122", "The Quintessential Quintuplets", "QQ", "Rare")];
  const r = rankCards(junk, parseQuery("Espon ex 34"));
  if (r.confident) fail("a lone weak match with the wrong number must not be confident");

  // ...and the same match with no number typed is still too weak to skip the picker.
  const r2 = rankCards(junk, parseQuery("Espon ex"));
  if (r2.confident) fail("a lone match below the score floor must not be confident");
}

{
  // A real, unambiguous single hit still resolves without a picker.
  const one = [row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare")];
  if (!rankCards(one, parseQuery("Umbreon ex 161")).confident) fail("a single strong exact match should stay confident");
}

{
  // Two English cards sharing a name and number in different sets cannot be
  // told apart from the text typed. The picker is the correct answer.
  const collide = [
    row(1, "Charizard ex", "223", "Obsidian Flames", "OBF", "Special Illustration Rare"),
    row(2, "Charizard ex", "223", "151", "MEW", "Special Illustration Rare")
  ];
  if (rankCards(collide, parseQuery("Charizard ex 223")).confident) {
    fail("a genuine name+number collision must show the picker");
  }
  // Unless the visitor said which set they meant.
  if (!rankCards(collide, parseQuery("Charizard ex 223 Obsidian Flames")).confident) {
    fail("naming the set should resolve a collision");
  }
}

{
  // A set code parked in the catalogue's number field ("ASC 022", "PRE 006")
  // must still match the number printed on the card.
  const prize = [row(1, "Moltres ex", "PRE 006", "Play! Pokémon Prize Pack Series Three", "PPS3", "Promo")];
  const r = rankCards(prize, parseQuery("Moltres ex 6"));
  if (!r.candidates.length || r.candidates[0].score < 100) fail("a set-code prefix in the number field should still match on 6");
}

{
  // A Prize Pack entry is the same card as the one it reprints, and says so in
  // its number. Left in, it sits 8 points behind and collapses the confidence
  // gap — asking the visitor to choose between a card and itself.
  const twin = [
    row(1, "Umbreon ex", "060", "Prismatic Evolutions", "PRE", "Double Rare"),
    row(2, "Umbreon ex", "PRE 060", "Play! Pokémon Prize Pack Series Seven", "PPS7", "Prize Pack Series cards")
  ];
  const r = rankCards(twin, parseQuery("Umbreon ex 60"));
  if (r.candidates[0].row.cardmarket_id !== 1) fail("the main-set card should rank above its reprint");
  if (!r.confident) fail("ranking the reprint down should leave a confident answer");
  // Ranked DOWN, not deleted — it is still a card someone can be holding.
  if (r.candidates.length !== 2) fail(`the reprint should still be offered, got ${r.candidates.length}`);

  // Naming the Prize Pack set must return the Prize Pack card. Deleting the
  // entry instead of ranking it down made this confidently return the wrong
  // card, on 27 queries.
  const named = rankCards(twin, parseQuery("Umbreon ex 60 Play! Pokémon Prize Pack Series Seven"));
  if (named.candidates[0].row.cardmarket_id !== 2) fail("naming the Prize Pack set should return the Prize Pack card");

  // The Celebrations Classic Collection is numbered the same way ("NR 66") but
  // is a DIFFERENT card at a very different price, not a redistribution. It
  // must not be ranked down: these should tie and be offered as a choice.
  const celebrations = [
    row(1, "Shining Magikarp", "66", "Neo Revelation", "NR", "Rare Holo"),
    row(2, "Shining Magikarp", "NR 66", "Celebrations", "CEL", "Rare Holo")
  ];
  const c = rankCards(celebrations, parseQuery("Shining Magikarp 66"));
  if (c.confident) fail("a Celebrations reprint is a real choice, not a redistribution");
  const cNamed = rankCards(celebrations, parseQuery("Shining Magikarp 66 Celebrations"));
  if (cNamed.candidates[0].row.cardmarket_id !== 2) fail("naming Celebrations should return the Celebrations card");
}

{
  // The trimming fallback must not lose a one-character word. "V" is the
  // difference between a £2 card and a £200 one.
  const zoroark = [
    row(1, "Hisuian Zoroark", "076", "Lost Origin", "LOR", "Rare"),
    row(2, "Hisuian Zoroark V", "146", "Lost Origin", "LOR", "Ultra Rare")
  ];
  const parsed = { name: "Hisuian Zoroark V", number: null, total: null, setHint: "Lost Origin" };
  const r = rankCards(zoroark, parsed);
  if (r.candidates[0].row.cardmarket_id !== 2) fail("the V card should win when V was typed");
}

{
  // Apostrophes: people omit them.
  const rocket = [row(1, "Team Rocket's Persian ex", "173", "Destined Rivals", "DRI", "Ultra Rare")];
  const withApos = rankCards(rocket, parseQuery("Team Rocket's Persian ex 173"));
  const without = rankCards(rocket, parseQuery("team rockets persian ex 173"));
  if (!withApos.confident) fail("the punctuated form should resolve confidently");
  if (!without.confident) fail("omitting the apostrophe should resolve just as well");

  // Scoring is only half of it: the DB filter runs against the raw name, which
  // keeps its apostrophe, so "rockets" has to be widened to "rocket" or the
  // card is never fetched to be scored at all.
  const forFilter = (w) => {
    const t = w.toLowerCase();
    return t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t;
  };
  const raw = "Team Rocket's Persian ex";
  for (const w of ["team", "rockets", "persian", "ex"]) {
    if (!raw.toLowerCase().includes(forFilter(w))) fail(`filter token "${forFilter(w)}" would not fetch ${raw}`);
  }
  // ...and it must not shorten something that is already short.
  if (forFilter("ex") !== "ex") fail("short tokens must be left alone");
  if (forFilter("eevee") !== "eevee") fail("a token not ending in s must be left alone");
}

{
  // The set hint must not fire on an unrelated set.
  const parsed = parseQuery("Umbreon ex 161 Evolving Skies");
  const a = scoreCard(row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare"), parsed);
  const b = scoreCard(row(2, "Umbreon ex", "161", "Evolving Skies", "EVS", "Secret Rare"), parsed);
  if (b <= a) fail("the named set should outscore the unnamed one");
}

{
  // Fuzzy fallback rows carry a similarity instead of a substring match. They
  // must be scoreable — the old code discarded them outright, since the typed
  // name cannot be a substring of the right one, that being the point — and
  // they must NEVER be confident, however clear the winner looks. A guess at
  // what someone meant is a suggestion, not a card to price silently.
  const fuzzyRow = { ...row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare"), _similarity: 0.86 };
  const r = rankCards([fuzzyRow], parseQuery("Umbeon ex 161"));
  if (!r.candidates.length) fail("a fuzzy row must be scoreable, not discarded");
  if (r.confident) fail("a fuzzy match must never be confident, even alone");
  if (!r.fuzzy) fail("rankCards should report that the answer came from the fuzzy path");

  // Even a perfect-looking similarity stays below the confidence floor.
  const r2 = rankCards([{ ...fuzzyRow, _similarity: 1 }], parseQuery("Umbeon ex 161"));
  if (r2.confident) fail("similarity 1.0 must still not be confident");

  // And an exact match alongside a fuzzy one still wins on the merits.
  const mixed = rankCards(
    [fuzzyRow, row(2, "Umbeon ex", "161", "Some Set", "XXX", "Rare")],
    parseQuery("Umbeon ex 161")
  );
  if (mixed.candidates[0].row.cardmarket_id !== 2) fail("an exact name match should outrank a fuzzy one");
}

{
  // looksWeak decides whether to escalate to the fuzzy fallback. It must fire
  // on an incidental substring and stay quiet on a genuine match, or it either
  // blocks the fallback or runs it on every query.
  const weak = rankCards([row(1, "Origins: Common Set", "1", "Origins", "ORI", "Common")], parseQuery("ns zoroark ex"));
  if (!looksWeak(weak.candidates, parseQuery("ns zoroark ex"))) {
    fail("a two-letter incidental substring should read as weak");
  }
  const exact = rankCards([row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare")], parseQuery("Umbreon ex 161"));
  if (looksWeak(exact.candidates, parseQuery("Umbreon ex 161"))) fail("an exact name match is not weak");
  // "Dark Slowbro" for "slowbro" is a real answer, not an accident.
  const ends = rankCards([row(1, "Dark Slowbro", "42", "Team Rocket", "TR", "Rare")], parseQuery("slowbro 42"));
  if (looksWeak(ends.candidates, parseQuery("slowbro 42"))) fail("an endsWith match should not trigger the fallback");
  if (!looksWeak([], parseQuery("anything"))) fail("no candidates at all is weak");
}

if (failed) {
  console.error(`\n${failed} resolver checks failed.`);
  process.exit(1);
}
console.log(`resolver: ${PARSE.length} parse cases + ranking and confidence cases pass.`);
