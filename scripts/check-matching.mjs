/**
 * Table check for apps/app/lib/matching.js — every rule the business app adds
 * on top of the shared engine. See docs/APP_BATCH_RECURSION.md.
 *
 * Both rules live in the APP. packages/core is untouched by either, and this
 * check is also the tripwire for that: it asserts core's own behaviour is
 * unchanged, so a later "tidy-up" that pushes one of these down into the
 * shared engine — and therefore into Last Comp — fails here rather than
 * silently repricing a stranger's card.
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
import CardUploaderCsv from "../apps/app/lib/carduploader.js";
import {
  APP_SETTINGS, appNameTokens, stripNumberingPrefix,
  dropForeignPostage, tooThinToPrice, MIN_SOLD_COMPS_TO_PRICE,
  poolDisagrees, needsActiveCheck, soldContradictsAsking, SANITY_CHECK_ABOVE_PENCE,
  settingsForText, applyNumberGuards, FOREIGN_LANGUAGE
} from "../apps/app/lib/matching.js";
// settings.js exports it on the default only, not as a named export.
import publicSettings from "../apps/public/lib/settings.js";

const { DEFAULT_SETTINGS, extractNameTokens, recommend } = CompFinderPricing;
// What the engine does on its own, which is what Last Comp still gets.
const CORE = DEFAULT_SETTINGS;

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
for (const [query, want] of TOKENS) check(`app tokens: ${query}`, appNameTokens(query), want);

// THE TRIPWIRE. core still emits the prefix, because Last Comp never passes one
// and nothing there asked for this. If this line starts failing, the rule has
// been moved into the shared engine and Last Comp's prices moved with it.
check("core is untouched — it still emits the prefix",
  extractNameTokens("Xatu No. 178"), ["Xatu", "No.", "178"]);
check("core's set-mismatch ratio is untouched", CORE.setMismatchExcludeBelowRatio, 0.5);
check("the app sets its own", APP_SETTINGS.setMismatchExcludeBelowRatio, 1);

// The number as it arrives from a CardUploader CSV's *C:Card Number column.
check("strip: No. 178", stripNumberingPrefix("No. 178"), "178");
check("strip: NO.178", stripNumberingPrefix("NO.178"), "178");
check("strip: #44", stripNumberingPrefix("#44"), "44");
check("strip: a bare number is left alone", stripNumberingPrefix("178"), "178");
check("strip: a slashed number is left alone", stripNumberingPrefix("215/203"), "215/203");

// ── 2. A prefix in the LISTING must match a query without one ───────────────
// The whole point: every spelling a seller uses has to reach the same price.
const comp = (title) => ({ title, itemPricePence: 200, postagePence: 100 });
const SPELLINGS = ["Xatu No.178 Neo Genesis Japanese", "Xatu No. 178 Neo Genesis Japanese",
                   "Xatu #178, Neo Genesis, Japanese", "Pokemon Xatu 178 Neo Genesis Japanese"];
check("every spelling of the number now matches in the app",
  SPELLINGS.map((t) => recommend([comp(t)], APP_SETTINGS, appNameTokens("Xatu No. 178"), "sold").included.length),
  [1, 1, 1, 1]);
check("...and only one of them did before",
  SPELLINGS.map((t) => recommend([comp(t)], CORE, extractNameTokens("Xatu No. 178"), "sold").included.length),
  [1, 0, 0, 0]);

// ── 3. A confirmed set excludes even when it WINS its own vote ──────────────
// The guard fired only when the set-matching comps were a minority, so a Neo
// Discovery print sitting inside a 4-of-5 Neo Genesis pool was priced. It still
// stands down below setMismatchMinKept: a pool of two is not a mandate to
// exclude, it is a reason to stop claiming a price.
const pool = (setNames) => setNames.map((s, i) => comp(`Snubbull No.209 Japanese ${s} card ${i}`));
const usedUnder = (settings, sets) =>
  recommend(pool(sets), settings, appNameTokens("Snubbull No. 209"), "sold", null, "Neo Genesis").included.length;

const MAJORITY = ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Destiny"];
check("majority-confirmed set now excludes the odd one out", usedUnder(APP_SETTINGS, MAJORITY), 4);
check("...and core still prices it, as Last Comp still does", usedUnder(CORE, MAJORITY), 5);

const MINORITY = ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny"];
check("minority-confirmed set still excludes, as it always did", usedUnder(APP_SETTINGS, MINORITY), 4);
check("...and core is unchanged there too", usedUnder(CORE, MINORITY), 4);

// FALSE POSITIVE. Too few confirmed comps to price from, so the guard must
// stand down and leave the ⚠ note rather than cut the pool to one.
const THIN = ["Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny"];
check("a thin confirmed set stands down rather than pricing off one comp", usedUnder(APP_SETTINGS, THIN), 4);

// FALSE POSITIVE. Nothing to exclude — every comp names the set — so the guard
// must not fire and must not touch the pool.
check("an all-matching pool is left alone", usedUnder(APP_SETTINGS, ["Neo Genesis", "Neo Genesis", "Neo Genesis", "Neo Genesis"]), 4);

// FALSE POSITIVE. No confirmed set at all (the app's paste path passes none) —
// the guard has nothing to judge against and must be a no-op.
check("no confirmed set is a no-op",
  recommend(pool(["Neo Genesis", "Neo Destiny", "Neo Destiny", "Neo Destiny", "Neo Destiny"]),
    APP_SETTINGS, appNameTokens("Snubbull No. 209"), "sold", null, null).included.length, 5);

// ── 4. Postage that no UK seller charges is not card value ──────────────────
// 74-82% of every recommended price in the 2026-08-25 batch WAS the postage.
// The comp is kept and its postage zeroed rather than the comp excluded —
// the sale happened and the card did go for £2.20; only the shipping is not
// evidence about the UK market, and these pools are too thin to bin comps.
const post = (item, postage) => ({ title: "Xatu No.178 Neo Genesis", itemPricePence: item, postagePence: postage });
const dropped = (item, postage) => {
  const r = dropForeignPostage([post(item, postage)]);
  return [r.comps[0].postagePence, r.changed];
};
check("£9.84 postage on a £2.20 card is not a UK cost", dropped(220, 984), [0, 1]);
check("£14.12 on a £2.76 card likewise", dropped(276, 1412), [0, 1]);

// FALSE POSITIVES — the ones that decide whether this rule is safe anywhere
// except this batch.
check("£1.35 on a £1.16 card is ordinary UK postage", dropped(116, 135), [135, 0]);
check("£5.00 delivery, seen live on a real UK Sunkern listing, survives", dropped(200, 500), [500, 0]);
// Postage is only ever material relative to a cheap card, which is the whole
// reason this can fire hard without touching the top of the market. £8 of
// signed-for on an £800 Umbreon is a real cost and must be left alone.
check("£8 signed-for on an £800 card is untouched", dropped(80000, 800), [800, 0]);
check("free postage is left alone", dropped(99, 0), [0, 0]);
// Both clauses have to hold: over the ceiling AND more than the card itself.
check("£7 postage on a £30 card stays — dear, but not more than the card", dropped(3000, 700), [700, 0]);

check("the whole set is reported, not just changed comps", (() => {
  const r = dropForeignPostage([post(220, 984), post(116, 135), post(276, 1412)]);
  return [r.comps.length, r.changed, r.comps.map((c) => c.postagePence)];
})(), [3, 2, [0, 135, 0]]);
check("an empty comp list is safe", (() => { const r = dropForeignPostage([]); return [r.comps.length, r.changed]; })(), [0, 0]);

// ── 5. Two comps is not a price ─────────────────────────────────────────────
// Prices from ≤2 comps had a median of £15.49 across the batch against £9.99
// for those from 4+. Sunkern No. 191 was £19.49 off one sold comp while twelve
// live UK listings sat at £1.99-£2.24.
const recOf = (n, source = "sold") => ({ dataSource: source, included: Array.from({ length: n }, () => ({})) });
check("one comp is too thin", tooThinToPrice(recOf(1)), true);
check("two comps is too thin", tooThinToPrice(recOf(2)), true);
check("three comps prices", tooThinToPrice(recOf(3)), false);
check("the minimum is what the app says it is", MIN_SOLD_COMPS_TO_PRICE, 3);
// FALSE POSITIVES. Zero comps is a different case with its own message, and an
// active-listing result has already been through this test on the sold side.
check("zero comps is handled elsewhere, not here", tooThinToPrice(recOf(0)), false);
check("an active-listing result is not re-judged", tooThinToPrice(recOf(2, "active")), false);
check("a missing rec is safe", tooThinToPrice(null), false);

// ── 6. Comps that disagree about what product this is ───────────────────────
// After the matching and postage fixes, the 71 rows with no disagreement
// warning had a median of £2.49 — right — and the 18 that warned about
// themselves had £5.74. Every remaining bad price was one of the 18. The
// ratio is priceOutlierMultiplier, reused rather than invented.
const spread = (...totals) => ({ included: totals.map((t) => ({ totalPence: t })) });
// Golbat No. 042 as it actually came back: three products blended into £7.99.
check("a 21x span is not one product", poolDisagrees(spread(117, 260, 508, 1299, 2499)), true);
check("Sunkern's 17x span likewise", poolDisagrees(spread(117, 200, 250, 1936)), true);
check("exactly 8x trips it", poolDisagrees(spread(100, 800)), true);
// FALSE POSITIVES. Wooper's 4x span priced at £3.49 and is plausible — an
// ordinary condition spread on a cheap card is not evidence of two products,
// which is the same reason splitPriceOutliers runs wide in the first place.
check("Wooper's 4x span is an ordinary condition spread", poolDisagrees(spread(117, 200, 300, 499)), false);
check("just under 8x holds", poolDisagrees(spread(100, 799)), false);
check("a single comp cannot disagree with itself", poolDisagrees(spread(500)), false);
check("an empty pool is safe", poolDisagrees(spread()), false);
check("a missing rec is safe", poolDisagrees(null), false);
// A free comp would make every ratio infinite, so zero totals are ignored.
check("free comps don't manufacture a span", poolDisagrees(spread(0, 250, 300)), false);

// Both routes to the live-market check, and neither for a healthy pool.
check("too few comps asks the market", needsActiveCheck(spread(117, 200)), true);
check("a disagreeing pool asks too", needsActiveCheck(spread(117, 260, 508, 1299, 2499)), true);
check("a healthy pool asks nothing", needsActiveCheck(spread(200, 250, 300, 400)), false);

// ── 7. A consistent pool can still be the wrong card ────────────────────────
// Golbat No. 042: four comps, £12.00-£44.33, a 3.7x span under the 8x trigger,
// four comps over the three minimum, Medium confidence — £29.99 on a card
// listed live at £3.48. Nothing inside the pool could catch it, because the
// cheapest comp in it was £12. Only the live market can.
const healthy = (pence, ...totals) => ({
  finalPence: pence, rawPence: pence, included: totals.map((t) => ({ totalPence: t }))
});
check("the threshold is twice the floor", SANITY_CHECK_ABOVE_PENCE, APP_SETTINGS.floorPence * 2);
check("Golbat's healthy-looking £29.99 gets checked", needsActiveCheck(healthy(2999, 1200, 2000, 3000, 4433)), true);
// FALSE POSITIVES. A price at the floor cannot be wrong in a way that costs
// anything — you list it and it sells — so it must not spend a request.
check("a floor price is not worth a request", needsActiveCheck(healthy(249, 200, 250, 300, 280)), false);
check("just under the threshold is left alone", needsActiveCheck(healthy(497, 400, 500, 520, 480)), false);
check("exactly at it is checked", needsActiveCheck(healthy(498, 400, 500, 520, 480)), true);

// Asking runs ABOVE sold, so sold well above asking is a contradiction, not a
// strong card. Golbat was 8.5x its asking market, Sunkern 9.7x.
const sold = (p) => ({ rawPence: p });
check("Golbat: £29.73 sold against £3.48 asking", soldContradictsAsking(sold(2973), sold(348)), true);
check("Sunkern: £19.36 against £2.00", soldContradictsAsking(sold(1936), sold(200)), true);
// FALSE POSITIVES — the multiple is loose on purpose. A card genuinely on the
// way up sells above stale listings, and this must never fire on that.
check("sold a little above asking is ordinary", soldContradictsAsking(sold(300), sold(250)), false);
check("sold below asking is the normal case", soldContradictsAsking(sold(200), sold(300)), false);
check("exactly 2x does not trip it", soldContradictsAsking(sold(500), sold(250)), false);
check("no asking figure means no contradiction", soldContradictsAsking(sold(2973), sold(null)), false);
check("no sold figure either", soldContradictsAsking(sold(null), sold(348)), false);

// ── 8. The set and the language steer the search, never the match ──────────
// The single biggest source of pooled prices was a query of name + number
// only. Measured on the same eight cards priced both ways: Golbat 042 without
// them returned 30 comps spanning 21x that eBay split into three products and
// blended to £7.99; with them the pool was clean at £3.49. Sunkern 191 went
// £6.99 to £2.49 against a live market of £2.00.
const q = (over = {}) => CardUploaderCsv.buildQueryFromItem({
  title: "Sunkern NO. 191 Neo Genesis Pokemon Japanese MP",
  cardName: "Sunkern", cardNumber: "No. 191", set: "Neo Genesis", condition: "MP", ...over
}, {});
check("the set and language reach the query", q().query, "Sunkern No. 191 Neo Genesis Japanese");

// THE ONE THAT MATTERS. nameTokensMatch requires EVERY token, so a required
// "Neo Genesis" would throw out each comp whose seller wrote "Neo" or nothing
// — the fault that made "Giratina V 186/196 LOR" reject all forty of its own
// comps on the public page. Steering a search is not demanding a word.
check("...and NEITHER becomes a required match token", q().nameTokens, ["Sunkern", "191"]);

// FALSE POSITIVES.
check("a generic set is not put in the query",
  q({ set: "Miscellaneous Cards & Products", title: "Kingdra 42" }).query, "Sunkern No. 191");
check("no language in the title adds none",
  q({ title: "Sunkern NO. 191 Neo Genesis Pokemon MP" }).query, "Sunkern No. 191 Neo Genesis");
check("an English card is untouched by the language rule",
  CardUploaderCsv.buildQueryFromItem({ title: "Umbreon VMAX 215/203 Evolving Skies",
    cardName: "Umbreon VMAX", cardNumber: "215/203", set: "Evolving Skies" }, {}).query,
  "Umbreon VMAX 215/203 Evolving Skies");
check("language detection is a closed list, not a guess",
  [CardUploaderCsv.languageInTitle("Sunkern Japanese NM"),
   CardUploaderCsv.languageInTitle("Sunkern Korean NM"),
   CardUploaderCsv.languageInTitle("Sunkern Japan NM"),
   CardUploaderCsv.languageInTitle("Sunkern NM")],
  ["Japanese", "Korean", null, null]);
// useFullTitle still wins outright — it is the escape hatch for a card the
// structured fields describe badly, and must not be second-guessed.
check("useFullTitle still overrides everything",
  CardUploaderCsv.buildQueryFromItem({ title: "Sunkern NO. 191 Neo Genesis Pokemon Japanese MP",
    cardName: "Sunkern", cardNumber: "No. 191", set: "Neo Genesis" }, { useFullTitle: true }).query,
  "Sunkern NO. 191 Neo Genesis Pokemon Japanese MP");

// ── 9. Ported from Last Comp: the language and number guards ────────────────
// The app had neither. An English Charizard could pool Japanese comps with
// nothing stopping it — a different card at a different price, and invisible,
// because a batch of English cards never shows the warning that would give it
// away.
const langOf = (t) => !!settingsForText(t).excludeKeywords.foreignPrint;
check("an English title blocks foreign comps", langOf("Charizard VMAX 020/189 Darkness Ablaze NM"), true);
check("a Japanese title does not", langOf("Sunkern NO. 191 Neo Genesis Pokemon Japanese MP"), false);
check("nor a German one", langOf("Glurak 020/189 Deutsch"), false);
// FALSE POSITIVES. The two products decide "is this English" from different
// evidence and that is deliberate, but the LIST must not drift — a language
// Last Comp knows and the app doesn't is a silent gap on exactly the cards
// where they would disagree.
check("the language list matches Last Comp's, exactly",
  [...FOREIGN_LANGUAGE].sort(), [...publicSettings.FOREIGN_LANGUAGE].sort());
check("empty text is treated as English", langOf(""), true);
check("a word merely containing a language name doesn't count", langOf("Frenchie Pikachu Promo"), true);

// The number guards. Both stand down when the number has no denominator, which
// is why they do nothing for the Japanese Neo cards that prompted this week —
// "No. 178" has nothing to compare. They earn their place on English stock.
const titled = (title) => ({ title });
const numberPool = [
  titled("Charizard VMAX 020/189 Darkness Ablaze NM"), titled("Pokemon Charizard VMAX 020/189 Darkness Ablaze"),
  titled("Charizard VMAX 020/189 DAA LP"), titled("Charizard VMAX 020/189 holo"),
  titled("Charizard VMAX 074/189 Darkness Ablaze RAINBOW"), titled("Charizard VMAX Darkness Ablaze")
];
check("a different numerator is dropped", applyNumberGuards(numberPool, "020/189").length, 5);
check("...and a title with NO number is kept — it can't be ruled out",
  applyNumberGuards(numberPool, "020/189").some((c) => c.title === "Charizard VMAX Darkness Ablaze"), true);
// FALSE POSITIVES.
check("no card number is a no-op", applyNumberGuards(numberPool, null).length, 6);
check("a bare number has no denominator to compare", applyNumberGuards(numberPool, "178").length, 6);
check("an empty pool is safe", applyNumberGuards([], "020/189").length, 0);
// The guard stands down rather than cut a pool below what it can price from.
check("it will not strip a pool down to nothing",
  applyNumberGuards([titled("Charizard 020/189"), titled("Charizard 074/189"), titled("Charizard 099/189")], "020/189").length, 3);

if (failures) { console.error(`\nmatching: ${failures} case(s) failed.`); process.exit(1); }
console.log("matching: prefix, set-guard, foreign-postage, thin-pool, disagreement, sanity, query-scoping, language and number-guard cases pass.");
