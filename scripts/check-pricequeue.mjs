/**
 * The pricing queue (apps/app/lib/pricing-queue.js, pricing-worker.js,
 * migration 048).
 *
 *   node scripts/check-pricequeue.mjs      (or: npm run check)
 *
 * Born from wanting ten batches priced at once without ten tabs each pacing
 * only itself against SoldComps' one limit. What it pins:
 *
 * - ONE worker per account: two claims at once, one wins; a live lease is
 *   never taken; an expired one is; only the holder renews.
 * - The worker prices oldest job first, a few cards a step, writes as it goes,
 *   finishes a job, moves to the next, and stops at its budget saying more
 *   is due; a cancel mid-step keeps the answers and stays cancelled; a refused
 *   key fails that job and stops the queue, leaving the rest queued.
 * - Answers on rows: a typed price kept, a listed row untouched, the same job
 *   read twice changes nothing, a later job beats an earlier one.
 * - Greps: the two tables named in one file; the route and the worker price
 *   through the same priceFieldCards; the worker paces at QUEUE_GAP_MS, under
 *   60 a minute; the hand-on needs CRON_SECRET; Add copies queues rather than
 *   pricing in the tab whenever batches are available.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  QUEUE_GAP_MS, QUEUE_CHUNK, remainingCards, nextChunk, stepTotals, applyJobs, queueEta, isOpen,
  enqueueJob, listJobs, cancelJob, claimLease, renewLease, releaseLease, leaseState, batchJobs
} from "../apps/app/lib/pricing-queue.js";
import { runPricingQueue } from "../apps/app/lib/pricing-worker.js";
import { labCardFor, compsFromResult, applyComps } from "../apps/app/lib/lab-pricing.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- a fake Supabase that honours the filters this code uses ----------------
function fakeDb() {
  const tables = { pricing_jobs: [], pricing_leases: [] };
  let n = 0;
  const sb = {
    tables,
    from(name) {
      if (!tables[name]) throw new Error(`unexpected table ${name}`);
      const rows = tables[name];
      const filters = [];
      let op = "select", payload = null, opts = {}, lim = null, orders = [];
      const match = (r) => filters.every((f) => f(r));
      const run = () => {
        if (op === "insert") { const r = { id: `job${++n}`, created_at: new Date(Date.UTC(2026, 10, 25, 0, 0, n)).toISOString(), done: 0, priced: 0, no_price: 0, failed: 0, searches: 0, cache_hits: 0, ...payload }; rows.push(r); return { data: [structuredClone(r)], error: null }; }
        if (op === "upsert") {
          const key = opts.onConflict;
          if (!rows.some((r) => r[key] === payload[key])) rows.push({ ...payload });
          else if (!opts.ignoreDuplicates) Object.assign(rows.find((r) => r[key] === payload[key]), payload);
          return { data: null, error: null };
        }
        if (op === "update") { const hit = rows.filter(match); for (const r of hit) Object.assign(r, structuredClone(payload)); return { data: hit.map((r) => structuredClone(r)), error: null }; }
        let out = rows.filter(match).map((r) => structuredClone(r));
        for (const [k, asc] of orders.slice().reverse()) out.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1));
        if (lim != null) out = out.slice(0, lim);
        return { data: out, error: null };
      };
      const q = {
        select: () => q,
        insert: (p) => { op = "insert"; payload = p; return q; },
        update: (p) => { op = "update"; payload = p; return q; },
        upsert: (p, o) => { op = "upsert"; payload = p; opts = o || {}; return q; },
        eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
        in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
        lt: (k, v) => { filters.push((r) => String(r[k]) < String(v)); return q; },
        order: (k, o) => { orders.push([k, o?.ascending !== false]); return q; },
        limit: (x) => { lim = x; return q; },
        single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res, rej) => Promise.resolve(run()).then(res, rej)
      };
      return q;
    }
  };
  return sb;
}

const card = (name) => ({ name, number: "1/100", set: "Base", condition: "NM", game: "pokemon" });
const cards = (k, n) => Array.from({ length: n }, (_, i) => ({ rowId: `${k}${i}`, card: card(`${k}-${i}`) }));

// ---- pure --------------------------------------------------------------------
{
  const job = { cards: cards("r", 5), results: { r0: { pence: 249 }, r2: { pence: 499 } } };
  eq("what is left", remainingCards(job).map((c) => c.rowId), ["r1", "r3", "r4"]);
  eq("a step is the next few", nextChunk(job, 2).map((c) => c.rowId), ["r1", "r3"]);
  eq("the counters", stepTotals({ done: 2, priced: 2 }, { a: { pence: 100 }, b: { pence: null }, c: { error: "x" } }, { searches: 9, cacheHits: 2 }),
    { done: 5, priced: 3, no_price: 1, failed: 1, searches: 9, cache_hits: 2 });
  ok("queued and running are open", isOpen({ status: "queued" }) && isOpen({ status: "running" }) && !isOpen({ status: "done" }));
  ok("one search every 1.5s is under 60 a minute", 60000 / QUEUE_GAP_MS <= 54);

  const rows = [
    { id: "a", pricePence: null }, { id: "b", pricePence: 999 }, { id: "c", pricePence: null, result: { ok: true } }, { id: "d", pricePence: null }
  ];
  const j1 = { id: "j1", created_at: "2026-11-25T10:00:00Z", results: { a: { pence: 249 }, b: { pence: 349 }, c: { pence: 449 }, d: { pence: 100 } } };
  const j2 = { id: "j2", created_at: "2026-11-25T11:00:00Z", results: { d: { pence: 200 } } };
  const out = applyJobs(rows, [j2, j1]);
  eq("an answer prices an unpriced row", out[0].pricePence, 249);
  eq("a typed price is kept, the comps still land", [out[1].pricePence, out[1].comps.pence], [999, 349]);
  eq("a listed row is untouched", out[2].comps, undefined);
  eq("the later job's answer wins on the comps", [out[3].comps.pence, out[3].comps.job], [200, "j2"]);
  ok("reading the same jobs again changes nothing", applyJobs(out, [j1, j2]) === out);

  const eta = queueEta([
    { id: "x", status: "done", done: 10, searches: 20, created_at: "1" },
    { id: "y", status: "running", total: 10, done: 4, searches: 8, created_at: "2" },
    { id: "z", status: "queued", total: 30, done: 0, created_at: "3" }
  ], { gapMs: 1500, now: 0 });
  eq("places in the queue, and the measured cost per card", eta.map((e) => [e.id, e.place, e.cardsLeft]), [["y", 1, 6], ["z", 2, 30]]);
  eq("…the second waits for the first", eta[1].minutes, Math.round((36 * 2 * 1500) / 60000));
}
{
  const r = { id: "r1", cardName: "Riolu", cardNumber: "BW33", set: "BW Promos", title: "Riolu BW33", condition: "NM", language: "English", copies: [{ sku: "AB1" }], card: { game: "pokemon", finish: "Cosmos Holo", setCode: "BW", year: "2011" } };
  eq("a row's card", labCardFor(r), { sku: "AB1", name: "Riolu", number: "BW33", set: "BW Promos", title: "Riolu BW33", condition: "NM", language: "English", any_language: false, overseas: false, game: "pokemon", variant: "Cosmos Holo", set_code: "BW", year: "2011" });
  const c = compsFromResult({ suggested_price: 49.99, n_comps: 11, decision: "apply", flags: { few_comps: false, wide_spread: true } }, r);
  eq("an answer kept on a row", [c.pence, c.n, c.decision, c.flags], [4999, 11, "apply", ["wide_spread"]]);
  eq("a failed lookup is a hold", compsFromResult({ error: "timeout" }, r).decision, "hold");
  ok("applyComps keeps a typed price", applyComps([{ id: "r1", pricePence: 100 }], { r1: { pence: 4999 } })[0].pricePence === 100);
  ok("…and one set from old comps it never matched", applyComps([{ id: "r1", pricePence: 100, comps: { pence: 1299 } }], { r1: { pence: 949 } })[0].pricePence === 100);
  ok("a price that was the old sold comps figure follows the new one", applyComps([{ id: "r1", pricePence: 1299, comps: { pence: 1299 } }], { r1: { pence: 949 } })[0].pricePence === 949);
  ok("no price takes the new figure", applyComps([{ id: "r1", pricePence: null }], { r1: { pence: 949 } })[0].pricePence === 949);
}

// ---- the lease -----------------------------------------------------------------
{
  const sb = fakeDb();
  const now = Date.parse("2026-11-25T12:00:00Z");
  const [a, b] = await Promise.all([claimLease(sb, "u1", "A", { now }), claimLease(sb, "u1", "B", { now })]);
  ok("two claims at once: exactly one wins", [a.claimed, b.claimed].filter(Boolean).length === 1);
  eq("a live lease is not taken", (await claimLease(sb, "u1", "C", { now: now + 1000 })).claimed, false);
  const winner = a.claimed ? "A" : "B";
  eq("the holder renews", (await renewLease(sb, "u1", winner, { now })).held, true);
  eq("nobody else can", (await renewLease(sb, "u1", "C", { now })).held, false);
  eq("busy while held", (await leaseState(sb, "u1", { now: now + 1000 })).busy, true);
  eq("an expired lease is taken", (await claimLease(sb, "u1", "D", { now: now + 10 * 60_000 })).claimed, true);
  await releaseLease(sb, "u1", "D");
  eq("released is free", (await claimLease(sb, "u1", "E", { now: now + 10 * 60_000 })).claimed, true);
  eq("another account has its own lease", (await claimLease(sb, "u2", "F", { now })).claimed, true);
}

// ---- the worker ------------------------------------------------------------------
const fakePricer = (calls, { fatalAt = null, onCall = null } = {}) => async (chunk) => {
  calls.push(chunk.map((c) => c.rowId));
  if (onCall) await onCall(calls.length);
  if (fatalAt && calls.length === fatalAt) return { answers: {}, fatal: new Error("SoldComps refused the API key") };
  const answers = {};
  for (const c of chunk) answers[c.rowId] = { pence: c.rowId.endsWith("1") ? null : 249 };
  return { answers, searches: chunk.length * 3, cacheHits: 1 };
};
{
  const sb = fakeDb();
  await enqueueJob(sb, "u1", { batchId: "b1", batchName: "first", cards: cards("a", 4) });
  await enqueueJob(sb, "u1", { batchId: "b2", batchName: "second", cards: cards("b", 2) });
  await enqueueJob(sb, "u2", { batchId: "b9", batchName: "someone else's", cards: cards("z", 2) });
  await claimLease(sb, "u1", "W");
  const calls = [];
  const r = await runPricingQueue(sb, "u1", "W", { priceCards: fakePricer(calls) });
  eq("the queue ran dry", r, { more: false });
  eq("oldest job first, a step at a time", calls, [["a0", "a1", "a2"], ["a3"], ["b0", "b1"]]);
  const jobs = (await listJobs(sb, "u1")).jobs;
  eq("both jobs done", jobs.map((j) => [j.batch_name, j.status, j.done, j.priced, j.no_price, j.searches]).sort(),
    [["first", "done", 4, 3, 1, 12, ], ["second", "done", 2, 1, 1, 6]].sort());
  eq("someone else's job is never touched", sb.tables.pricing_jobs.find((j) => j.user_id === "u2").status, "queued");
  eq("the answers are kept by row", Object.keys((await batchJobs(sb, "u1", "b1")).jobs[0].results), ["a0", "a1", "a2", "a3"]);
  eq("the lease is let go", (await leaseState(sb, "u1")).busy, false);
}
{
  const sb = fakeDb();
  await enqueueJob(sb, "u1", { batchId: "b1", cards: cards("a", 9) });
  await claimLease(sb, "u1", "W");
  let t = 0;
  const calls = [];
  const r = await runPricingQueue(sb, "u1", "W", { budgetMs: 2, now: () => t, priceCards: fakePricer(calls, { onCall: () => { t += 1; } }) });
  eq("the budget ends a run and says more is due", r, { more: true });
  eq("…after the steps that fitted", calls.length, 2);
  const job = sb.tables.pricing_jobs[0];
  eq("…its work kept, still running", [job.status, Object.keys(job.results).length], ["running", 6]);
  await claimLease(sb, "u1", "W2");
  const r2 = await runPricingQueue(sb, "u1", "W2", { priceCards: fakePricer(calls) });
  eq("the next run picks up where it left off", [r2.more, calls.at(-1), sb.tables.pricing_jobs[0].status], [false, ["a6", "a7", "a8"], "done"]);
}
{
  const sb = fakeDb();
  const { job } = await enqueueJob(sb, "u1", { batchId: "b1", cards: cards("a", 6) });
  await claimLease(sb, "u1", "W");
  const calls = [];
  await runPricingQueue(sb, "u1", "W", { priceCards: fakePricer(calls, { onCall: async (k) => { if (k === 1) await cancelJob(sb, "u1", job.id); } }) });
  const j = sb.tables.pricing_jobs[0];
  eq("a cancel mid-step stays cancelled, its answers kept, nothing more priced", [j.status, Object.keys(j.results).length, calls.length], ["cancelled", 3, 1]);
  eq("a finished job can't be cancelled", (await cancelJob(sb, "u1", job.id)).ok, false);
}
{
  const sb = fakeDb();
  await enqueueJob(sb, "u1", { batchId: "b1", cards: cards("a", 3) });
  await enqueueJob(sb, "u1", { batchId: "b2", cards: cards("b", 3) });
  await claimLease(sb, "u1", "W");
  const r = await runPricingQueue(sb, "u1", "W", { priceCards: fakePricer([], { fatalAt: 1 }) });
  eq("a refused key stops the queue", r.more, false);
  eq("…that job says why, the next stays queued", sb.tables.pricing_jobs.map((j) => [j.status, j.error || null]), [["failed", "SoldComps refused the API key"], ["queued", null]]);
}
{
  const sb = fakeDb();
  eq("nothing to price is refused", (await enqueueJob(sb, "u1", { batchId: "b", cards: [] })).ok, false);
  eq("a card with no name is not queued", (await enqueueJob(sb, "u1", { batchId: "b", cards: [{ rowId: "x", card: { name: "" } }] })).ok, false);
}

// ---- greps -----------------------------------------------------------------------
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(m?js|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}
const files = walk("apps");
for (const t of ["pricing_jobs", "pricing_leases"]) {
  eq(`${t} is named in one app file`, files.filter((f) => new RegExp(t).test(readFileSync(f, "utf8"))), ["apps/app/lib/pricing-queue.js"]);
}
const read = (p) => readFileSync(p, "utf8");
const worker = read("apps/app/lib/pricing-worker.js");
ok("the worker prices through priceFieldCards", /priceFieldCards\(/.test(worker));
ok("…and so does /api/batch-comps", /priceFieldCards\(/.test(read("apps/app/app/api/batch-comps/route.js")));
ok("the worker paces at QUEUE_GAP_MS with one gate per run", /createGate\(gapMs\)/.test(worker) && /gapMs = QUEUE_GAP_MS/.test(worker));
ok("the worker always lets the lease go", /finally \{\s*await releaseLease/.test(worker));
const route = read("apps/app/app/api/pricing-queue/route.js");
ok("the hand-on needs CRON_SECRET", /action === "worker"[\s\S]{0,200}Bearer \$\{secret\}/.test(route));
ok("a worker only starts on a claimed lease", /if \(!claim\.claimed\) return/.test(route));
const screen = read("apps/app/app/panel/lab/add/LabAdd.js");
ok("Add copies queues when batches are available", /if \(store !== "ok" \|\| !batchId \|\| queue\.missing\) return priceInTab\(\);/.test(screen));
ok("Add copies restarts a worker that died", /res\.busy === false && res\.jobs\.some\(isOpen\)/.test(screen));
ok("the tab and the worker price a row the same way", /labCardFor/.test(screen) && /compsFromResult/.test(screen) && /compsFromResult/.test(worker));

if (failures) {
  console.error(`check-pricequeue: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-pricequeue: ok");
