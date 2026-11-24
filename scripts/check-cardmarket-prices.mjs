// Cardmarket's price guide beside our prices (lib/cm-match.js, lib/fx.js,
// /api/cardmarket/prices): which Cardmarket product a card of ours is, the
// figures in pounds, the ECB rate, and that none of it reaches a price.
//
//   node scripts/check-cardmarket-prices.mjs
import { readFileSync } from "node:fs";
import { matchCatalog, normNumber, cmFigures, isReverse } from "../apps/app/lib/cm-match.js";
import { parseEcb, FALLBACK_EUR_GBP } from "../apps/app/lib/fx.js";
import { cmGap, sortRows, filterRows, EMPTY_FILTERS } from "../apps/app/lib/lab-inventory.js";

let failed = 0, n = 0;
const eq = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { failed++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); } };

// ---- numbers as the catalogue keeps them ----
eq("numbers: numerator, zeros off, prefix kept", ["074/165", "74", "TG05/TG30", "SV49", "001/SV-P", "177a/165", "SWSH 001"].map(normNumber), ["74", "74", "TG5", "SV49", "1", "177a", "SWSH1"]);

// ---- matching, by set name then number then name ----
const set151 = [
  { cardmarket_id: 1, name: "Geodude", collector_number: "074", expansion: "Pokemon Card 151" },
  { cardmarket_id: 2, name: "Geodude (Master Ball Pattern)", collector_number: "074", expansion: "Pokemon Card 151" },
  { cardmarket_id: 3, name: "Geodude (Poke Ball Pattern)", collector_number: "074", expansion: "Pokemon Card 151" },
  { cardmarket_id: 4, name: "Nidoking", collector_number: "034", expansion: "Pokemon Card 151" }
];
const m = (card) => matchCatalog(card, set151).row?.cardmarket_id ?? matchCatalog(card, set151).why;
eq("the Master Ball pattern is its own product", m({ name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151" }), 2);
eq("…the plain card is the one with no bracket", m({ name: "Geodude", number: "074/165", set: "Pokemon Card 151" }), 1);
eq("one product at the number, the same card", m({ name: "Nidoking", number: "034/165", set: "Pokemon Card 151" }), 4);
eq("one product at the number, a different card, is refused", m({ name: "Mewtwo", number: "034/165", set: "Pokemon Card 151" }), "number matches Nidoking, not this card");
eq("a number not in the set", m({ name: "Pikachu", number: "025/165", set: "Pokemon Card 151" }), "no product with that number in the set");
eq("a set not in the catalogue", matchCatalog({ name: "x", number: "1", set: "Nowhere" }, set151).why, "set not in the catalogue");
eq("several at the number and nothing to choose: no figure", matchCatalog({ name: "Geodude (Rainbow)", number: "074", set: "Pokemon Card 151" }, set151).why, "several products share that number");
eq("set names compare without case or accents", matchCatalog({ name: "Nidoking", number: "34", set: "POKÉMON CARD 151" }, set151.map((r) => ({ ...r, expansion: "Pokémon Card 151" }))).row?.cardmarket_id, 4);

// ---- figures in pounds ----
const price = { as_of: "2026-11-24", trend: 2.0, avg7: 2.5, avg30: 2.0, low: 1.0, p_trend: 6.0, p_avg7: 5.0, p_avg30: 6.0, p_low: 4.0 };
eq("trend in pence at the rate, with the 7 vs 30-day direction", cmFigures(price, { rate: 0.85 }), { pence: 170, avg7Pence: 213, avg30Pence: 170, lowPence: 85, eurTrend: 2, reverse: false, dir: "up", asOf: "2026-11-24" });
eq("a reverse holo reads Cardmarket's reverse figures", cmFigures(price, { reverse: true, rate: 0.85 }).pence, 510);
eq("…and is read off the finish or the title", [isReverse({ finish: "Reverse Holofoil" }), isReverse({ title: "Emboar 33/236 Reverse Holo" }), isReverse({ title: "Reverse Valley" })], [true, true, false]);
eq("no price in the guide is no figure, never £0", cmFigures({ trend: null, avg30: null }, {}), null);

// ---- the ECB rate ----
const ecb = `<gesmes:Envelope><Cube><Cube time='2026-11-24'><Cube currency='USD' rate='1.05'/><Cube currency='GBP' rate='0.8312'/></Cube></Cube></gesmes:Envelope>`;
eq("the GBP rate and its date off the ECB file", parseEcb(ecb), { rate: 0.8312, asOf: "2026-11-24" });
eq("…nonsense is refused, not used", [parseEcb("<x/>"), parseEcb(`<Cube currency='GBP' rate='83.1'/>`)], [null, null]);
eq("the fallback is a plausible rate", FALLBACK_EUR_GBP > 0.7 && FALLBACK_EUR_GBP < 1, true);

// ---- the inventory: vs Cardmarket ----
const row = (id, price, cmPence) => ({ id, title: id, name: id, set: "", number: "", condition: "NM", status: "live", forSale: 1, total: 1, waiting: 0, pricePence: price, marketPence: null, piles: [], copies: [{ sku: id }], listing: {}, search: id, cm: cmPence == null ? null : { pence: cmPence } });
const inv = [row("a", 249, 400), row("b", 500, 250), row("c", 249, null)];
eq("price against Cardmarket", [cmGap(inv[0]), cmGap(inv[2])], [{ pence: -151, pct: -38 }, null]);
eq("filter under Cardmarket", filterRows(inv, { ...EMPTY_FILTERS, vsCm: "under" }).map((r) => r.id), ["a"]);
eq("sort by the gap, no figure last both ways", [sortRows(inv, "cmgap-asc").map((r) => r.id), sortRows(inv, "cmgap-desc").map((r) => r.id)], [["a", "b", "c"], ["b", "a", "c"]]);

// ---- greps ----
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const housePricing = read("apps/app/lib/house-pricing.js") + read("apps/app/lib/batch-comps.js") + read("apps/app/lib/lab-evidence.js");
eq("nothing that prices a card reads Cardmarket's guide (shown, never priced from — yet)", /cm-match|cm_price_latest|cardmarket\/prices/.test(housePricing), false);
eq("the nightly job and Sync now both refresh the rate", [/refreshEurGbp\(admin\)/.test(read("apps/app/app/api/cron/prices/route.js")), /refreshEurGbp\(admin\)/.test(read("apps/app/app/api/prices/sync/route.js"))], [true, true]);
eq("fx_rates is named in its store and its migration alone", /fx_rates/.test(read("apps/app/app/api/cardmarket/prices/route.js")), false);
const route = read("apps/app/app/api/cardmarket/prices/route.js");
eq("the route reads stored data and never calls Cardmarket", [/fetch\(/.test(route), /auth\.getUser\(\)/.test(route)], [false, true]);

console.log(failed ? `\n${failed} of ${n} Cardmarket price checks failed.` : `✓ ${n} Cardmarket price checks pass.`);
process.exit(failed ? 1 : 0);
