/**
 * Your rules for a card (apps/app/lib/price-rules.js, migration 050):
 * "these sales aren't this card", set once in Add copies → 🔍 see sales.
 *
 *   node scripts/check-pricerules.mjs      (or: npm run check)
 *
 * Built around 2026-11-25: a plain card auto-priced off prerelease-STAMPED
 * sales, because the engine only drops "prerelease" from a plain card's pool
 * and "stamp", "stamped" and "staff" get through. What it pins:
 *
 * - A rule is per CARD — name, number, set, printing, language, never the
 *   condition — and the server's card and an Add copies row key alike.
 * - The stamped kind catches every spelling and refuses "unstamped"; a word in
 *   the card's OWN name never trips a rule ("Staff of Nin").
 * - The server's filter leaves a breaking sale out as `yourRule`, and only for
 *   the card the rule is on.
 * - Applied on screen it re-works the figure by the house rules, a typed
 *   price stays, and taking the rule off brings back only what it took out.
 * - The feedback it writes is a 👎 "wrong card" whose comment carries the
 *   rule, and the export tallies those tags.
 * - Greps: the table is named in one store file; the route and the worker
 *   both pass the rules to priceFieldCards.
 */
import { readFileSync, readdirSync } from "node:fs";
import { ruleKeyFor, normaliseRule, saleBreaksRule, isEmptyRule, describeRule, rulesByKey, ruleComment, ruleTagsFromComment } from "../apps/app/lib/price-rules.js";
import { normaliseCard, planCard, evaluateCard } from "../apps/app/lib/batch-comps.js";
import { applyCardRule, ruleFeedbackArgs, compsShown } from "../apps/app/lib/lab-draft.js";
import { evidencePrice } from "../apps/app/lib/lab-evidence.js";
import { feedbackRecord, feedbackSummary } from "../apps/app/lib/price-feedback.js";

let failures = 0;
const fail = (m) => { console.error(`  ${m}`); failures++; };
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- which card a rule belongs to ----
const server = normaliseCard({ name: "Shedinja", number: "014/107", set: "Deoxys", variant: "", condition: "LP", language: "English" });
const row = { cardName: "Shedinja", cardNumber: "14/107", set: "Deoxys", card: { finish: "" }, language: "English", condition: "NM" };
eq("the server's card and an Add copies row key alike (padding and condition ignored)", ruleKeyFor(server), ruleKeyFor(row));
ok("a reverse holo is another card", ruleKeyFor({ ...row, card: { finish: "Reverse Holo" } }) !== ruleKeyFor(row));
ok("Japanese is another card", ruleKeyFor({ ...row, language: "Japanese" }) !== ruleKeyFor(row));
ok("another number is another card", ruleKeyFor({ ...row, cardNumber: "15/107" }) !== ruleKeyFor(row));

// ---- what a rule catches ----
const stamped = normaliseRule({ kinds: ["stamped"] });
for (const t of ["Shedinja 14/107 Prerelease Stamp", "Shedinja 14/107 STAMPED promo", "Shedinja 14/107 pre-release", "Shedinja 14/107 Staff"]) {
  ok(`stamped catches "${t}"`, !!saleBreaksRule(t, stamped, "Shedinja"));
}
for (const t of ["Shedinja 14/107 Deoxys unstamped", "Shedinja 14/107 Deoxys Holo NM", "Shedinja 14/107 not stamped", "Shedinja 14/107 sent in a stamped addressed envelope"]) {
  ok(`stamped leaves "${t}"`, !saleBreaksRule(t, stamped, "Shedinja"));
}
ok("a word in the card's own name never trips it", !saleBreaksRule("Staff of Nin 7th Edition NM", stamped, "Staff of Nin"));
ok("…but the same word elsewhere in a title does", !!saleBreaksRule("Staff of Nin 7th Edition staff promo", normaliseRule({ words: ["promo"] }), "Staff of Nin"));
const words = normaliseRule({ words: ["Shadowless", " ", "x", "Shadowless"] });
eq("words are trimmed, deduped, and a one-letter word is dropped", words.words, ["shadowless"]);
ok("a typed word is whole-word", !saleBreaksRule("Charizard shadowlessness", words, "Charizard") && !!saleBreaksRule("Charizard Shadowless 4/102", words, "Charizard"));
eq("unknown kinds are dropped", normaliseRule({ kinds: ["stamped", "nonsense"] }).kinds, ["stamped"]);
ok("nothing ticked is no rule", isEmptyRule(normaliseRule({ kinds: [], words: [], note: "just a note" })));
eq("described in words", describeRule(normaliseRule({ kinds: ["stamped"], words: ["shadowless"] })), 'no stamped · no "shadowless"');
eq("read back from the table", [...rulesByKey([{ card_key: "k", kinds: ["graded"], words: [], note: "n" }]).entries()], [["k", { kinds: ["graded"], words: [], note: "n" }]]);

