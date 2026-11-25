/**
 * Comp Finder — 👍 / 👎 on a price: what a vote means and what it carries.
 *
 * Three signals tell the app whether a price was right, and only one of them
 * needed building:
 *
 *   - an OVERRIDE (price-override.js) — "wrong, and here is the right number",
 *     already in `price_checks` as "Priced by hand at £X, overriding £Y";
 *   - a 👎 with a REASON — wrong, and which way, when you don't want to type a
 *     figure;
 *   - a 👍 — a person looked and agreed. Without it an accepted price and a
 *     price nobody read are indistinguishable, which is what made the overrides
 *     alone a biased sample: they only ever describe the misses.
 *
 * A vote is EVIDENCE for a measured rule change, never a rule change. Nothing
 * here or anywhere reads feedback to move a price. `scripts/export-feedback.mjs`
 * turns it into a corpus, and a change is judged on how many 👎 it fixes and
 * how many 👍 it breaks — the same discipline as the audit harness.
 *
 * Pure and framework-free, so `scripts/check-feedback.mjs` loads it under bare
 * node. `feedback-store.js` is the only file naming the table.
 */
import { slimRec } from "./batch-store.js";
import { effectivePence } from "./price-override.js";
import { ruleTagsFromComment, saleTagFromComment } from "./price-rules.js";

export const VERDICTS = ["up", "down", "clear"];

/**
 * Why a price was wrong. A down without one cannot be acted on — "6 excluded"
 * with no breakdown taught that — so a down REQUIRES one. Keys are what is
 * stored; changing a key orphans every vote cast under it, so add, don't rename.
 */
export const REASONS = [
  { key: "wrongCard", label: "Wrong card or printing in the sales" },
  { key: "tooHigh", label: "Too high" },
  { key: "tooLow", label: "Too low" },
  { key: "thin", label: "Too few sales to trust" },
  { key: "condition", label: "Condition not allowed for" },
  { key: "other", label: "Something else" }
];
const REASON_KEYS = new Set(REASONS.map((r) => r.key));

export function reasonLabel(key) {
  return REASONS.find((r) => r.key === key)?.label || key || "";
}

