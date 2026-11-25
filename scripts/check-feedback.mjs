/**
 * 👍 / 👎 on a price (apps/app/lib/price-feedback.js, feedback-store.js).
 *
 *   node scripts/check-feedback.mjs      (or: npm run check)
 *
 * What it pins:
 *
 * - A thumbs down carries a reason, and only a down does. A down with no
 *   reason is a vote nobody can act on.
 * - The stored row is an ALLOW-LIST: a Batch row stuffed with private values
 *   (cost, stack, note) leaks none of them, and the comps keep their exclusion
 *   reasons — the half a rule change is replayed against.
 * - What was on screen is what was voted on: a 👍 on an overridden row records
 *   YOUR price as shown, beside the app's.
 * - The latest vote per card wins, and a taken-back vote counts as none.
 * - The override sentence the export reads back is the one overrideNote()
 *   writes, both forms — reword one and this fails instead of reading nothing.
 * - Against a fake Supabase: a missing table degrades, never throws.
 * - Greps: `price_feedback` named in one app file, and nothing that PRICES a
 *   card (core, the house rules, batch-comps) reads feedback. A vote is
 *   evidence for a measured change, not a change.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  feedbackProblem, feedbackRecord, feedbackKey, latestVerdicts, verdictsByPosition,
  parseOverrideNote, overrideDirection, feedbackSummary, REASONS
} from "../apps/app/lib/price-feedback.js";
import { recordFeedback, loadBatchFeedback } from "../apps/app/lib/feedback-store.js";
import { overrideNote, withOverride } from "../apps/app/lib/price-override.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, cond) => { if (!cond) fail(label); };

// ---- what a vote may be ----
eq("a down with no reason", feedbackProblem({ verdict: "down", surface: "batch" }), "Say what was wrong with it.");
eq("a down with an unknown reason", feedbackProblem({ verdict: "down", reason: "vibes", surface: "batch" }), "Say what was wrong with it.");
eq("a down with a reason", feedbackProblem({ verdict: "down", reason: "tooHigh", surface: "batch" }), null);
eq("an up with a reason", feedbackProblem({ verdict: "up", reason: "tooHigh", surface: "batch" }), "Only a thumbs down carries a reason.");
eq("an up", feedbackProblem({ verdict: "up", surface: "quick" }), null);
eq("a clear", feedbackProblem({ verdict: "clear", surface: "quick" }), null);
eq("an unknown verdict", feedbackProblem({ verdict: "meh", surface: "batch" }), "A vote is up, down or clear.");
eq("an unknown screen", feedbackProblem({ verdict: "up", surface: "storefront" }), "Unknown screen for this vote.");
ok("every reason has a key and a label", REASONS.every((r) => r.key && r.label));
let threw = false;
try { feedbackRecord({ verdict: "down", surface: "batch" }); } catch { threw = true; }
ok("a record refuses a down with no reason", threw);

// ---- the stored row ----
const comp = (title, total, reason) => ({ title, itemPricePence: total, postagePence: 0, totalPence: total, itemLocation: "GB", ...(reason ? { exclusionReason: reason } : {}), _source: { url: "https://ebay.co.uk/itm/1", endedAt: "2026-11-01" }, sellerSecret: "x" });
const rec = {
  rawPence: 1180, finalPence: 1249, confidence: "Medium", dataSource: "sold", note: "fine",
  included: [comp("Riolu BW33", 1200), comp("Riolu BW33 promo", 1300)],
  excluded: [comp("Riolu 1st Class postage lot", 300, "multiCardLot")],
  house: { decision: "apply", enginePence: 999 }
};
const row = {
  title: "Riolu BW33 Black Star Promo", query: "Riolu BW33", sku: "BP12",
  csvItem: { cardNumber: "BW33", set: "BW Promos", costPence: 4242, startPrice: "2.49" },
  stack: "SECRET-STACK", cost_pence: 4242, privateNote: "bought off Dave"
};
const r = feedbackRecord({ verdict: "down", reason: "tooLow", comment: " missed the promo ", surface: "batch", row, rec, batchId: "b1", position: 3, userId: "u1", at: "2026-11-25T10:00:00Z" });
eq("the row's keys", Object.keys(r).sort(), [
  "batch_id", "batch_position", "card_number", "comment", "comps_excluded", "comps_used", "confidence", "created_at",
  "data_source", "engine_pence", "evidence", "final_pence", "house_decision", "override_pence", "query", "reason",
  "set_name", "shown_pence", "sku", "surface", "title", "user_id", "verdict"
]);
const ser = JSON.stringify(r);
for (const secret of ["SECRET-STACK", "4242", "bought off Dave", "sellerSecret"]) ok(`private value ${secret} kept out of the row`, !ser.includes(secret));
eq("the figures", [r.final_pence, r.engine_pence, r.override_pence, r.shown_pence], [1249, 999, null, 1249]);
eq("the card", [r.card_number, r.set_name, r.sku], ["BW33", "BW Promos", "BP12"]);
eq("the comment is trimmed", r.comment, "missed the promo");
eq("comps counted", [r.comps_used, r.comps_excluded], [2, 1]);
eq("an excluded comp keeps its reason", r.evidence.excluded[0].exclusionReason, "multiCardLot");
eq("a comp keeps its listing", r.evidence.included[0]._source.url, "https://ebay.co.uk/itm/1");

const mine = withOverride(rec, 4999);
const u = feedbackRecord({ verdict: "up", surface: "batch", row, rec: mine, batchId: "b1", position: 3 });
eq("a 👍 on your price records what was shown", [u.final_pence, u.override_pence, u.shown_pence], [1249, 4999, 4999]);
eq("an up carries no reason", u.reason, null);
const c = feedbackRecord({ verdict: "clear", surface: "batch", row, rec, batchId: "b1", position: 3 });
eq("a cleared vote carries no evidence", c.evidence, null);
const nul = feedbackRecord({ verdict: "up", surface: "quick", row: { title: "X\u0000Y", query: "x" }, rec: null });
eq("no rec is no figures and no comps", [nul.final_pence, nul.shown_pence, nul.comps_used, nul.evidence], [null, null, 0, null]);
eq("a NUL byte is dropped", nul.title, "XY");

// ---- latest wins ----
const votes = [
  { verdict: "up", batch_id: "b1", batch_position: 0, created_at: "2026-11-25T10:00:00Z" },
  { verdict: "down", reason: "tooHigh", batch_id: "b1", batch_position: 0, created_at: "2026-11-25T10:05:00Z" },
  { verdict: "up", batch_id: "b1", batch_position: 1, created_at: "2026-11-25T10:00:00Z" },
  { verdict: "clear", batch_id: "b1", batch_position: 1, created_at: "2026-11-25T10:01:00Z" },
  { verdict: "up", surface: "quick", query: "Umbreon VMAX 215", created_at: "2026-11-25T09:00:00Z" },
  { verdict: "down", reason: "thin", surface: "quick", query: "umbreon vmax 215 ", created_at: "2026-11-25T09:30:00Z" }
];
const latest = latestVerdicts([...votes].reverse());
eq("latest vote per card, cleared dropped", latest.map((v) => `${feedbackKey(v)}=${v.verdict}`).sort(), [
  "batch|b1|0=down", "quick|umbreon vmax 215=down"
]);
const byPos = verdictsByPosition(votes);
eq("a run's votes by position", [...byPos.entries()], [[0, { verdict: "down", reason: "tooHigh" }]]);

// ---- the override sentence, both ways round ----
eq("an override read back", parseOverrideNote(overrideNote(withOverride(rec, 4999)) + " The engine said …"), { overridePence: 4999, enginePence: 1249 });
eq("an override of an unpriced card read back", parseOverrideNote(overrideNote(withOverride(null, 350))), { overridePence: 350, enginePence: null });
eq("a note with no override", parseOverrideNote("Recency-weighted from 8 comps."), null);
eq("you went higher: the app was too low", overrideDirection({ overridePence: 4999, enginePence: 1249 }), "tooLow");
eq("you went lower: the app was too high", overrideDirection({ overridePence: 800, enginePence: 1249 }), "tooHigh");
eq("within 10%", overrideDirection({ overridePence: 1299, enginePence: 1249 }), "aboutRight");
eq("no app price", overrideDirection({ overridePence: 350, enginePence: null }), "unpriced");
const sum = feedbackSummary({ votes: latest, overrides: [{ overridePence: 2000, enginePence: 1000 }, { overridePence: 500, enginePence: 1000 }, { overridePence: 1000, enginePence: 1000 }] });
eq("the summary", sum, { votes: { up: 0, down: 2, byReason: { thin: 1, tooHigh: 1 } }, overrides: { count: 3, byDirection: { tooLow: 1, tooHigh: 1, aboutRight: 1 }, medianGapPct: 0 } });

// ---- the store, against a fake Supabase ----
function fakeSb({ insertError = null, selectRows = [], selectError = null, user = { id: "u1" } } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      calls.push(table);
      const q = {
        insert: async (row) => { calls.push(row); return { error: insertError }; },
        select: () => q, eq: () => q, order: () => q,
        limit: async () => ({ data: selectRows, error: selectError })
      };
      return q;
    }
  };
}
{
  const sb = fakeSb();
  const res = await recordFeedback(sb, { verdict: "up", surface: "batch", row, rec, batchId: "b1", position: 0 });
  ok("a vote is written", res.ok);
  eq("to price_feedback", sb.calls[0], "price_feedback");
  eq("as the signed-in user", sb.calls[1].user_id, "u1");
  const missing = await recordFeedback(fakeSb({ insertError: { code: "42P01", message: 'relation "price_feedback" does not exist' } }), { verdict: "up", surface: "batch", row, rec });
  eq("before 046 it says so", missing, { ok: false, missing: true });
  const bad = await recordFeedback(fakeSb(), { verdict: "down", surface: "batch", row, rec });
  ok("a down with no reason is refused, not thrown", bad.ok === false && /wrong/.test(bad.error));
  const out = await recordFeedback(fakeSb({ user: null }), { verdict: "up", surface: "batch", row, rec });
  eq("signed out", out, { ok: false, error: "Not signed in." });
  const loaded = await loadBatchFeedback(fakeSb({ selectRows: votes.slice(0, 4) }), "b1");
  eq("a run's votes load by position", [...loaded.byPosition.entries()], [[0, { verdict: "down", reason: "tooHigh" }]]);
  const none = await loadBatchFeedback(fakeSb({ selectError: { message: "Could not find the table 'public.price_feedback' in the schema cache" } }), "b1");
  eq("loading before 046", none, { ok: false, missing: true });
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
const appFiles = walk("apps");
const naming = appFiles.filter((f) => /["'`]price_feedback["'`]/.test(readFileSync(f, "utf8")));
eq("price_feedback is named in one app file", naming, ["apps/app/lib/feedback-store.js"]);

const pricing = [...walk("packages/core"), "apps/app/lib/house-pricing.js", "apps/app/lib/batch-comps.js", "apps/app/lib/house-rec.js", "apps/app/lib/searchpasses.js", "apps/app/lib/matching.js"];
for (const f of pricing) {
  if (/price-feedback|feedback-store/.test(readFileSync(f, "utf8"))) fail(`${f} reads feedback — a vote is evidence for a measured change, never an automatic one`);
}
for (const f of walk("apps/public")) {
  if (/price-feedback|feedback-store/.test(readFileSync(f, "utf8"))) fail(`${f} — feedback is the app's, not Last Comp's`);
}

const css = readFileSync("apps/app/app/globals.css", "utf8");
ok("the vote row wraps on a phone", /\.pf-row\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
ok("the reasons wrap on a phone", /\.pf-reasons\s*\{[^}]*flex-wrap:\s*wrap/.test(css));

const panel = readFileSync("apps/app/app/panel/Panel.js", "utf8");
ok("both Batch views carry the vote", (panel.match(/onVote=\{\(verdict, reason\) => voteFor\(origIndex, verdict, reason\)\}/g) || []).length === 2);
ok("Quick Search carries the vote", /<PriceFeedback[^>]*send=\{voteOnCard\}/.test(readFileSync("apps/app/app/panel/QuickSearch.js", "utf8")));

if (failures) {
  console.error(`check-feedback: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-feedback: ok");
