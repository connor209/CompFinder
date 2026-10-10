// pagedSelect: every paged read is in a total order, so no row is skipped.
//
// Born from the pull sheet filing stack cards under "Variation / loose picks":
// stack_cards was paged 1000 at a time with no ORDER BY, Postgres returned the
// pages in no particular order, and an order whose card was never read had no
// stack to match. Nothing errored; the card just moved to the wrong list.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pagedSelect } from "../apps/app/lib/pagedSelect.js";

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ok  ${msg}`);
  else { failed++; console.log(`  FAIL ${msg}`); }
};

// A fake table that behaves like an unordered heap scan: unless the query is
// ordered, every page is cut from a FRESH shuffle of the rows.
function fakeTable(rows, columns = ["id"]) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shuffled = () => rows.map((r) => [rand(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return () => {
    const order = [];
    const q = {
      order(col) { order.push(col); return q; },
      async range(from, to) {
        if (order.some((c) => !columns.includes(c))) return { data: null, error: { message: `column ${order} does not exist` } };
        const src = order.length ? rows.slice().sort((a, b) => String(a[order[order.length - 1]]).localeCompare(String(b[order[order.length - 1]]))) : shuffled();
        return { data: src.slice(from, to + 1), error: null };
      }
    };
    return q;
  };
}

const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `card-${String(i).padStart(5, "0")}`, sku: `EA${i}` }));
const got = await pagedSelect(fakeTable(rows));
const ids = new Set(got.map((r) => r.id));
ok(got.length === rows.length, `2500 rows read as ${got.length}`);
ok(ids.size === rows.length, `every row read exactly once (${ids.size} distinct)`);

const sales = Array.from({ length: 1200 }, (_, i) => ({ line_item_id: `li-${String(i).padStart(5, "0")}` }));
const got2 = await pagedSelect(fakeTable(sales, ["line_item_id"]), { orderBy: "line_item_id" });
ok(new Set(got2.map((r) => r.line_item_id)).size === sales.length, "a table not keyed on id pages by its own key");

// Tables with no `id` column: ordering by the default would error and read
// NOTHING, so every caller naming one must pass orderBy.
const NO_ID = ["ebay_sales", "listing_costs", "card_catalog"];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(f)) files.push(p);
  }
};
walk("apps/app");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const re = /pagedSelect\(\s*\(\)\s*=>/g;
  let m;
  while ((m = re.exec(src))) {
    // the call runs to its matching close paren
    let depth = 0, i = m.index + "pagedSelect".length, end = i;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) { end = i; break; }
    }
    const call = src.slice(m.index, end + 1);
    const table = (call.match(/from\("([a-z_]+)"\)/) || [])[1];
    if (NO_ID.includes(table)) ok(/orderBy:/.test(call), `${f}: pagedSelect over ${table} names its key`);
  }
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\npagedSelect: all passed");
