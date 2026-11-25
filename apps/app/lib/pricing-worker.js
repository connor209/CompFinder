/**
 * The pricing queue's worker: holds the account's lease, prices the oldest
 * open job a few cards at a time through the SAME code /api/batch-comps uses
 * (lib/batch-price-core.js), and writes each step's answers as it goes.
 *
 * One gate for the whole run, at QUEUE_GAP_MS, and one worker per account
 * (the lease) — so however many batches are queued, SoldComps sees one caller
 * at 40 a minute. A run works for WORK_BUDGET_MS and then hands on: the route
 * starts the next run, and any open Add copies tab restarts one that died.
 *
 * Server-only. `sb` is the service-role client, so every read and write in
 * pricing-queue.js names the user by hand.
 */
import { createGate } from "./pace.js";
import { BATCH_FETCH_OPTIONS, normaliseCard } from "./batch-comps.js";
import { resolveRules } from "./house-pricing.js";
import { createCompsFetcher, priceFieldCards } from "./batch-price-core.js";
import { compsFromResult } from "./lab-pricing.js";
import { rulesForPricing } from "./price-rules-store.js";
import {
  QUEUE_GAP_MS, QUEUE_CHUNK, WORK_BUDGET_MS, nextJob, nextChunk, saveJob, stepTotals, renewLease, releaseLease
} from "./pricing-queue.js";

/**
 * Work the queue until it is empty, the budget is spent, the lease is lost,
 * or SoldComps refuses the key. Returns { more } — whether another run is due.
 * `priceCards` is injectable so the check can run this with no network.
 */
export async function runPricingQueue(sb, userId, holder, {
  apiKey, budgetMs = WORK_BUDGET_MS, gapMs = QUEUE_GAP_MS, now = () => Date.now(), priceCards = null
} = {}) {
  const start = now();
  const gate = createGate(gapMs);
  const rules = resolveRules();
  // Your rules for a card, read once a run (the service client: by user_id).
  const userRules = priceCards ? new Map() : await rulesForPricing(sb, userId);
  try {
    while (now() - start < budgetMs) {
      const got = await nextJob(sb, userId);
      if (!got.ok) return { more: false, error: got.error || "the queue can't be read" };
      const job = got.job;
      if (!job) return { more: false };

      if (job.status === "queued") {
        await saveJob(sb, userId, job.id, { status: "running", started_at: new Date(now()).toISOString() });
        job.status = "running";
      }
      const chunk = nextChunk(job, QUEUE_CHUNK);
      if (!chunk.length) {
        await saveJob(sb, userId, job.id, { status: "done", finished_at: new Date(now()).toISOString() });
        continue;
      }

      let answers = {};
      let searches = 0, cacheHits = 0, fatal = null;
      if (priceCards) {
        ({ answers, searches = 0, cacheHits = 0, fatal = null } = await priceCards(chunk));
      } else {
        const engine = createCompsFetcher({ supabase: sb, apiKey, options: { ...BATCH_FETCH_OPTIONS }, gate });
        const cards = chunk.map((c, i) => normaliseCard(c.card, i));
        const results = await priceFieldCards(cards, { getComps: engine.getComps, fatalNow: engine.fatalNow, depth: 3, rules, userRules, concurrency: QUEUE_CHUNK });
        chunk.forEach((c, i) => {
          answers[c.rowId] = compsFromResult(results[i], { condition: c.card.condition, card: { game: c.card.game } });
        });
        searches = engine.stats.requests;
        cacheHits = engine.stats.cacheHits;
        fatal = engine.fatalNow();
      }

      if (fatal) {
        // A refused key or a spent quota: nothing else in the queue can price
        // either. This job says why; the rest stay queued for when it's fixed.
        await saveJob(sb, userId, job.id, { status: "failed", error: fatal.message || String(fatal), finished_at: new Date(now()).toISOString() });
        return { more: false, error: fatal.message || String(fatal) };
      }

      // Re-read before writing: a cancel pressed during the step wins, and its
      // answers so far are kept.
      const fresh = await nextJob(sb, userId);
      const stillOpen = fresh.ok && fresh.job?.id === job.id;
      const results = { ...(stillOpen ? fresh.job.results : job.results), ...answers };
      const base = stillOpen ? fresh.job : job;
      const patch = { results, ...stepTotals(base, answers, { searches, cacheHits }) };
      if (!stillOpen) {
        // Cancelled mid-step: keep what it found, leave the status alone.
        await saveJob(sb, userId, job.id, { results, ...stepTotals(job, answers, { searches, cacheHits }) });
      } else {
        if (Object.keys(results).length >= (job.cards || []).length) {
          patch.status = "done";
          patch.finished_at = new Date(now()).toISOString();
        }
        await saveJob(sb, userId, job.id, patch);
      }

      const held = await renewLease(sb, userId, holder);
      if (!held.ok || !held.held) return { more: false, error: "lost the queue to another worker" };
    }
    return { more: true };
  } finally {
    await releaseLease(sb, userId, holder);
  }
}
