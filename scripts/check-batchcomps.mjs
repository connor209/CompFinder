/**
 * Pricing a batch in one call: /api/batch-comps and the rules behind it.
 *
 *   node scripts/check-batchcomps.mjs      (or: npm run check)
 *
 * Built around the card that prompted it. Riolu BW33 Cosmos Holo, a £50 card,
 * went out at £2.49, and testing found three faults stacked:
 *
 * 1. the catalogue numbered it "BW33/101", and that search finds nothing;
 * 2. nothing could say "Cosmos Holo", so a variant priced as the base card
 *    and a base card pooled the variant's sales;
 * 3. every honest title says "Black Star Promo", and the engine drops any
 *    comp saying "promo" — eleven UK sales listed, one counted.
 *
 * The comps below are written the way sellers write them. They are fixtures,
 * not a corpus: the live acceptance figures (~11 comps / ~£49.99 for Riolu,
 * ~29 / ~£12.49 for Numel) can only be confirmed against SoldComps.
 */
import { readFileSync } from "node:fs";
import { isPromoCard, promoNumber, textLooksPromo } from "../apps/app/lib/promo.js";
import { compVariants, detectVariants, nameWithoutVariants, variantExclusion } from "../apps/app/lib/variants.js";
import { housePrice, percentileOf, resolveRules, roundUpToLadder, rulesForGame, gameCode, decide, spreadTooWide, HOUSE_RULES } from "../apps/app/lib/house-pricing.js";
import { cardsFromCsv, distinctiveSetWords, coreNameOf, engineTitle, evaluateCard, languageMarker, parseJpPromo, searchLadder, listsOtherCards, normaliseCard, planCard, priceDiffers, resultsCsv, unpricedSkus } from "../apps/app/lib/batch-comps.js";
import { settingsForText } from "../apps/app/lib/matching.js";
import { canPriceHouse, houseCardFor, recFromHouse, houseConfidence } from "../apps/app/lib/house-rec.js";
import { slimRec } from "../apps/app/lib/batch-store.js";

let failed = 0;
const fail = (m) => { failed++; console.error("FAIL", m); };
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fail(`${label}\n   got  ${g}\n   want ${w}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

let seq = 0;
const comp = (title, pounds, postage = 0, { loc = null, daysAgo = 5 } = {}) => ({
  title,
  itemPricePence: Math.round(pounds * 100),
  postagePence: Math.round(postage * 100),
  itemLocation: loc,
  _source: { itemId: `i${++seq}`, url: `https://www.ebay.co.uk/itm/${seq}`, endedAt: new Date(Date.now() - daysAgo * 864e5).toISOString() }
});

// --- 1. promo numbers ------------------------------------------------------

eq("a promo's set total comes off", promoNumber("BW33/101"), "BW33");
eq("spaced and lower-case", promoNumber("swsh 123"), "SWSH123");
eq("SVP keeps its padding as printed", promoNumber("SVP045"), "SVP045");
eq("a main-set number is untouched", promoNumber("013/078"), "013/078");
eq("Shiny Vault SV49/SV94 is NOT a promo", promoNumber("SV49/SV94"), "SV49/SV94");
ok("BW33 is a promo", isPromoCard({ number: "BW33" }));
ok("a promo set is a promo", isPromoCard({ number: "45", set: "SWSH Black Star Promos" }));
ok("013/078 Pokémon GO is not", !isPromoCard({ number: "013/078", set: "Pokémon GO" }));
ok("Hidden Fates SV49 is not", !isPromoCard({ number: "SV49", set: "Hidden Fates" }));
ok("a promo code in text reads as promo", textLooksPromo("Riolu BW33 Cosmos Holo"));
ok("a main-set title does not", !textLooksPromo("Charizard 4/102 Base Set Holo"));
ok("nor does a Shiny Vault one", !textLooksPromo("Charizard GX SV49/SV94 Hidden Fates"));

// The engine's blanket "promo" exclusion stands down for a promo — and only
// the blanket word: a league or prerelease promo is still another card.
const promoSettings = settingsForText("Riolu BW33", { promo: true });
ok("promo stood down for a promo", !promoSettings.excludeKeywords.promoVariant.includes("promo"));
ok("league still excluded for a promo", promoSettings.excludeKeywords.promoVariant.includes("league"));
ok("promo still excluded for a main-set card", settingsForText("Charizard 4/102").excludeKeywords.promoVariant.includes("promo"));
ok("and inferred off the text when not passed", !settingsForText("Riolu BW33 Black Star Promo").excludeKeywords.promoVariant.includes("promo"));

// --- 2. variants -------------------------------------------------------------

eq("Cosmos from the name's brackets", detectVariants({ name: "Riolu (Cosmos Holo)" }).keys, ["cosmos"]);
eq("Holofoil in the variant column is the base card", detectVariants({ name: "Riolu", variant: "Holofoil" }), { keys: [], unrecognised: [] });
eq("Reverse Holofoil column", detectVariants({ name: "Emboar", variant: "Reverse Holofoil" }).keys, ["reverse"]);
eq("a McDonald's set makes a McDonald's card", detectVariants({ name: "Pikachu", set: "McDonald's Collection 2021" }).keys, ["mcdonalds"]);
eq("Unown (E) is a name, not a variant", detectVariants({ name: "Unown (E)" }), { keys: [], unrecognised: [] });
eq("an unknown variant is reported, not guessed", detectVariants({ name: "Mew", variant: "Galaxy Foil" }).unrecognised, ["Galaxy Foil"]);
eq("variant words come off the name", nameWithoutVariants("Riolu (Cosmos Holo)"), "Riolu");
eq("Peelable Ditto", detectVariants({ name: "Numel (Peelable Ditto)" }).keys, ["ditto"]);

// Comp side. The false positives matter more than the true ones.
eq("1st Class postage is not 1st Edition", compVariants("Charizard 4/102 Base Set Free 1st Class Postage"), []);
eq("'not 1st edition' is not 1st Edition", compVariants("Machamp 8/102 not 1st edition unlimited"), []);
eq("'unstamped' is not stamped", compVariants("Shedinja 14/107 unstamped"), []);
eq("stamped addressed envelope is postage", compVariants("Pikachu 25/102 sent with stamped addressed envelope"), []);
eq("Cosmog is not Cosmos", compVariants("Cosmog 41/236 Cosmic Eclipse"), []);
eq("1st Edition", compVariants("Charizard 4/102 1st Edition Base Set"), ["firstEdition"]);
eq("Cracked Ice", compVariants("Mewtwo Cracked Ice Holo Prize Pack"), ["crackedIce", "prizePack"]);

