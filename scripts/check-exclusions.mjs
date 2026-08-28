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
  ["Charizard VMAX 074/073 Champion's Path Secret Rare - pristine condition", null],

  // --- not a card: binder inserts and display furniture ---------------------
  // Found as the CHEAPEST LIVE LISTING for a Charizard ex 223/197 whose real
  // floor is £72.54, which on the redesigned page made it the headline "buy it
  // today for" figure. The keyword list held "binder insert" and "display
  // case"; neither substring appears in these titles.
  ["Charizard ex 223/197 Obsidian Flames Extended Binder Art Inserts", "notACard"],
  ["Pokémon Umbreon VMAX 215/203 Extended Art Binder Insert", "notACard"],
  ["Magikarp Illustration Rare 203/193 Paldea Evolved Extended Art Binder Inserts", "notACard"],
  ["Pokemon TCG Charizard EX Scarlet Violet Obsidian Flames 223/197 Display Stand", "notACard"],
  // The false positive that kept bare "binder" out of the pattern: a real sale
  // of a real card, described by its seller as worth putting in a binder.
  ["Charizard EX 4/100 - Crystal Guardians 2006 Delta Species (HP - Binder Worthy)", null],
  // And the reason bare "display" stayed out: this one is already caught twice
  // over by the fan-art and gold-metal patterns, so it earns nothing.
  ["Pokemon Charizard ex 223/197 Obsidian Flames Holo Gold Metal Fan Art Display Card", "notACard"]
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

