// What the pull sheet reads (apps/app/lib/pullsheet-read.js): the shelf, plus
// only the PULLED cards the open orders can mention — in place of every stack
// card ever made. The test that matters: run the sheet's matcher over the old
// read (everything) and the new one (shelf + asked-for pulled) against the
// same fake database, and get the same answer for every order line.
//
//   node scripts/check-pullsheetread.mjs
import { readFileSync } from "node:fs";
import { readShelfCards, readPulledFor, pulledQueryPlan } from "../apps/app/lib/pullsheet-read.js";
import { assignPulls, cuChoiceReport, pulledOutsideSheet } from "../apps/app/lib/pullmatch.js";

let failed = 0;
let n = 0;
function eq(name, got, want) {
  n += 1;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed += 1; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
}

// ---- a fake Supabase over an array, implementing exactly what the reader uses
function fakeDb(rows, { missingColumns = [] } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { cols: "*", filters: [], ranges: null };
    const api = {
      select(cols) { q.cols = cols; return api; },
      is(col, v) { q.filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return api; },
      not(col, op, v) { q.filters.push((r) => !(v === null ? r[col] == null : r[col] === v)); return api; },
      in(col, vals) { const s = new Set(vals); q.filters.push((r) => s.has(r[col])); return api; },
      or(expr) {
        const parts = expr.split(",").map((p) => p.match(/^(\w+)\.ilike\.(.*)%$/)).filter(Boolean);
        q.filters.push((r) => parts.some(([, col, pre]) => String(r[col] ?? "").toLowerCase().startsWith(pre.toLowerCase())));
        return api;
      },
      order() { return api; },
      range(a, b) {
        calls.push({ table, cols: q.cols });
        const named = q.cols === "*" ? [] : q.cols.split(",");
        const bad = named.find((c) => missingColumns.includes(c));
        if (bad) return Promise.resolve({ data: null, error: { message: `Could not find the '${bad}' column of 'stack_cards' in the schema cache` } });
        const out = rows.filter((r) => q.filters.every((f) => f(r))).sort((x, y) => String(x.id).localeCompare(String(y.id)))
          .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !missingColumns.includes(k))));
        return Promise.resolve({ data: out.slice(a, b + 1), error: null });
      }
    };
    return api;
  };
  return { from, calls };
}

// ---- a stock room: on the shelf, pulled long ago, pulled for open lines
const T = "2026-11-20T10:00:00Z";
const rows = [
  { id: "a1", stack_id: "A", position: 1, sku: "A1", pulled_at: null, pulled_line: null },
  { id: "a2", stack_id: "A", position: 2, sku: "A2", pulled_at: null, pulled_line: null },
  { id: "a3", stack_id: "A", position: 3, sku: "A3", pulled_at: T, pulled_line: "L3" },     // committed for open line L3
  { id: "a4", stack_id: "A", position: 4, sku: "A4", pulled_at: T, pulled_line: null },     // pulled in Stacks; SKU on line L4
  { id: "old", stack_id: "A", position: 5, sku: "Z9", pulled_at: T, pulled_line: "OLD" },   // history nobody asks about
  // CardUploader variation: two copies of one card, one pulled for line L5
  { id: "v1", stack_id: "IR", position: 1, sku: "IR1", listing_sku: "CS-P3NSJY_982a", pulled_at: T, pulled_line: "L5" },
  { id: "v2", stack_id: "IR", position: 2, sku: "IR2", listing_sku: "CS-P3NSJY_982a", pulled_at: null },
  // a variation whose every copy has gone: "every copy pulled", not "not stacked"
  { id: "w1", stack_id: "IR", position: 3, sku: "IR3", listing_sku: "CS-ZZZZZZ_1", pulled_at: T, pulled_line: "X" },
  // lab: a reserved copy already picked, and one on the shelf
  { id: "lab1", stack_id: "LT", position: 1, sku: "TEST-1", lab_listing_id: "LL", reserved_line: "L7#1", pulled_at: T },
  { id: "lab2", stack_id: "LT", position: 2, sku: "TEST-2", lab_listing_id: "LL", reserved_line: "L8#1", pulled_at: null },
  // away at a show
  { id: "s1", stack_id: "A", position: 6, sku: "A6", pulled_at: null, checked_out_at: T }
];
const lines = [
  { lineItemId: "L1", orderId: "O1", sku: "A1", quantity: 1 },
  { lineItemId: "L3", orderId: "O3", sku: "A3", quantity: 1 },
  { lineItemId: "L4", orderId: "O4", sku: "a4", quantity: 1 },                 // lower-case on the order
  { lineItemId: "L5", orderId: "O5", sku: "CS-P3NSJY_982a", quantity: 2 },     // one pulled, one to pick
  { lineItemId: "L6", orderId: "O6", sku: "CS-ZZZZZZ", quantity: 1 },          // nothing left
  { lineItemId: "L7", orderId: "O7", itemId: "999", sku: null, quantity: 1 },  // lab, already picked
  { lineItemId: "L8", orderId: "O8", itemId: "999", sku: null, quantity: 1 },  // lab, to pick
  { lineItemId: "L9", orderId: "O9", sku: "A6", quantity: 1 }                  // away at a show
];
const cuChoice = new Map([["O5", ["ir2"]]]);

