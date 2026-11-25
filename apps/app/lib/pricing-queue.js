/**
 * Comp Finder — the pricing queue: what a job is, and where it is kept.
 *
 * Pricing used to run in whichever tab asked, each pacing only itself, so ten
 * batches priced at once were ten callers against SoldComps' ONE limit of 60
 * a minute. The queue makes it one consumer per account: Add copies queues a
 * job, a single worker (lib/pricing-worker.js) prices jobs oldest first at
 * QUEUE_GAP_MS between searches, and the tab reads the answers back onto its
 * rows. The rate is held by there being one worker — the lease — not by
 * anybody remembering not to open two tabs.
 *
 * `pricing_jobs` and `pricing_leases` (migration 048) are named in THIS FILE
 * ONLY. Every store call takes the client it is handed and names `user_id` by
 * hand, because the worker runs with the service-role key and no RLS behind
 * it. Pure parts first, so scripts/check-pricequeue.mjs can pin them.
 */
import { applyComps } from "./lab-pricing.js";

/**
 * One search every 1.5s — 40 a minute. Under SoldComps' 60 on purpose: the
 * queue is not the only caller (Quick Search and the Batch screen still ask
 * directly), and the 20 a minute left over is theirs.
 */
export const QUEUE_GAP_MS = 1500;
/** Cards per step: progress is written, the lease renewed and a cancel seen between steps. */
export const QUEUE_CHUNK = 3;
/** A worker's hold on the queue; renewed every step, so a dead worker frees it within this. */
export const LEASE_MS = 120_000;
/** How long one worker invocation works before handing on (Vercel stops it at 300s). */
export const WORK_BUDGET_MS = 230_000;
/** Searches a card costs at depth 3 before a job has measured its own. */
export const SEARCHES_PER_CARD_GUESS = 5;
export const JOB_MAX_CARDS = 1000;

const OPEN = ["queued", "running"];
export const isOpen = (job) => OPEN.includes(job?.status);

/** The cards a job still has to price, in order. */
export function remainingCards(job) {
  const done = job?.results || {};
  return (job?.cards || []).filter((c) => !(c.rowId in done));
}

/** The next step's cards. */
export function nextChunk(job, size = QUEUE_CHUNK) {
  return remainingCards(job).slice(0, size);
}

/** A job's counters after one step's answers. */
export function stepTotals(job, answers, { searches = 0, cacheHits = 0 } = {}) {
  let priced = 0, noPrice = 0, failed = 0;
  for (const c of Object.values(answers)) {
    if (c.error) failed += 1; else if (c.pence != null) priced += 1; else noPrice += 1;
  }
  return {
    done: (job.done || 0) + Object.keys(answers).length,
    priced: (job.priced || 0) + priced,
    no_price: (job.no_price || 0) + noPrice,
    failed: (job.failed || 0) + failed,
    searches: (job.searches || 0) + searches,
    cache_hits: (job.cache_hits || 0) + cacheHits
  };
}

/**
 * A batch's rows with every job's answers on them. An answer lands only if it
 * is NEWER than what the row already has (`pricedAt`), so reading the same
 * jobs again changes nothing, a later job beats an earlier one, and a row
 * priced since in the tab is never put back to an older answer.
 */
export function applyJobs(rows, jobs) {
  const fresh = {};
  const freshAt = {};
  for (const job of jobs || []) {
    for (const [rowId, c] of Object.entries(job.results || {})) {
      const at = c.pricedAt || job.updated_at || job.created_at || "";
      if (freshAt[rowId] && freshAt[rowId] >= at) continue;
      freshAt[rowId] = at;
      fresh[rowId] = { ...c, job: job.id, pricedAt: at };
    }
  }
  const take = {};
  for (const r of rows || []) {
    const c = fresh[String(r.id)];
    if (!c) continue;
    if (r.result?.ok || r.result?.pending) continue; // listed or listing: its price is settled
    if (r.comps?.pricedAt && r.comps.pricedAt >= c.pricedAt) continue;
    take[r.id] = c;
  }
  return Object.keys(take).length ? applyComps(rows, take) : rows;
}

/**
 * Where each open job stands in the queue and roughly when it finishes. The
 * guess uses what this account's jobs have actually cost per card once one
 * has run, which beats any constant: a cached re-run costs nearly nothing.
 */
export function queueEta(jobs, { gapMs = QUEUE_GAP_MS, now = Date.now() } = {}) {
  const measured = (jobs || []).filter((j) => j.done > 0);
  const perCard = measured.length
    ? Math.max(0.5, measured.reduce((t, j) => t + (j.searches || 0), 0) / measured.reduce((t, j) => t + j.done, 0))
    : SEARCHES_PER_CARD_GUESS;
  const open = (jobs || []).filter(isOpen).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let ahead = 0;
  return open.map((j, i) => {
    const left = Math.max(0, (j.total || 0) - (j.done || 0));
    const ms = (ahead + left) * perCard * gapMs;
    ahead += left;
    return { id: j.id, place: i + 1, cardsLeft: left, finishesAt: new Date(now + ms).toISOString(), minutes: Math.max(1, Math.round(ms / 60000)) };
  });
}

