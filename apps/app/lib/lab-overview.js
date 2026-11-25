/**
 * The lab at a glance (/panel/lab): where every card is between the
 * CardUploader file and a sale. Pure — the page hands it the Add copies list
 * (this device's draft), the pricing run's progress (also this device), and
 * /api/lab's GET (listings, copies, the last 200 log lines), and it counts.
 *
 * Two halves, and the screen says which is which, because they answer
 * different questions: the draft and the pricing run live in THIS browser
 * (another device sees its own), the listings and the log are the account's.
 */
import { rowStatus, isThin, liveCopies } from "./lab-draft.js";
import { listingForGroup, isForSale } from "./lab-copies.js";

/** Where Add copies writes how far a pricing run has got, for other tabs to read. */
export const PRICING_KEY = "cf-lab-pricing-v1";
/** A pricing note older than this is a tab that closed mid-run, not a run. */
export const PRICING_STALE_MS = 2 * 60 * 1000;
/** A background job with no log line for this long is not counted as running. */
export const JOB_STALE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const at = (e) => Date.parse(e?.at || e?.created_at || "") || 0;

export function labOverview({ rows = [], lab = null, pricing = null, now = Date.now() } = {}) {
  const listings = lab?.listings || [];
  const joinsOf = (r) => (r.result?.ok ? null : listingForGroup(listings, r));

  // ---- the Add copies list, on this device ---------------------------------
  const draft = { rows: 0, copies: 0, needsPrice: 0, checkFirst: 0, ready: 0, sending: 0, failed: 0, listed: 0, leftOut: 0, unpriced: 0 };
  for (const r of rows) {
    const st = rowStatus(r, joinsOf(r));
    draft.rows += 1;
    if (st === "excluded" || st === "nocopies") { draft.leftOut += 1; continue; }
    draft.copies += liveCopies(r).length;
    if (st === "listed") draft.listed += 1;
    else if (st === "sending") draft.sending += 1;
    else if (st === "failed") draft.failed += 1;
    else if (st === "needsprice" || st === "toolow") draft.needsPrice += 1;
    else if (st === "thin") draft.checkFirst += 1;
    else if (st === "ready" || st === "checked") draft.ready += 1;
    if (!r.comps && !r.result?.ok && !joinsOf(r)) draft.unpriced += 1;
  }
  draft.toList = draft.ready + draft.checkFirst;

  // ---- a pricing run, if one is going in a tab on this device ---------------
  const running = pricing && now - (Number(pricing.updatedAt) || 0) < PRICING_STALE_MS ? {
    done: Number(pricing.done) || 0, total: Number(pricing.total) || 0, startedAt: Number(pricing.startedAt) || null,
    left: pricing.done > 0 ? Math.round(((now - pricing.startedAt) / pricing.done) * (pricing.total - pricing.done) / 1000) : null
  } : null;

  // ---- eBay, from the account's listings and log ----------------------------
  const events = lab?.events || [];
  const recent = events.filter((e) => now - at(e) < DAY_MS);
  const jobs = new Map();
  for (const e of events) {
    if (!/^bulk_/.test(e.kind) || !e.detail?.job) continue;
    const j = jobs.get(e.detail.job) || { listed: 0, failed: 0, done: false, last: 0 };
    if (e.kind === "bulk_listed") j.listed += 1;
    if (e.kind === "bulk_failed") j.failed += 1;
    if (e.kind === "bulk_done") j.done = true;
    j.last = Math.max(j.last, at(e));
    jobs.set(e.detail.job, j);
  }
  const live = [...jobs.values()].filter((j) => !j.done && now - j.last < JOB_STALE_MS);
  const liveListings = listings.filter((l) => l.ebay_item_id && !l.ended_at);
  const copies = lab?.copies || [];
  const ebay = {
    jobsRunning: live.length,
    jobsListedSoFar: live.reduce((t, j) => t + j.listed, 0),
    listed24h: recent.filter((e) => e.kind === "listed" || e.kind === "joined").length,
    failed24h: recent.filter((e) => e.kind === "bulk_failed").length,
    liveListings: liveListings.length,
    forSale: copies.filter(isForSale).length,
    awaitingPull: copies.filter((c) => c.reserved_line && !c.pulled_at).length,
    sold24h: recent.filter((e) => e.kind === "reserved" || e.kind === "mismatch").length,
    errors24h: recent.filter((e) => e.kind === "error").length
  };

  return { draft, pricing: running, ebay, thin: rows.filter((r) => isThin(r) && !r.result?.ok).length };
}
