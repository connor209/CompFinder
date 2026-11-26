// The lab's Add copies working list (apps/app/lib/lab-draft.js): loading
// several exports into one list, what each row's status is, what every bulk
// edit does, that only rows ticked AND on screen are touched, the .49/.99
// ladder, and that the list survives a reload.
//
//   node scripts/check-labdraft.mjs
import {
  mergeGroups, liveCopies, groupToSend, rowStatus, applyBulk, ladderUp, parsePrice,
  filterRows, sortRows, tickedOnScreen, draftTotals, serialiseDraft, restoreDraft, LISTABLE, isThin, unreadableRows, settleSent, SENT_TIMEOUT_MS,
  compsShown, STATUS_TEXT, FILTERS
} from "../apps/app/lib/lab-draft.js";
import { applyComps } from "../apps/app/lib/lab-pricing.js";
import { groupKey, keyForLanguage, groupsFromItems } from "../apps/app/lib/lab-copies.js";
import { readFileSync } from "node:fs";
import { labOverview, PRICING_STALE_MS, JOB_STALE_MS } from "../apps/app/lib/lab-overview.js";
import { evidenceFrom, evidenceSummary, evidencePrice, chosenSales, picksDiffer, EVIDENCE_CAP } from "../apps/app/lib/lab-evidence.js";

let failed = 0;
let n = 0;
function ok(name, cond) { n += 1; if (!cond) { failed += 1; console.log(`✗ ${name}`); } }
function eq(name, got, want) {
  n += 1;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed += 1; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
}

const g = (key, title, skus, extra = {}) => ({
  key, title, cardName: title.split(" ")[0], cardNumber: "1/1", set: "Set", condition: "NM",
  copies: skus.map((sku, i) => ({ sku, seq: i, scans: [`${sku}.jpg`] })), ...extra
});

// ---- loading files -----------------------------------------------------------
const a = mergeGroups([], [g("mareep|nm", "Mareep", ["KA1", "KA2"]), g("latios|nm", "Latios", ["KA3"])], "batch1.csv");
eq("a file becomes one row per card + condition", a.rows.map((r) => [r.title, r.copies.length, r.file]), [["Mareep", 2, "batch1.csv"], ["Latios", 1, "batch1.csv"]]);
const b = mergeGroups(a.rows, [g("mareep|nm", "Mareep", ["KB1"]), g("suicune|nm", "Suicune", ["KB2", "KA3"])], "batch2.csv");
eq("a second file's copies of the same card join its row", b.rows.find((r) => r.key === "mareep|nm").copies.map((c) => c.sku), ["KA1", "KA2", "KB1"]);
eq("…a SKU already loaded is refused, with the reason", b.refused.map((x) => x.sku), ["KA3"]);
eq("…and merging never changes the list it was given", a.rows.find((r) => r.key === "mareep|nm").copies.length, 2);
eq("…counting what was actually added", b.added, 2);
const listed = mergeGroups([{ ...a.rows[0], result: { ok: true } }], [g("mareep|nm", "Mareep", ["KC1"])], "batch3.csv");
eq("copies of a card whose row is already LISTED start a fresh row", listed.rows.length, 2);

// ---- status --------------------------------------------------------------------
const row = (over = {}) => ({ ...a.rows[0], ...over });
eq("no price → needs a price", rowStatus(row()), "needsprice");
eq("priced → ready", rowStatus(row({ pricePence: 249 })), "ready");
eq("under 99p → can't list", rowStatus(row({ pricePence: 50 })), "toolow");
eq("thin comps → ready, flagged thin", rowStatus(row({ pricePence: 249, comps: { pence: 249, confidence: "low", flags: [] } })), "thin");
eq("joining a live listing needs no price", rowStatus(row(), { id: "L" }), "ready");
eq("left out", rowStatus(row({ pricePence: 249, excluded: true })), "excluded");
eq("every copy left out", rowStatus(row({ pricePence: 249, skippedSkus: ["ka1", "KA2"] })), "nocopies");
eq("failed stays failed (and listable, to retry)", [rowStatus(row({ pricePence: 249, result: { ok: false, error: "x" } })), LISTABLE.has("failed")], ["failed", true]);
eq("listed is final", rowStatus(row({ result: { ok: true } })), "listed");