// ---- store -------------------------------------------------------------------

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /pricing_jobs|pricing_leases|does not exist|schema cache/i.test(msg);
}
const fail = (error) => (isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error?.message || String(error) });

const JOB_LIST_COLUMNS = "id,batch_id,batch_name,created_at,started_at,finished_at,updated_at,status,total,done,priced,no_price,failed,searches,cache_hits,error";

/** Queue a job: `cards` is [{ rowId, card }]. */
export async function enqueueJob(sb, userId, { batchId, batchName, cards }) {
  const list = (cards || []).filter((c) => c && c.rowId != null && c.card?.name);
  if (!list.length) return { ok: false, error: "Nothing to price — every row is priced, listed or joins a live listing." };
  if (list.length > JOB_MAX_CARDS) return { ok: false, error: `At most ${JOB_MAX_CARDS} cards a job.` };
  try {
    const { data, error } = await sb.from("pricing_jobs").insert({
      user_id: userId, batch_id: batchId || null, batch_name: batchName || null, status: "queued",
      total: list.length, cards: list.map((c) => ({ rowId: String(c.rowId), card: c.card })), results: {}
    }).select(JOB_LIST_COLUMNS).single();
    if (error) return fail(error);
    return { ok: true, job: data };
  } catch (e) { return fail(e); }
}

/** The queue as the log shows it: open jobs, then the latest finished ones. Never the cards or answers. */
export async function listJobs(sb, userId, { limit = 40 } = {}) {
  try {
    const { data, error } = await sb.from("pricing_jobs").select(JOB_LIST_COLUMNS).eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: true }).limit(limit);
    if (error) return fail(error);
    return { ok: true, jobs: data || [] };
  } catch (e) { return fail(e); }
}

/** One batch's jobs WITH their answers — what a tab reads to fill its rows in. */
export async function batchJobs(sb, userId, batchId) {
  try {
    const { data, error } = await sb.from("pricing_jobs").select(`${JOB_LIST_COLUMNS},results`).eq("user_id", userId).eq("batch_id", batchId)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50);
    if (error) return fail(error);
    return { ok: true, jobs: data || [] };
  } catch (e) { return fail(e); }
}

/** Stop a job that has not finished. Answers already written stay. */
export async function cancelJob(sb, userId, id) {
  try {
    const { data, error } = await sb.from("pricing_jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("id", id).in("status", OPEN).select("id");
    if (error) return fail(error);
    return data?.length ? { ok: true } : { ok: false, error: "That job has already finished." };
  } catch (e) { return fail(e); }
}

/** The oldest open job, with its cards and answers. */
export async function nextJob(sb, userId) {
  try {
    const { data, error } = await sb.from("pricing_jobs").select("*").eq("user_id", userId).in("status", OPEN)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1);
    if (error) return fail(error);
    return { ok: true, job: data?.[0] || null };
  } catch (e) { return fail(e); }
}

export async function saveJob(sb, userId, id, patch) {
  try {
    const { error } = await sb.from("pricing_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id);
    return error ? fail(error) : { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Take the queue for `holder` if nobody holds it. The row is made once, then
 * taken only where the lease has run out — one conditional UPDATE, so two
 * workers asking at the same moment cannot both win.
 */
export async function claimLease(sb, userId, holder, { ms = LEASE_MS, now = Date.now() } = {}) {
  try {
    const up = await sb.from("pricing_leases").upsert({ user_id: userId, lease_until: new Date(0).toISOString() }, { onConflict: "user_id", ignoreDuplicates: true });
    if (up.error) return fail(up.error);
    const { data, error } = await sb.from("pricing_leases").update({ holder, lease_until: new Date(now + ms).toISOString() })
      .eq("user_id", userId).lt("lease_until", new Date(now).toISOString()).select("user_id");
    if (error) return fail(error);
    return { ok: true, claimed: (data || []).length > 0 };
  } catch (e) { return fail(e); }
}

/** Keep holding it — only if we still do. */
export async function renewLease(sb, userId, holder, { ms = LEASE_MS, now = Date.now() } = {}) {
  try {
    const { data, error } = await sb.from("pricing_leases").update({ lease_until: new Date(now + ms).toISOString() })
      .eq("user_id", userId).eq("holder", holder).select("user_id");
    if (error) return fail(error);
    return { ok: true, held: (data || []).length > 0 };
  } catch (e) { return fail(e); }
}

export async function releaseLease(sb, userId, holder) {
  try {
    const { error } = await sb.from("pricing_leases").update({ lease_until: new Date(0).toISOString() }).eq("user_id", userId).eq("holder", holder);
    return error ? fail(error) : { ok: true };
  } catch (e) { return fail(e); }
}

/** Is a worker on it right now? */
export async function leaseState(sb, userId, { now = Date.now() } = {}) {
  try {
    const { data, error } = await sb.from("pricing_leases").select("lease_until").eq("user_id", userId).maybeSingle();
    if (error) return fail(error);
    return { ok: true, busy: !!data && new Date(data.lease_until).getTime() > now, leaseUntil: data?.lease_until || null };
  } catch (e) { return fail(e); }
}