// ---- the server's filter ----
let seq = 0;
const comp = (title, pounds) => ({ title, itemPricePence: Math.round(pounds * 100), postagePence: 0, itemLocation: null,
  _source: { itemId: `s${++seq}`, url: `https://www.ebay.co.uk/itm/${seq}`, endedAt: new Date(Date.now() - 5 * 864e5).toISOString() } });
const comps = [
  comp("Shedinja 14/107 Deoxys Holo", 6), comp("Shedinja 14/107 Deoxys NM", 6.5), comp("Shedinja 14/107 Deoxys", 7),
  comp("Shedinja 14/107 Deoxys Holo Stamped", 30), comp("Shedinja 14/107 Deoxys staff stamp", 40)
];
const plain = planCard(server);
const before = evaluateCard(plain, comps);
ok("a plain card drops every stamped sale on its own (the global rule, 2026-11-25)", before.sales.every((s) => !/stamp/i.test(s.title)));
eq("…each as stampedCopy", before.excluded.filter((e) => e.reason === "stampedCopy").length, 2);
const kept = evaluateCard(planCard(server), [...comps, comp("Shedinja 14/107 Deoxys not stamped", 6.2), comp("Shedinja 14/107 Deoxys unstamped holo", 6.3)]);
ok("…but keeps a seller saying it is NOT stamped", kept.sales.some((s) => /not stamped/.test(s.title)) && kept.sales.some((s) => /unstamped/.test(s.title)));
const stampedCard = evaluateCard(planCard(normaliseCard({ name: "Shedinja", number: "14/107", set: "Deoxys", title: "Shedinja 14/107 Deoxys Prerelease Stamped", condition: "NM" })), comps);
ok("a STAMPED card is never hit by it", !stampedCard.excluded.some((e) => e.reason === "stampedCopy"));
const shadow = [...comps, comp("Shedinja 14/107 Deoxys swirl", 7.5)];
const free = evaluateCard(planCard(server), shadow);
const ruled = planCard(server);
ruled.userRule = normaliseRule({ words: ["swirl"] });
const after = evaluateCard(ruled, shadow);
ok("without your rule the word gets through", free.sales.some((s) => /swirl/i.test(s.title)));
ok("with it, it doesn't", after.sales.every((s) => !/swirl/i.test(s.title)));
eq("…and goes as yourRule", after.excluded.filter((e) => e.reason === "yourRule").length, 1);
ok("…and the price comes down", after.suggested_price <= free.suggested_price);
ok("Quick Search hands the filter its settings, so a stamped card searched there keeps its sales", /plan\.settings = cardSettings/.test(readFileSync("apps/app/app/panel/QuickSearch.js", "utf8")));

