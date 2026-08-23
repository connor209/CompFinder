#!/usr/bin/env node
/**
 * Put card art on the catalogue.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-images.mjs [--dry-run] [--limit N] [--set "Name"] [--recheck]
 *
 * Reads catalogue rows with no image, asks tcgdex for the set they belong to,
 * matches on set + collector number, and writes the image URLs back. The
 * matching rules — and the guard that refuses a pairing whose card names
 * disagree — live in lib/card-images.mjs and are covered by
 * scripts/check-images.mjs.
 *
 * RESUMABLE. Every row looked at gets image_checked_at, whether or not art was
 * found, so a second run skips the ones already answered rather than asking
 * about 20,000 cards again. --recheck ignores that, for when a source has
 * improved or the rules have changed.
 *
 * ENGLISH ONLY, for now. tcgdex indexes Japanese and Chinese printings too,
 * but under their own set names (ナイトワンダラー where Cardmarket says "Night
 * Wanderer"), so those need a name map this doesn't have. The public page is
 * English-first, and a non-English row simply keeps no image.
 *
 * Safe to interrupt: it writes in batches as it goes, and re-running picks up
 * where it stopped.
 */
import { createClient } from "@supabase/supabase-js";
import { languageOf } from "../apps/public/lib/resolve.js";
import { setFamily, indexByNumber, matchCard } from "./lib/card-images.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = has("--dry-run");
const RECHECK = has("--recheck");
const ONLY_SET = argOf("--set", null);
const LIMIT = Number(argOf("--limit", "0")) || 0;

const supabase = createClient(url, key, { auth: { persistSession: false } });
const API = "https://api.tcgdex.net/v2/en";
const SOURCE = "tcgdex";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tcgdex publishes no rate limit and asks for politeness. A whole-catalogue
// run is a few hundred calls — one per set, not one per card — so there is no
// reason to arrive all at once.
const GAP_MS = 250;
let last = 0, calls = 0, failed = 0;
async function api(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const since = Date.now() - last;
    if (since < GAP_MS) await sleep(GAP_MS - since);
    last = Date.now();
    calls++;
    try {
      const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(25000) });
      if (res.ok) return await res.json();
    } catch { /* retried below */ }
    await sleep(1200 * (attempt + 1));
  }
  failed++;
  // null is "we don't know", never "empty" — a caller that treats a failed
  // call as an empty set marks every card in it as having no art.
  return null;
}

// --- what needs looking at --------------------------------------------------
const SELECT = "cardmarket_id,name,collector_number,expansion,expansion_code,game";
async function fetchRows() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("card_catalog").select(SELECT).eq("game", "pokemon")
      .order("cardmarket_id").range(from, from + PAGE - 1);
    if (!RECHECK) q = q.is("image_small", null).is("image_checked_at", null);
    if (ONLY_SET) q = q.eq("expansion", ONLY_SET);
    const { data, error } = await q;
    if (error) { console.error("catalogue read failed:", error.message); process.exit(1); }
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    if (LIMIT && out.length >= LIMIT) break;
  }
  return LIMIT ? out.slice(0, LIMIT) : out;
}

const rows = await fetchRows();
const english = rows.filter((r) => languageOf(r) === "English");
console.log(`${rows.length} catalogue rows to check — ${english.length} English`);
console.log(`${rows.length - english.length} non-English skipped (tcgdex is indexed under its own set names)\n`);

const bySet = new Map();
for (const r of english) {
  if (!bySet.has(r.expansion)) bySet.set(r.expansion, []);
  bySet.get(r.expansion).push(r);
}

const theirSets = await api("/sets");
if (!theirSets) { console.error("Couldn't reach tcgdex."); process.exit(1); }
console.log(`tcgdex knows ${theirSets.length} English sets; we have ${bySet.size} to place\n`);

