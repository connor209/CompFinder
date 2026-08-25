/**
 * Prices the public page's card set under TWO rule sets from ONE set of comps,
 * and diffs them. This is the audit gate for a change to packages/core.
 *
 *   AUDIT_TOKEN=… node scripts/audit-rulechange.mjs --corpus-out corpus.json
 *   node scripts/audit-rulechange.mjs --corpus-in corpus.json          # free, offline
 *   node scripts/audit-rulechange.mjs --corpus-in corpus.json --json out.json
 *
 * Run it from apps/public, like audit-big.mjs, so the workspace imports resolve.
 *
 * WHY NOT audit-big + diff-runs. That pair is the right tool for "did the site
 * get better between Tuesday and Thursday": two runs, two fetches, diffed.
 * It is the wrong tool for judging a RULE, and the app's own batch export is
 * why — 16 queries priced twice in one run, four came back with a different
 * comp pool, two moved the price. Diffing two live runs therefore measures the
 * rule change PLUS a day of upstream churn, with nothing separating them, and
 * the churn is large enough to hide or invent a result on any thin card.
 *
 * So the comps are fetched once and both rule sets are priced from exactly the
 * same bytes. Every difference below is the rule and nothing else. It also
 * halves what the audit costs at SoldComps, and --corpus-in makes every re-run
 * after the first one free — which matters when a threshold wants trying at
 * four values.
 *
 * WHAT IS UNDER TEST. Two flags in DEFAULT_SETTINGS, both added 2026-08-25:
 *   dropNumberingPrefixTokens  — "No." stops being a required match token
 *   setMismatchPreferConfirmed — the set guard fires even when it wins its vote
 * BEFORE is both off (what is deployed today), AFTER is both on.
 *
 * READ THE LOST COLUMN FIRST. A rule that tightens matching can take a card
 * from a price to no price at all, and on the public page that is a blank
 * screen where a number used to be. diff-runs.mjs flags the same thing for the
 * same reason.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens, dropWrongSetTotal, dropWrongNumerator } from "../apps/public/lib/tokens.js";
import { UK, splitByMarket } from "../apps/public/lib/markets.js";
import { settingsForCard } from "../apps/public/lib/settings.js";
import { auditHeaders } from "./lib/audit-headers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://www.lastcomp.co.uk").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "9999"));
const SET = argOf("--set", join(HERE, "bigset.json"));
const CORPUS_IN = argOf("--corpus-in", null);
const CORPUS_OUT = argOf("--corpus-out", null);
const JSON_OUT = argOf("--json", null);

const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

// Same rarity-weighted sample as audit-big.mjs, so this run is comparable with
// every audit already on record rather than being its own population.
const ALL = JSON.parse(readFileSync(SET, "utf8"));
const TIER = (r) => /special illustration|secret|hyper|amazing|shiny/i.test(r) ? 0
  : /illustration rare|art rare/i.test(r) ? 1
  : /ultra rare|rare ultra/i.test(r) ? 2 : 3;
const pick = [];
for (const tier of [0, 1, 2, 3]) {
  const g = ALL.filter((c) => TIER(c.rarity) === tier);
  pick.push(...(tier <= 1 ? g : g.filter((_, i) => i % (tier === 2 ? 2 : 3) === 0)));
}
const CARDS = (process.env.BIGSET_ALL ? ALL : pick).slice(0, LIMIT).map((c) => ({ ...c, q: `${c.name} ${c.number} ${c.set}` }));

// ── the comps, fetched once ─────────────────────────────────────────────────
let corpus;
if (CORPUS_IN) {
  if (!existsSync(CORPUS_IN)) { console.error(`no corpus at ${CORPUS_IN}`); process.exit(1); }
  corpus = JSON.parse(readFileSync(CORPUS_IN, "utf8"));
  console.log(`replaying ${corpus.cards.length} cards from ${CORPUS_IN} (fetched ${corpus.fetchedAt}) — costs nothing\n`);
} else {
  if (!process.env.AUDIT_TOKEN) {
    console.error(
      "AUDIT_TOKEN is not set.\n\n" +
      "/api/price serves the cache to anyone, but a MISS is gated on Turnstile, and\n" +
      "the sold cache is 24h while the warmer runs weekly — so an audit is all misses.\n" +
      "Without the token every card comes back 403 needsChallenge, which is the bot\n" +
      "protection working, not a fault. Set it to the value on compfinder-public.\n"
    );
    process.exit(1);
  }
  const pacer = createPacer({ onWait: (m) => process.stdout.write(`\r   ⏳ ${m}          `) });
  corpus = { fetchedAt: new Date().toISOString(), base: BASE, set: SET, cards: [] };
  let failed = 0;
  for (const [i, c] of CARDS.entries()) {
    process.stdout.write(`\r  fetching ${i + 1}/${CARDS.length} · ${failed} failed        `);
    let body;
    try {
      const r = await pacer.call(async () => {
        const res = await fetch(`${BASE}/api/price`, {
          method: "POST", headers: auditHeaders(),
          body: JSON.stringify({ query: c.q, sold: true, soldAfterDays: 90 })
        });
        return { status: res.status, body: await res.json().catch(() => ({ ok: false, error: "bad json" })) };
      });
      body = r.body && r.body.ok ? r.body : null;
      if (!body) { failed++; corpus.cards.push({ card: c, error: `${r.status} ${(r.body && r.body.error) || "no body"}` }); continue; }
    } catch (err) { failed++; corpus.cards.push({ card: c, error: err.message }); continue; }
    corpus.cards.push({ card: c, comps: body.comps || [], hasNextPage: body.hasNextPage ?? null, cached: !!body.cached });
  }
  console.log(`\n  fetched ${corpus.cards.length - failed} of ${CARDS.length} (${failed} failed)\n`);
  if (CORPUS_OUT) { writeFileSync(CORPUS_OUT, JSON.stringify(corpus)); console.log(`  wrote ${CORPUS_OUT} — every re-run from here is free\n`); }
}

// ── the two rule sets ───────────────────────────────────────────────────────
const RULES = {
  before: { dropNumberingPrefixTokens: false, setMismatchPreferConfirmed: false },
  after: { dropNumberingPrefixTokens: true, setMismatchPreferConfirmed: true }
};

/**
 * The public page's own pipeline, exactly as audit-big.mjs runs it — the token
 * guards, the market split, the name-only fallback. Only DEFAULT_SETTINGS is
 * overridden, so nothing here is a second definition of how a card is priced.
 */