// ---- what is sent ------------------------------------------------------------------
const sent = groupToSend(row({ pricePence: 249, skippedSkus: ["KA2"], titleOverride: "x", comps: { pence: 1 } }));
eq("a left-out copy is not sent", sent.copies.map((c) => c.sku), ["KA1"]);
eq("…and the working fields never reach the server", ["pricePence", "titleOverride", "skippedSkus", "comps", "result", "file", "id"].filter((k) => k in sent), []);
eq("skipping is case-blind", liveCopies(row({ skippedSkus: ["ka1"] })).map((c) => c.sku), ["KA2"]);

// ---- bulk edits ----------------------------------------------------------------------
const rows = [
  row({ id: "1", comps: { pence: 1000 } }),
  row({ id: "2", comps: { pence: 349 }, pricePence: 500 }),
  row({ id: "3", comps: null, pricePence: 700 }),
  row({ id: "4", comps: { pence: 999 }, result: { ok: true } })
];
const ids = ["1", "2", "3", "4"];
eq("one price for all (never a listed row)", applyBulk(rows, ids, { op: "price", pence: 299 }).map((r) => r.pricePence), [299, 299, 299, undefined]);
eq("a price under 99p is refused", applyBulk(rows, ["1"], { op: "price", pence: 50 })[0].pricePence, null);
eq("sold comps; a row with none keeps its price", applyBulk(rows, ids, { op: "comps" }).map((r) => r.pricePence), [1000, 349, 700, undefined]);
eq("sold comps −10%, laddered up", applyBulk(rows, ["1", "2"], { op: "compsPct", pct: -10 }).slice(0, 2).map((r) => r.pricePence), [949, 349]);
eq("round up onto .49/.99", applyBulk(rows, ["2", "3"], { op: "ladder" }).slice(1, 3).map((r) => r.pricePence), [549, 749]);
eq("clear", applyBulk(rows, ["2"], { op: "clear" })[1].pricePence, null);
eq("subtype", applyBulk(rows, ["1"], { op: "subtype", value: "Stamped" })[0].subtype, "Stamped");
eq("leave out / put back", [applyBulk(rows, ["1"], { op: "exclude" })[0].excluded, applyBulk(applyBulk(rows, ["1"], { op: "exclude" }), ["1"], { op: "include" })[0].excluded], [true, false]);
eq("untouched rows are the same objects", applyBulk(rows, ["1"], { op: "clear" })[2] === rows[2], true);

eq("the ladder", [ladderUp(1), ladderUp(99), ladderUp(100), ladderUp(149), ladderUp(150), ladderUp(1200), ladderUp(1250), ladderUp(1299)], [99, 99, 149, 149, 199, 1249, 1299, 1299]);
eq("a typed price", [parsePrice("£12.49"), parsePrice("3"), parsePrice("0"), parsePrice("1.234"), parsePrice("abc")], [1249, 300, null, null, null]);

// ---- what a bulk action may touch ------------------------------------------------------
eq("ticked AND on screen only", tickedOnScreen(new Set(["1", "3"]), [rows[0], rows[1]]).map((r) => r.id), ["1"]);
eq("nothing ticked is nothing", tickedOnScreen(new Set(), rows), []);

