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
  listLabBatches, loadLabBatch, createLabBatch, saveLabBatch, deleteLabBatch, renameLabBatch,
  batchDefaults, batchKind, batchStage, viewBatches, batchesTotals, batchProgress, nextStep, TILE_FIELDS, refreshTile, tilesToFill
} from "../apps/app/lib/lab-batches.js";
import { describeEvent } from "../apps/app/lib/lab-log.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- pure ----
const row = (id, file, copies, extra = {}) => ({ id, file, copies: Array.from({ length: copies }, (_, i) => ({ sku: `${id}-${i}` })), pricePence: 249, ...extra });
const rows = [row("a", "one.csv", 2), row("b", "one.csv", 1, { result: { ok: true } }), row("c", "two.csv", 3)];
eq("the counts come off the rows", batchSummary(rows), {
  card_count: 3, copy_count: 6, listed_count: 1, files: ["one.csv", "two.csv"],
  cover_url: null, value_pence: 249 * 6, listed_value_pence: 249, priced_count: 3, language: null, game: null
});
eq("no rows", batchSummary(null), { card_count: 0, copy_count: 0, listed_count: 0, files: [], cover_url: null, value_pence: 0, listed_value_pence: 0, priced_count: 0, language: null, game: null });
{
  const scanned = [
    { id: "x", file: "a.csv", copies: [{ sku: "A1", scans: [] }], pricePence: null, excluded: true, language: "Japanese" },
    { id: "y", file: "a.csv", copies: [{ sku: "B1", scans: ["https://cdn/b1.jpg"] }, { sku: "B2", scans: ["https://cdn/b2.jpg"] }], skippedSkus: ["B2"], pricePence: 500, language: "Japanese", card: { game: "Pokemon" } },
    { id: "z", file: "a.csv", copies: [{ sku: "C1", scans: ["https://cdn/c1.jpg"] }], pricePence: null, language: "Japanese", card: { game: "Pokemon" } }
  ];
  const t = batchSummary(scanned);
  eq("the cover is the first scan of a copy that goes", t.cover_url, "https://cdn/b1.jpg");
  eq("value is price × copies that go; a left-out row and a skipped copy don't count", [t.value_pence, t.priced_count], [500, 1]);
  eq("what the batch is", [t.language, t.game, batchKind(t)], ["Japanese", "Pokemon", "Japanese · Pokemon"]);
}

// ---- the next file into a batch is loaded the way the batch was ----
eq("a batch's settings come off its rows", batchDefaults([{ language: "Japanese", anyLanguage: false, overseas: true }, { language: "Japanese", overseas: true }]),
  { language: "Japanese", anyLanguage: false, overseas: true });
eq("…a left-out row has no say", batchDefaults([{ language: "English", overseas: true, excluded: true }, { language: "Korean" }]), { language: "Korean", anyLanguage: false, overseas: false });
eq("an empty batch is English, UK sales", batchDefaults([]), { language: "English", anyLanguage: false, overseas: false });

// ---- a tile's stage ----
const tile = (o) => ({ id: o.id || "t", name: o.name || "x", card_count: 10, listed_count: 0, priced_count: 0, created_at: o.created_at || "2026-11-20", value_pence: 0, ...o });
eq("empty", batchStage(tile({ card_count: 0 })).key, "empty");
eq("in the queue says so", batchStage(tile({}), { pricing: true }).key, "pricing");
eq("nothing priced", batchStage(tile({})).label, "Not priced");
eq("part priced", batchStage(tile({ priced_count: 4 })).label, "4 of 10 priced");
eq("all priced", batchStage(tile({ priced_count: 10 })).key, "ready");
eq("part listed", batchStage(tile({ priced_count: 10, listed_count: 3 })).label, "3 of 10 listed");
eq("a batch in the queue says so even if part listed", batchStage(tile({ priced_count: 10, listed_count: 10 }), { pricing: true }).key, "pricing");
eq("all listed", batchStage(tile({ priced_count: 10, listed_count: 10 })).key, "listed");
eq("before 049 a tile has no priced count and says it is in progress", batchStage({ card_count: 5, listed_count: 1, priced_count: undefined }).key, "listing");