eq("a base card drops the Cosmos sale", variantExclusion("Riolu BW33 Cosmos Holo Black Star Promo", []), { reason: "wrongVariant", variant: "cosmos" });
eq("a Cosmos card drops the plain one", variantExclusion("Riolu BW33 Black Star Promo", ["cosmos"]), { reason: "missingVariant", variant: "cosmos" });
eq("a Cosmos card keeps a Cosmos sale", variantExclusion("Riolu BW33 Cosmos Holo", ["cosmos"]), null);
eq("reverse is left to the engine", variantExclusion("Emboar 33/236 Reverse Holo", []), null);
eq("pricing Ditto itself, 'Ditto' in a title is the name", variantExclusion("Ditto 132/165 151 holo", [], "Ditto"), null);

// --- 3. house pricing --------------------------------------------------------

eq("p40 interpolates", percentileOf([100, 200, 300, 400, 500, 600], 40), 300);
eq("up to the next .49", roundUpToLadder(1201), 1249);
eq("up to the next .99", roundUpToLadder(1250), 1299);
eq("a rung stays a rung", roundUpToLadder(1249), 1249);
eq("the floor", roundUpToLadder(50), 249);
const totalsOf = (list) => list.map(([p, s]) => comp("x", p, s));
// Postage capped at £4.00 (CardCropper's standard, 2026-11-24): a £3.50 card
// with £6.95 postage totals £7.50, and £3.95 postage counts in full.
eq("postage cap", housePrice(totalsOf([[3.5, 6.95]])).totals, [750]);
eq("postage under the cap counts in full", housePrice(totalsOf([[3.5, 3.95]])).totals, [745]);
eq("the cap is £4.00", HOUSE_RULES.postageCapPence, 400);
eq("under 4 comps, the lowest", housePrice(totalsOf([[20, 0], [30, 0], [40, 0]])).method, "lowest");
eq("…priced at it", housePrice(totalsOf([[20, 0], [30, 0], [40, 0]])).suggestedPence, 2049);
const four = totalsOf([[10, 0], [12, 0], [14, 0], [30, 0]]);
eq("4+ comps: p40 of totals", housePrice(four).basisPence, 1240);
eq("NM is LP", housePrice(four, "NM").suggestedPence, housePrice(four, "LP").suggestedPence);
eq("MP is 0.85 of the LP price once it is £5+", housePrice(four, "MP").suggestedPence, roundUpToLadder(1249 * 0.85));
eq("MP under a £5 LP price sells as LP", housePrice(totalsOf([[3, 0]]), "MP").suggestedPence, 349);
eq("HP 0.6", housePrice(four, "HP").suggestedPence, roundUpToLadder(1249 * 0.6));
eq("DMG 0.4 still floored", housePrice(totalsOf([[3, 0]]), "DMG").suggestedPence, 249);
eq("rules are configurable", resolveRules({ percentile: 50, postageCapPence: 0 }).percentile, 50);
eq("nonsense is refused, not used", resolveRules({ percentile: "lots", floorPence: -5 }).floorPence, HOUSE_RULES.floorPence);

// --- 4. the acceptance cards, end to end over fixtures ------------------------

const rioluComps = [
  comp("Pokemon Riolu BW33 Cosmos Holo Black Star Promo NM", 45, 1.2),
  comp("Riolu BW33 Black Star Promo Cosmos Holo", 52),
  comp("Riolu BW 33 Cosmos holo promo card", 18, 1),
  comp("Riolu Cosmos Holo BW33 Promo LP", 49.99, 0.99),
  comp("Riolu BW33 Cosmos Holo Promo Pokemon Card", 55),
  comp("Riolu BW33 Cosmos Holo", 105),
  comp("Riolu - BW33 - Cosmos Holo Promo", 47),
  comp("Riolu BW33 Black Star Promo Holo", 3, 1),             // the plain promo
  comp("Riolu BW33 Black Star Promo", 2.5, 1),
  comp("Riolu 61/124 Fates Collide Cosmos", 2, 1),            // a main-set Riolu
  comp("Riolu BW33 Cosmos Holo PSA 9", 90),                   // a slab
  comp("Riolu BW33 Cosmos Holo promo", 60, 0, { loc: "US" })  // not a UK sale
];

const cosmos = planCard(normaliseCard({
  sku: "JZ10", name: "Riolu (Cosmos Holo)", number: "BW33/101", set: "Black and White Promos", variant: "Holofoil", condition: "NM"
}));
eq("Cosmos query: no denominator, no promo set name", cosmos.queries, ["Riolu Cosmos Holo BW33"]);
const cr = evaluateCard(cosmos, rioluComps);
eq("Cosmos keeps every UK Cosmos sale", cr.n_comps, 7);
ok("…none of them the plain promo", cr.sales.every((s) => /cosmos/i.test(s.title)));
ok("…and the promo word cost nothing", !cr.excluded.some((e) => e.reason === "promoVariant"));
eq("the plain promo goes as missingVariant", cr.excluded.filter((e) => e.reason === "missingVariant").length, 2);
eq("the main-set Riolu goes as wrongNumber", cr.excluded.filter((e) => e.reason === "wrongNumber").length, 1);
ok("the slab goes as graded", cr.excluded.some((e) => e.reason === "graded"));
ok("the US sale goes as non-UK", cr.excluded.some((e) => e.reason === "nonUkLocation"));
eq("worldwide counts the US sale back in", cr.worldwide_comps, 8);
ok("a Cosmos price, not a £2.49 one", cr.suggested_price > 40);
eq("matched", cr.matched.variant, "Cosmos Holo");

const plainRiolu = planCard(normaliseCard({ sku: "JZ11", name: "Riolu", number: "BW33", set: "Black and White Promos", condition: "NM" }));
const pr = evaluateCard(plainRiolu, rioluComps);
ok("the plain Riolu includes no Cosmos sale", pr.sales.every((s) => !/cosmos/i.test(s.title)));
eq("…and keeps both plain promos", pr.n_comps, 2);
ok("few_comps on 2", pr.flags.few_comps);
ok("variant_uncertain: most of its search was a variant", pr.flags.variant_uncertain);
eq("under 4 comps it takes the lowest (£2.50 + £1 = £3.50, up to £3.99)", pr.suggested_price, 3.99);

