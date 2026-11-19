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
import { housePrice, percentileOf, resolveRules, roundUpToLadder, HOUSE_RULES } from "../apps/app/lib/house-pricing.js";
import { cardsFromCsv, evaluateCard, normaliseCard, planCard, priceDiffers, resultsCsv, unpricedSkus } from "../apps/app/lib/batch-comps.js";
import { settingsForText } from "../apps/app/lib/matching.js";
import { guardVerdict, matchCatalog, numberForms, referenceGbp, setsAgree } from "../apps/app/lib/price-guard.js";

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
// Postage capped at £1.50: a £3.50 card with £3.95 postage totals £5.00.
eq("postage cap", housePrice(totalsOf([[3.5, 3.95]])).totals, [500]);
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

// Measured live, 2026-11-19: every Peelable Ditto is a reverse holo, and the
// engine read Numel as a plain card — 175 Ditto sales went as variantMismatch
// and it priced off the 5 that never wrote "reverse". Real titles from that run.
const live = evaluateCard(numel, [
  comp("Numel (Peelable Ditto) 013/078 Pokémon GO Reverse Holo", 16.71),
  comp("Pokemon GO Numel Peelable Ditto Reverse Holo NM 013/078", 15.54),
  comp("Numel 013/078 Pokémon GO Ditto Reverse Foil", 14.44),
  comp("Pokémon TCG - Numel (Peelable Ditto) Rev Holo  - pokemon go - #013/078 2022", 11.8),
  comp("The Pokémon Company Numel 013/078 Common Regular - Pokémon Go Ditto Variant", 8.59),
  comp("Pokemon TCG Numel 013/078 Pokemon GO Reverse Holo NM", 2.24),           // not the Ditto
  comp("Numel (Peelable Ditto) 013/078 Pokémon GO Reverse Holo PSA 10", 1215.28) // a slab
]);
eq("a Ditto reverse holo is the Ditto card, however it's written", live.n_comps, 5);
ok("…and none of them went as variantMismatch", !live.excluded.some((e) => e.reason === "variantMismatch"));
ok("the plain reverse still goes", live.excluded.some((e) => e.reason === "missingVariant"));
ok("the slab still goes", live.excluded.some((e) => e.reason === "graded"));
ok("a sale shows the seller's title, not the engine's", live.sales.every((x) => !/Variant Reverse Holo$/.test(x.title)));

// A card the caller SAID is the base card is not "uncertain" about it.
const explicitBase = planCard(normaliseCard({ name: "Riolu", number: "BW33", variant_keys: [] }));
ok("variant_keys: [] answers the question", !evaluateCard(explicitBase, rioluComps).flags.variant_uncertain);

// --- 4b. the guard: a £40 card must never go out at £2.49 ---------------------

// The Riolu that shipped: the file said the plain promo, so the plain promo's
// honest comps priced it. Only evidence from OUTSIDE those comps can catch it.
const shipped = { suggested_price: 2.49, suggested_pence: 249, n_comps: 2, sales: [{ total: 2.5 }, { total: 3 }], excluded: [], engine_price: 2.49, flags: {} };
eq("Cardmarket at £45 holds a £2.49 card", guardVerdict(shipped, { reference: { gbp: 45, product: "Riolu" } }).verdict, "hold");
eq("…and only review at 50% of it", guardVerdict({ ...shipped, suggested_price: 25 }, { reference: { gbp: 45 } }).verdict, "review");
eq("…and fine at 70%", guardVerdict({ ...shipped, suggested_price: 32, n_comps: 8 }, { reference: { gbp: 45 } }).verdict, "ok");
eq("a reference under £5 says nothing", guardVerdict({ ...shipped, n_comps: 8 }, { reference: { gbp: 4 } }).verdict, "ok");
eq("a pricey sibling printing is a review, never a hold", guardVerdict({ ...shipped, n_comps: 8 }, { siblings: [{ name: "Riolu (Cosmos Holo)", gbp: 45 }] }).verdict, "review");
eq("thin comps alone are a review", guardVerdict(shipped, {}).verdict, "review");
eq("no price is a hold", guardVerdict({ ...shipped, suggested_price: null }, {}).verdict, "hold");
ok("the cheap stray is named", guardVerdict({ ...shipped, sales: [{ total: 2.5 }, { total: 30 }] }, {}).reasons.some((r) => /lowest sale/.test(r.why)));
eq("live asking at 3x+ is a review", guardVerdict({ ...shipped, n_comps: 8 }, { asking: { medianGbp: 20, n: 5 } }).verdict, "review");
// The plain Riolu run: honest at £13.99, but the Cosmos sales it threw out ran
// ~£50 — exactly the moment to ask "is yours the Cosmos one?".
const plainLive = { ...shipped, suggested_price: 13.99, n_comps: 4, sales: [{ total: 13 }, { total: 13.5 }, { total: 13.91 }, { total: 17.65 }],
  excluded: [48.74, 52.65, 54.2, 76.49, 85].map((t) => ({ reason: "wrongVariant", detail: "Cosmos Holo", total: t })) };