function priceUnder(entry, overrides) {
  const card = entry.card;
  const base = settingsForCard(card);
  const cs = { ...base, ...overrides };
  const comps = entry.comps || [];
  const tokens = buildCompTokens({ name: card.name, number: card.number }, card.q, cs);
  const guarded = dropWrongNumerator(dropWrongSetTotal(comps, card.number), card.number);
  const { chosen, rest } = splitByMarket(guarded, UK);
  const all = [...chosen, ...rest];

  let rec = all.length ? CompFinderPricing.recommend(all, cs, tokens, "sold", card.number, card.set) : null;
  let viaName = false;
  if (rec && (rec.included || []).length === 0) {
    const alt = CompFinderPricing.recommend(all, cs, buildCompTokens({ name: card.name }, card.q, cs), "sold", null, card.set);
    if ((alt.included || []).length >= 3) { rec = alt; viaName = true; }
  }
  const reasons = {};
  for (const e of rec?.excluded || []) reasons[e.exclusionReason] = (reasons[e.exclusionReason] || 0) + 1;
  return { price: rec?.rawPence ?? null, used: (rec?.included || []).length, confidence: rec?.confidence ?? null, viaName, reasons };
}

// ── diff ────────────────────────────────────────────────────────────────────
const rows = [];
for (const entry of corpus.cards) {
  if (entry.error) { rows.push({ card: entry.card, error: entry.error }); continue; }
  const before = priceUnder(entry, RULES.before);
  const after = priceUnder(entry, RULES.after);
  const movedPct = before.price && after.price ? ((after.price - before.price) / before.price) * 100 : null;
  rows.push({
    card: entry.card, fetched: (entry.comps || []).length, before, after, movedPct,
    lost: before.price != null && after.price == null,
    gained: before.price == null && after.price != null
  });
}

const priced = rows.filter((r) => !r.error);
const lost = priced.filter((r) => r.lost);
const gained = priced.filter((r) => r.gained);
const moved = priced.filter((r) => r.movedPct != null && Math.abs(r.movedPct) >= 1).sort((a, b) => Math.abs(b.movedPct) - Math.abs(a.movedPct));
const big = moved.filter((r) => Math.abs(r.movedPct) >= 10);
const compsMoved = priced.filter((r) => r.before.used !== r.after.used);
const fellToName = priced.filter((r) => !r.before.viaName && r.after.viaName);
const roseFromName = priced.filter((r) => r.before.viaName && !r.after.viaName);