// --- match, and write as we go ----------------------------------------------
const tally = { matched: 0, "no-art": 0, "no-number": 0, "name-clash": 0, "no-set": 0, unknown: 0 };
const clashes = [];
let written = 0;

async function flush(updates) {
  if (!updates.length || DRY) return;
  // `name` rides along because upsert INSERTs first, and the table's name
  // column is NOT NULL. Every id here came from a select on this table a
  // moment ago, so the insert never actually fires — but without a name in
  // the payload the statement wouldn't be valid to attempt.
  const { error } = await supabase.from("card_catalog").upsert(updates, { onConflict: "cardmarket_id" });
  if (error) { console.error("  write failed:", error.message); return; }
  written += updates.length;
}

const now = () => new Date().toISOString();

for (const [setName, cards] of bySet) {
  const family = setFamily(setName, theirSets);
  if (!family.length) {
    tally["no-set"] += cards.length;
    await flush(cards.map((c) => ({ cardmarket_id: c.cardmarket_id, name: c.name, image_checked_at: now() })));
    console.log(`    —/${String(cards.length).padEnd(4)} ${setName}   (tcgdex has no such set)`);
    continue;
  }

  const cardsBySetId = new Map();
  let complete = true;
  for (const part of family) {
    const full = await api(`/sets/${encodeURIComponent(part.id)}`);
    if (!full) { complete = false; break; }
    cardsBySetId.set(part.id, full.cards || []);
  }
  if (!complete) {
    // Nothing is written for these — not even image_checked_at — so the next
    // run tries again rather than recording "no art" for a set we never read.
    tally.unknown += cards.length;
    console.log(`    ?/${String(cards.length).padEnd(4)} ${setName}   (tcgdex wouldn't answer; left for the next run)`);
    continue;
  }

  const byNumber = indexByNumber(family, cardsBySetId);
  const updates = [];
  let ok = 0;
  for (const c of cards) {
    const m = matchCard(c, byNumber);
    tally[m.outcome] = (tally[m.outcome] || 0) + 1;
    if (m.outcome === "matched") ok++;
    if (m.outcome === "name-clash") clashes.push({ ...c, theirName: m.theirName });
    updates.push({
      cardmarket_id: c.cardmarket_id,
      name: c.name,
      image_small: m.small || null,
      image_large: m.large || null,
      image_source: m.outcome === "matched" ? SOURCE : null,
      image_checked_at: now()
    });
  }
  await flush(updates);
  console.log(`  ${String(ok).padStart(4)}/${String(cards.length).padEnd(4)} ${setName}  →  ${family.map((f) => f.id).join(" + ")}`);
}

// --- what happened ----------------------------------------------------------
const total = english.length;
const pct = (n) => (total ? `${Math.round((n / total) * 100)}%` : "—");
console.log(`\n${"-".repeat(66)}`);
console.log(`English rows checked        ${total}`);
console.log(`  art found                ${tally.matched}  (${pct(tally.matched)})`);
console.log(`  listed, no art on file    ${tally["no-art"]}`);
console.log(`  number not in their set    ${tally["no-number"]}`);
console.log(`  set not in their index    ${tally["no-set"]}`);
console.log(`  names disagreed, refused  ${tally["name-clash"]}`);
if (tally.unknown) console.log(`  left for the next run     ${tally.unknown}  (their API didn't answer)`);
console.log(`\ntcgdex calls ${calls}${failed ? `, gave up on ${failed}` : ""}`);
console.log(DRY ? "\nDRY RUN — nothing was written." : `\nwrote ${written} rows.`);

if (clashes.length) {
  console.log(`\nRefused because the names disagree (${clashes.length}) — worth an eye, since each is`);
  console.log(`either a set-name collision or a card tcgdex numbers differently:`);
  for (const c of clashes.slice(0, 20)) {
    console.log(`  ${c.expansion} #${c.collector_number}: ours "${c.name}" vs theirs "${c.theirName}"`);
  }
}