// ---- the grid's search, filters and sort ----
{
  const list = [
    tile({ id: "a", name: "Base set run", language: "English", value_pence: 500, created_at: "2026-11-01", priced_count: 10 }),
    tile({ id: "b", name: "Japanese promos", language: "Japanese", value_pence: 9000, created_at: "2026-11-03", files: ["sv2a.csv"] }),
    tile({ id: "c", name: "Commons", language: "English", value_pence: 100, created_at: "2026-11-02", priced_count: 10, listed_count: 10 })
  ];
  eq("newest first", viewBatches(list).map((b) => b.id), ["b", "c", "a"]);
  eq("by value", viewBatches(list, { sort: "value" }).map((b) => b.id), ["b", "a", "c"]);
  eq("search reads the file names too", viewBatches(list, { q: "sv2a" }).map((b) => b.id), ["b"]);
  eq("search reads the kind", viewBatches(list, { q: "japanese" }).map((b) => b.id), ["b"]);
  eq("a stage", viewBatches(list, { stage: "ready" }).map((b) => b.id), ["a"]);
  eq("a language", viewBatches(list, { language: "English", sort: "oldest" }).map((b) => b.id), ["a", "c"]);
  eq("the list given is never changed", list.map((b) => b.id), ["a", "b", "c"]);
  eq("the line over the grid", batchesTotals(list), { batches: 3, cards: 30, listed: 10, value: 9600, listedValue: 0 });
}

// ---- the steps inside a batch, and the one thing to do next ----
{
  const r = (id, o = {}) => ({ id, copies: [{ sku: id }], pricePence: null, comps: null, ...o });
  const fresh = [r("1"), r("2"), r("3", { excluded: true })];
  const p0 = batchProgress(fresh);
  eq("a fresh batch: two cards, nothing priced", [p0.cards, p0.priced, p0.unpriced], [2, 0, 2]);
  eq("…so the next step is to price them", [nextStep(p0).key, nextStep(p0).button], ["price", "£ Price 2 cards"]);
  const p1 = batchProgress(fresh, () => null, new Set(["1", "2"]));
  eq("queued cards are waited for, not priced again", [p1.unpriced, p1.queued, nextStep(p1).key], [0, 2, "wait"]);
  const thinComps = { pence: 249, decision: "terapeak", confidence: "low", flags: ["few_sales"] };
  const p2 = batchProgress([r("1", { pricePence: 249, comps: thinComps }), r("2", { pricePence: 499, comps: { pence: 499, decision: "apply", confidence: "high", flags: [] } })]);
  eq("a thin price is checked first, and the ready ones can still go", [nextStep(p2).key, nextStep(p2).also], ["thin", "List the 1 ready"]);
  const p3 = batchProgress([r("1", { comps: { pence: null, decision: "terapeak" } })]);
  eq("priced but found nothing: type one", nextStep(p3).key, "needsprice");
  const p4 = batchProgress([r("1", { pricePence: 499, comps: { pence: 499, decision: "apply", confidence: "high", flags: [] } })]);
  eq("ready: list", [nextStep(p4).key, p4.readyIds], ["list", ["1"]]);
  eq("listing on the server", nextStep(batchProgress([r("1", { pricePence: 499, result: { pending: true } })])).key, "sending");
  eq("all listed", nextStep(batchProgress([r("1", { pricePence: 499, result: { ok: true } })])).key, "done");
  eq("empty", nextStep(batchProgress([])).key, "empty");
}

