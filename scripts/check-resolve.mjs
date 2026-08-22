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
import { parseQuery, rankCards, scoreCard } from "../apps/public/lib/resolve.js";

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
  // The set hint must not fire on an unrelated set.
  const parsed = parseQuery("Umbreon ex 161 Evolving Skies");
  const a = scoreCard(row(1, "Umbreon ex", "161", "Prismatic Evolutions", "PRE", "Special Illustration Rare"), parsed);
  const b = scoreCard(row(2, "Umbreon ex", "161", "Evolving Skies", "EVS", "Secret Rare"), parsed);
  if (b <= a) fail("the named set should outscore the unnamed one");
}

if (failed) {
  console.error(`\n${failed} resolver checks failed.`);
  process.exit(1);
}
console.log(`resolver: ${PARSE.length} parse cases + ranking and confidence cases pass.`);