// ---- on screen, no new search ----
const ev = (id, title, price, counted = true, extra = {}) => ({ id, title, price, postage: 0, total: price, date: null, url: null, counted, reason: "", ...extra });
const evidence = [ev("a", "Shedinja 14/107 Holo", 6), ev("b", "Shedinja 14/107 NM", 6.5), ev("c", "Shedinja 14/107", 7), ev("d", "Shedinja 14/107 Stamped", 30), ev("e", "Shedinja 14/107 Graded PSA 9", 90, false, { reasonCode: "graded", reason: "graded" })];
const startPence = evidencePrice(evidence, null).suggestedPence;
const r1 = { ...row, id: 1, title: "Shedinja", comps: { pence: startPence, n: 4, evidence, condition: "NM" }, pricePence: startPence, picks: ["a"], checkedAt: "2026-11-25" };
const r2 = { ...r1, id: 2, pricePence: 1999 };
const other = { ...r1, id: 3, cardNumber: "15/107" };
const [a1, a2, a3] = applyCardRule([r1, r2, other], ruleKeyFor(row), stamped);
ok("the stamped sale is left out as your rule", a1.comps.evidence.find((e) => e.id === "d").counted === false && a1.comps.evidence.find((e) => e.id === "d").reasonCode === "yourRule");
eq("the figure is re-worked off what is left", a1.comps.pence, evidencePrice(evidence.filter((e) => e.id !== "d"), ["a", "b", "c"]).suggestedPence);
eq("…n follows", a1.comps.n, 3);
eq("a price that was the old figure follows it", a1.pricePence, a1.comps.pence);
eq("a price you typed stays", a2.pricePence, 1999);
ok("picks and checked go", a1.picks === null && a1.checkedAt === null);
ok("another card is untouched", a3 === other);
ok("the sales panel's figure agrees", compsShown(a1).pence === a1.comps.pence && !compsShown(a1).picked);
const [back] = applyCardRule([a1], ruleKeyFor(row), null);
ok("taking the rule off brings the stamped sale back", back.comps.evidence.find((e) => e.id === "d").counted === true);
ok("…but never what something else left out", back.comps.evidence.find((e) => e.id === "e").counted === false);
eq("…and the figure is the original", back.comps.pence, startPence);
const listed = { ...r1, result: { ok: true } };
ok("a listed row is left alone", applyCardRule([listed], ruleKeyFor(row), stamped)[0] === listed);

// ---- feedback ----
const comment = ruleComment(normaliseRule({ kinds: ["stamped"], words: ["shadowless"], note: "no stamp on this one" }));
eq("the comment carries the rule", comment, "[rule: stamped, word:shadowless] no stamp on this one");
eq("…and reads back", ruleTagsFromComment(comment), ["stamped", "word:shadowless"]);
const fb = feedbackRecord(ruleFeedbackArgs(r1, stamped, comment));
ok("a rule is a 👎 wrong card from the lab", fb.verdict === "down" && fb.reason === "wrongCard" && fb.surface === "lab");
eq("…keyed on the card", fb.query, ruleKeyFor(row));
eq("…with the sales as they were", fb.comps_used, 4);
eq("…and no saved-run id", fb.batch_id, null);
eq("the export tallies rule tags", feedbackSummary({ votes: [fb, { ...fb, comment: "[rule: stamped]" }] }).votes.ruleTags, { stamped: 2, "word:shadowless": 1 });

// ---- greps ----
const read = (p) => readFileSync(p, "utf8");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
const naming = walk("apps/app").filter((f) => /\.(m?js)$/.test(f) && read(f).includes("card_price_rules"));
eq("card_price_rules is named in its store alone", naming, ["apps/app/lib/price-rules-store.js"]);
ok("the house route passes your rules", /userRules = await rulesForPricing\(supabase, user\.id\)/.test(read("apps/app/app/api/batch-comps/route.js")) && /rules, userRules,/.test(read("apps/app/app/api/batch-comps/route.js")));
ok("the pricing worker passes your rules", /rulesForPricing\(sb, userId\)/.test(read("apps/app/lib/pricing-worker.js")) && /rules, userRules,/.test(read("apps/app/lib/pricing-worker.js")));
ok("the filter reads plan.userRule first", /if \(plan\.userRule\)/.test(read("apps/app/lib/batch-comps.js")));
ok("nothing in core knows about card rules", !walk("packages/core").some((f) => /price-rules/.test(read(f))));

if (failures) { console.error(`check-pricerules: ${failures} failure(s)`); process.exit(1); }
console.log("check-pricerules: ok");
