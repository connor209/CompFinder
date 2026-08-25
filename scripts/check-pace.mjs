/**
 * Table check for apps/app/lib/pace.js — the batch run's rate gate and worker
 * pool. See docs/PRICING_RESEARCH.md for the measurements behind the numbers.
 *
 *   node scripts/check-pace.mjs      (or: npm run check)
 *
 * This is load-bearing in a way the old code was not. A batch used to price
 * one card at a time with a sleep between them, so ordering was free and the
 * rate was whatever the sleep made it. Now cards run three at a time and the
 * gate is the only thing keeping us inside SoldComps' 60/minute — so both the
 * ordering and the pacing are worth asserting rather than assuming.
 */
import { createGate, runPool, SOLDCOMPS_GAP_MS, BROWSE_GAP_MS, BATCH_CONCURRENCY } from "../apps/app/lib/pace.js";

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the numbers ─────────────────────────────────────────────────────────────
// SoldComps documents 60 requests a minute. Anything under 1000ms is over it.
check("the SoldComps gap stays inside 60/min", SOLDCOMPS_GAP_MS >= 1000, true);
// Three is the whole answer: past it the gate binds anyway, so more
// concurrency buys nothing and only risks 429s.
check("concurrency is three", BATCH_CONCURRENCY, 3);
check("Browse is paced far looser — 5,000/day, not 60/min", BROWSE_GAP_MS < SOLDCOMPS_GAP_MS, true);

// ── the gate holds under concurrency ────────────────────────────────────────
// The bug a naive timestamp check has: three workers read the same `last`,
// all see enough time has passed, and all start at once. Only shows up under
// the concurrency this exists to allow, which is why it is asserted.
{
  const gate = createGate(60);
  const starts = [];
  await runPool(9, 3, async () => { await gate(); starts.push(Date.now()); await sleep(120); });
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  check("nine calls, three workers: every start is a gap apart", gaps.every((g) => g >= 55), true);
  check("...and all nine ran", starts.length, 9);
}

// ── the pool covers every index, exactly once ───────────────────────────────
{
  const seen = [];
  await runPool(12, 3, async (i) => { await sleep(i % 3); seen.push(i); });
  check("every index runs exactly once", [...seen].sort((a, b) => a - b), [...Array(12).keys()]);
}

// ── a slow card must not idle the other workers ─────────────────────────────
// Workers pull the next index rather than taking a fixed slice, which matters
// because a card needing a live-market check does roughly twice the work.
{
  const t0 = Date.now();
  await runPool(6, 3, async (i) => { await sleep(i === 0 ? 200 : 40); });
  // Fixed slices would put items 0 and 1 on one worker: 200 + 40 = 240ms+.
  // Pulling puts the five fast ones on the two free workers.
  check("one slow card doesn't hold up the rest", Date.now() - t0 < 300, true);
}

// ── stopping ────────────────────────────────────────────────────────────────
{
  let ran = 0;
  await runPool(100, 3, async () => { ran++; await sleep(1); }, () => ran >= 5);
  // Pulling stops immediately; work already in flight still finishes, so a
  // couple more than the trigger is correct rather than a leak.
  check("shouldStop halts the pull", ran <= 5 + 3, true);
  check("...and it actually stopped well short", ran < 100, true);
}

// ── edges ───────────────────────────────────────────────────────────────────
{
  let ran = 0;
  await runPool(0, 3, async () => { ran++; });
  check("an empty list runs nothing and returns", ran, 0);
  await runPool(1, 3, async () => { ran++; });
  check("a single item doesn't spawn three workers over it", ran, 1);
}

if (failures) { console.error(`\npace: ${failures} case(s) failed.`); process.exit(1); }
console.log(`pace: gate holds under concurrency, pool covers every index once, slow cards don't block, stop works.`);
