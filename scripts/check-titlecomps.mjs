/**
 * /api/batch-comps, title form: { id, title } in, every sold listing out with
 * the reason it would be excluded.
 *
 *   node scripts/check-titlecomps.mjs      (or: npm run check)
 *
 * What it pins: what a title parses to; that every fetched sale comes back
 * (kept or not) with a reason from the caller's vocabulary; that a failed
 * lookup is "timeout" with no rows and never a fall back to active listings;
 * and that a title is one search however many ids carry it.
 */
import { readFileSync } from "node:fs";
import { REASON_TEXT } from "../apps/app/lib/batch-comps.js";
import {
  REASON_CODES, cardConditionTier, compCondition, conditionMismatch, isTitleRequest, parseCardTitle, planTitleCard, reasonCode, titleCardResult, titleKey
} from "../apps/app/lib/title-comps.js";

let failed = 0;
const fail = (m) => { failed++; console.error("FAIL", m); };
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fail(`${label}\n   got  ${g}\n   want ${w}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// --- parsing ---------------------------------------------------------------
const parse = (t) => { const p = parseCardTitle(t); return [p.name, p.number, p.set, p.language, p.condition]; };
eq("cosmos", parse("Kingdra (Cosmos Holo) 032/182 Pokemon"), ["Kingdra (Cosmos Holo)", "032/182", "", "English", ""]);
eq("promo code", parse("Riolu (Cosmos Holo) BW33 Black Star Promo Pokemon Card").slice(0, 2), ["Riolu (Cosmos Holo)", "BW33"]);
eq("set, condition, filler", parse("Emboar Reverse Holo 33/236 Cosmic Eclipse Pokemon TCG NM"), ["Emboar Reverse Holo", "33/236", "Cosmic Eclipse", "English", "NM"]);
eq("rarity off the set", parse("Umbreon VMAX 215/203 Evolving Skies Secret Rare").slice(0, 3), ["Umbreon VMAX", "215/203", "Evolving Skies"]);
eq("language", parse("Pikachu Japanese 025/165 SV2a"), ["Pikachu", "025/165", "SV2a", "Japanese", ""]);
eq("gallery number", parse("Lugia V TG05/TG30 Silver Tempest").slice(0, 3), ["Lugia V", "TG05/TG30", "Silver Tempest"]);
eq("abbreviation dot survives", parse("Mr. Mime 97/162 BREAKthrough LP"), ["Mr. Mime", "97/162", "BREAKthrough", "English", "LP"]);
eq("a card's ex is not a grade", parse("Charizard ex Obsidian Flames").slice(0, 1).concat(parseCardTitle("Charizard ex Obsidian Flames").condition), ["Charizard ex Obsidian Flames", ""]);
eq("no number: the whole title is the name", parse("Charizard Base Set").slice(0, 2), ["Charizard Base Set", ""]);

const kingdra = planTitleCard({ id: "JO28", title: "Kingdra (Cosmos Holo) 032/182 Pokemon" });
eq("query asks for the variant", kingdra.plan.queries[0], "Kingdra Cosmos Holo 032/182");
eq("variant read off the title", kingdra.plan.variantKeys, ["cosmos"]);
ok("a promo plans as a promo", planTitleCard({ title: "Riolu (Cosmos Holo) BW33 Black Star Promo" }).plan.promo);

// --- reasons ---------------------------------------------------------------
for (const k of Object.keys(REASON_TEXT)) ok(`engine reason ${k} has a code`, REASON_CODES[k]);
eq("unknown reasons are snake-cased, never dropped", reasonCode("someNewReason"), "some_new_reason");
eq("kept is null", reasonCode(null), null);

let seq = 0;
const comp = (title, pounds, postage = 0, loc = null) => ({
  title, itemPricePence: Math.round(pounds * 100), postagePence: Math.round(postage * 100), itemLocation: loc,
  _source: { itemId: `i${++seq}`, url: `https://www.ebay.co.uk/itm/${seq}`, endedAt: new Date(Date.now() - seq * 864e5).toISOString() }
});
const comps = [
  comp("Kingdra Cosmos Holo 032/182 Paradox Rift Pokemon", 3.2, 0.85),
  comp("Pokemon Kingdra 032/182 Cosmos Holo Paradox Rift NM", 2.9, 1.0),
  comp("Kingdra 032/182 Cosmos Holo Paradox Rift", 3.5, 0),
  comp("Kingdra 032/182 Paradox Rift Holo Rare", 1.5, 0.85), // the base card
  comp("PSA 10 Kingdra Cosmos Holo 032/182 Paradox Rift", 40, 3),
  comp("Kingdra Cosmos Holo 033/182 Paradox Rift", 3.0, 0.85), // another number
  comp("Kingdra Cosmos Holo 032/182 Paradox Rift JAPANESE", 2.0, 0.85),
  comp("Kingdra Cosmos Holo 032/182 Paradox Rift", 2.5, 9.0, "United States"),
  comp("Kingdra Cosmos Holo 032/182 job lot x3 Paradox Rift", 8.0, 1.0)
];
const res = titleCardResult({ id: "JO28", title: kingdra.title, plan: kingdra.plan, parsed: kingdra.parsed }, { status: "ok", comps, cached: false });
eq("status", res.status, "ok");
eq("every fetched sale is returned", res.sold.length, comps.length);
eq("in SoldComps order", res.sold.map((r) => r.itemId), comps.map((c) => c._source.itemId));
const why = Object.fromEntries(res.sold.map((r) => [r.title, r.excluded_reason]));
eq("kept", [why[comps[0].title], why[comps[1].title], why[comps[2].title]], [null, null, null]);
eq("base card in a variant's comps", why[comps[3].title], "variant_mismatch");
eq("slab", why[comps[4].title], "graded");
eq("other number", why[comps[5].title], "name_mismatch");
eq("foreign print", why[comps[6].title], "foreign");
eq("non-UK seller", why[comps[7].title], "non_uk");
eq("lot", why[comps[8].title], "bundle");
eq("n_kept counts the nulls", res.n_kept, res.sold.filter((r) => r.excluded_reason == null).length);
eq("postage is SoldComps' figure, not the engine's zeroed one", res.sold[7].postage, 9);
ok("each row carries the shape asked for", res.sold.every((r) => ["price", "postage", "date", "title", "itemId", "excluded_reason"].every((k) => k in r)));
ok("no price on the answer", !("suggested_price" in res) && !("p40" in res));
for (const r of res.sold) {
  ok(`reason in the vocabulary: ${r.excluded_reason}`, r.excluded_reason == null || Object.values(REASON_CODES).includes(r.excluded_reason));
}