const say = (s) => console.log(s);
say(`\nRule change vs ${priced.length} cards, one fetch, priced both ways`);
say("═".repeat(58));
say(`  cards that LOST a price          ${String(lost.length).padStart(4)}   ← read this first`);
say(`  cards that GAINED a price        ${String(gained.length).padStart(4)}`);
say(`  cards whose price moved ≥1%      ${String(moved.length).padStart(4)}`);
say(`  cards whose price moved ≥10%     ${String(big.length).padStart(4)}`);
say(`  cards whose comp COUNT changed   ${String(compsMoved.length).padStart(4)}`);
say(`  fell back to name-only matching  ${String(fellToName.length).padStart(4)}`);
say(`  no longer need the name fallback ${String(roseFromName.length).padStart(4)}`);

if (lost.length) {
  say(`\nLOST a price (${lost.length}) — each is a blank where a number used to be`);
  say("─".repeat(58));
  for (const r of lost.slice(0, 40)) {
    say(`  ${gbp(r.before.price).padStart(9)} → none   ${r.before.used}→${r.after.used} comps  ${r.card.name} ${r.card.number} ${r.card.set}`);
  }
  if (lost.length > 40) say(`  …and ${lost.length - 40} more`);
}
if (big.length) {
  say(`\nMoved ≥10% (${big.length})`);
  say("─".repeat(58));
  for (const r of big.slice(0, 40)) {
    say(`  ${gbp(r.before.price).padStart(9)} → ${gbp(r.after.price).padStart(9)}  ${String(Math.round(r.movedPct)).padStart(5)}%  ` +
        `${r.before.used}→${r.after.used} comps  ${r.card.name} ${r.card.number} ${r.card.set}`);
  }
  if (big.length > 40) say(`  …and ${big.length - 40} more`);
}

// Which of the two flags did the work. A change nobody can attribute is a
// change nobody can defend, and these two are only bundled because shipping
// the first alone was measured to make things worse.
const soloA = corpus.cards.filter((e) => !e.error).map((e) => ({
  card: e.card,
  base: priceUnder(e, RULES.before).price,
  tokensOnly: priceUnder(e, { ...RULES.before, dropNumberingPrefixTokens: true }).price,
  setOnly: priceUnder(e, { ...RULES.before, setMismatchPreferConfirmed: true }).price
}));
const diff = (a, b) => a !== b;
say(`\nAttribution`);
say("─".repeat(58));
say(`  the token fix alone moves   ${soloA.filter((r) => diff(r.base, r.tokensOnly)).length} card(s)`);
say(`  the set fix alone moves     ${soloA.filter((r) => diff(r.base, r.setOnly)).length} card(s)`);
say(`  both together move          ${priced.filter((r) => diff(r.before.price, r.after.price)).length} card(s)`);

// The smoke fixture went vacuous twice while this script was being written —
// once because every comp was excluded as a foreign print, once because the
// odd-set comp said "promo" and was gone before the set guard ran. Both times
// the summary read "nothing moved", which is what a WORKING audit of a
// harmless rule also reads like. So when the smoke fixture is the input, the
// expected movement is asserted rather than eyeballed.
if (/rulechange-smoke\.json$/.test(CORPUS_IN || "")) {
  const setMoves = soloA.filter((r) => diff(r.base, r.setOnly)).length;
  const tokenMoves = soloA.filter((r) => diff(r.base, r.tokensOnly)).length;
  const problems = [];
  if (setMoves !== 1) problems.push(`the set flag should move exactly 1 of the 2 smoke cards, moved ${setMoves}`);
  if (tokenMoves !== 0) problems.push(`the token flag should move nothing on the public path, moved ${tokenMoves}`);
  if (lost.length) problems.push(`neither flag can lose a price — setMismatchMinKept guarantees ≥${CompFinderPricing.DEFAULT_SETTINGS.setMismatchMinKept} survive — but ${lost.length} did`);
  if (problems.length) {
    console.error(`\nSMOKE FAILED — this harness is not measuring what it claims:`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  say("\nsmoke: OK — the replay path prices, the set flag reaches the public pipeline, nothing is lost.");
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ fetchedAt: corpus.fetchedAt, rules: RULES, rows, attribution: soloA }, null, 2));
  say(`\nwrote ${JSON_OUT}`);
}