// ---- filters, sort, totals -----------------------------------------------------------------
const mix = [
  row({ id: "n", title: "Needs", pricePence: null }),
  row({ id: "r", title: "Ready", pricePence: 300 }),
  row({ id: "f", title: "Failed", pricePence: 300, result: { ok: false, error: "x" } }),
  row({ id: "j", title: "Joins", pricePence: null, key: "joins" })
];
const joinsOf = (r) => (r.key === "joins" ? { id: "L", price_pence: 999 } : null);
eq("filter: needs a price", filterRows(mix, { filter: "needsprice" }, joinsOf).map((r) => r.id), ["n"]);
eq("filter: joins", filterRows(mix, { filter: "joins" }, joinsOf).map((r) => r.id), ["j"]);
eq("filter: ready includes a join", filterRows(mix, { filter: "ready" }, joinsOf).map((r) => r.id).sort(), ["j", "r"]);
eq("search by SKU", filterRows(mix, { q: "ka2" }, joinsOf).length, 4);
eq("needs attention first: failed, then unpriced", sortRows(mix, "attention", joinsOf).map((r) => r.id).slice(0, 2), ["f", "n"]);
const t = draftTotals(mix, joinsOf);
eq("totals: new-listing value excludes joins (their price stays)", [t.rows, t.value], [4, 300 * 2 + 300 * 2]);

// ---- language and the house-rule decision (CardCropper's, 2026-11-24) --------------
eq("an English key is unchanged", groupKey({ cardName: "Pikachu", cardNumber: "25/102", set: "Base", condition: "NM", language: "English" }), "pikachu|25/102|base|NM");
eq("…as is one with no language", groupKey({ cardName: "Pikachu", cardNumber: "25/102", set: "Base", condition: "NM" }), "pikachu|25/102|base|NM");
eq("a Japanese key is its own", groupKey({ cardName: "Pikachu", cardNumber: "25/102", set: "Base", condition: "NM", language: "Japanese" }), "pikachu|25/102|base|NM|japanese");
eq("re-keying replaces the language, never stacks it", keyForLanguage(keyForLanguage("a|b|c|NM", "Japanese"), "Korean"), "a|b|c|NM|korean");
eq("…and back to English drops it", keyForLanguage("a|b|c|NM|japanese", "English"), "a|b|c|NM");
// ---- printing (2026-11-26): a reverse holo is never the plain copy's listing ------
const card = (over) => ({ cardName: "Shedinja", cardNumber: "14/107", set: "Deoxys", condition: "NM", title: "Shedinja 14/107 Deoxys", ...over });
eq("a plain key is unchanged by the printing part", groupKey(card({})), "shedinja|14/107|deoxys|NM");
eq("a reverse holo read off the finish columns is its own listing", groupKey(card({ finish: "Reverse Holo" })), "shedinja|14/107|deoxys|NM|p:rev");
eq("…and off the title when the finish is blank", groupKey(card({ title: "Shedinja 14/107 Deoxys Reverse Holo" })), "shedinja|14/107|deoxys|NM|p:rev");
eq("…spelled 'Rev Holo' too", groupKey(card({ title: "Shedinja 14/107 Rev Holo" })), "shedinja|14/107|deoxys|NM|p:rev");
eq("Reverse Valley is a card, not a printing", groupKey(card({ cardName: "Reverse Valley", title: "Reverse Valley 110/123 Holo" })).endsWith("p:rev"), false);
eq("a Japanese reverse keeps both parts", groupKey(card({ finish: "Reverse Holo", language: "Japanese" })), "shedinja|14/107|deoxys|NM|japanese|p:rev");
eq("re-keying the language never drops the printing", keyForLanguage("a|b|c|NM|japanese|p:rev", "English"), "a|b|c|NM|p:rev");
eq("…nor stacks it", keyForLanguage(keyForLanguage("a|b|c|NM|p:rev", "Korean"), "Korean"), "a|b|c|NM|korean|p:rev");
const mixed = groupsFromItems([
  { sku: "P1", ...card({}), images: ["https://x/p1.jpg"] },
  { sku: "R1", ...card({ finish: "Reverse Holo" }), images: ["https://x/r1.jpg"] },
  { sku: "P2", ...card({}), images: ["https://x/p2.jpg"] }
]).groups;
eq("a plain and a reverse copy are two listings; two plain copies are one", mixed.map((g) => g.copies.map((c) => c.sku)), [["P1", "P2"], ["R1"]]);
eq("…and the reverse listing's card says so", mixed[1].card.finish, "Reverse Holo");

