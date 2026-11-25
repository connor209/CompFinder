/**
 * Would a stamp rule for EVERY plain card be safe? Measured, never switched on.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/probe-stamps.mjs [--out stamps.json] [--max-cache 20000]
 *
 * Or Actions → Probe: stamped sales on plain cards → Run workflow.
 *
 * The question (CLAUDE.md, "A stamped copy is not the card underneath it
 * either"): pricing a stamped copy now drops the ordinary sales, but pricing an
 * ORDINARY card still counts a stamped sale unless it says "prerelease"
 * (promoVariant). The mirror rule changes every card in both products, so it
 * is measured first. READ-ONLY — it reads three tables and writes nothing:
 *
 * 1. lab_batches — Add copies' rows, each card with every sale its searches
 *    found and whether it counted. For each PLAIN card (core's own
 *    subjectStampFrom says the card isn't stamped): how many COUNTED sales core's
 *    isStampedTitle() calls stamped, and the house price with and without them,
 *    worked out by house-pricing.js exactly as the screen does.
 * 2. price_batch_items — the Batch screen's saved runs (30 days): the same
 *    count over each rec's included comps, re-worked by the house rules too.
 * 3. app_comp_cache — every cached search: how sellers spell a stamp, and the
 *    titles that only a WIDER pattern (bare "staff", "stamp" before
 *    "addressed") would catch — the false positives to look at.
 *
 * Every matched title is printed, so a false positive is read, not guessed at.
 * No account ids or SKUs are printed.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { housePrice, resolveRules, rulesForGame } from "../apps/app/lib/house-pricing.js";

const require = createRequire(import.meta.url);
const core = require("../packages/core/pricing.js");
const { isStampedTitle, subjectStampFrom } = core;

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = arg("--out");
const maxCache = Number(arg("--max-cache", 20000));

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
const HEAD = { apikey: key, Authorization: `Bearer ${key}` };

async function readAll(path, page = 200, cap = Infinity) {
  const rows = [];
  for (let from = 0; from < cap; from += page) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...HEAD, Range: `${from}-${from + page - 1}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`${res.status} ${body.slice(0, 200)}`);
      err.missing = res.status === 404 || /does not exist|schema cache|42P01|PGRST205/.test(body);
      throw err;
    }
    const got = await res.json();
    rows.push(...got);
    if (got.length < page) break;
  }
  return rows;
}

const RULES = resolveRules();
const pence = (comps, game) => housePrice(comps, "NM", rulesForGame(RULES, game)).suggestedPence;
const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const fromPounds = (e) => ({ itemPricePence: Math.round((Number(e.price) || 0) * 100), postagePence: Math.round((Number(e.postage) || 0) * 100) });

const report = { lab: null, batch: null, cache: null };
const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };

function tally(cards) {
  const hit = cards.filter((c) => c.stamped.length);
  const moved = hit.filter((c) => c.before !== c.after);
  const lost = hit.filter((c) => c.before != null && c.after == null);
  const deltas = moved.filter((c) => c.before && c.after).map((c) => c.after / c.before - 1).sort((a, b) => a - b);
  const med = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  return { cards: cards.length, withStamped: hit.length, priceMoved: moved.length, lostPrice: lost.length, medianMovePct: med == null ? null : Math.round(med * 1000) / 10 };
}

function printCards(label, cards) {
  const t = tally(cards);
  say(`### ${label}`);
  say(`${t.cards} plain cards · ${t.withStamped} counted a stamped sale · price moved on ${t.priceMoved} · would LOSE a price on ${t.lostPrice}${t.medianMovePct != null ? ` · median move ${t.medianMovePct}%` : ""}`);
  for (const c of cards.filter((x) => x.stamped.length).sort((a, b) => Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)))) {
    say(`- **${c.card}** — ${c.stamped.length} of ${c.counted} counted: ${gbp(c.before)} → ${gbp(c.after)}`);
    for (const s of c.stamped.slice(0, 4)) say(`    - ${s}`);
  }
  say();
  return t;
}

// ---- 1. Add copies batches ----
try {
  const batches = await readAll("lab_batches?select=id,rows&order=id.asc", 20);
  const cards = [];
  for (const b of batches) {
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      const ev = r?.comps?.evidence;
      if (!Array.isArray(ev) || !ev.length) continue;
      const subject = [r.titleOverride, r.title, r.card?.finish, r.subtype].filter(Boolean).join(" ");
      if (subjectStampFrom(subject)) continue; // a stamped card: the other rule
      const counted = ev.filter((e) => e.counted);
      const stamped = counted.filter((e) => isStampedTitle(e.title));
      const game = r.comps.game || r.card?.game || "";
      cards.push({
        card: [r.cardName, r.cardNumber, r.set].filter(Boolean).join(" ") || r.title,
        counted: counted.length, stamped: stamped.map((e) => `${e.title} (£${Number(e.total).toFixed(2)})`),
        before: pence(counted.map(fromPounds), game), after: pence(counted.filter((e) => !isStampedTitle(e.title)).map(fromPounds), game)
      });
    }
  }
  say("## Add copies batches (house rules, NM)");
  report.lab = { ...printCards("Plain cards with sales on file", cards), cardsDetail: cards.filter((c) => c.stamped.length) };
} catch (e) {
  say(`## Add copies batches\n${e.missing ? "lab_batches not there (047)." : `could not read: ${e.message}`}\n`);
}

// ---- 2. Batch screen saved runs ----
try {
  const items = await readAll("price_batch_items?select=id,title,rec&order=id.asc", 200);
  const cards = [];
  for (const it of items) {
    const inc = it.rec?.included;
    if (!Array.isArray(inc) || !inc.length) continue;
    if (subjectStampFrom(it.title)) continue;
    const stamped = inc.filter((c) => isStampedTitle(c.title));
    const comps = (list) => list.map((c) => ({ itemPricePence: c.itemPricePence || 0, postagePence: c.postagePence || 0 }));
    cards.push({
      card: it.title, counted: inc.length,
      stamped: stamped.map((c) => `${c.title} (£${(((c.itemPricePence || 0) + (c.postagePence || 0)) / 100).toFixed(2)})`),
      before: pence(comps(inc), ""), after: pence(comps(inc.filter((c) => !isStampedTitle(c.title))), "")
    });
  }
  say("## Batch screen saved runs (re-worked by the house rules, NM — not the engine's own figure)");
  report.batch = { ...printCards("Plain cards in saved runs", cards), cardsDetail: cards.filter((c) => c.stamped.length) };
} catch (e) {
  say(`## Batch screen saved runs\n${e.missing ? "price_batch_items not there (023)." : `could not read: ${e.message}`}\n`);
}

// ---- 3. How sellers spell it, across every cached search ----
try {
  const rows = await readAll("app_comp_cache?select=cache_key,query,payload&sold=eq.true&order=cache_key.asc", 100, maxCache);
  const SPELL = [
    ["prerelease / pre-release", /\bpre[\s-]?release\b/i],
    ["stamp", /\bstamp\b/i],
    ["stamped", /\bstamped\b/i],
    ["staff + stamp/promo/pre", /\bstaff\s+(?:stamp|promo|pre)/i],
    ["bare staff (not followed by stamp/promo/pre)", /\bstaff\b(?!\s+(?:stamp|promo|pre))/i],
    ["stamp(ed) addressed/envelope/sae", /\bstamp(?:ed)?\s+(?:addressed|envelope|sae)\b/i],
    ["unstamped / not stamped / no stamp", /\b(?:not|non|un)[\s-]?stamped\b|\bno\s+stamp\b/i]
  ];
  const counts = Object.fromEntries(SPELL.map(([k]) => [k, 0]));
  const examples = Object.fromEntries(SPELL.map(([k]) => [k, new Set()]));
  const seen = new Set();
  let titles = 0, coreStamped = 0;
  for (const r of rows) {
    for (const c of r.payload?.comps || []) {
      const t = String(c.title || "");
      const id = c._source?.itemId || c.itemId || t;
      if (!t || seen.has(id)) continue;
      seen.add(id);
      titles++;
      if (isStampedTitle(t)) coreStamped++;
      for (const [k, re] of SPELL) if (re.test(t)) { counts[k]++; if (examples[k].size < 12) examples[k].add(t); }
    }
  }
  say(`## Every cached search (${rows.length} searches${rows.length >= maxCache ? ", capped" : ""}, ${titles} distinct sold titles)`);
  say(`core's isStampedTitle() calls ${coreStamped} of them stamped (${titles ? ((coreStamped / titles) * 100).toFixed(2) : 0}%).`);
  for (const [k] of SPELL) {
    say(`- **${k}**: ${counts[k]}`);
    for (const t of examples[k]) say(`    - ${t}`);
  }
  say();
  report.cache = { searches: rows.length, titles, coreStamped, counts, examples: Object.fromEntries(Object.entries(examples).map(([k, v]) => [k, [...v]])) };
} catch (e) {
  say(`## Cached searches\n${e.missing ? "app_comp_cache not there (025)." : `could not read: ${e.message}`}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `# Stamped sales on plain cards\n\n${lines.join("\n")}\n`, { flag: "a" });
if (out) writeFileSync(out, JSON.stringify({ probedAt: new Date().toISOString(), ...report }, null, 2));
