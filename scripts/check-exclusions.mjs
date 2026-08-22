/**
 * Table check for the exclusion rules in packages/core/pricing.js.
 *
 *   node scripts/check-exclusions.mjs      (or: npm run check)
 *
 * Every title below is a REAL sold-listing title taken from the 11,063-comp
 * audit corpus, with the reason it must produce. The false-positive cases at
 * the bottom matter more than the true positives: each one is a title an
 * earlier draft of a rule wrongly excluded, and they are here so a later
 * "obvious" widening of a pattern fails loudly instead of quietly costing
 * good comps.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import { settingsForCard } from "../apps/public/lib/settings.js";

const { DEFAULT_SETTINGS, recommend } = CompFinderPricing;

/** Runs one title through the pipeline and returns its exclusion reason. */
function reasonFor(title, { tokens = null, number = null, set = null } = {}) {
  const comp = { title, itemPricePence: 5000, postagePence: 0 };
  const rec = recommend([comp], DEFAULT_SETTINGS, tokens, "sold", number, set);
  const ex = (rec.excluded || [])[0];
  return ex ? ex.exclusionReason : null;
}

const CASES = [
  // --- graded: companies the old list missed --------------------------------
  ["Pokemon 2025 Jolteon ex 153/131 SIR Prismatic Evolutions GEM MINT TAG 10", "graded"],
  ["Pokemon Espeon ex Prismatic Evolutions Special Illustration Rare TAG 9", "graded"],
  ["Pokemon GRAAD 4 Charizard #146 Holo Skyridge 2003 English", "graded"],
  ["Mew VMAX (Secret) 268/264 Swsh08: Fusion Strike MGC 10", "graded"],
  ["Giratina VSTAR (Secret) 201/196 Swsh11: Lost Origin Holo AGS 9", "graded"],
  ["ACE Grading 9 Pikachu VMAX Secret Rare 188/185 Vivid Voltage 2020 Holo", "graded"],
  ["Pokemon Lugia VSTAR 2022 Silver Tempest 211/195 Ace Grade 10 - perfect subgrades", "graded"],
  ["GetGraded 9.5 Dragapult VMAX 197/192 Rebel Clash 2020 Holo Secret Rare EN", "graded"],
  ["PSA 10 Umbreon VMAX (Alternate Art Secret) 215/203 Swsh07: Evolving Skies", "graded"],
  // A grade with no company named. This one was a £303 comp in a five-comp
  // set whose other four ran £22-£26.
  ["Mewtwo VSTAR Secret #086 Pokemon GO~PRISTINE 10 GOLD LABEL TOP POP~SHOOT OFFER", "graded"],
  ["Radiant Blastoise 018/071 Certified Pristine 10 Pokemon Go Bling", "graded"],

  // --- notACard: shapes a keyword cannot express ---------------------------
  ["Charizard 146/144 Skyridge E-Reader Series - Custom-Art Gold Metal Pokemon Card", "notACard"],
  ["Crystal Charizard Skyridge 146/144 Holo Vintage Custom Handmade Fan Art Card", "notACard"],
  ["Fan made art work Charizard 136/135 Plasma Storm Holo", "notACard"],
  ["DIY Rayquaza Vmax 218/203 Pokemon Evolving Skies Non-textured Holo Inspired Art", "notACard"],
  ["D-I-Y Mega Charizard Y ex 294/217 Gold Inspired Art Holo Ascended Heroes Card", "notACard"],
  ["Custom Gold Metal Vivid Voltage Rainbow Secret Rare Pikachu VMAX Card 188/185", "notACard"],
  ["Mew VMAX 269/264 Pokemon Premium Gold Metal Card Collectible Gift Display", "notACard"],

  // --- pickYourOwn ----------------------------------------------------------
  ["Pokemon TCG - Choose Your Pikachu | Holo/Reverse EX VMAX Full Art Cards | NM", "pickYourOwn"],
  ["Evolving Skies Master Set - Choose Your Card! - Every Alt Art", "pickYourOwn"],

  // --- multiCardLot: two distinct "<Name> <N>/<M>" groups -------------------
  ["Nintendo Pokemon TCG EX Dragon Latias ex 93/97 & Latios ex 94/97 Holo Lot", "multiCardLot"],
  ["POKEMON FLYING PIKACHU 110/108 & SURFING PIKACHU 111/108 SECRET RARES EVOLUTIONS", "multiCardLot"],
  ["Gladion's Final Battle 118/084 & Silvally 095/084 Set Me05: Pitch Black Holo", "multiCardLot"],
  ["Pokemon TCG Plasma Storm Articuno EX 25/135 Zapdos 48/135 Moltres 14/135 Holo", "multiCardLot"],
  ["Pokemon TCG Tyranitar 222/193 Sv02: Paldea Evolved Holo & Larvitar 203/197 Holo", "multiCardLot"],
  // The three real phrasings the check was originally written for, kept as
  // regressions: checks (1) and (3) were merged and must still catch these.
  ["Horsea 030, Seadra 031 and Kingdra 032/182", "multiCardLot"],
  ["Horsea 030 Seadra 031 Kingdra 032/182 - Sv04 Paradox Rift", "multiCardLot"],

  // --- bundles written with a count, or as a plus-joined evolution line -----
  ["Pokémon TCG 10 Card Lot Mewtwo VSTAR 086/078 Holo Pokémon GO English", "bundle"],
  ["Chesnaught V 015/195 Silver Tempest - 2 Card Lot", "bundle"],
  ["SHINY HOLO RARE Gible + Gabite + Garchomp SET Pokemon SV40/SV94 Hidden Fates NM", "bundle"],

  // --- FALSE POSITIVES. Each of these was excluded by a draft rule. ---------
  // A date, not a card number: denominator 8 is too small to be a set total.
  ["FRI 21/08 MEGA GENGAR EX 284/217 ASCENDED HEROES", null],
  // A year, not a card number.
  ["Origin Forme Dialga VSTAR Gold 210/189 Astral Radiance. NEW CERT 03/2026", null],
  // One card written twice, with and without the leading zero.
  ["PIKACHU VMAX 044/185 FA ULTRA RARE POKEMON CARD VIVID VOLTAGE 44/185", null],
  // "read description" is ordinary seller language on genuine full-price sales.
  ["Umbreon ex 161/131 Sv: Prismatic Evolutions Holo Great Centering! Read Description", null],
  ["Pokemon TCG Prismatic Evolutions Flareon EX Sir 146/131 - LP - Read Description", null],
  // TAG TEAM cards are not TAG-graded cards: the digit must follow "tag".
  ["Reshiram & Charizard GX 20/214 Unbroken Bonds TAG TEAM Ultra Rare Holo", null],
  // "Gold Hyper Rare" is a real rarity; only gold METAL is the novelty.
  ["Mega Charizard Y EX 294/217 Gold Hyper Rare Ascended Heroes Pokemon TCG - NM", null],
  // Ordinary single-card titles, one number group each.
  ["Umbreon VMAX 215/203 Evolving Skies Alt Art Secret Rare Moonbreon NM Raw", null],
  ["Pokemon Latios Ex Dragon holo 94 / 97 LP", null],
  ["Machamp EX 37/98 Holo EX Rare Ancient Origins Pokemon Lightly Played", null],
  // A set whose NAME is a number. Counting matches rather than distinct
  // numbers made this pair its own set name with the card and read as a lot.
  ["Pokemon 151 Charizard ex 199/165 Special Illustration Rare Holo", null],
  ["Pokemon Card 151 Mew ex 205/165 SIR English NM", null],
  // A bare "set" token appears in 301 of the 11,534 corpus titles. Keying off
  // it would take out every one of these.
  ["Pokémon TCG Mew EX 151/165 Scarlet Violet 151 Set Ultra Rare NM", null],
  ["Garchomp SV40/SV94 Hidden Fates: Shiny Vault Shiny Holo Rare Pokemon Card", null],
  ["Umbreon VMAX 215/203 Evolving Skies Secret Rare Set Holo", null],
  // "pristine" needs a digit after it, or an ordinary description of a raw
  // card would read as a slab.
  ["Charizard VMAX 074/073 Champion's Path Secret Rare - pristine condition", null]
];