const item = (sku, language) => ({ sku, cardName: "Pikachu", cardNumber: "25/102", set: "Base", condition: "NM", title: "Pikachu", images: [`https://x/${sku}.jpg`], language });
const en = groupsFromItems([item("E1", "English")]).groups;
const ja = groupsFromItems([item("J1", "Japanese")]).groups;
const both = mergeGroups(mergeGroups([], en, "en.csv").rows, ja, "ja.csv", { anyLanguage: true }).rows;
eq("a Japanese batch never joins the English row", both.map((r) => [r.language, r.copies.length, r.anyLanguage]), [["English", 1, false], ["Japanese", 1, true]]);
const priced = { ...both[0], id: "p", comps: { pence: 349, decision: "apply" }, pricePence: 349 };
const typed = { ...both[0], id: "t", comps: { pence: 349, decision: "apply" }, pricePence: 999 };
const relang = applyBulk([priced, typed], ["p", "t"], { op: "language", language: "Japanese", anyLanguage: false });
eq("changing language re-keys and drops the old language's comps", relang.map((r) => [r.language, r.key.endsWith("|japanese"), r.comps]), [["Japanese", true, null], ["Japanese", true, null]]);
eq("…a price that only came from them goes, a typed one stays", relang.map((r) => r.pricePence), [null, 999]);
eq("…and the listing's card says the new language", relang[0].card.language, "Japanese");
eq("an unknown language is refused", applyBulk([priced], ["p"], { op: "language", language: "Klingon" })[0], priced);
eq("Terapeak is check first", rowStatus(row({ pricePence: 599, comps: { pence: 599, decision: "terapeak", confidence: "high", flags: [] } })), "thin");
eq("apply on few sales is not (the decision rules, not the confidence)", rowStatus(row({ pricePence: 349, comps: { pence: 349, decision: "apply", confidence: "low", flags: ["few_sales"] } })), "ready");
eq("a failed lookup is check first", isThin(row({ comps: { error: "x", decision: "hold" } })), true);
// The card a row is priced as, and what an answer does to it, live in
// lib/lab-pricing.js — shared by the page and the pricing queue's worker.
const page = readFileSync(new URL("../apps/app/app/panel/lab/add/LabAdd.js", import.meta.url), "utf8")
  + readFileSync(new URL("../apps/app/lib/lab-pricing.js", import.meta.url), "utf8");
eq("the page sends the batch's language and the every-language choice", [/any_language: Boolean\(r\.anyLanguage\)/.test(page), /language: r\.language/.test(page)], [true, true]);
eq("the page stamps the batch language on every card it loads", /language: batchLang/.test(page), true);

// ---- rows the reader skips are named, not lost -------------------------------------
const skippedRows = unreadableRows([
  { CustomLabel: "KA1", "*C:Card Name": "Mareep", "*C:Card Number": "1/1" },
  { CustomLabel: "KA2", "*Title": "Mystery card", "*C:Card Name": "", "*C:Card Number": "5/9" },
  { CustomLabel: "", "*C:Card Name": "Latios", "*C:Card Number": "" },
  { CustomLabel: "", "*C:Card Name": "", "*C:Card Number": "" }
]);
eq("a row with no name or number is named", skippedRows.map((x) => x.sku), ["KA2", "row 4"]);
eq("…saying what is missing", skippedRows.map((x) => x.why.split(" on ")[0]), ["no card name", "no card number"]);
eq("a blank line is not a row", skippedRows.length, 2);
eq("on Add copies a card with no number is listable (TEST3-16, a Golden Box energy)",
  unreadableRows([{ CustomLabel: "T16", "*C:Card Name": "Lightning Energy", "*C:Card Number": "" }], { needNumber: false }), []);