// --- condition ---------------------------------------------------------------
eq("NM and LP are one tier", [cardConditionTier("NM").tier, cardConditionTier("LP").tier], ["NM/LP", "NM/LP"]);
eq("played grades stand alone", ["MP", "Heavily Played", "DMG"].map((c) => cardConditionTier(c).tier), ["MP", "HP", "DMG"]);
eq("no condition is NM/LP, and says it was assumed", cardConditionTier(""), { tier: "NM/LP", assumed: true });
eq("comp grade off the title", compCondition({ title: "Kingdra 032/182 MP" }), "MP");
eq("60 HP is a stat", compCondition({ title: "Kingdra 60 HP 032/182" }), null);
eq("eBay's Ungraded says nothing", compCondition({ title: "Kingdra 032/182", condition: "Ungraded" }), null);
eq("a field that IS a grade is read", compCondition({ title: "Kingdra 032/182", condition: "LP" }), "LP");
ok("an NM comp suits an LP card", !conditionMismatch({ title: "Kingdra 032/182 NM" }, "NM/LP"));
ok("a played comp does not suit an NM card", conditionMismatch({ title: "Kingdra 032/182 Moderately Played" }, "NM/LP"));
ok("an NM comp does not suit an HP card", conditionMismatch({ title: "Kingdra 032/182 Near Mint" }, "HP"));
ok("a comp stating no grade is never a mismatch", !conditionMismatch({ title: "Kingdra 032/182" }, "HP"));