// Check (2), the shared-denominator test, needs the searched-for number to
// carry its own denominator. Kept separate because it takes cardNumber.
const NUMBERED_CASES = [
  ["Horsea, Seadra, Kingdra 030/182, 031/182, 032/182", "032/182", "multiCardLot"],
  ["Flabebe + Floette RC17/RC32 RC18/RC32 Generations Common", "RC17/RC32", "multiCardLot"],
  ["Kingdra 032/182 Paradox Rift Holo Rare Pokemon Card NM", "032/182", null]
];

let failed = 0;
for (const [title, want] of CASES) {
  const got = reasonFor(title);
  if (got !== want) {
    failed++;
    console.error(`FAIL  want ${String(want)}, got ${String(got)}\n      ${title}`);
  }
}
for (const [title, number, want] of NUMBERED_CASES) {
  const got = reasonFor(title, { number });
  if (got !== want) {
    failed++;
    console.error(`FAIL  want ${String(want)}, got ${String(got)}  (number ${number})\n      ${title}`);
  }
}

// --- postage that dwarfs the card -------------------------------------------
// A £2 card posted for £20 is not a £22 comp. Built from the real Hydreigon ex
// 161/086 pull, whose median POSTAGE was £9.85 — so the old median-postage
// test set a £78 threshold and flagged nothing at all.
{
  const cheap = (item, post) => ({ title: `Hydreigon ex 161/086 White Flare Holo`, itemPricePence: item, postagePence: post });
  const comps = [
    cheap(220, 0), cheap(179, 0), cheap(144, 0), cheap(219, 0), cheap(279, 0), cheap(299, 0),
    cheap(249, 985), cheap(265, 985), cheap(199, 1082), cheap(208, 2088)
  ];
  const rec = recommend(comps, DEFAULT_SETTINGS, null, "sold", null, null);
  const dwarfed = (rec.excluded || []).filter((e) => e.exclusionReason === "highPostage").length;
  if (dwarfed !== 4) {
    failed++;
    console.error(`FAIL  postage-dwarfs-card: expected 4 excluded, got ${dwarfed}`);
  }
  // ...and the same postage on an expensive card is noise, not an outlier.
  const dear = (item, post) => ({ title: `Umbreon VMAX 215/203 Evolving Skies Alt Art`, itemPricePence: item, postagePence: post });
  const rich = [
    dear(150000, 0), dear(151140, 0), dear(153089, 0), dear(156335, 0),
    dear(165065, 500), dear(181571, 985), dear(99900, 1082), dear(102670, 500)
  ];
  const rec2 = recommend(rich, DEFAULT_SETTINGS, null, "sold", null, null);
  const wrongly = (rec2.excluded || []).filter((e) => e.exclusionReason === "highPostage").length;
  if (wrongly !== 0) {
    failed++;
    console.error(`FAIL  postage on an expensive card: expected 0 excluded, got ${wrongly}`);
  }
}