// A modern reverse holo must not mix in plain copies.
const emboarComps = [
  comp("Emboar 33/236 Reverse Holo Cosmic Eclipse NM", 0.99, 0.85),
  comp("Pokemon Emboar 33/236 Rev Holo", 1.2, 0.85),
  comp("Emboar 033/236 Cosmic Eclipse Reverse Foil", 1.5, 0.85),
  comp("Emboar 33/236 Reverse Holo", 1.1, 0.85),
  comp("Emboar 33/236 Cosmic Eclipse Holo Rare", 0.6, 0.85),
  comp("Emboar 33/236 Cosmic Eclipse", 0.5, 0.85)
];
const emboar = planCard(normaliseCard({ name: "Emboar", number: "33/236", set: "Cosmic Eclipse", variant: "Reverse Holofoil" }));
const er = evaluateCard(emboar, emboarComps);
eq("reverse holo keeps only reverses", er.n_comps, 4);
ok("…no plain copy in it", er.sales.every((s) => /rev/i.test(s.title)));

// Numel 013/078 Peelable Ditto: the Ditto copies only.
const numel = planCard(normaliseCard({ name: "Numel (Peelable Ditto)", number: "013/078", set: "Pokémon GO" }));
eq("Numel query", numel.queries[0], "Numel Ditto 013/078 Pokemon GO");
const nr = evaluateCard(numel, [
  comp("Numel 013/078 Pokemon GO Peelable Ditto", 11, 1.5),
  comp("Numel Ditto 013/078 Pokemon Go Holo", 12.5, 0.99),
  comp("Pokemon GO Numel 013/078 Ditto sticker", 10, 2.5),
  comp("Numel 013/078 Pokemon GO Peel Ditto NM", 13),
  comp("Numel 013/078 Pokemon GO", 0.5, 0.85)
]);
eq("Numel keeps the Ditto copies", nr.n_comps, 4);


// --- 4b. CardCropper's rules, ported 2026-11-24 ---------------------------------

// Floors by game.
eq("game codes", ["Pokémon", "Yu-Gi-Oh!", "Magic: The Gathering", "YGO", "", "Lorcana"].map(gameCode), ["pokemon", "yugioh", "mtg", "yugioh", "", ""]);
eq("a Yu-Gi-Oh floor", housePrice(totalsOf([[0.5, 0]]), "NM", rulesForGame(resolveRules(), "yugioh")).suggestedPence, 199);
eq("a Magic floor", housePrice(totalsOf([[0.5, 0]]), "NM", rulesForGame(resolveRules(), "mtg")).suggestedPence, 99);
eq("an unnamed game is Pokémon's floor", housePrice(totalsOf([[0.5, 0]]), "NM", rulesForGame(resolveRules(), "")).suggestedPence, 249);
eq("the ladder steps off the game's floor", roundUpToLadder(210, rulesForGame(resolveRules(), "yugioh")), 249);

// Lots that only LIST their cards.
const fearow = planCard(normaliseCard({ name: "Fearow", number: "36/100", set: "Majestic Dawn" }));
ok("the Fearow list is a lot", listsOtherCards(fearow, "Fearow, Cacturne, Cradily Majestic Dawn Pokemon"));
ok("…& is a list", listsOtherCards(fearow, "Fearow & Pidgeot Pokemon cards"));
ok("…'and' is a list", listsOtherCards(fearow, "Fearow and Spearow Majestic Dawn"));
ok("a title with the card's number is the card", !listsOtherCards(fearow, "Fearow 36/100, Majestic Dawn, NM"));
ok("…zero-padded too", !listsOtherCards(fearow, "Fearow 036/100 Majestic Dawn & more"));
ok("a plain title is not a list", !listsOtherCards(fearow, "Fearow Majestic Dawn Pokemon Card Uncommon"));
const tag = planCard(normaliseCard({ name: "Pikachu & Zekrom GX", number: "33/181", set: "Team Up" }));
ok("a tag team's own & is not a list", !listsOtherCards(tag, "Pikachu & Zekrom GX Team Up Pokemon"));
const bw = planCard(normaliseCard({ name: "Riolu", number: "BW33", set: "Black and White Promos" }));
ok("'Black and White' is a set, not a list", !listsOtherCards(bw, "Riolu Black and White Promo Holo"));
ok("'Sun & Moon' is an era, not a list", !listsOtherCards(fearow, "Fearow Sun & Moon era Pokemon"));
ok("a card with no number is never judged a list", !listsOtherCards(planCard(normaliseCard({ name: "Fearow" })), "Fearow, Pidgeot"));
const fr = evaluateCard(fearow, [
  comp("Fearow 36/100 Majestic Dawn", 2, 1), comp("Fearow 36/100 Majestic Dawn NM", 2.2, 1),
  comp("Fearow Majestic Dawn 36/100 Uncommon", 1.8, 1), comp("Fearow, Cacturne, Cradily Majestic Dawn", 22.41, 1)
]);
ok("the listed lot never reaches the price", fr.sales.every((x) => x.price < 20));
ok("…and goes as a multi-card lot, saying why", fr.excluded.some((e) => e.reason === "multiCardLot" && e.detail === "lists other cards"));

// High postage is put back: the total caps it.
const pb = evaluateCard(fearow, [
  ...[10, 10.5, 11, 11.5, 12, 12.5, 13].map((p) => comp("Fearow 36/100 Majestic Dawn", p, 1)),
  comp("Fearow 36/100 Majestic Dawn", 16, 12) // £12 postage: the engine's highPostage
]);
ok("a sale left out only for postage counts", pb.sales.some((x) => x.put_back));
ok("…not as excluded", !pb.excluded.some((e) => e.reason === "highPostage"));
ok("…flagged put_back", pb.flags.put_back);
ok("…with its total capped at £4 of postage", pb.sales.find((x) => x.put_back)?.total === 20);

// Any language.
const jp = planCard(normaliseCard({ name: "Pikachu", number: "25/102", set: "Base Set" }));
const anyL = planCard(normaliseCard({ name: "Pikachu", number: "25/102", set: "Base Set", any_language: true }));
ok("an English card leaves foreign prints out", "foreignPrint" in jp.settings.excludeKeywords);
ok("any language counts them", !("foreignPrint" in anyL.settings.excludeKeywords));
eq("…and searches as the English card", anyL.queries[0], jp.queries[0]);
ok("'All languages' reads as any", normaliseCard({ name: "x", language: "All languages" }).anyLanguage);
const japanese = planCard(normaliseCard({ name: "Pikachu", number: "25/102", set: "Base Set", language: "Japanese" }));
ok("a Japanese card searches as Japanese", /Japanese/.test(japanese.queries[0]));

