/**
 * Add copies batches (apps/app/lib/lab-batches.js, migration 047).
 *
 *   node scripts/check-labbatches.mjs      (or: npm run check)
 *
 * Born from four tabs of Add copies sharing one localStorage slot: each saved
 * its whole list over the others and a refresh showed the same list in all
 * four (2026-11-25). What it pins:
 *
 * - A save names the rev it was loaded at; a stale save writes NOTHING and
 *   says conflict. Last-write-wins between two tabs is the bug, one level up.
 * - Two batches are two rows: saving one never touches the other.
 * - The counts on the batch list come off the rows.
 * - The id in a URL is a uuid or nothing.
 * - A missing table degrades instead of throwing.
 * - Greps: `lab_batches` named in one file; the screen reads the batch from
 *   the URL, saves through saveLabBatch, and shows the conflict rather than
 *   resolving it for you; the old single-slot draft is only written when
 *   batches are unavailable.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  batchSummary, defaultBatchName, batchIdFrom, localKeyFor,
  listLabBatches, loadLabBatch, createLabBatch, saveLabBatch, deleteLabBatch, renameLabBatch
} from "../apps/app/lib/lab-batches.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- pure ----
const row = (id, file, copies, extra = {}) => ({ id, file, copies: Array.from({ length: copies }, (_, i) => ({ sku: `${id}-${i}` })), pricePence: 249, ...extra });
const rows = [row("a", "one.csv", 2), row("b", "one.csv", 1, { result: { ok: true } }), row("c", "two.csv", 3)];
eq("the counts come off the rows", batchSummary(rows), { card_count: 3, copy_count: 6, listed_count: 1, files: ["one.csv", "two.csv"] });
eq("no rows", batchSummary(null), { card_count: 0, copy_count: 0, listed_count: 0, files: [] });
const at = new Date("2026-11-25T14:05:00Z");
ok("one file names the batch after it", /^base-set · 25 Nov/.test(defaultBatchName(["base-set.csv"], at)));
ok("several files are counted", /^3 files · /.test(defaultBatchName(["a.csv", "b.csv", "c.csv"], at)));
ok("no file is still a name", /^Batch · /.test(defaultBatchName([], at)));
const uuid = "0b3c4c1e-8a1f-4f2e-9b1a-2c3d4e5f6a7b";
eq("a uuid in the URL", batchIdFrom(`?batch=${uuid.toUpperCase()}`), uuid);
eq("not a uuid", batchIdFrom("?batch=../../etc"), null);
eq("no batch", batchIdFrom(""), null);
ok("each batch has its own backup on the device", localKeyFor("x") !== localKeyFor("y"));

// ---- the store against a fake Supabase that honours eq() filters ----
function fakeDb({ missing = false } = {}) {
  const table = [];
  let n = 0;
  const err = missing ? { code: "42P01", message: 'relation "public.lab_batches" does not exist' } : null;
  const sb = {
    table,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(name) {
      if (name !== "lab_batches") throw new Error(`unexpected table ${name}`);
      const filters = [];
      let op = "select", payload = null;
      const match = (r) => filters.every(([k, v]) => r[k] === v);
      const run = () => {
        if (err) return { data: null, error: err };
        if (op === "insert") { const r = { id: `id${++n}`, ...payload }; table.push(r); return { data: [r], error: null }; }
        if (op === "update") { const hit = table.filter(match); for (const r of hit) Object.assign(r, payload); return { data: hit.map((r) => ({ ...r })), error: null }; }
        if (op === "delete") { for (let i = table.length - 1; i >= 0; i--) if (match(table[i])) table.splice(i, 1); return { data: null, error: null }; }
        return { data: table.filter(match).map((r) => ({ ...r })), error: null };
      };
      const q = {
        select: () => q, order: () => q,
        insert: (p) => { op = "insert"; payload = p; return q; },
        update: (p) => { op = "update"; payload = p; return q; },
        delete: () => { op = "delete"; return q; },
        eq: (k, v) => { filters.push([k, v]); return q; },
        limit: async () => run(),
        single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res, rej) => Promise.resolve(run()).then(res, rej)
      };
      return q;
    }
  };
  return sb;
}

{
  const sb = fakeDb();
  const a = await createLabBatch(sb, { name: "Tab one", rows: [row("a", "one.csv", 2)] });
  const b = await createLabBatch(sb, { name: "Tab two", rows: [row("b", "two.csv", 1)] });
  ok("two uploads are two batches", a.ok && b.ok && a.batch.id !== b.batch.id);
  eq("a new batch starts at rev 0", a.batch.rev, 0);

  // Tab one and a second tab both open batch A at rev 0.
  const first = await saveLabBatch(sb, { id: a.batch.id, rows: [row("a", "one.csv", 2, { pricePence: 999 })], rev: 0 });
  eq("the first save lands and moves the rev", first, { ok: true, rev: 1 });
  const stale = await saveLabBatch(sb, { id: a.batch.id, rows: [row("a", "one.csv", 2, { pricePence: 111 })], rev: 0 });
  eq("the stale tab's save is a conflict", stale, { ok: false, conflict: true });
  const got = await loadLabBatch(sb, a.batch.id);
  eq("and wrote nothing", got.batch.rows[0].pricePence, 999);
  const after = await saveLabBatch(sb, { id: a.batch.id, rows: [row("a", "one.csv", 2, { pricePence: 1499 })], rev: 1 });
  eq("a save from the current rev lands", after, { ok: true, rev: 2 });
  eq("the counts are saved with it", [got.batch.card_count, got.batch.copy_count], [1, 2]);

  const other = await loadLabBatch(sb, b.batch.id);
  eq("saving one batch never touches another", other.batch.rows.map((r) => r.id), ["b"]);

  const listed = await listLabBatches(sb);
  ok("the list never carries the rows", listed.ok && listed.batches.length === 2);
  eq("a rename needs a name", (await renameLabBatch(sb, a.batch.id, "  ")).ok, false);
  eq("a rename", (await renameLabBatch(sb, a.batch.id, " Base set run ")).name, "Base set run");
  await deleteLabBatch(sb, b.batch.id);
  eq("a deleted batch is gone", (await loadLabBatch(sb, b.batch.id)).notFound, true);
  eq("and the other stays", (await loadLabBatch(sb, a.batch.id)).ok, true);
}
{
  const sb = fakeDb({ missing: true });
  eq("before 047: list", await listLabBatches(sb), { ok: false, missing: true });
  eq("before 047: create", await createLabBatch(sb, { name: "x", rows: [] }), { ok: false, missing: true });
  eq("before 047: save", await saveLabBatch(sb, { id: "x", rows: [], rev: 0 }), { ok: false, missing: true });
}

// ---- greps ----
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(m?js|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}
const naming = walk("apps").filter((f) => /lab_batches/.test(readFileSync(f, "utf8")));
eq("lab_batches is named in one app file", naming, ["apps/app/lib/lab-batches.js"]);

const screen = readFileSync("apps/app/app/panel/lab/add/LabAdd.js", "utf8");
ok("the screen reads its batch from the URL", /batchIdFrom\(window\.location\.search\)/.test(screen));
ok("the screen saves through saveLabBatch with the loaded rev", /saveLabBatch\(createClient\(\), \{[^}]*rev:\s*revRef\.current/.test(screen));
ok("a conflict stops the saving", /res\.conflict\)\s*\{\s*conflictRef\.current = true/.test(screen));
ok("a conflict is put to you, both ways", /takeTheirs/.test(screen) && /keepMine/.test(screen));
ok("an upload with no batch open starts one", /!batchId && next\.length\)[\s\S]{0,80}startBatch\(next/.test(screen));
ok("the one-slot draft is written only without batches", /if \(store !== "ok"\) \{\s*try \{ localStorage\.setItem\(DRAFT_KEY/.test(screen));
const css = screen.slice(screen.indexOf("const EXTRA_CSS"));
ok("the batch rows wrap on a phone", /\.lb-strip, \.lb-row \{[^}]*flex-wrap:wrap/.test(css));

if (failures) {
  console.error(`check-labbatches: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-labbatches: ok");