// --- low-side price outlier --------------------------------------------------
{
  const at = (pence, title) => ({ title: title || "Gengar VMAX 271/264 Fusion Strike Alt Art", itemPricePence: pence, postagePence: 0 });
  // One stray at 70x below the median is contamination.
  const strays = [at(63389), at(62868), at(66464), at(70096), at(73837), at(76990), at(81118), at(899)];
  const rec = recommend(strays, DEFAULT_SETTINGS, null, "sold", null, null);
  const low = (rec.excluded || []).filter((e) => e.exclusionReason === "priceOutlierLow").length;
  if (low !== 1) { failed++; console.error(`FAIL  low-side stray: expected 1 excluded, got ${low}`); }

  // A genuine played copy at ~9x below must survive — this is the August case.
  const played = [at(10292), at(12851), at(14669), at(14673), at(17811), at(7332), at(1080)];
  const rec2 = recommend(played, DEFAULT_SETTINGS, null, "sold", null, null);
  const low2 = (rec2.excluded || []).filter((e) => e.exclusionReason === "priceOutlierLow").length;
  if (low2 !== 0) { failed++; console.error(`FAIL  played copy at 9x below: expected 0 excluded, got ${low2}`); }

  // A CLUSTER of cheap comps is a bimodal market, not contamination: stand down.
  const bimodal = [at(200), at(210), at(220), at(230), at(240), at(250), at(9000), at(9500), at(10000), at(10500)];
  const rec3 = recommend(bimodal, DEFAULT_SETTINGS, null, "sold", null, null);
  const low3 = (rec3.excluded || []).filter((e) => e.exclusionReason === "priceOutlierLow").length;
  if (low3 !== 0) { failed++; console.error(`FAIL  bimodal cluster: expected 0 excluded, got ${low3}`); }
}

// --- foreign-language prints: PUBLIC PAGE ONLY -------------------------------
// Deliberately not in core (see apps/public/lib/settings.js): the app has a
// manual language toggle and prices stock that may be a foreign print on
// purpose. These run through settingsForCard rather than DEFAULT_SETTINGS.
{
  const check = (title, card, want) => {
    const rec = recommend(
      [{ title, itemPricePence: 5000, postagePence: 0 }],
      settingsForCard(card), null, "sold", null, null
    );
    const got = (rec.excluded || [])[0]?.exclusionReason ?? null;
    if (got !== want) {
      failed++;
      console.error(`FAIL  foreign: want ${String(want)}, got ${String(got)}\n      ${title}`);
    }
  };
  const english = { name: "Vaporeon ex", language: "English" };
  const japanese = { name: "Hydreigon", language: "Japanese" };

  check("Vaporeon ex 149/131 SIR Prismatic Evolutions Italian Pokemon Card NM", english, "foreignPrint");
  check("SYLVEON VMAX POKEMON 212/203 EVOLVING SKIES 2021 GERMAN", english, "foreignPrint");
  check("Pecharunt ex 163/131 (Korean) Prismatic Evolutions Pokemon Holo NM", english, "foreignPrint");
  check("Hydreigon 057/052 Next Destinies 1st Ed BW3 Japanese Pokemon Card MP", english, "foreignPrint");
  // An ITALIAN-LANGUAGE listing for an ENGLISH card ("inglese"). This is the
  // sale we want, and it is why "carte" is not in the list.
  check("Lotto Carte Pokemon Raichu ex 98/100 EX Sandstorm inglese", english, null);
  check("Vaporeon ex 149/131 SIR Prismatic Evolutions Pokemon Card NM", english, null);
  // A card the catalogue says IS Japanese must keep its Japanese comps.
  check("Hydreigon 057/052 Next Destinies 1st Ed BW3 Japanese Pokemon Card MP", japanese, null);
  // No resolved card at all: English is the right default on a UK marketplace.
  check("Vaporeon ex 149/131 SIR Prismatic Evolutions Italian Pokemon Card NM", null, "foreignPrint");
}

if (failed) {
  console.error(`\n${failed} exclusion checks failed.`);
  process.exit(1);
}
console.log(`exclusions: ${CASES.length + NUMBERED_CASES.length} titles + postage, low-outlier and foreign-print cases pass.`);