eq("variant sales at 3x+ make the base card a review", guardVerdict(plainLive, {}).verdict, "review");

eq("Cardmarket euros to pounds", referenceGbp({ trend: 10 }), 8.5);
eq("a reverse reads the premium column…", referenceGbp({ trend: 1, p_trend: 4, p_low: 2 }, { reverse: true }), 3.4);
eq("…only where the premium is really listed", referenceGbp({ trend: 1, p_trend: 40, p_low: 0 }, { reverse: true }), 0.85);
ok("number forms cover padding", ["013/078", "013", "13"].every((f) => numberForms("013/078").includes(f)));

ok("CardUploader's promo set is Cardmarket's", setsAgree("Black and White Promos", "BW Black Star Promos", { promo: true }));
ok("accents and case", setsAgree("Pokémon GO", "Pokemon Go"));
ok("SWSH promos", setsAgree("Sword and Shield Promos", "SWSH Black Star Promos", { promo: true }));
ok("BW promos are not SM promos", !setsAgree("Black and White Promos", "SM Black Star Promos", { promo: true }));
ok("Base Set is not Base Set 2", !setsAgree("Base Set", "Base Set 2"));
ok("Team Rocket is not Team Rocket Returns", !setsAgree("Team Rocket", "Team Rocket Returns"));
ok("a promo set never matches a main set", !setsAgree("Black and White Promos", "Black & White", { promo: true }));
const cat = [
  { cardmarket_id: 1, name: "Riolu", collector_number: "BW33", expansion: "BW Black Star Promos" },
  { cardmarket_id: 2, name: "Riolu (Cosmos Holo)", collector_number: "BW33", expansion: "BW Black Star Promos" },
  { cardmarket_id: 3, name: "Riolu", collector_number: "BW33", expansion: "Some Other Set" }
];
const vOf = (name) => detectVariants({ name }).keys;
const asPlan = (o) => ({ card: { set: "Black and White Promos" }, promo: true, baseName: "Riolu", variantKeys: [], ...o });
eq("the plain card matches the plain product", matchCatalog(asPlan({}), cat, vOf).product.cardmarket_id, 1);
eq("…and the Cosmos is its sibling", matchCatalog(asPlan({}), cat, vOf).siblings.map((r) => r.cardmarket_id), [2]);
eq("the Cosmos card matches the Cosmos product", matchCatalog(asPlan({ variantKeys: ["cosmos"] }), cat, vOf).product.cardmarket_id, 2);
eq("another set's Riolu is neither", matchCatalog(asPlan({}), cat, vOf).siblings.some((r) => r.cardmarket_id === 3), false);
eq("no set, no match — a wrong reference could hold a card", matchCatalog(asPlan({ card: { set: "" } }), cat, vOf).product, null);

// A held card leaves the CSV at 0.00, whatever it was priced at.
eq("held → 0.00 in the CSV", resultsCsv([{ sku: "H1", suggested_pence: 249, listable_pence: null }]), "sku,suggested_price\nH1,0.00\n");
eq("held cards are named", unpricedSkus([{ sku: "H1", suggested_pence: 249, listable_pence: null }]), ["H1"]);

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
const route = read("apps/app/app/api/batch-comps/route.js");
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

if (failed) {
  console.error(`\ncheck-batchcomps: ${failed} failure(s)`);
  process.exit(1);
}
console.log("check-batchcomps: all passed");
