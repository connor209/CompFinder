/**
 * Table check for languageOf(). No framework — `node scripts/check-language.mjs`,
 * non-zero exit on any mismatch.
 *
 * This exists because the rule is the kind that looks obviously right and is
 * quietly wrong: the first version classified every Japanese set from 2016 on
 * and silently let the older ones through, which is what put MA5 "Shadow
 * Threat" and XY7 "Bandit Ring" into an English-only audit set. The cases
 * below are all real (expansion_code, expansion) pairs taken from the
 * catalogue, and the English ones are here specifically as tripwires: BS2,
 * N1, G1 and bare MA are the codes a looser rule would misclassify.
 */
import { languageOf } from "../apps/public/lib/resolve.js";

const CASES = [
  // Non-English regional line. MA1 names itself "ID/TH".
  ["MA5", "Shadow Threat", "Asian"],
  ["MA4", "Void Blast", "Asian"],
  ["MA2", "Indigo Flame", "Asian"],
  ["MA1", "Mega Evolution ID/TH", "Asian"],

  // Pre-2016 Japanese, all-caps codes.
  ["XY6", "Emerald Break", "Japanese"],
  ["XY7", "Bandit Ring", "Japanese"],
  ["BW7", "Plasma Gale", "Japanese"],
  ["ADV1", "ADV Expansion Pack", "Japanese"],
  ["ADV2", "Miracle of the Desert", "Japanese"],
  ["ADV4", "Undone Seal", "Japanese"],
  ["PCG1", "Flight of Legends", "Japanese"],
  ["L2", "Reviving Legends", "Japanese"],
  ["L3", "Clash at the Summit", "Japanese"],
  ["L1SS", "SoulSilver Collection", "Japanese"],
  ["LL", "Lost Link", "Japanese"],
  ["WCP", "World Champions Pack", "Japanese"],
  ["DP1", "Space-Time Creation", "Japanese"],
  ["CP6", "20th Anniversary", "Japanese"],
  ["SM1", "Collection Sun", "Japanese"],

  // Japanese promos: "<era>-P". English promos never take that shape.
  ["XY-P", "XY Promos", "Japanese"],
  ["S-P", "Sword & Shield Promos", "Japanese"],
  ["SM-P", "Sun & Moon Promos", "Japanese"],
  ["SV-P", "Scarlet & Violet Promos", "Japanese"],
  ["PCG-P", "PCG Promos", "Japanese"],

  // Modern Japanese, caught by the lowercase letter.
  ["m5", "Abyss Eye", "Japanese"],
  ["m1L", "Mega Brave", "Japanese"],
  ["sv2a", "Pokémon Card 151", "Japanese"],
  ["SV3s", "Black Sparkle", "Japanese"],
  ["s7R", "Blue Sky Stream", "Japanese"],
  ["BW8t", "Thunder Knuckle", "Japanese"],
  ["sm8b", "GX Ultra Shiny", "Japanese"],

  // Chinese: lowercase too, so the C-with-a-digit test has to run first.
  ["CSV3C", "Fearless Terastal", "Chinese"],
  ["CS4aC", "Nine Colors Gathering - Friends", "Chinese"],
  ["CBB2C", "Gem Pack Vol. 2", "Chinese"],
  ["151C", "Collect 151", "Chinese"],

  // Named in the set title — handled by core's detectLanguage, not the code.
  ["", "Journey Together (Japanese)", "Japanese"],
  ["", "Prismatic Evolutions (Korean)", "Korean"],

  // The vintage Japanese families. These were originally asserted the OTHER
  // WAY ROUND here — as English tripwires — on the reasoning that N1-N4 and
  // G1/G2 are Neo and Gym. That is CardMarket's convention elsewhere but not
  // this catalogue's, and the wrong assertion was protecting a real leak.
  // Every pair below was read back out of the catalogue via /api/resolve.
  ["N1", "Gold, Silver, to a New World...", "Japanese"],
  ["N2", "Crossing the Ruins...", "Japanese"],
  ["N3", "Awakening Legends", "Japanese"],
  ["G1", "Leaders' Stadium", "Japanese"],
  ["G2", "Challenge from the Darkness", "Japanese"],
  ["EC1", "Base Expansion Pack", "Japanese"],
  ["EC2", "The Town on No Map", "Japanese"],
  ["EC4", "Split Earth", "Japanese"],
  ["EXP", "Expansion Pack", "Japanese"],
  ["EXS", "Expansion Sheet", "Japanese"],

  // The ENGLISH sets of those same eras, which carry no digit at all. These
  // are the real tripwires: a rule keyed on the letter alone would take them.
  ["NG", "Neo Genesis", "English"],
  ["ND", "Neo Discovery", "English"],
  ["NR", "Neo Revelation", "English"],
  ["NDE", "Neo Destiny", "English"],
  ["GH", "Gym Heroes", "English"],
  ["GC", "Gym Challenge", "English"],
  ["LC", "Legendary Collection", "English"],
  ["MA", "EX Team Magma vs Team Aqua", "English"],
  ["DP", "Diamond & Pearl", "English"],

  // English sets that DO carry a digit, so the family rule has to be a family
  // rule and not "contains a digit".
  ["BA20", "Battle Academy 2020", "English"],
  ["BA24", "Battle Academy 2024", "English"],
  ["POP1", "POP Series 1", "English"],
  ["PPS9", "Play! Pokémon Prize Pack Series Nine", "English"],
  ["WCD25", "WCD 2025", "English"],
  ["WCS23", "World Championships 2023 Yokohama Deck -Pikachu-", "English"],

  // Ordinary English.
  ["DR", "EX Dragon", "English"],
  ["SK", "Skyridge", "English"],
  ["AQ", "Aquapolis", "English"],
  ["PRE", "Prismatic Evolutions", "English"],
  ["EVS", "Evolving Skies", "English"],
  ["SVI", "Scarlet & Violet", "English"],
  ["ASC", "Ascended Heroes", "English"],
  ["CRI", "Chaos Rising", "English"],
  ["PBL", "Pitch Black", "English"],
  ["MEG", "Mega Evolution", "English"],
  ["POR", "Perfect Order", "English"],
  ["JTG", "Journey Together", "English"],
  ["CPA", "Champion’s Path", "English"],
  ["HS", "HeartGold & SoulSilver", "English"],
  ["UD", "Undaunted", "English"],
  ["TM", "Triumphant", "English"],
  ["UF", "EX Unseen Forces", "English"],
  ["SWSH", "SWSH Black Star Promos", "English"],
  ["SVP", "SV Black Star Promos", "English"],
  ["XYPR", "XY Black Star Promos", "English"],
  ["NP", "Nintendo Black Star Promos", "English"],
  ["PLAY", "PLAY Promos", "English"],
  ["BEST", "Best of Game Cards Promos", "English"],
  ["PPS3", "Play! Pokémon Prize Pack Series Three", "English"]
];

let failed = 0;
for (const [code, expansion, want] of CASES) {
  const got = languageOf({ expansion, expansion_code: code });
  if (got !== want) {
    failed++;
    console.error(`FAIL  ${(code || "(none)").padEnd(7)} ${expansion.padEnd(34)} want ${want}, got ${got}`);
  }
}

if (failed) {
  console.error(`\n${failed} of ${CASES.length} language cases failed.`);
  process.exit(1);
}
console.log(`languageOf: ${CASES.length} cases pass.`);