// ---- the log, in words ----
eq("a sale", describeEvent({ kind: "reserved", detail: { sku: "LAB-A3" } }), { text: "Sold — copy LAB-A3 reserved for the buyer.", tone: "good" });
eq("a wrong copy is loud", describeEvent({ kind: "mismatch", detail: {} }).tone, "bad");
eq("an error says what", describeEvent({ kind: "error", detail: { action: "price", message: "eBay timed out" } }).text, "Something went wrong (price): eBay timed out.");
ok("a kind nobody wrote a line for is still a sentence", /^Something happened: brand new\.$/.test(describeEvent({ kind: "brand_new", detail: { x: 1 } }).text));
ok("no line is JSON", !/[{}"]/.test(describeEvent({ kind: "listed", detail: { itemId: "123" } }).text));
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
  // A batch saved before 049 has no tile: the grid fills it in from its rows,
  // touching neither the rows nor the rev.
  const sb = fakeDb();
  const scanned = [{ id: "y", file: "f.csv", copies: [{ sku: "B1", scans: ["https://cdn/b1.jpg"] }], pricePence: 300, language: "English", card: { game: "Pokemon" } }];
  sb.table.push({ id: "old", user_id: "u1", name: "Old", rev: 4, rows: scanned, card_count: 1, cover_url: null });
  sb.table.push({ id: "bare", user_id: "u1", name: "No scans", rev: 0, rows: [{ id: "z", copies: [{ sku: "Z1", scans: [] }] }], card_count: 1, cover_url: null });
  sb.table.push({ id: "done", user_id: "u1", name: "Filled", rev: 0, rows: [], card_count: 3, cover_url: "https://cdn/x.jpg" });
  sb.table.push({ id: "empty", user_id: "u1", name: "Empty", rev: 0, rows: [], card_count: 0, cover_url: null });
  eq("only unfilled batches with cards are filled", tilesToFill(sb.table).map((b) => b.id), ["old", "bare"]);
  const r = await refreshTile(sb, "old");
  eq("the tile comes off the rows", [r.ok, r.tile.cover_url, r.tile.value_pence, r.tile.game], [true, "https://cdn/b1.jpg", 300, "Pokemon"]);
  const old = sb.table.find((b) => b.id === "old");
  eq("the rows and the rev are untouched", [old.rev, old.rows], [4, scanned]);
  await refreshTile(sb, "bare");
  eq("a batch with no scan is marked so it isn't asked again", [sb.table.find((b) => b.id === "bare").cover_url, tilesToFill(sb.table).map((b) => b.id)], ["", []]);
}
{
  // Before 049: the first write naming a tile column is refused, the save goes
  // again without them, and every later call leaves them out.
  const sb = fakeDb();
  let refusedOnce = 0;
  const real = sb.from.bind(sb);
  sb.from = (name) => {
    const q = real(name);
    const wrap = (fn) => (p) => {
      if (p && TILE_FIELDS.some((f) => f in p)) {
        refusedOnce += 1;
        const err = { data: null, error: { message: "Could not find the 'cover_url' column of 'lab_batches' in the schema cache" } };
        const dead = { select: () => dead, eq: () => dead, single: async () => err, then: (res) => Promise.resolve(err).then(res) };
        return dead;
      }
      return fn(p);
    };
    q.insert = wrap(q.insert);
    q.update = wrap(q.update);
    return q;
  };
  const made = await createLabBatch(sb, { name: "old db", rows: [row("a", "one.csv", 1)] });
  ok("a database without 049 still makes a batch", made.ok);
  eq("…asking once with the tile columns", refusedOnce, 1);
  eq("…and saves without them from then on", (await saveLabBatch(sb, { id: made.batch.id, rows: [], rev: 0 })).ok, true);
  eq("…still only refused once", refusedOnce, 1);
  ok("…and the stored row carries no tile column", !TILE_FIELDS.some((f) => f in sb.table[0]));
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
ok("the grid, New batch and the batch itself are three views of one screen", /store === "ok" && !batchId && !isNew/.test(screen) && /store === "ok" && isNew/.test(screen) && /<BatchSteps/.test(screen));
ok("New batch creates the batch before it is shown, and queues it in the same step", /startBatch\(next, picked\.map\(\(f\) => f\.name\), name\)/.test(screen) && /if \(priceNow\) queued = await queueRows/.test(screen));
ok("more files into an open batch load the way the batch was set up", /batchDefaults\(rows\)/.test(screen));
const home = readFileSync("apps/app/app/panel/lab/add/BatchHome.js", "utf8");
ok("the grid never reads a batch's rows", !/\.rows\b/.test(home));
ok("the grid fills in tiles saved before 049", /tilesToFill\(listed\.batches\)/.test(screen) && /refreshTile\(sb, b\.id\)/.test(screen));
for (const [f, tab] of [["apps/app/app/panel/lab/LabCopies.js", "overview"], ["apps/app/app/panel/lab/add/LabAdd.js", "batches"], ["apps/app/app/panel/lab/inventory/LabInventory.js", "inventory"], ["apps/app/app/panel/lab/settings/ListingSettings.js", "settings"]]) {
  ok(`${f} carries the lab's one header`, new RegExp(`<LabHeader current="${tab}"`).test(readFileSync(f, "utf8")));
}
ok("the lab's log is written in words, not JSON", !/JSON\.stringify\(e\.detail\)/.test(readFileSync("apps/app/app/panel/lab/LabCopies.js", "utf8")));
ok("the grid and New batch never wait on /api/lab", !/if \(!lab\) return/.test(screen));
ok("a batch and the list are read together, not one after the other", /Promise\.all\(\[listLabBatches\(sb\), id \? loadLabBatch\(sb, id\)/.test(screen));
ok("what was last seen is drawn at once, for the life of the page", /const MEM = \{/.test(screen) && /useState\(\(\) => MEM\.batches \|\| \[\]\)/.test(screen));
ok("a batch's rev and a save in flight are shared between screens, so leaving one never makes the next conflict with itself", /MEM\.saving\.has\(id\)/.test(screen) && /MEM\.rev\.set\(id, res\.rev\)/.test(screen));
ok("listing waits for this visit's live listings, never the remembered ones", /async function listRows\(candidates\) \{\s*if \(!labFresh\)/.test(screen));
const css = screen.slice(screen.indexOf("const EXTRA_CSS"));
ok("the batch rows wrap on a phone", /\.lb-strip, \.lb-row \{[^}]*flex-wrap:wrap/.test(css));

if (failures) {
  console.error(`check-labbatches: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-labbatches: ok");