const SURFACES = new Set(["batch", "quick", "lab"]); // lab: a rule set on a card in Add copies
const text = (v, max = 500) => {
  const s = String(v ?? "").replace(/\u0000/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const int = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/** Is this vote one we can store? `null` when it is, else the reason it isn't. */
export function feedbackProblem({ verdict, reason, surface } = {}) {
  if (!VERDICTS.includes(verdict)) return "A vote is up, down or clear.";
  if (!SURFACES.has(surface)) return "Unknown screen for this vote.";
  if (verdict === "down" && !REASON_KEYS.has(reason)) return "Say what was wrong with it.";
  if (verdict !== "down" && reason != null) return "Only a thumbs down carries a reason.";
  return null;
}

/**
 * The row a vote writes — built key by key, never a spread of the screen's row,
 * so a field added to a Batch row later cannot ride into the table unasked.
 *
 * `final_pence` is the figure the app produced; `override_pence` is yours;
 * `shown_pence` is what was on screen, which is what was actually voted on.
 * A 👍 on an overridden row agrees with YOUR price, not the engine's, and the
 * corpus has to be able to tell.
 */
export function feedbackRecord({ verdict, reason = null, comment = null, surface, row = {}, rec = null, batchId = null, position = null, userId = null, at = new Date() }) {
  const problem = feedbackProblem({ verdict, reason, surface });
  if (problem) throw new Error(problem);
  const csv = row.csvItem || {};
  const slim = verdict === "clear" ? null : slimRec(rec);
  return {
    user_id: userId,
    created_at: new Date(at).toISOString(),
    verdict,
    reason: verdict === "down" ? reason : null,
    comment: verdict === "clear" ? null : text(comment),
    surface,
    batch_id: batchId || null,
    batch_position: int(position),
    title: text(row.title),
    query: text(row.query),
    sku: text(row.sku, 80),
    card_number: text(row.cardNumber || csv.cardNumber, 40),
    set_name: text(row.set || csv.set, 120),
    final_pence: int(rec?.finalPence),
    engine_pence: int(rec?.house?.enginePence),
    override_pence: int(rec?.overridePence),
    shown_pence: int(effectivePence(rec)),
    confidence: text(rec?.confidence, 20),
    data_source: text(rec?.dataSource, 20),
    house_decision: text(rec?.house?.decision, 20),
    comps_used: (rec?.included || []).length,
    comps_excluded: (rec?.excluded || []).length,
    evidence: slim
  };
}

/**
 * Which card a vote is about, so the latest vote per card wins. A Batch row is
 * its run and position; a Quick Search card is its query. Votes are append-only,
 * so this is what turns a history of taps into one verdict.
 */
export function feedbackKey(r) {
  if (r?.batch_id != null && r?.batch_position != null) return `batch|${r.batch_id}|${r.batch_position}`;
  return `${r?.surface || "?"}|${String(r?.query || r?.title || "").trim().toLowerCase()}`;
}

/** Latest vote per card, with cleared ones dropped. Rows in any order. */
export function latestVerdicts(rows) {
  const latest = new Map();
  for (const r of rows || []) {
    const k = feedbackKey(r);
    const prev = latest.get(k);
    if (!prev || String(r.created_at) >= String(prev.created_at)) latest.set(k, r);
  }
  return [...latest.values()].filter((r) => r.verdict !== "clear");
}

/** A saved run's votes as Map position → { verdict, reason }, for drawing the buttons. */
export function verdictsByPosition(rows) {
  const out = new Map();
  for (const r of latestVerdicts(rows)) {
    if (r.batch_position != null) out.set(r.batch_position, { verdict: r.verdict, reason: r.reason || null });
  }
  return out;
}

/**
 * An override read back out of `price_checks.note` — the existing record of
 * every price typed by hand, which is the first corpus and needs no new table.
 * The sentence is `overrideNote()`'s; check-feedback.mjs pins the two together,
 * so rewording one without the other fails rather than silently reading none.
 */
export function parseOverrideNote(note) {
  const s = String(note || "");
  const pounds = (m) => Math.round(parseFloat(m) * 100);
  let m = s.match(/Priced by hand at £(\d+(?:\.\d+)?), overriding £(\d+(?:\.\d+)?)\./);
  if (m) return { overridePence: pounds(m[1]), enginePence: pounds(m[2]) };
  m = s.match(/Priced by hand at £(\d+(?:\.\d+)?) — the app couldn't price this card\./);
  if (m) return { overridePence: pounds(m[1]), enginePence: null };
  return null;
}

/** "too high" / "too low" / "about right" for an override, from the two figures. */
export function overrideDirection({ overridePence, enginePence }, tolerance = 0.1) {
  if (overridePence == null || enginePence == null || enginePence <= 0) return "unpriced";
  const r = overridePence / enginePence - 1;
  if (r > tolerance) return "tooLow"; // you priced it higher: the app was too low
  if (r < -tolerance) return "tooHigh";
  return "aboutRight";
}

/**
 * The corpus summary: votes by verdict and reason, overrides by direction, and
 * the median gap an override puts between you and the app. The numbers a rule
 * change is argued from, before any of the rows are read.
 */
export function feedbackSummary({ votes = [], overrides = [] } = {}) {
  const byReason = {};
  const ruleTags = {}; // what your per-card rules keep saying (price-rules.js)
  const saleTags = {}; // why single sales were unticked, from "why not?" notes
  let up = 0, down = 0;
  for (const v of votes) {
    if (v.verdict === "up") up++;
    else if (v.verdict === "down") { down++; byReason[v.reason] = (byReason[v.reason] || 0) + 1; }
    for (const t of ruleTagsFromComment(v.comment)) ruleTags[t] = (ruleTags[t] || 0) + 1;
    const st = saleTagFromComment(v.comment);
    if (st) saleTags[st] = (saleTags[st] || 0) + 1;
  }
  const byDirection = {};
  const gaps = [];
  for (const o of overrides) {
    const d = overrideDirection(o);
    byDirection[d] = (byDirection[d] || 0) + 1;
    if (o.enginePence > 0 && o.overridePence != null) gaps.push(o.overridePence / o.enginePence - 1);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length
    ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2)
    : null;
  return {
    votes: { up, down, byReason, ruleTags, saleTags },
    overrides: { count: overrides.length, byDirection, medianGapPct: medianGap == null ? null : Math.round(medianGap * 1000) / 10 }
  };
}