// --- collector numbers written padded or unpadded ----------------------------
// The catalogue and the seller rarely agree. Measured across 4,778 sold titles
// from 120 cheap cards, 212 comps on 12 of them matched the name and failed
// only because the catalogue said "2" and the listing said "002/073".
{
  const check = (title, tokens, want, label) => {
    const rec = recommend([{ title, itemPricePence: 500, postagePence: 0 }], DEFAULT_SETTINGS, tokens, "sold", null, null);
    const included = (rec.included || []).length > 0;
    if (included !== want) {
      failed++;
      console.error(`FAIL  ${label}: want ${want ? "kept" : "dropped"}, got ${included ? "kept" : "dropped"}\n      ${title}`);
    }
  };
  check("Weedle 002/073 Common Champions Path NM", ["Weedle", "2"], true, "padded title, unpadded catalogue");
  check("Weedle 02/73 Champions Path Common Unlimited", ["Weedle", "2"], true, "half-padded title");
  check("Weedle 2/73 Champions Path NM", ["Weedle", "2"], true, "both unpadded");
  check("Glaceon ex 090/084 Paldean Fates NM", ["Glaceon", "90"], true, "padded title, unpadded token");
  check("Glaceon ex 90/84 Paldean Fates NM", ["Glaceon", "090"], true, "unpadded title, padded token");
  // ...and it must not start matching numbers that merely contain the digits.
  check("Weedle 12/73 Champions Path NM", ["Weedle", "2"], false, "12 is not 2");
  check("Weedle 20/73 Champions Path NM", ["Weedle", "2"], false, "20 is not 2");
  check("Umbreon ex 61/131 Prismatic Evolutions NM", ["Umbreon", "161"], false, "61 is not 161");
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

// --- the grade is not part of the card's NAME --------------------------------
// The second leak, and it sat in front of the first: nameTokensMatch requires
// EVERY token, so a graded title tokenised whole makes "PSA" and "10" words a
// comp has to contain. That drops a CGC 10 of the same card, and drops a
// "PSA10" written without the space, since \bPSA\b does not match inside it —
// both as "nameMismatch", before any of the graded logic below runs. A graded
// title and the raw title underneath it must produce the SAME name tokens.
{
  const tokensOf = (title) =>
    CompFinderPricing.extractNameTokens(CompFinderPricing.simplifyTitle(title, DEFAULT_SETTINGS.stripWords));
  const same = (a, b, why) => {
    if (JSON.stringify(tokensOf(a)) !== JSON.stringify(tokensOf(b))) {
      failed++;
      console.error(`FAIL  tokens ${why}:\n      ${a} -> ${JSON.stringify(tokensOf(a))}\n      ${b} -> ${JSON.stringify(tokensOf(b))}`);
    }
  };
  same("PSA 10 Umbreon VMAX 215/203 Evolving Skies", "Umbreon VMAX 215/203 Evolving Skies", "a slab and its raw card");
  same("CGC 9.5 Charizard 4/102 Base Set", "Charizard 4/102 Base Set", "a half grade");
  same("Umbreon VMAX 215/203 Evolving Skies graded slab", "Umbreon VMAX 215/203 Evolving Skies", "a bare graded/slab");
  // PSA's own label wording, which the first cut missed: "GEM MINT 10" left
  // "GEM" (and, unsimplified, "MINT" and "10") in the required tokens, an
  // NM-MT 8 left a mangled "-MT", and a grader named with no number left the
  // company itself — each a word the right comp has no reason to contain.
  same("Umbreon VMAX 215/203 Evolving Skies PSA GEM MINT 10", "Umbreon VMAX 215/203 Evolving Skies", "PSA's label wording");
  same("PSA NM-MT 8 Charizard 4/102 Base Set", "Charizard 4/102 Base Set", "an NM-MT 8 label");
  same("PSA Graded Umbreon VMAX 215/203 Evolving Skies", "Umbreon VMAX 215/203 Evolving Skies", "a grader named with no number");

  const tok = tokensOf("PSA 10 Umbreon VMAX 215/203 Evolving Skies");
  const matches = (title, want, why) => {
    if (CompFinderPricing.nameTokensMatch(title, tok) !== want) {
      failed++;
      console.error(`FAIL  ${why}: want ${want ? "match" : "no match"}\n      ${title}`);
    }
  };
  matches("CGC 10 Umbreon VMAX 215/203 Evolving Skies", true, "a CGC slab of the same card");
  matches("PSA10 Umbreon VMAX 215/203 Evolving Skies", true, "a grade written without the space");
  // ...and the tokens must still do the job they were there for.
  matches("PSA 10 Charizard 4/102 Base Set", false, "a different card in a slab");

  // The two live false positives again, from this side: a grader word inside a
  // card's real NAME must survive, or the token set loses what identifies it.
  const ace = tokensOf("Master Ball Pattern ACE SPEC 153/191 Surging Sparks");
  if (!ace.includes("ACE") || !ace.includes("SPEC")) {
    failed++;
    console.error(`FAIL  ACE SPEC must stay in the name tokens, got ${JSON.stringify(ace)}`);
  }
  const tag = tokensOf("Reshiram & Charizard GX TAG TEAM 20/214 Unbroken Bonds");
  if (!tag.includes("TAG") || !tag.includes("TEAM")) {
    failed++;
    console.error(`FAIL  TAG TEAM must stay in the name tokens, got ${JSON.stringify(tag)}`);
  }
}

// --- is the card WE hold a slab ----------------------------------------------
// The highest-stakes question in the whole rule, and the one with the widest
// blast radius. A false positive on a COMP costs one comp out of forty and the
// median absorbs it. A false positive on the SUBJECT inverts the exclusion and
// throws away every comp that IS the card — the same shape of fault, from the
// opposite direction, as the one this whole change exists to fix.
//
// So the false negatives below are the important half: every one is a raw card
// whose own title says something about grading.
{
  const subject = (title, want, why) => {
    const got = CompFinderPricing.subjectGradeFrom(title);
    const isGraded = !!got;
    if (isGraded !== want) {
      failed++;
      console.error(`FAIL  subject ${why}: want ${want ? "slab" : "raw"}, got ${want ? "raw" : "slab"}\n      ${title}`);
    }
    return got;
  };

  subject("PSA 10 Umbreon VMAX (Alternate Art Secret) 215/203 Swsh07: Evolving Skies", true, "a slab");
  subject("Umbreon VMAX 215/203 Evolving Skies graded slab", true, "a slab with no readable grade");
  subject("Charizard 4/102 Base Set Holo NM", false, "a plain raw card");

  // A seller saying what the card ISN'T. "ungraded" never matched anything
  // (there is no word boundary in front of the "graded" inside it) but the
  // spaced and hyphenated forms do, and "raw" is how half of them are written.
  subject("Charizard 4/102 Base Set - not graded, raw", false, "a title saying NOT graded");
  subject("Charizard 4/102 Base Set NON-GRADED", false, "a hyphenated non-graded");
  subject("Charizard 4/102 Base Set ungraded", false, "an ungraded card");
  subject("Charizard 4/102 Base Set raw copy", false, "a card described as raw");

  // The two live false positives the comp-side pattern was already built to
  // dodge, re-pinned here because the subject test now rides on it and the
  // cost of getting them wrong is no longer one comp.
  subject("Master Ball Pattern ACE SPEC 153/191 Surging Sparks", false, "an ACE SPEC card, not an ACE grade");
  subject("Reshiram & Charizard GX TAG TEAM 20/214 Unbroken Bonds", false, "a TAG TEAM card, not a TAG grade");
  subject("Charizard VMAX 074/073 Champion's Path Secret Rare - pristine condition", false, "pristine condition, not PRISTINE 10");

  // The grade itself, since it is what splits the comps.
  const half = subject("CGC 9.5 Pikachu 58/102 Base Set", true, "a half grade");
  if (!half || half.grade !== 9.5 || half.company !== "CGC") {
    failed++;
    console.error(`FAIL  subject half grade: want CGC 9.5, got ${JSON.stringify(half)}`);
  }

  // The wording PSA itself prints on the flip, which the first version read
  // as raw: "GEM MINT" (and "NM-MT", and our own stripWords' leftover
  // "GEM") may sit between the company and the number.
  const label = subject("Charizard VMAX 074/073 Champion's Path PSA GEM MINT 10", true, "a slab written the way PSA writes it");
  if (!label || label.grade !== 10 || label.company !== "PSA") {
    failed++;
    console.error(`FAIL  subject label wording: want PSA 10, got ${JSON.stringify(label)}`);
  }
  // ...and only between a COMPANY and the number. "Mint 9/10" is seller talk
  // about a raw card, and "tag"/"ace" keep requiring the digit directly —
  // the same reasoning that kept bare "ace" out of the keyword list.
  subject("Umbreon VMAX 215/203 Evolving Skies Gem Mint 10/10 Pack Fresh", false, "gem mint with no company named");
  subject("Reshiram & Charizard GX TAG TEAM 20/214 Mint 9/10 condition", false, "a raw TAG TEAM in mint-9/10 seller talk");
  subject("Portgas D Ace Mint 9/10 One Piece OP02 Alt Art", false, "One Piece's Ace beside condition talk");
}

// --- the card being priced is ITSELF a slab ----------------------------------
// The rule that shipped the £2.49 PSA 10. Every comp below is a title from the
// same search; what changes between the two halves is only WHICH CARD WE HOLD,
// and the exclusion has to invert on that alone. The pairs are the point: the
// same title is evidence in one column and contamination in the other, and a
// rule that reads only the comp can never get both right.
{
  const SUBJECT = "PSA 10 Umbreon VMAX (Alternate Art Secret) 215/203 Swsh07: Evolving Skies";
  const graded = { ...DEFAULT_SETTINGS, subjectGrade: CompFinderPricing.subjectGradeFrom(SUBJECT) };
  const check = (title, settings, want, label) => {
    const rec = recommend([{ title, itemPricePence: 5000, postagePence: 0 }], settings, null, "sold", null, null);
    const got = (rec.excluded || [])[0]?.exclusionReason ?? null;
    if (got !== want) {
      failed++;
      console.error(`FAIL  ${label}: want ${String(want)}, got ${String(got)}\n      ${title}`);
    }
  };

  const SLAB_SAME_GRADE = "PSA 10 Umbreon VMAX Alt Art 215/203 Evolving Skies";
  const SLAB_OTHER_COMPANY = "CGC 10 Umbreon VMAX 215/203 Evolving Skies";
  const SLAB_OTHER_GRADE = "PSA 9 Umbreon VMAX 215/203 Evolving Skies";
  const RAW = "Umbreon VMAX 215/203 Evolving Skies Secret Rare Holo NM";
  const SLAB_NO_GRADE = "Umbreon VMAX 215/203 Evolving Skies graded slab";

  // Holding a raw card: unchanged from the day the graded rule was written.
  check(SLAB_SAME_GRADE, DEFAULT_SETTINGS, "graded", "raw subject still drops slabs");
  check(SLAB_OTHER_GRADE, DEFAULT_SETTINGS, "graded", "raw subject still drops other grades");
  check(RAW, DEFAULT_SETTINGS, null, "raw subject keeps raw comps");

  // Holding the slab: the same five titles, read the other way round.
  check(SLAB_SAME_GRADE, graded, null, "slab subject keeps its own grade");
  check(RAW, graded, "rawCopy", "slab subject drops raw copies");
  check(SLAB_OTHER_GRADE, graded, "otherGrade", "slab subject drops a different grade");
  // Companies are pooled and grades are not — the gap between PSA and CGC is
  // nothing like the gap between a 10 and a 9, and splitting on both empties
  // most pools. Pinned because it is a judgement call, not an accident.
  check(SLAB_OTHER_COMPANY, graded, null, "slab subject pools companies at the same grade");
  // A slab whose grade cannot be read is a wide answer, not a wrong one.
  check(SLAB_NO_GRADE, graded, null, "slab subject keeps an unreadable grade");
  // PSA's label wording, both ways round. Before the pattern learned it,
  // this title was "rawCopy" while holding the slab — the best comp on the
  // search, excluded for being written the way PSA writes it.
  const SLAB_LABEL = "Umbreon VMAX Alt Art 215/203 Evolving Skies PSA GEM MINT 10";
  check(SLAB_LABEL, DEFAULT_SETTINGS, "graded", "raw subject drops PSA's label wording");
  check(SLAB_LABEL, graded, null, "slab subject keeps PSA's label wording");
  check("Umbreon VMAX 215/203 Evolving Skies PSA MINT 9", graded, "otherGrade", "label wording still splits the grades");
  // Companyless "gem mint" is a raw card being praised, not a slab.
  check("Umbreon VMAX 215/203 Evolving Skies Gem Mint 10/10 Pack Fresh", graded, "rawCopy", "gem mint alone is still a raw copy");
  // Everything else still applies on top: a slab in a display case is still
  // not a card, and a different card is still a different card.
  check("PSA 10 Umbreon VMAX 215/203 Evolving Skies display case", graded, "notACard", "slab subject still drops non-cards");

  // ...and the keyword group. This is the one that undid the whole fix in an
  // earlier draft: settings.excludeKeywords carries its own "psa"/"slab" list,
  // which re-excluded every slab one line after the pattern had let it through
  // and left the card priced from nothing at all.
  const kept = recommend(
    [{ title: SLAB_SAME_GRADE, itemPricePence: 84000, postagePence: 0 }],
    graded, null, "sold", null, null
  );
  if ((kept.included || []).length !== 1) {
    failed++;
    console.error("FAIL  the graded KEYWORD list must stand down too, not just the pattern");
  }

  // The £2.49 itself, end to end: the pool that shipped, priced both ways.
  const POOL = [
    { title: SLAB_SAME_GRADE, itemPricePence: 84000, postagePence: 0 },
    { title: "PSA 10 Umbreon VMAX Alternate Art 215/203", itemPricePence: 91000, postagePence: 0 },
    { title: SLAB_OTHER_COMPANY, itemPricePence: 79000, postagePence: 0 },
    { title: SLAB_OTHER_GRADE, itemPricePence: 62000, postagePence: 0 },
    { title: "Umbreon VMAX 215/203 Evolving Skies proxy custom card", itemPricePence: 199, postagePence: 50 },
    { title: RAW, itemPricePence: 250, postagePence: 0 }
  ];
  const asSlab = recommend(POOL, graded, ["umbreon"], "sold", "215/203", null);
  if (!(asSlab.rawPence > 50000)) {
    failed++;
    console.error(`FAIL  the PSA 10 must price off its own slabs, got ${asSlab.rawPence}`);
  }
  if (!/[Gg]raded card/.test(asSlab.note || "")) {
    failed++;
    console.error("FAIL  a graded price must say on the row that it is one");
  }

  // Too few slabs at our grade is NO price — never a quiet fall back to the
  // raw copies, which is the exact shape of the original fault.
  const thin = recommend(POOL.filter((c) => !/PSA 10|CGC 10/.test(c.title)), graded, ["umbreon"], "sold", "215/203", null);
  if (thin.rawPence !== null || !thin.priceHeld) {
    failed++;
    console.error(`FAIL  a thin slab pool must hold, got ${thin.rawPence}`);
  }
  // The tiers still travel, so the screen can show what WAS found.
  if (!(thin.graded || []).length) {
    failed++;
    console.error("FAIL  a held slab must still hand back the graded tiers it found");
  }
}

if (failed) {
  console.error(`\n${failed} exclusion checks failed.`);
  process.exit(1);
}
console.log(`exclusions: ${CASES.length + NUMBERED_CASES.length} titles + postage, low-outlier, foreign-print and graded-subject cases pass.`);