// The decision.
eq("a rise on 2 sales goes to a person", decide({ nSales: 2, totals: [500, 600], suggestedPence: 599, currentPence: 249 }).decision, "terapeak");
eq("2 sales, not a rise, applies", decide({ nSales: 2, totals: [200, 220], suggestedPence: 249, currentPence: 349 }).decision, "apply");
eq("a new card on 2 sales applies (nothing to rise from)", decide({ nSales: 2, totals: [500, 600], suggestedPence: 549 }).decision, "apply");
eq("a big rise", decide({ nSales: 6, totals: [900, 950, 1000, 1000, 1100, 1200], suggestedPence: 999, currentPence: 299 }).decision, "terapeak");
ok("…flagged", decide({ nSales: 6, totals: [900, 950, 1000, 1000, 1100, 1200], suggestedPence: 999, currentPence: 299 }).flags.includes("big_rise"));
eq("under double is not a big rise", decide({ nSales: 6, totals: [430, 440, 450, 460, 470, 480], suggestedPence: 449, currentPence: 249 }).decision, "apply");
eq("double but under £2 of difference is not either", decide({ nSales: 6, totals: [200, 210, 220, 230, 240, 250], suggestedPence: 249, currentPence: 99 }).decision, "apply");
eq("a big drop", decide({ nSales: 6, totals: [200, 210, 220, 230, 240, 250], suggestedPence: 249, currentPence: 1299 }).decision, "terapeak");
ok("wide spread is p90/p10 over 3", spreadTooWide([100, 120, 130, 140, 900, 1000]) && !spreadTooWide([100, 120, 130, 140, 200, 250]));
eq("…and goes to a person", decide({ nSales: 6, totals: [100, 120, 130, 140, 900, 1000], suggestedPence: 249 }).decision, "terapeak");
eq("no sales, no price → Terapeak", decide({ nSales: 0, totals: [], suggestedPence: null }).decision, "terapeak");
eq("no sales, a price already → keep it", decide({ nSales: 0, totals: [], suggestedPence: null, currentPence: 499 }).decision, "keep");
eq("a failed lookup holds", decide({ status: "timeout" }).decision, "hold");
ok("NM at £15+ is checked in hand", decide({ nSales: 8, totals: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500], suggestedPence: 1549, condition: "NM" }).flags.includes("in_hand_check"));
ok("…LP is not", !decide({ nSales: 8, totals: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500], suggestedPence: 1549, condition: "LP" }).flags.includes("in_hand_check"));
eq("a result carries its decision", typeof fr.decision, "string");
eq("…and its floor", fr.floor_price, 2.49);