{
  const c = [
    comp("Kingdra Cosmos Holo 032/182 Paradox Rift NM", 3.2, 0.85),
    comp("Kingdra Cosmos Holo 032/182 Paradox Rift", 3.0, 0.85),
    comp("Kingdra Cosmos Holo 032/182 Paradox Rift MP", 2.0, 0.85),
    comp("Kingdra Cosmos Holo 032/182 Paradox Rift Heavily Played", 1.2, 0.85),
    comp("PSA 9 Kingdra Cosmos Holo 032/182 Paradox Rift MP", 30, 3)
  ];
  const nm = planTitleCard({ title: "Kingdra (Cosmos Holo) 032/182 Paradox Rift NM" });
  eq("condition read off the card's title", nm.condition, { tier: "NM/LP", assumed: false });
  const r = titleCardResult({ id: "A", title: nm.title, plan: nm.plan, parsed: nm.parsed, condition: nm.condition }, { status: "ok", comps: c });
  eq("NM card: the played sales are condition mismatches", r.sold.map((x) => x.excluded_reason), [null, null, "condition_mismatch", "condition_mismatch", "graded"]);
  eq("a slab stays graded, not condition", r.sold[4].excluded_reason, "graded");
  eq("each row says the grade it read", r.sold.map((x) => x.condition), ["NM", null, "MP", "HP", "MP"]);
  eq("n_kept counts condition out", r.n_kept, 2);
  eq("the card's tier is on the row", r.card_condition, { tier: "NM/LP", assumed: false });

  const mp = planTitleCard({ title: "Kingdra (Cosmos Holo) 032/182 Paradox Rift NM", condition: "MP" });
  const r2 = titleCardResult({ id: "B", title: mp.title, plan: mp.plan, parsed: mp.parsed, condition: mp.condition }, { status: "ok", comps: c });
  eq("an explicit condition beats the title", r2.sold.map((x) => x.excluded_reason), ["condition_mismatch", null, null, "condition_mismatch", "graded"]);
}

// --- status ----------------------------------------------------------------
const none = titleCardResult({ id: "A", title: "x", plan: kingdra.plan, parsed: kingdra.parsed }, { status: "ok", comps: [] });
eq("nothing sold", [none.status, none.sold.length], ["no_sales", 0]);
const late = titleCardResult({ id: "A", title: "x", plan: kingdra.plan, parsed: kingdra.parsed }, { status: "timeout", error: "SoldComps didn't respond" });
eq("a failed lookup is timeout, with no rows", [late.status, late.sold.length, late.error], ["timeout", 0, "SoldComps didn't respond"]);

// --- the request -----------------------------------------------------------
ok("titles form", isTitleRequest({ cards: [{ id: "JO28", title: "Kingdra 032/182" }] }));
ok("fields form is not", !isTitleRequest({ cards: [{ sku: "A", name: "Kingdra", title: "Kingdra 032/182" }] }));
ok("mixed is not", !isTitleRequest({ cards: [{ id: "A", title: "x" }, { name: "Kingdra" }] }));
eq("one title, however spaced", titleKey("  Kingdra   032/182 ") === titleKey("kingdra 032/182"), true);

const route = readFileSync(new URL("../apps/app/app/api/batch-comps/route.js", import.meta.url), "utf8");
const titlePath = route.slice(route.indexOf("async function titleResponse"));
ok("the title path never asks for active listings", !/sold:\s*false|\/api\/active|"active"/.test(titlePath));
ok("the title path sends only the first query", (titlePath.match(/getComps\(/g) || []).length === 1 && !/queries\[1\]/.test(titlePath));
ok("the title path is grouped by title", /titleKey\(/.test(titlePath));
ok("and by the condition asked, which changes the answer but not the search", /group\.condition/.test(titlePath));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("check-titlecomps: ok");
