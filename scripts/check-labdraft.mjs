// The lab's Add copies working list (apps/app/lib/lab-draft.js): loading
// several exports into one list, what each row's status is, what every bulk
// edit does, that only rows ticked AND on screen are touched, the .49/.99
// ladder, and that the list survives a reload.
//
//   node scripts/check-labdraft.mjs
import {
  mergeGroups, liveCopies, groupToSend, rowStatus, applyBulk, ladderUp, parsePrice,
  filterRows, sortRows, tickedOnScreen, draftTotals, serialiseDraft, restoreDraft, LISTABLE
} from "../apps/app/lib/lab-draft.js";

let failed = 0;
let n = 0;
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

// ---- reload ------------------------------------------------------------------------------
eq("the list survives a reload", restoreDraft(serialiseDraft(mix)).map((r) => [r.id, r.pricePence]), mix.map((r) => [r.id, r.pricePence]));
eq("junk in storage reads as an empty list", [restoreDraft("not json"), restoreDraft(null), restoreDraft('{"v":9}')], [[], [], []]);

console.log(failed ? `\n${failed} of ${n} add-copies checks failed.` : `✓ ${n} add-copies checks pass.`);
process.exit(failed ? 1 : 0);