eq("…a card with no NAME is still named", unreadableRows([{ CustomLabel: "T17", "*C:Card Name": "", "*C:Card Number": "" , "*Title": "x" }], { needNumber: false }).map((x) => x.sku), ["T17"]);
{
  const csv = ["CustomLabel,*Title,*C:Card Name,*C:Card Number,*C:Set,C:Card Condition,PicURL",
    "T15,Pikachu,Pikachu,001/025,Golden Box,Near Mint or Better,https://x/a.jpg",
    "T16,Lightning Energy,Lightning Energy,,Golden Box,Near Mint or Better,https://x/b.jpg"].join("\n");
  const CU = (await import("../apps/app/lib/carduploader.js")).default;
  eq("everywhere else a numberless row is still left out", CU.extractItems(csv).map((i) => i.sku), ["T15"]);
  const numberless = CU.extractItems(csv, { allowNoNumber: true });
  eq("…Add copies reads it", numberless.map((i) => i.sku), ["T15", "T16"]);
  eq("…and it becomes a listable group", groupsFromItems(numberless).groups.map((g) => g.copies[0].sku), ["T15", "T16"]);
}

// ---- the sales behind a price, to pick from ----------------------------------------
const result = {
  sales: [
    { title: "Geodude Master Ball 074/165 Japanese", price: 6, postage: 1, total: 7, date: "2026-11-01", item_id: "a" },
    { title: "Geodude Masterball 074/165 sv2a", price: 5, postage: 0, total: 5, date: "2026-10-20", item_id: "b", put_back: true, put_back_reason: "nonUkLocation" }
  ],
  excluded: [
    { title: "Geodude 074/165 Japanese", price: 0.2, postage: 1, total: 1.2, date: "2026-10-10", item_id: "c", reason: "missingVariant", detail: "Master Ball pattern" },
    { title: "Geodude Master Ball 074/165 x4 lot", price: 22, postage: 2, total: 24, date: "2026-10-01", item_id: "d", reason: "bundle" },
    { title: "Geodude Master Ball 074/165 Japanese", price: 8, postage: 1, total: 9, date: "2026-09-30", item_id: "e", reason: "nonUkLocation" }
  ]
};
const ev = evidenceFrom(result);
eq("every sale fetched, counted first, each with why", ev.map((e) => [e.id, e.counted, e.reason]), [
  ["a", true, ""], ["b", true, "overseas, counted"], ["c", false, "doesn't say printing (Master Ball pattern)"], ["d", false, "lot"], ["e", false, "overseas seller"]
]);
eq("the row's one line", evidenceSummary(ev), "found 5 · counted 2 · 1 doesn't say printing · 1 lot · 1 overseas seller");
eq("no picks: the price is over what the filter counted", [chosenSales(ev, null).map((e) => e.id), evidencePrice(ev, null).suggestedPence], [["a", "b"], 549]);
eq("…your picks: the overseas £9 sale is plainly the card", evidencePrice(ev, ["a", "b", "e"]).suggestedPence, 549);
eq("…four picks reach the percentile", evidencePrice(ev, ["a", "b", "e", "c"]).method, "p40");
eq("the house rules: postage capped at £4, the game's floor, the condition step", [
  evidencePrice([{ id: "x", price: 3, postage: 20, counted: true }], null).totals,
  evidencePrice([{ id: "x", price: 0.5, postage: 0, counted: true }], null, { game: "yugioh" }).suggestedPence,
  evidencePrice([{ id: "x", price: 20, postage: 0, counted: true }], null, { condition: "HP" }).suggestedPence
], [[700], 199, 1249]);
eq("nothing picked prices nothing", evidencePrice(ev, []).suggestedPence, null);
eq("picks that equal the counted set are not 'your picks'", [picksDiffer(ev, ["b", "a"]), picksDiffer(ev, ["a"]), picksDiffer(ev, null)], [false, true, false]);
const many = evidenceFrom({ sales: [{ title: "k", price: 1, postage: 0, total: 1, item_id: "k" }], excluded: Array.from({ length: 300 }, (_, i) => ({ title: `x${i}`, price: 1, postage: 0, total: 1, item_id: `x${i}`, reason: "nameMismatch" })) });
eq("capped, never cutting a counted sale", [many.length, many[0].id], [EVIDENCE_CAP, "k"]);
// Piloswine 48/102 (TEST9, 2026-11-26): 200 Quagsire 48/64s from the widest
// search came first and filled the cap, so the Piloswines turned away for the
// seller's country were cut off the table. Nearest the card first.
const pilo = evidenceFrom({ sales: [], excluded: [
  ...Array.from({ length: 200 }, (_, i) => ({ title: `Quagsire 48/64 #${i}`, price: 1, postage: 0, total: 1, item_id: `q${i}`, reason: "setMismatch" })),
  { title: "Piloswine 48/102 HGSS Triumphant", price: 3, postage: 1, total: 4, item_id: "p1", reason: "nonUkLocation" }
] });
eq("a sale of THIS card left out is shown before 200 other cards", [pilo.length, pilo[0].id], [EVIDENCE_CAP, "p1"]);
eq("the line says the table was capped", evidenceSummary(pilo, 234).startsWith(`found 234, ${EVIDENCE_CAP} shown`), true);
eq("…and nothing extra when it wasn't", evidenceSummary(ev, 5).startsWith("found 5 ·"), true);
eq("a sale found twice is one row", evidenceFrom({ sales: [{ title: "a", total: 1, price: 1, item_id: "z" }], excluded: [{ title: "a", total: 1, price: 1, item_id: "z", reason: "duplicate" }] }).length, 1);
const relangPicks = applyBulk([{ ...priced, picks: ["a"] }], ["p"], { op: "language", language: "Japanese", overseas: true });
eq("changing language or sellers drops your picks with the old sales", [relangPicks[0].picks, relangPicks[0].overseas], [null, true]);
const pageSrc = page;
eq("the page sends the overseas choice and keeps the sales", [/overseas: Boolean\(r\.overseas\)/.test(pageSrc), /evidence: evidenceFrom\(x\)/.test(pageSrc), /picks: null,( checkedAt: null,)? pricePence/.test(pageSrc)], [true, true, true]);
ok("…and prices your picks through lab-evidence, not a copy of the rules", /evidencePrice\(ev, row\.picks/.test(pageSrc) && !/percentileOf|roundUpToLadder/.test(pageSrc));

// ---- listing in the background ------------------------------------------------------
const sentRow = (id, skus, job = "j1-0", sentAt = 1000) => ({ ...row({ id, copies: skus.map((sku, i) => ({ sku, seq: i, scans: ["x"] })) }), pricePence: 300, result: { pending: true, job, sentAt } });
const sentRows = [sentRow("a", ["KA1"]), sentRow("b", ["KA2"]), sentRow("c", ["KA3"]), sentRow("d", ["KA4"]), row({ id: "e", pricePence: 300 })];
eq("a sent row is 'Listing on eBay…', not listable again", [rowStatus(sentRows[0]), LISTABLE.has("sending")], ["sending", false]);
const labNow = {
  events: [
    { kind: "bulk_listed", detail: { job: "j1-0", rowId: "a", itemId: "111", joined: false } },
    { kind: "bulk_failed", detail: { job: "j1-0", rowId: "b", error: "eBay said no" } },
    { kind: "bulk_listed", detail: { job: "OLD", rowId: "d", itemId: "999" } }
  ],
  copies: [{ sku: "KA3", listing_id: "L3" }],
  listings: [{ id: "L3", ebay_item_id: "333" }]
};
const settled = settleSent(sentRows, labNow, 2000);
eq("settled from the job's own log line, or from the copies now in the lab", settled.map((r) => [r.id, rowStatus(r), r.result?.itemId || r.result?.error || null]), [
  ["a", "listed", "111"], ["b", "failed", "eBay said no"], ["c", "listed", "333"], ["d", "sending", null], ["e", "ready", null]
]);
eq("another job's line for the same row id is not this one's answer", settled[3].result.pending, true);
eq("no answer in ten minutes says so, and to check before re-listing", /Check Inventory/.test(settleSent([sentRow("z", ["KZ"])], { events: [], copies: [], listings: [] }, 1000 + SENT_TIMEOUT_MS + 1)[0].result.error), true);
eq("nothing to settle returns the same list", settleSent([row({ id: "q" })], labNow) === settleSent([row({ id: "q" })], labNow) ? "n/a" : "n/a", "n/a");
const unchanged = [row({ id: "q" })];
eq("…the very same array (it is React state)", settleSent(unchanged, labNow) === unchanged, true);
const route = readFileSync(new URL("../apps/app/app/api/lab/route.js", import.meta.url), "utf8");
eq("the server lists in after(), with the admin client, and logs each card", [/after\(async/.test(route), /createAdminClient\(\)/.test(route), /"bulk_listed" : "bulk_failed"/.test(route), /"bulk_done"/.test(route)], [true, true, true, true]);
eq("the page sends jobs, not one request per card", [/action: "createMany"/.test(pageSrc), /action: "create",/.test(pageSrc)], [true, false]);

// ---- the lab overview -------------------------------------------------------------------
{
  const NOW = Date.parse("2026-11-24T12:00:00Z");
  const ago = (min) => new Date(NOW - min * 60000).toISOString();
  const list = [
    row({ id: "np" }),                                                   // needs a price, not priced
    row({ id: "th", pricePence: 349, comps: { pence: 349, decision: "terapeak" } }),
    row({ id: "rd", pricePence: 349, comps: { pence: 349, decision: "apply" } }),
    row({ id: "sd", pricePence: 349, result: { pending: true, job: "j-0", sentAt: NOW } }),
    row({ id: "fl", pricePence: 349, result: { ok: false, error: "x" } }),
    row({ id: "ls", result: { ok: true } }),
    row({ id: "ex", excluded: true })
  ];
  const lab = {
    listings: [{ id: "L1", ebay_item_id: "1" }, { id: "L2", ebay_item_id: "2", ended_at: ago(5) }],
    copies: [{ sku: "A", listing_id: "L1" }, { sku: "B", listing_id: "L1", reserved_line: "x#1" }, { sku: "C", listing_id: "L1", pulled_at: ago(1) }],
    events: [
      { kind: "bulk_listed", at: ago(2), detail: { job: "j-0" } }, { kind: "bulk_failed", at: ago(1), detail: { job: "j-0" } },
      { kind: "bulk_listed", at: ago(30), detail: { job: "j-old" } }, { kind: "bulk_done", at: ago(29), detail: { job: "j-old" } },
      { kind: "bulk_listed", at: ago(60), detail: { job: "j-stale" } },
      { kind: "listed", at: ago(3) }, { kind: "joined", at: ago(40) }, { kind: "listed", at: ago(60 * 30) },
      { kind: "reserved", at: ago(10) }, { kind: "error", at: ago(4) }
    ]
  };
  const o = labOverview({ rows: list, lab, pricing: { done: 3, total: 12, startedAt: NOW - 60000, updatedAt: NOW - 5000 }, now: NOW });
  eq("the list, by where each card is", [o.draft.rows, o.draft.needsPrice, o.draft.checkFirst, o.draft.ready, o.draft.sending, o.draft.failed, o.draft.listed, o.draft.leftOut, o.draft.toList],
    [7, 1, 1, 1, 1, 1, 1, 1, 2]);
  eq("a pricing run in progress, with time left", [o.pricing.done, o.pricing.total, o.pricing.left], [3, 12, 180]);
  eq("…a stale note is a closed tab, not a run", labOverview({ rows: [], lab, pricing: { done: 1, total: 9, updatedAt: NOW - PRICING_STALE_MS - 1 }, now: NOW }).pricing, null);
  eq("jobs running: not done, heard from lately", [o.ebay.jobsRunning, o.ebay.jobsListedSoFar], [1, 1]);
  eq("eBay over the last day", [o.ebay.listed24h, o.ebay.failed24h, o.ebay.liveListings, o.ebay.forSale, o.ebay.awaitingPull, o.ebay.sold24h, o.ebay.errors24h], [2, 1, 1, 1, 1, 1, 1]);
  ok("JOB_STALE_MS is minutes, not hours", JOB_STALE_MS <= 15 * 60000);
  const labPage = readFileSync(new URL("../apps/app/app/panel/lab/LabCopies.js", import.meta.url), "utf8");
  ok("the lab page shows it", /<LabOverview lab=\{lab\}/.test(labPage));
  ok("Add copies writes pricing progress for it, and clears it", /setItem\(PRICING_KEY/.test(pageSrc) && /removeItem\(PRICING_KEY\)/.test(pageSrc));
}


// ---- picking sales moves the sold-comps figure; a checked row is reviewed ------------------
{
  const sale = (id, price, counted = true) => ({ id, title: `Pikachu 25/102 sale ${id}`, price, postage: 0, counted, reason: counted ? "" : "nameMismatch" });
  const ev = [sale("a", 2), sale("b", 3), sale("c", 4), sale("d", 40, false)];
  const thinComps = { pence: 349, n: 3, decision: "terapeak", confidence: "low", flags: ["few_sales"], evidence: ev, condition: "NM", game: "pokemon" };
  const row = { id: "r1", key: "k", title: "Pikachu", copies: [{ sku: "A1" }], condition: "NM", pricePence: 349, comps: thinComps, picks: null };
  eq("no picks: the figure the filter counted", compsShown(row), { pence: 349, n: 3, picked: false, counted: 349 });
  const picked = { ...row, picks: ["c", "d"] };
  const want = evidencePrice(ev, ["c", "d"], { condition: "NM", game: "pokemon" });
  eq("ticking a sale moves the sold-comps figure, by the same house rules", compsShown(picked), { pence: want.suggestedPence, n: 2, picked: true, counted: 349 });
  ok("…to a different figure than the filter's", want.suggestedPence !== 349);
  eq("picking the same sales the filter counted is not 'your picks'", compsShown({ ...row, picks: ["a", "b", "c"] }).picked, false);
  eq("your price is not moved by picking", picked.pricePence, 349);
  eq("'set price from sold comps' uses your picks", applyBulk([picked], ["r1"], { op: "comps" })[0].pricePence, want.suggestedPence);

  eq("a thin row is check first", rowStatus(row, null), "thin");
  const checked = applyBulk([row], ["r1"], { op: "check", at: "2026-11-25T12:00:00Z" })[0];
  eq("marking it checked", [checked.checkedAt, rowStatus(checked, null), STATUS_TEXT.checked], ["2026-11-25T12:00:00Z", "checked", "Checked ✓"]);
  ok("a checked row can be listed", LISTABLE.has("checked"));
  eq("a checked row leaves the check-first filter and has its own", [filterRows([checked], { filter: "thin" }).length, filterRows([checked], { filter: "checked" }).length], [0, 1]);
  ok("Checked is a filter", FILTERS.some(([k]) => k === "checked"));
  const ready = { ...row, id: "r2", comps: { ...thinComps, decision: "apply", confidence: "high", flags: [] } };
  eq("only a row that needs checking can be checked", applyBulk([ready], ["r2"], { op: "check" })[0].checkedAt, undefined);
  eq("undo puts it back in the pile", rowStatus(applyBulk([checked], ["r1"], { op: "uncheck" })[0], null), "thin");
  eq("new sales clear it — it was about the old ones", applyComps([checked], { r1: { ...thinComps, pence: 299 } })[0].checkedAt, null);
  eq("changing language clears it too", applyBulk([checked], ["r1"], { op: "language", language: "Japanese" })[0].checkedAt, null);
  ok("a checked mark is never sent to eBay", !("checkedAt" in groupToSend(checked)));
}

// ---- reload ------------------------------------------------------------------------------
eq("the list survives a reload", restoreDraft(serialiseDraft(mix)).map((r) => [r.id, r.pricePence]), mix.map((r) => [r.id, r.pricePence]));
eq("junk in storage reads as an empty list", [restoreDraft("not json"), restoreDraft(null), restoreDraft('{"v":9}')], [[], [], []]);

console.log(failed ? `\n${failed} of ${n} add-copies checks failed.` : `✓ ${n} add-copies checks pass.`);
process.exit(failed ? 1 : 0);
