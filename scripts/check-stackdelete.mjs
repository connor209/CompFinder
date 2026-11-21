/**
 * Deleting stacks, and the game areas on the Stacks screen.
 *
 *   node scripts/check-stackdelete.mjs      (or: npm run check)
 *
 * What it pins, in the order they would cost cards:
 *
 * - A stack holding a card that is AWAY (its own flag, or an open checkout of
 *   any pool naming it) is never deleted, and the refusal names the card.
 * - A failed read deletes nothing. A short read is how a card at a show is
 *   deleted with its stack.
 * - Every delete names `user_id`, and only the stacks asked for go.
 * - A stack's area is its name prefix: MTG- Magic, YGO- Yu-Gi-Oh, everything
 *   else Pokémon. A stack made on a tab lands on that tab.
 * - Nothing else deletes a stack: a grep over the app.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stackArea, newStackName, stacksInArea } from "../apps/app/lib/stack-areas.js";
import { deleteBlockers, deleteStacks, planDelete, nameCards } from "../apps/app/lib/stack-delete.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// --- 1. areas ----------------------------------------------------------------
for (const [name, want] of [
  ["MTG-A", "mtg"], ["MTG-AC", "mtg"], ["mtg-c", "mtg"], ["MTG C", "mtg"],
  ["YGO-A", "ygo"], ["YGO_B", "ygo"], ["ygo-aa", "ygo"],
  ["A", "pokemon"], ["AB", "pokemon"], ["Stack 3", "pokemon"], ["Toploaders", "pokemon"],
  ["Show Binder 2 · Pokémon", "pokemon"], ["GRADED", "pokemon"],
  // a prefix needs its separator: these are names, not areas
  ["MTGX", "pokemon"], ["YGOLD", "pokemon"], ["", "pokemon"]
]) eq(`area of "${name}"`, stackArea(name), want);
eq("area of a stack object", stackArea({ name: "MTG-B" }), "mtg");
eq("stacks in an area", stacksInArea([{ name: "A" }, { name: "MTG-A" }, { name: "YGO-A" }], "mtg").map((s) => s.name), ["MTG-A"]);

eq("C typed on MTG becomes MTG-C", newStackName("C", "mtg"), { name: "MTG-C" });
eq("MTG-C typed on MTG stays MTG-C", newStackName("MTG-C", "mtg"), { name: "MTG-C" });
eq("A typed on YGO becomes YGO-A", newStackName(" A ", "ygo"), { name: "YGO-A" });
eq("a Pokémon name stays as typed", newStackName("Stack 4", "pokemon"), { name: "Stack 4" });
eq("another game's prefix is refused", !!newStackName("YGO-A", "mtg").error, true);
eq("…and on the Pokémon tab", !!newStackName("MTG-A", "pokemon").error, true);
eq("a blank name is refused", !!newStackName("  ", "pokemon").error, true);

// --- 2. blockers -------------------------------------------------------------
const card = (id, over = {}) => ({ id, sku: id.toUpperCase(), stack_id: "s1", pulled_at: null, checked_out_at: null, ...over });
eq("nothing away, nothing blocks", deleteBlockers([card("a"), card("b")], []).map((c) => c.id), []);
eq("the card's own flag blocks", deleteBlockers([card("a", { checked_out_at: "x" }), card("b")]).map((c) => c.id), ["a"]);
eq("an open checkout naming it blocks, flag cleared or not",
  deleteBlockers([card("a"), card("b")], [{ stack_card_id: "b", resolved_at: null }]).map((c) => c.id), ["b"]);
eq("an open checkout by SKU blocks",
  deleteBlockers([card("a"), card("b")], [{ stack_card_id: null, sku: "a", resolved_at: null }]).map((c) => c.id), ["a"]);
eq("a resolved checkout does not",
  deleteBlockers([card("a")], [{ stack_card_id: "a", resolved_at: "2026-11-01" }]).map((c) => c.id), []);
eq("a pulled card never blocks", deleteBlockers([card("a", { pulled_at: "x", checked_out_at: "y" })]).map((c) => c.id), []);
eq("a refusal names the cards", nameCards([1, 2, 3, 4, 5, 6, 7].map((n) => ({ sku: `A${n}` }))), "A1, A2, A3, A4, A5 and 2 more");

// --- 3. against a fake Supabase -----------------------------------------------
function fakeSb({ cards = [], checkouts = [], failOn = null }) {
  const deleted = [];
  const reads = [];
  const sb = {
    deleted, reads,
    from(table) {
      const q = { table, filters: [], op: "select" };
      const chain = {
        select() { return chain; },
        delete() { q.op = "delete"; return chain; },
        eq(col, v) { q.filters.push(["eq", col, v]); return chain; },
        is(col, v) { q.filters.push(["is", col, v]); return chain; },
        in(col, v) { q.filters.push(["in", col, v]); return chain; },
        order() { return chain; },
        range() { return chain; },
        then(res, rej) {
          return Promise.resolve(run()).then(res, rej);
        }
      };
      function run() {
        if (failOn === table) return { data: null, error: { message: "network down" } };
        reads.push(q);
        if (q.op === "delete") { deleted.push(q); return { error: null }; }
        let rows = table === "stack_cards" ? cards : table === "stock_checkouts" ? checkouts : [];
        for (const [op, col, v] of q.filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === v);
          if (op === "in") rows = rows.filter((r) => v.includes(r[col]));
          if (op === "is") rows = rows.filter((r) => (r[col] ?? null) === v);
        }
        return { data: rows, error: null };
      }
      return chain;
    }
  };
  return sb;
}
const U = "user-1";
const rows = [
  card("a", { user_id: U, stack_id: "s1" }),
  card("b", { user_id: U, stack_id: "s1", pulled_at: "2026-11-01" }),
  card("c", { user_id: U, stack_id: "s2" })
];

{
  const sb = fakeSb({ cards: rows });
  const r = await deleteStacks(sb, U, ["s1"]);
  eq("deletes the stack asked for, counting pulled cards too", [r.deleted, r.cards, r.error], [1, 2, null]);
  eq("…and only that one", sb.deleted.map((d) => d.filters.find((f) => f[1] === "id")[2]), ["s1"]);
  eq("…naming user_id", sb.deleted.every((d) => d.filters.some((f) => f[1] === "user_id" && f[2] === U)), true);
  eq("every read names user_id", sb.reads.filter((q) => q.op === "select").every((q) => q.filters.some((f) => f[1] === "user_id")), true);
}
{
  const sb = fakeSb({ cards: rows, checkouts: [{ id: "co1", user_id: U, stack_card_id: "a", sku: "A", resolved_at: null }] });
  const r = await deleteStacks(sb, U, ["s1"]);
  eq("a card out at a show refuses the delete", [r.deleted, r.blockers.map((c) => c.id)], [0, ["a"]]);
  eq("…and nothing was deleted", sb.deleted.length, 0);
}
{
  const sb = fakeSb({ cards: rows, failOn: "stack_cards" });
  const r = await deleteStacks(sb, U, ["s1"]);
  eq("a failed card read deletes nothing", [r.deleted, !!r.error, sb.deleted.length], [0, true, 0]);
}
{
  const sb = fakeSb({ cards: rows, failOn: "stock_checkouts" });
  const p = await planDelete(sb, U, ["s1"]);
  eq("a failed checkout read is an error, not 'nothing away'", !!p.error, true);
}

// --- 4. greps ----------------------------------------------------------------
// Nothing but stack-delete.js deletes a stack, bar the load's own rollback of
// a divider it has just written and failed to fill.
const ROOT = new URL("../apps/app/", import.meta.url).pathname;
const ALLOWED = new Set(["lib/stack-delete.js", "lib/cardmarket-store.js"]);
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|jsx)$/.test(f)) out.push(p);
  }
  return out;
}
for (const f of walk(ROOT)) {
  const rel = f.slice(ROOT.length);
  const src = readFileSync(f, "utf8");
  if (/from\(\s*["']card_stacks["']\s*\)\s*\.delete\(/.test(src) && !ALLOWED.has(rel)) {
    fail(`${rel} deletes a card_stacks row itself — go through deleteStacks() in lib/stack-delete.js`);
  }
}
const stacksSrc = readFileSync(join(ROOT, "app/panel/Stacks.js"), "utf8");
if (!/areaStacks\.map/.test(stacksSrc) || /sortedStacks\.map\(\(s\) => \(\s*<button/.test(stacksSrc)) {
  fail("Stacks.js renders stack tabs from every game rather than the chosen area");
}

if (failures) {
  console.error(`check-stackdelete: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-stackdelete: ok");
