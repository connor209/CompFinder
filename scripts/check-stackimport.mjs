/**
 * Which listings become stack cards, and where.
 *
 *   node scripts/check-stackimport.mjs      (or: npm run check)
 *
 * Born from a pull sheet full of FY18, BV41 and M9 filed as "variation picks".
 * They were ordinary listings that sold before anybody pressed Auto-import —
 * and Auto-import reads the ACTIVE listings, so once the card sold it could
 * never be placed. The listings sync now places new SKUs itself, which makes
 * this plan run in the background on every sync, where a wrong rule is not
 * seen until a stack counts to the wrong card.
 */
import { readFileSync } from "node:fs";
import { stackOfSku, planStackImport, stackedNote } from "../apps/app/lib/stackimport.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// --- 1. the SKU reading ------------------------------------------------------
eq("A50", stackOfSku("A50"), { stack: "A", pos: 50 });
eq("fy18 is stack FY", stackOfSku("fy18"), { stack: "FY", pos: 18 });
eq("a separator is allowed", stackOfSku("BV-41"), { stack: "BV", pos: 41 });
eq("stray spaces", stackOfSku("  M9 "), { stack: "M", pos: 9 });
eq("a dated batch SKU names no stack", stackOfSku("26.08.06-010-029"), null);
eq("a number alone names no stack", stackOfSku("123"), null);
eq("letters alone name no stack", stackOfSku("ABC"), null);
eq("five digits is not a position", stackOfSku("A12345"), null);
eq("nothing", stackOfSku(null), null);

// --- 2. the plan -------------------------------------------------------------
const L = (sku, quantity = 1, over = {}) => ({ sku, title: `card ${sku}`, ebay_item_id: `item-${sku}`, quantity, ...over });
const plan = planStackImport({
  listings: [
    L("FY18"),                 // new, into an existing stack
    L("ZZ1"),                  // new, into a stack that doesn't exist yet
    L("a50"),                  // already a stack card under another case
    L("A51"),                  // already a stack card that was PULLED
    L("A52", 0),               // sold shell eBay left at quantity zero
    L("A53", null),            // quantity unknown is not zero
    L("26.08.06-010-029"),     // no stack in it
    L("FY19"), L("FY19"),      // one SKU on two listings is one card
    L(null), L("")             // no SKU at all
  ],
  existingSkus: ["A50", "A51 "],
  stacks: [{ id: "s-a", name: "A" }, { id: "s-fy", name: " fy " }]
});
eq("rows", plan.rows.map((r) => `${r.stack}:${r.position}:${r.sku}`), ["FY:18:FY18", "ZZ:1:ZZ1", "A:53:A53", "FY:19:FY19"]);
eq("only the missing stack is created", plan.newStacks, ["ZZ"]);
eq("already (incl. the second FY19)", plan.already, 3);
eq("sold out", plan.soldOut, 1);
eq("unparseable", plan.unparseable, 1);
eq("the listing's title and item id ride along", plan.rows[0], { stack: "FY", position: 18, sku: "FY18", title: "card FY18", ebay_item_id: "item-FY18" });
eq("an empty sync plans nothing", planStackImport({ listings: [], existingSkus: [], stacks: [] }).rows, []);

// --- 3. what a sync says -----------------------------------------------------
eq("silent when nothing was added", stackedNote({ added: 0, created: 0 }), "");
eq("silent with no stacks", stackedNote({ skipped: "no-stacks" }), "");
eq("says what it added", stackedNote({ added: 3, created: 1 }), " Added 3 new cards to stacks, 1 new stack.");
if (!stackedNote({ error: "boom" }).includes("boom")) fail("a failure is reported, not swallowed");

// --- 4. one reading, in one file ---------------------------------------------
const SKU_RE = "[A-Za-z]+)[-_ ]?(\\d{1,4})";
for (const f of ["apps/app/app/panel/Stacks.js", "apps/app/app/panel/PullSheet.js", "apps/app/lib/ebay.js"]) {
  if (readFileSync(f, "utf8").includes(SKU_RE)) fail(`${f} reads stack SKUs itself — use stackOfSku() from lib/stackimport.js`);
}
const ebay = readFileSync("apps/app/lib/ebay.js", "utf8");
if (!/importStackCards\(admin, userId, listings, \{ onlyIfStacks: true \}\)/.test(ebay)) {
  fail("syncUserListings no longer places new SKUs, or does it for users with no stacks");
}
if (!/try \{\s*stacked = await importStackCards/.test(ebay)) fail("a stack failure must never fail the listings sync");

if (failures) { console.error(`check-stackimport: ${failures} failure(s)`); process.exit(1); }
console.log("check-stackimport: ok");
