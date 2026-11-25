/**
 * What the app has been told about its prices, as a corpus.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/export-feedback.mjs [--out feedback.json] [--user <uuid>]
 *
 * Two sources, read-only:
 *
 *   - `price_feedback` (migration 046): every 👍 / 👎, latest vote per card,
 *     with the comps the price was built from;
 *   - `price_checks`: every price typed by hand, read back out of the note
 *     "Priced by hand at £X, overriding £Y" — the corpus that already existed
 *     and needed no new table.
 *
 * Prints the summary (votes by reason, overrides by direction, the median gap
 * between your price and the app's) and writes the rows with --out. A rule
 * change is then judged on it: replay the 👎 and 👍 cards, and count what it
 * fixes against what it breaks. Nothing here changes a price.
 *
 * If 046 is not applied the votes are reported as unavailable and the
 * overrides still export — an unanswered table is never reported as empty.
 */
import { writeFileSync } from "node:fs";
import { latestVerdicts, parseOverrideNote, feedbackSummary, overrideDirection, reasonLabel } from "../apps/app/lib/price-feedback.js";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = arg("--out");
const userId = arg("--user");

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const HEAD = { apikey: key, Authorization: `Bearer ${key}` };
const PAGE = 1000;

/** Every row of a query, paged in a total order so no page is missed or doubled. */
async function readAll(path) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...HEAD, Range: `${from}-${from + PAGE - 1}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`${res.status} ${body.slice(0, 200)}`);
      err.missing = res.status === 404 || /does not exist|schema cache|42P01/.test(body);
      throw err;
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const who = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";

let votes = null;
let votesNote = "";
try {
  votes = latestVerdicts(await readAll(`price_feedback?select=*&order=created_at.asc,id.asc${who}`));
} catch (e) {
  votesNote = e.missing ? "price_feedback is not there yet — run migration 046." : `could not read price_feedback: ${e.message}`;
}

// Your rules for a card (migration 050) as they stand now, beside the votes.
let cardRules = null;
try {
  cardRules = await readAll(`card_price_rules?select=card_key,label,kinds,words,note,updated_at&order=card_key.asc,id.asc${who}`);
} catch (e) {
  cardRules = null;
}

let overrides;
try {
  const checks = await readAll(`price_checks?select=id,created_at,title,query,sku,confidence,data_source,comps_used,comps_excluded,note&note=like.Priced%20by%20hand*&order=created_at.asc,id.asc${who}`);
  overrides = checks
    .map((c) => {
      const o = parseOverrideNote(c.note);
      return o ? { ...o, id: c.id, created_at: c.created_at, title: c.title, query: c.query, sku: c.sku, confidence: c.confidence, data_source: c.data_source, comps_used: c.comps_used, comps_excluded: c.comps_excluded, direction: overrideDirection(o) } : null;
    })
    .filter(Boolean);
} catch (e) {
  console.error(`Could not read price_checks: ${e.message}`);
  process.exit(1);
}

const summary = feedbackSummary({ votes: votes || [], overrides });

console.log("\nVotes");
if (votes == null) console.log(`  unavailable: ${votesNote}`);
else {
  console.log(`  👍 ${summary.votes.up}   👎 ${summary.votes.down}`);
  for (const [k, n] of Object.entries(summary.votes.byReason).sort((a, b) => b[1] - a[1])) console.log(`    ${n}  ${reasonLabel(k)}`);
  const saleTags = Object.entries(summary.votes.saleTags || {}).sort((a, b) => b[1] - a[1]);
  if (saleTags.length) {
    console.log("  single sales you unticked, by why:");
    for (const [k, n] of saleTags) console.log(`    ${n}  ${k}`);
  }
  const tags = Object.entries(summary.votes.ruleTags || {}).sort((a, b) => b[1] - a[1]);
  if (tags.length) {
    console.log("  your card rules, by what they leave out (a kind on many cards is a case for a rule on every card — measure it first):");
    for (const [k, n] of tags) console.log(`    ${n}  ${k}`);
  }
}
console.log("\nPrices typed by hand");
if (cardRules) console.log(`  ${cardRules.length} card rule${cardRules.length === 1 ? "" : "s"} kept`);
console.log(`  ${summary.overrides.count} overrides`);
const dirLabel = { tooLow: "app was too low (you went >10% higher)", tooHigh: "app was too high (you went >10% lower)", aboutRight: "within 10%", unpriced: "app had no price" };
for (const [k, n] of Object.entries(summary.overrides.byDirection)) console.log(`    ${n}  ${dirLabel[k] || k}`);
if (summary.overrides.medianGapPct != null) console.log(`  median gap: ${summary.overrides.medianGapPct > 0 ? "+" : ""}${summary.overrides.medianGapPct}% (your price against the app's)`);

if (out) {
  writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), summary, votes: votes || [], votesNote: votesNote || null, cardRules, overrides }, null, 2));
  console.log(`\nWrote ${out}`);
}