// --- 4c. Cardmarket's bracketed printings (TEST3, 2026-11-24) ------------------
// "(Master Ball Pattern)" made Master, Ball AND Pattern required words, so a
// sale titled "Geodude Master Ball Holo 074/165" never counted.
const geo = planCard(normaliseCard({ name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151", language: "Japanese" }));
eq("a pattern is a variant, not name words", [geo.variantKeys, geo.nameTokens], [["masterBall"], ["Geodude"]]);
eq("…and the search asks for it — without Cardmarket's Japanese set name, one search", geo.queries, ["Geodude Master Ball 074/165 Japanese"]);
// The five UK sales eBay shows for it (2026-11-24): every one has every word.
const words = geo.queries[0].toLowerCase().split(" ");
eq("every UK sale of it matches the search", [
  "Geodude 074/165 Master Ball - 151 sv2a Japanese Mint - Pokémon Card Game",
  "Geodude Master Ball 074/165 sv2a Japanese Mint Condition Pokemon TCG Card",
  "2023 Japanese Pokemon SV2a 151 Geodude Master Ball Reverse Holo 074/165",
  "Geodude 074/165 Master Ball 2023 Pokemon - Japanese Scarlet & Violet 151 - MINT"
].filter((t) => words.every((w) => t.toLowerCase().includes(w))).length, 4);
eq("an English card still searches with its set", planCard(normaliseCard({ name: "Geodude", number: "074/165", set: "151" })).queries[0], "Geodude 074/165 151");
const gr = evaluateCard(geo, [
  comp("Geodude (Master Ball Pattern) 074/165 SV2a Pokemon Card 151 Holo Japanese", 6),
  comp("Geodude Master Ball Holo 074/165 Japanese 151", 7),
  comp("Geodude Masterball reverse 074/165 sv2a", 8),
  comp("Geodude 074/165 Pokemon Card 151 Japanese", 0.2)
]);
eq("every way of writing it counts; the plain copy doesn't", gr.n_comps, 3);
ok("…'reverse' on a pattern sale is this card, and it keeps its own title", gr.sales.some((x) => x.title === "Geodude Masterball reverse 074/165 sv2a"));
ok("…which goes as missingVariant", gr.excluded.some((e) => e.reason === "missingVariant"));
const plainGeo = evaluateCard(planCard(normaliseCard({ name: "Geodude", number: "074/165", set: "Pokemon Card 151", language: "Japanese" })), [
  comp("Geodude Master Ball Holo 074/165 Japanese", 7), comp("Geodude Poke Ball 074/165 Japanese", 1.5), comp("Geodude 074/165 Japanese", 0.2)
]);
eq("a plain card drops both patterns", plainGeo.n_comps, 1);
eq("Poke Ball pattern", planCard(normaliseCard({ name: "Machamp (Poke Ball Pattern)", number: "068/165" })).variantKeys, ["pokeBall"]);
eq("Energy symbol pattern", planCard(normaliseCard({ name: "Team Rocket's Tarountula (Energy Symbol Pattern)", number: "015/193" })).variantKeys, ["energyPattern"]);
ok("…but an energy card's 'Reverse Holo' is not an energy pattern", !compVariants("Lightning Energy Reverse Holo 091/091").includes("energyPattern"));
const ball = planCard(normaliseCard({ name: "Master Ball", number: "153/165", set: "151" }));
eq("the Master Ball TRAINER is not a pattern card", ball.variantKeys, []);
eq("…and its own sales count", evaluateCard(ball, [comp("Master Ball 153/165 151 Trainer", 1), comp("Master Ball 153/165 Pokemon", 1.2)]).n_comps, 2);
const lum = planCard(normaliseCard({ name: "Luminous Energy (Mirror Holofoil)", number: "190/190", set: "Shiny Treasure ex", language: "Japanese" }));
eq("mirror is recognised but soft: no name word, no query word", [lum.variantKeys, lum.nameTokens, lum.queries[0]], [["mirror"], ["Luminous", "Energy"], "Luminous Energy 190/190 Japanese"]);
eq("…and a sale need not say mirror", evaluateCard(lum, [comp("Luminous Energy 190/190 Shiny Treasure ex Japanese", 2), comp("Luminous Energy Mirror Holo 190/190 sv4a", 2.5)]).n_comps, 2);
eq("an unplaced bracket is never a required word", planCard(normaliseCard({ name: "Pikachu (Rainbow Swirl Foil)", number: "025/165" })).nameTokens, ["Pikachu"]);
eq("…but Unown keeps its letter", planCard(normaliseCard({ name: "Unown (E)", number: "E/28" })).baseName, "Unown (E)");

// --- 4d. the full search ladder (depth 3) -----------------------------------------
const geoJ = planCard(normaliseCard({ name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151", language: "Japanese" }));
eq("the ladder for a Japanese pattern card, every rung different", geoJ.ladder.map((r) => r.query), [
  "Geodude Master Ball 074/165 Japanese", "Geodude 074/165 Japanese", "Geodude Master Ball 74/165 Japanese",
  "Geodude Master Ball 074 Japanese", "Geodude Master Ball 074/165 sv2a", "Geodude Master Ball 074/165"
]);
eq("Cardmarket's Japanese set name gives the printed code", geoJ.setCode, "sv2a");
eq("an English card's ladder keeps its set first and never drops a language word", planCard(normaliseCard({ name: "Emboar", number: "33/236", set: "Cosmic Eclipse", variant: "Reverse Holofoil" })).ladder.map((r) => r.rung), ["exact", "noset", "noprinting", "numerator"]);
eq("a promo is its code, asked two ways", planCard(normaliseCard({ name: "Riolu (Cosmos Holo)", number: "BW33/101", set: "Black and White Promos" })).ladder.map((r) => r.query), ["Riolu Cosmos Holo BW33", "Riolu BW33"]);
eq("a card with nothing to vary is one search", searchLadder({ baseName: "Pikachu", number: "" }).length, 1);
eq("a numberless card asks with its set", planCard(normaliseCard({ name: "Lightning Energy", set: "25th Anniversary Golden Box", language: "Japanese" })).ladder.map((r) => r.rung), ["exact", "nolanguage", "withset"]);
// The widest rungs return the English copy that shares the number: a
// Japanese card only counts a sale that says it is Japanese, one way or another.
const jm = languageMarker("Japanese", "Pokemon Card 151", "sv2a");
eq("what says Japanese", [
  "Geodude Master Ball 074/165 Japanese", "Geodude 074/165 JPN", "Geodude Master Ball 074/165 sv2a",
  "Geodude (Master Ball Pattern) 074/165 Common - SV2a: Pokemon Card 151", "イシツブテ 074/165", "Geodude 074/165 Scarlet & Violet 151 English"
].map((t) => jm.test(t)), [true, true, true, true, true, false]);
const mixed = evaluateCard(geoJ, [
  comp("Geodude Master Ball 074/165 Japanese", 6), comp("Geodude Master Ball Reverse 74/165 sv2a", 7),
  comp("Geodude 074/165 Master Ball Reverse Holo 151 Prismatic", 9)
]);
eq("an English-looking sale of the same number is left out, saying why", [mixed.n_comps, mixed.excluded.map((e) => e.reason)], [2, ["notThisLanguage"]]);
ok("any-language stands the language rule down", planCard(normaliseCard({ name: "Geodude", number: "074/165", language: "Japanese", any_language: true })).languageMarker === null);
ok("an English card has no language rule", planCard(normaliseCard({ name: "Geodude", number: "074/165" })).languageMarker === null);
// The route's fields-form pricing lives in lib/batch-price-core.js, shared with
// the pricing queue's worker — read both as "the route".
const routeSrc = readFileSync(new URL("../apps/app/app/api/batch-comps/route.js", import.meta.url), "utf8")
  + readFileSync(new URL("../apps/app/lib/batch-price-core.js", import.meta.url), "utf8");
ok("depth 3 runs the ladder and reports each rung", /depth === 3/.test(routeSrc) && /plan\.ladder/.test(routeSrc) && /search \}/.test(routeSrc));

// --- 4e. where the TEST3 batch fell apart (2026-11-24) ------------------------------
const run = (card, titles) => evaluateCard(planCard(normaliseCard({ ...card, language: "Japanese" })), titles.map(([t, p]) => comp(t, p, 1)));
const dar = planCard(normaliseCard({ name: "Basic Darkness Energy", number: "DAR", set: "Sun & Moon Era Unnumbered Energies", language: "Japanese" }));
eq("'DAR' is Cardmarket's code, not a number: no number, no required word", [dar.number, dar.nameTokens], ["", ["Darkness", "Energy"]]);
eq("…and 'Basic' is Cardmarket's word, not a seller's", dar.baseName, "Darkness Energy");
eq("…an era set name imposes nothing", dar.setWords, []);
const metal = planCard(normaliseCard({ name: "Metal Energy", number: "38", set: "25th Anniversary Collection", language: "Japanese" }));
eq("a bare number is also searched WITHOUT it — sellers list 'Metal Energy 25th Anniversary'", metal.ladder.map((r) => r.query), [
  "Metal Energy 38 Japanese", "Metal Energy 38 s8a", "Metal Energy 38", "Metal Energy 25th Anniversary Collection", "Metal Energy s8a", "Metal Energy Japanese"
]);
eq("…and its sales must name the set's word, the weak one when it is all there is", [metal.setWords, distinctiveSetWords("25th Anniversary Golden Box")], [["25th", "anniversary"], ["golden"]]);
const metalR = evaluateCard(metal, [comp("Metal Energy 25th Anniversary Japanese s8a", 2), comp("Japanese Metal Energy basic", 0.2), comp("Metal Energy 25th Anniversary Collection JP", 2.5)]);
eq("…so a plain basic energy is left out", [metalR.n_comps, metalR.excluded.map((e) => e.reason)], [2, ["setMismatch"]]);
eq("…and it goes to a person", metalR.decision, "terapeak");
eq("a bare number searches but is never a required word", planCard(normaliseCard({ name: "Metal Energy", number: "38", set: "25th Anniversary Collection", language: "Japanese" })).nameTokens, ["Metal", "Energy"]);
eq("…so '038/028' counts", run({ name: "Metal Energy", number: "38", set: "25th Anniversary Collection" }, [["Metal Energy 038/028 25th Anniversary Japanese", 3], ["Metal Energy s8a Japanese", 2.5]]).n_comps, 2);
eq("a hyphenated name is two words to a seller", run({ name: "Chi-Yu", number: "025/187", set: "Terastal Festival ex" }, [["Chi Yu 025/187 Terastal Festival Japanese", 1.2], ["Chi-Yu 025/187 sv8a", 1]]).n_comps, 2);
ok("…Ho-Oh needs both words, either spelling", planCard(normaliseCard({ name: "Ho-Oh", number: "1/1" })).nameTokens.join() === "Ho,Oh");
const golden = run({ name: "Lightning Energy", number: "", set: "25th Anniversary Golden Box" }, [
  ["Lightning Energy 25th Anniversary Golden Box Japanese", 8], ["Lightning Energy Golden Box Japanese", 9],
  ["Japanese Lightning Energy basic", 0.2], ["Lightning Energy Japanese x10", 0.5]
]);
eq("a numberless card needs its set's own word; a lot of ten is a lot", [golden.n_comps, golden.excluded.map((e) => e.reason).sort()], [2, ["bundle", "setMismatch"]]);
ok("…priced off the Golden Box sales, not the 20p basics", golden.suggested_price > 8);
const quantity = (t) => evaluateCard(planCard(normaliseCard({ name: "Pikachu", number: "025/165", set: "151" })), [comp(t, 1)]).excluded.map((e) => e.reason);
eq("quantity lots", ["Pikachu 025/165 x4", "4x Pikachu 025/165", "Pikachu 025/165 lot of 3", "Pikachu 025/165 playset"].map(quantity), [["bundle"], ["bundle"], ["bundle"], ["bundle"]]);
eq("…not a lot", ["Pikachu 025/165 151 x1 NM", "Pikachu 025/165 XY", "Mega Charizard X ex 025/165"].map((t) => quantity(t).includes("bundle")), [false, false, false]);
const rose = (titles) => run({ name: "Rose Tower (Mirror Holofoil)", number: "182/190", set: "Shiny Star V" }, titles);
eq("mirror: one sale saying it is not a market telling them apart", rose([["Rose Tower 182/190 Mirror Holo s4a Japanese", 3], ["Rose Tower 182/190 s4a Japanese", 0.6]]).n_comps, 2);
const roseHard = rose([["Rose Tower 182/190 Mirror Holo s4a Japanese", 3], ["Rose Tower Mirror 182/190 Japanese", 3.2], ["Rose Tower 182/190 s4a Japanese", 0.6]]);
eq("…two are: the plain copy goes, and the mirror is priced on its own", [roseHard.n_comps, roseHard.suggested_price > 2.49], [2, true]);

// --- 4f. the gaps, filled (2026-11-24) ---------------------------------------------
// Overseas sellers, on the card's say-so only.
const usSale = (t, p) => ({ ...comp(t, p, 1), itemLocation: "US" });
const ukOnly = evaluateCard(planCard(normaliseCard({ name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151", language: "Japanese" })),
  [comp("Geodude Master Ball 074/165 Japanese", 6), usSale("Geodude Master Ball 074/165 sv2a Japanese", 9)]);
const withOverseas = evaluateCard(planCard(normaliseCard({ name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151", language: "Japanese", overseas: true })),
  [comp("Geodude Master Ball 074/165 Japanese", 6), usSale("Geodude Master Ball 074/165 sv2a Japanese", 9)]);
eq("UK only by default", [ukOnly.n_comps, ukOnly.excluded.map((e) => e.reason)], [1, ["nonUkLocation"]]);
eq("overseas counts the overseas sale, marked", [withOverseas.n_comps, withOverseas.sales.filter((x) => x.put_back_reason === "nonUkLocation").length], [2, 1]);

// Possessives and owner prefixes.
const tr = planCard(normaliseCard({ name: "Team Rocket's Moltres EX", number: "015/098", set: "Glory of the Rocket Gang", language: "Japanese" }));
eq("'Team Rockets' and 'TR' read as Team Rocket's", [engineTitle(tr, "Team Rockets Moltres EX 015/098 Japanese"), engineTitle(tr, "TR Moltres ex 015/098 sv10")],
  ["Team Rocket's Moltres EX 015/098 Japanese", "Team Rocket's Moltres ex 015/098 sv10"]);
eq("…so those sales count", evaluateCard(tr, [comp("Team Rockets Moltres EX 015/098 Japanese", 4), comp("TR Moltres ex 015/098 sv10", 5), comp("Team Rocket's Moltres ex 015/098 Japanese", 4.5)]).n_comps, 3);
eq("…and keep their own titles", evaluateCard(tr, [comp("TR Moltres ex 015/098 sv10", 5)]).sales[0].title, "TR Moltres ex 015/098 sv10");
eq("the core name", [coreNameOf("Team Rocket's Moltres EX"), coreNameOf("Cynthia's Roserade"), coreNameOf("Charizard VSTAR"), coreNameOf("Pikachu")], ["Moltres", "Roserade", "Charizard", ""]);
ok("…is a search rung, anchored on the number", tr.ladder.some((r) => r.rung === "corename" && r.query === "Moltres 015/098 Japanese"));
eq("…and what it finds counts, when it carries the card's number", evaluateCard(tr, [comp("Moltres ex 015/098 sv10 Japanese", 4), comp("Moltres ex Japanese 151", 9), comp("Moltres 016/098 Japanese", 2)]).n_comps, 1);
eq("Hoopa 029/062 is Hoopa EX 029/062", evaluateCard(planCard(normaliseCard({ name: "Hoopa EX", number: "029/062", set: "Raging Surf", language: "Japanese" })), [comp("Hoopa 029/062 sv3a Japanese", 3), comp("Hoopa EX 029/062 Japanese", 3.5)]).n_comps, 2);
ok("…never on a bare number", !planCard(normaliseCard({ name: "Metal Energy", number: "38", set: "x" })).ladder.some((r) => r.rung === "corename"));

// Jumbo.
const plainPika = planCard(normaliseCard({ name: "Pikachu", number: "025/165", set: "151" }));
eq("a normal card drops a jumbo sale", evaluateCard(plainPika, [comp("Pikachu 025/165 151 Jumbo Oversized promo", 9), comp("Pikachu 025/165 151", 1)]).n_comps, 1);
eq("a jumbo card is one", planCard(normaliseCard({ name: "Pikachu (Jumbo)", number: "025/165" })).variantKeys, ["jumbo"]);

// Check first, whatever the sales say.
eq("an unrecognised printing goes to a person", decide({ nSales: 8, totals: [300, 300, 300, 300, 300, 300, 300, 300], suggestedPence: 349, unrecognised: ["Rainbow Swirl"] }).decision, "terapeak");
eq("…so does a card with no number", decide({ nSales: 8, totals: [300, 300, 300, 300, 300, 300, 300, 300], suggestedPence: 349, numberless: true }).decision, "terapeak");
eq("…end to end", evaluateCard(planCard(normaliseCard({ name: "Pikachu (Rainbow Swirl)", number: "025/165", set: "151" })), [1, 2, 3, 4].map((i) => comp("Pikachu 025/165 151", 1 + i / 10))).decision, "terapeak");

// Japanese promos.
eq("promo numbers", [parseJpPromo("001/SV-P"), parseJpPromo("SV-P 12"), parseJpPromo("7", "SV-P Promotional cards"), parseJpPromo("025/165"), parseJpPromo("12", "Shiny Treasure ex")],
  [{ digits: "001", code: "SV-P" }, { digits: "012", code: "SV-P" }, { digits: "007", code: "SV-P" }, null, null]);
const jpp = planCard(normaliseCard({ name: "Pikachu", number: "001/SV-P", set: "SV-P Promotional cards", language: "Japanese" }));
eq("a Japanese promo is a promo, searched as sellers write it", [jpp.promo, jpp.nameTokens, jpp.ladder.map((r) => r.query)],
  [true, ["Pikachu"], ["Pikachu 001/SV-P Japanese", "Pikachu SV-P 001 Japanese", "Pikachu 001 SV-P promo", "Pikachu 001/SV-P"]]);
const jppr = evaluateCard(jpp, [comp("Pikachu 001/SV-P Japanese promo", 5), comp("Pikachu SV-P 001 Japanese", 6), comp("Pikachu 002/SV-P Japanese promo", 20), comp("Pikachu 025/165 Japanese", 1)]);
eq("…another promo number, or a set card, is not it", [jppr.n_comps, jppr.excluded.map((e) => e.reason).sort()], [2, ["wrongNumber", "wrongNumber"]]);

// Set codes, more of them.
eq("Sun & Moon and Sword & Shield era codes", ["Dream League", "Tag Bolt", "Rebellion Crash", "Blue Sky Stream"].map((n) => planCard(normaliseCard({ name: "x", number: "1/2", set: n, language: "Japanese" })).setCode), ["sm11b", "sm9", "s2", "s7R"]);
ok("a result says which set code it searched", jpp && evaluateCard(planCard(normaliseCard({ name: "Geodude", number: "074/165", set: "Pokemon Card 151", language: "Japanese" })), []).set_code === "sv2a");
ok("page 2 is cached under its own key, never over page 1", /::page\$\{page\}/.test(routeSrc) && /getComps\(rungs\[0\]\.query, 2\)/.test(routeSrc));

// --- 4g. every Zubat numbered 41 (TEST6, 2026-11-24) ----------------------------------
// The numerator-only search returns every set's card 41; with overseas sellers
// counted, a 1996 Base Set Zubat, a Carddass and a Sealdass sticker priced a
// 2022 Dark Phantasma common.
let zs = 0;
const jpSale = (t, p) => ({ title: t, itemPricePence: Math.round(p * 100), postagePence: 0, itemLocation: "JP", _source: { itemId: `z${++zs}`, endedAt: new Date().toISOString() } });
const zubat = planCard(normaliseCard({ name: "Zubat", number: "041/071", set: "Dark Phantasma", language: "Japanese", any_language: true, overseas: true, year: "2022" }));
const zr = evaluateCard(zubat, [
  jpSale("1996 Pokemon TCG Japanese Zubat Base Set #041 WZ74", 1.73),
  jpSale("Pokemon Japanese Zubat NO. 041 Bandai Carddass Series 3-4 EXCELLENT", 16.67),
  jpSale("Topsun Pokemon TCG Zubat 041 Pokemon Card Basic Non-Holo Common Japanese 1995", 7.36),
  jpSale("ZUBAT 1996 POKEMON NEO REVELATION JAPANESE 041 COMMON Q7803", 0.77),
  jpSale("LP - Pokemon Japanese Zubat No. 041 Bandai Sealdass Sticker", 3.68),
  jpSale("Pokemon Japanese Zubat No. 041 Base Set Holo", 4),
  jpSale("Zubat 041/071 Dark Phantasma s10a Japanese", 0.5),
  jpSale("Pokemon Zubat 041 s10a Dark Phantasma Japanese NM", 0.6),
  jpSale("Zubat 41/71 Japanese", 0.4)
]);
eq("only the Dark Phantasma sales count", zr.sales.map((x) => x.title).sort(), ["Pokemon Zubat 041 s10a Dark Phantasma Japanese NM", "Zubat 041/071 Dark Phantasma s10a Japanese", "Zubat 41/71 Japanese"]);
eq("…each other one says why", zr.excluded.map((e) => e.reason).sort(), ["notACard", "notACard", "notACard", "setMismatch", "setMismatch", "setMismatch"]);
ok("…a different year is a different card, give or take one", zr.excluded.some((e) => /says 1996, the card is 2022/.test(e.detail || "")));
eq("a year either side is still the card (Japanese and English releases straddle a year)", evaluateCard(zubat, [jpSale("Zubat 041/071 Dark Phantasma 2023 Japanese", 0.5), jpSale("Zubat 041/071 s10a 2021", 0.5)]).n_comps, 2);
eq("a Ditto sticker is still a Peelable Ditto", evaluateCard(numel, [comp("Pokemon GO Numel 013/078 Ditto sticker", 10, 2.5)]).n_comps, 1);
eq("…but a Sealdass sticker never is", evaluateCard(numel, [comp("Numel 013/078 Ditto Sealdass sticker", 3)]).n_comps, 0);
eq("an English card whose set has no distinctive word is not asked for one", evaluateCard(planCard(normaliseCard({ name: "Charizard", number: "4/102", set: "Base Set" })), [comp("Charizard Base Set Holo #4", 300)]).n_comps, 1);

// --- 5. output ---------------------------------------------------------------

eq("check mode: within £1 and 30% is not a difference", priceDiffers({ suggested_price: 10.49, current_price: 9.99 }).differs, false);
eq("check mode: £2 off is", priceDiffers({ suggested_price: 12.49, current_price: 9.99 }).differs, true);
eq("check mode: 30% of a cheap card is", priceDiffers({ suggested_price: 3.49, current_price: 2.49 }).differs, true);
eq("check mode: no suggestion always needs a look", priceDiffers({ suggested_price: null, current_price: 2.49 }).differs, true);

const csv = resultsCsv([{ sku: "A1", suggested_pence: 1249 }, { sku: "A2", suggested_pence: null }]);
eq("CSV: an unpriced card is 0.00, not blank", csv, "sku,suggested_price\nA1,12.49\nA2,0.00\n");
eq("and it is named", unpricedSkus([{ sku: "A1", suggested_pence: 1249 }, { sku: "A2", suggested_pence: null }]), ["A2"]);

const cu = [
  "CustomLabel,*Title,*C:Card Name,*C:Card Number,*C:Set,C:Card Condition,*StartPrice,*C:Finish",
  "JZ10,Riolu BW33 Cosmos Holo Black Star Promo,Riolu (Cosmos Holo),BW33,Black and White Promos,Near Mint or Better,2.49,Holofoil",
  "JZ12,Emboar 33/236 Reverse Holo,Emboar,33/236,Cosmic Eclipse,Lightly Played (Excellent),2.49,Reverse Holofoil"
].join("\n");
const fromCsv = cardsFromCsv(cu);
eq("CSV in: two cards", fromCsv.length, 2);
eq("CSV in: the finish column is read", fromCsv[1].variant, "Reverse Holofoil");
eq("CSV in: condition", [fromCsv[0].condition, fromCsv[1].condition], ["NM", "LP"]);
eq("CSV in: current price", fromCsv[0].currentPence, 249);

// --- 6. greps ----------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const route = read("apps/app/app/api/batch-comps/route.js") + read("apps/app/lib/batch-price-core.js");
if (!/auth\.getUser\(\)/.test(route) || !/status: 401/.test(route)) fail("batch-comps must refuse a request with no signed-in user");
if (/soldcomps_api_key[^\n]*NextResponse\.json\(\{[^}]*soldcomps_api_key/.test(route)) fail("the key must never be returned");
if (!/fetchSoldComps/.test(route) || /async function fetchSoldComps/.test(route)) fail("batch-comps must use the shared lib/soldcomps-fetch.js, not a copy");
if (/async function fetchSoldComps/.test(read("apps/app/app/api/soldcomps/route.js"))) fail("soldcomps route grew its own fetcher back");
const lib = read("apps/app/lib/batch-comps.js");
if (/from "@\//.test(lib) || /from "next|from "react/.test(lib)) fail("batch-comps.js must stay loadable under bare node (no @/ imports, no Next/React)");
for (const f of ["packages/core/pricing.js", "packages/core/cardnumber.js"]) {
  if (/variants\.js|house-pricing|batch-comps|promo\.js/.test(read(f))) fail(`${f} reaches into app-side batch rules`);
}
const qs = read("apps/app/app/panel/QuickSearch.js");
if (!/prefilterComps\(/.test(qs)) fail("Quick Search must read variants and promo numbers through prefilterComps, not its own copy");
if (!/promoNumber\(/.test(qs)) fail("Quick Search must cut a promo's set total off");

// ---- One pricing path: the Batch screen's file cards go through the house route ----
{
  const item = { source: "csv", title: "Shedinja 014/107 Reverse Holo Corrected", sku: "AB12",
    csvItem: { cardName: "Shedinja", cardNumber: "014/107", set: "Deoxys", condition: "Unknown", conditionLabel: "Lightly Played", language: "", game: "Pokémon", finish: "Reverse Holo", setCode: "", year: "2005", title: "old" } };
  eq("a file card can be priced the house way; a pasted title cannot", [canPriceHouse(item), canPriceHouse({ source: "paste", title: "x" }), canPriceHouse({ source: "csv", csvItem: {} })], [true, false, false]);
  const card = houseCardFor(item, { overseas: true });
  eq("the route's card: the ROW's title (a correction is priced), the file's fields, the finish, overseas from Worldwide",
    [card.title, card.name, card.number, card.set, card.condition, card.language, card.variant, card.overseas],
    ["Shedinja 014/107 Reverse Holo Corrected", "Shedinja", "014/107", "Deoxys", "Lightly Played", "English", "Reverse Holo", true]);
  // A real evaluateCard answer, turned into the Batch screen's rec.
  const plan = planCard(normaliseCard({ sku: "X", name: "Numel", number: "012/098", set: "Ancient Origins", condition: "NM" }));
  const sale = (t, p, d) => ({ title: t, itemPricePence: p, postagePence: 100, totalPence: p + 100, _source: { endedAt: d, url: `u${p}`, itemId: `i${p}` } });
  const x = evaluateCard(plan, [
    sale("Numel 012/098 Ancient Origins NM", 399, "2026-11-01"), sale("Numel 12/98 Ancient Origins", 449, "2026-11-02"),
    sale("Numel 012/098 Ancient Origins Pokemon", 499, "2026-11-03"), sale("Numel 012/098 Ancient Origins", 549, "2026-11-04"),
    sale("Charmander 012/098 Ancient Origins", 2000, "2026-11-05")
  ], { queries: ["q"] });
  const rec = recFromHouse({ ...x, index: 0 });
  eq("the rec's price IS the house price, never the engine's", rec.finalPence, x.suggested_pence);
  eq("every counted sale is a comp with pence and its date; every left-out one keeps why", [rec.included.length, rec.included.every((c) => c.totalPence > 0 && c._source.endedAt), rec.excluded.every((c) => c.exclusionReason)], [x.sales.length, true, true]);
  eq("the decision and the engine's own figure ride along", [rec.house.decision, rec.house.enginePence], [x.decision, x.engine_price == null ? null : Math.round(x.engine_price * 100)]);
  eq("a saved run keeps how it was priced", slimRec(rec).house?.decision, x.decision);
  eq("a Terapeak card is Low (held from a sticker), no price is None", [houseConfidence({ suggested_pence: 500, decision: "terapeak", confidence: "High" }), houseConfidence({ suggested_pence: null }), houseConfidence({ suggested_pence: 500, decision: "apply", confidence: "Medium" })], ["Low", "None", "Medium"]);
  eq("a failed lookup is no rec (the row fails, never a price)", recFromHouse({ error: "timeout" }), null);
  const panel = read("apps/app/app/panel/Panel.js");
  if (!/recFromHouse\(/.test(panel) || !/\/api\/batch-comps/.test(panel)) fail("the Batch screen must price file cards through /api/batch-comps and recFromHouse, not a copy of the house rules");
  if (/housePrice\(/.test(panel)) fail("the Batch screen must not run the house rules itself — the route does, one definition");
  if (!/query: built\.query/.test(panel)) fail("a house-priced row must keep the Batch query, or every row reads as corrected since it was priced");
}

if (failed) {
  console.error(`\ncheck-batchcomps: ${failed} failure(s)`);
  process.exit(1);
}
console.log("check-batchcomps: all passed");
