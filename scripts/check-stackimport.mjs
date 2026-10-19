/**
 * Stacks' auto-import, now that it also runs at 3am with nobody watching.
 *
 *   node scripts/check-stackimport.mjs      (or: npm run check)
 *
 * The button had one person reading the result. The nightly sync has none,
 * so the failures that matter are the quiet ones:
 *
 * - A failed read that looks like an empty one. If `stack_cards` comes back
 *   short, every SKU looks new and the night adds a second copy of the whole
 *   inventory. A read error must stop the import before it writes anything.
 * - A sold card imported into a stack. eBay leaves a sold listing in the
 *   ActiveList at quantity 0, so a SKU that sold before it was ever stacked
 *   would arrive as a card on the shelf that is not there.
 * - Another account's rows. The cron uses the service-role key, so no RLS
 *   stands behind a missing `user_id` filter.
 *
 * Supabase is faked. Nothing here touches the network.
 */
import { readFileSync } from "node:fs";
import { planStackImport, runStackImport, stackImportNote } from "../apps/app/lib/stack-import.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── the plan ─────────────────────────────────────────────────────────────────

console.log("What the plan imports");
{
  const p = planStackImport({
    listings: [
      { sku: "A50", title: "Umbreon", ebay_item_id: "1", quantity: 1 },
      { sku: "YGO-A12", title: "Dark Magician", ebay_item_id: "2", quantity: null },
      { sku: "a50", title: "Umbreon again", ebay_item_id: "3", quantity: 1 },
      { sku: "B7", title: "Sold one", ebay_item_id: "4", quantity: 0 },
      { sku: "C1", title: "Already stacked", ebay_item_id: "5", quantity: 1 },
      { sku: "my-weird-sku-x", title: "?", ebay_item_id: "6", quantity: 1 },
      { sku: null, title: "no sku", ebay_item_id: "7", quantity: 1 }
    ],
    existingSkus: ["c1"],
    stacks: [{ id: "sA", name: "a" }]
  });
  const skus = p.cards.map((c) => c.sku);
  check("A50 and YGO-A12 are imported", skus.includes("A50") && skus.includes("YGO-A12"), skus.join(","));
  check("two listings under one SKU are one card", skus.filter((s) => s.toLowerCase() === "a50").length === 1);
  check("a quantity-0 listing is skipped as sold out", !skus.includes("B7") && p.soldOut === 1);
  check("a missing quantity is NOT sold out", skus.includes("YGO-A12"));
  check("a SKU already in a stack is skipped, whatever its case", !skus.includes("C1") && p.already === 1);
  check("a non-standard SKU is counted, not guessed", p.unparseable === 1);
  check("an existing stack is reused, whatever its case", !p.newStacks.includes("A"));
  check("a stack that doesn't exist yet is created", p.newStacks.includes("YGO-A"));
  check("the position is the SKU's number", p.cards.find((c) => c.sku === "YGO-A12")?.num === 12);
}

// ── a fake Supabase ──────────────────────────────────────────────────────────

function fakeSb(tables, { failRead = null } = {}) {
  const log = { inserts: [], unfilteredReads: [] };
  const from = (table) => {
    const filters = [];
    let op = "select";
    let payload = null;
    let range = null;
    const q = {
      select: () => q,
      eq: (col, val) => { filters.push([col, val]); return q; },
      not: () => q,
      order: () => q,
      range: (a, b) => { range = [a, b]; return q; },
      insert: (rows) => { op = "insert"; payload = rows; return q; },
      single: () => q,
      then: (res, rej) => Promise.resolve(run()).then(res, rej)
    };
    function run() {
      if (op === "insert") {
        const rows = Array.isArray(payload) ? payload : [payload];
        log.inserts.push({ table, rows });
        if (table === "card_stacks") {
          const row = { id: `new-${rows[0].name}`, name: rows[0].name, user_id: rows[0].user_id };
          tables.card_stacks.push(row);
          return { data: row, error: null };
        }
        tables[table].push(...rows);
        return { data: null, error: null };
      }
      if (!filters.some(([c]) => c === "user_id")) log.unfilteredReads.push(table);
      if (failRead === table) return { data: null, error: { message: `${table} timed out` } };
      let rows = tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows, error: null };
    }
    return q;
  };
  return { sb: { from }, log };
}

function world() {
  return {
    ebay_listings: [
      { id: "l1", user_id: "me", sku: "A1", title: "Card A1", ebay_item_id: "i1", quantity: 1 },
      { id: "l2", user_id: "me", sku: "B2", title: "Card B2", ebay_item_id: "i2", quantity: 1 },
      { id: "l3", user_id: "them", sku: "Z9", title: "Someone else's", ebay_item_id: "i9", quantity: 1 }
    ],
    stack_cards: [{ id: "s1", user_id: "me", sku: "A1" }],
    card_stacks: [{ id: "stA", user_id: "me", name: "A" }]
  };
}

console.log("Running it");
{
  const t = world();
  const { sb, log } = fakeSb(t);
  const r = await runStackImport(sb, "me");
  check("imports the one new card", r.imported === 1, JSON.stringify(r));
  check("creates the one missing stack", r.created === 1 && t.card_stacks.some((s) => s.name === "B"));
  check("never touches another account's listing", !t.stack_cards.some((c) => c.sku === "Z9"));
  check("every read is filtered on the user by hand", log.unfilteredReads.length === 0, log.unfilteredReads.join(","));
  check("every row written carries the user", log.inserts.every((i) => i.rows.every((row) => row.user_id === "me")));

  const again = await runStackImport(sb, "me");
  check("running it twice adds nothing the second time", again.imported === 0 && again.created === 0, JSON.stringify(again));
}

console.log("A failed read stops the import before it writes anything");
for (const table of ["stack_cards", "ebay_listings", "card_stacks"]) {
  const t = world();
  const { sb, log } = fakeSb(t, { failRead: table });
  let err = null;
  try {
    await runStackImport(sb, "me");
  } catch (e) {
    err = e;
  }
  check(`${table} unreadable: throws`, !!err);
  check(`${table} unreadable: nothing written`, log.inserts.length === 0, `${log.inserts.length} insert(s)`);
}

console.log("What it says");
check("counts sold-out skips", /2 sold out on eBay/.test(stackImportNote({ imported: 3, stacks: 1, created: 0, already: 4, soldOut: 2, unparseable: 0, failed: 0 })));
check("says when rows couldn't be saved", /couldn't be saved/.test(stackImportNote({ imported: 0, stacks: 1, created: 0, already: 0, soldOut: 0, unparseable: 0, failed: 5 })));

// ── one definition ───────────────────────────────────────────────────────────

console.log("One import, two callers");
const stacksSrc = readFileSync(new URL("../apps/app/app/panel/Stacks.js", import.meta.url), "utf8");
const cronSrc = readFileSync(new URL("../apps/app/app/api/cron/sync/route.js", import.meta.url), "utf8");
check("Stacks calls runStackImport", /runStackImport\(/.test(stacksSrc));
check("Stacks no longer parses SKUs itself", !/stackFromSku\(/.test(stacksSrc));
check("the nightly sync calls runStackImport", /runStackImport\(admin/.test(cronSrc));
check("…only after the listings refresh succeeded", /if \(listingsOk\)\s*\{\s*try\s*\{\s*const r = await runStackImport/.test(cronSrc));

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall stack-import checks passed");