const summary = (cards) => {
  const { units, pulledFor } = assignPulls(lines, cards, { labItemIds: new Set(["999"]), cuChoice });
  return {
    units: units.map((u) => `${u.key}:${u.card?.id || "-"}:${u.done ? "done" : u.via || u.reason || ""}`),
    // Only open lines' entries: the sheet looks pulledFor up by an OPEN
    // line's id and never reads the rest.
    pulledFor: [...pulledFor.entries()].filter(([k]) => lines.some((l) => String(l.lineItemId) === k)).map(([k, v]) => `${k}=${v.map((c) => c.id).join("+")}`).sort(),
    pulledSkus: cards.filter((c) => c.pulled_at && c.sku).map((c) => c.sku.toLowerCase()).filter((s) => lines.some((l) => (l.sku || "").toLowerCase() === s)).sort(),
    cu: cuChoiceReport(units, cuChoice, cards),
    outside: cards.filter(pulledOutsideSheet).map((c) => c.id).filter((id) => id !== "old" && id !== "w1").sort()
  };
};

{
  const db = fakeDb(rows);
  const shelf = await readShelfCards(db);
  const pulled = await readPulledFor(db, lines, cuChoice);
  eq("the shelf read is every unpulled card, nothing pulled", shelf.data.map((c) => c.id).sort(), ["a1", "a2", "lab2", "s1", "v2"]);
  eq("only the pulled cards an open line can mention", pulled.data.map((c) => c.id).sort(), ["a3", "a4", "lab1", "v1", "w1"]);
  eq("history no line names is never read", pulled.data.some((c) => c.id === "old"), false);
  eq("the matcher answers EXACTLY as it did over every card", summary([...shelf.data, ...pulled.data]), summary(rows));
  eq("named columns — scans and Cardmarket data stay on the server", db.calls.every((c) => c.cols !== "*"), true);
}

{
  // The live database had no copy_seq until 2026-11-24. A named select that
  // fails must fall back to *, never come back empty.
  const db = fakeDb(rows, { missingColumns: ["copy_seq"] });
  const shelf = await readShelfCards(db);
  const pulled = await readPulledFor(db, lines, cuChoice);
  eq("a missing column falls back to *, not to an empty shelf", [shelf.error || null, shelf.data.length], [null, 5]);
  eq("…and the pulled cards are still found", pulled.data.map((c) => c.id).sort(), ["a3", "a4", "lab1", "v1", "w1"]);
}

{
  // Before 037/042 there is no pulled_line or reserved_line at all: those
  // questions find nothing, which is what they would have found.
  const db = fakeDb(rows.map(({ pulled_line, reserved_line, lab_listing_id, listing_sku, ...r }) => r), { missingColumns: ["pulled_line", "reserved_line", "lab_listing_id", "listing_sku"] }); // eslint-disable-line no-unused-vars
  const pulled = await readPulledFor(db, lines, cuChoice);
  eq("a column a database predates reads as nothing found, never as a failure", [pulled.error || null, pulled.data.map((c) => c.id).sort()], [null, ["a3", "a4"]]);
  // (v1 is tied to its line only by pulled_line and listing_sku — without
  // either column nothing ever could find it, over the old read or the new.)
}

{
  const plan = pulledQueryPlan(lines, cuChoice);
  eq("SKUs are asked for as written, upper and lower", ["A1", "a4", "A4", "ir2", "IR2"].every((s) => plan.skus.includes(s)), true);
  eq("every unit of every line is a reservation to ask about", plan.unitKeys.filter((k) => k.startsWith("L5")), ["L5#1", "L5#2"]);
  eq("CardUploader keys, suffix off", plan.cuKeys.sort(), ["cs-p3nsjy", "cs-zzzzzz"]);
}

{
  const sheet = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
  eq("the sheet no longer reads every stack card", /from\("stack_cards"\)\.select\("\*"\)/.test(sheet), false);
  eq("the sheet reads through pullsheet-read", /readShelfCards\(sb\)/.test(sheet) && /readPulledFor\(sb, rawLines, cuChoice\)/.test(sheet), true);
  eq("the shelf read starts before the eBay answer is awaited", sheet.indexOf("readShelfCards(sb)") < sheet.indexOf("await ordersP"), true);
  eq("a failed stack read stops the sheet rather than showing an empty shelf", /shelfRes\.error \|\| pulledRes\.error/.test(sheet), true);
}

console.log(failed ? `\n${failed} of ${n} pull-sheet read checks failed.` : `✓ ${n} pull-sheet read checks pass.`);
process.exit(failed ? 1 : 0);
