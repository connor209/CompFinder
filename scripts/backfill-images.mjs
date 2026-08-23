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
// Which sets the misses are concentrated in. A total on its own can't tell a
// genuine gap in their index from our set being spelled differently, and the
// difference decides whether there is anything to fix.
const missingSets = new Map();
const numberMisses = new Map();
let written = 0;

/**
 * Stops the run rather than logging past it.
 *
 * The first version counted write failures and carried on, so a run whose
 * every write was rejected still walked all 176 sets, still made 167 calls to
 * tcgdex, still printed a coverage summary, and still exited 0 — "wrote 0
 * rows" was the only sign, sitting under a green tick. A backfill that cannot
 * write has nothing to say about coverage.
 */
function diagnose(error) {
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  if (text.includes("row-level security")) {
    return [
      "The database refused the write under row-level security.",
      "",
      "That means the key being used is NOT the service_role key — anon and",
      "authenticated can read card_catalog but never write it, which is exactly",
      "what happened here: 32,365 rows read, none written.",
      "",
      "Supabase → Project Settings → API → Project API keys → service_role.",
      "It is the one marked secret, not the one marked public."
    ].join("\n");
  }
  if (text.includes("image_small") || text.includes("column")) {
    return "The image columns aren't there. Run supabase/migrations/022_catalog_images.sql first.";
  }
  return null;
}

async function flush(updates) {
  if (!updates.length || DRY) return;
  // `name` rides along because upsert INSERTs first, and the table's name
  // column is NOT NULL. Every id here came from a select on this table a
  // moment ago, so the insert never actually fires — but without a name in
  // the payload the statement wouldn't be valid to attempt.
  const { error } = await supabase.from("card_catalog").upsert(updates, { onConflict: "cardmarket_id" });
  if (error) {
    console.error(`\nWrite failed: ${error.message}`);
    const why = diagnose(error);
    if (why) console.error(`\n${why}`);
    console.error(`\nStopping — ${written} rows written before this.`);
    process.exit(1);
  }
  written += updates.length;
}

const now = () => new Date().toISOString();

for (const [setName, cards] of bySet) {
  const family = setFamily(setName, theirSets);
  if (!family.length) {
    tally["no-set"] += cards.length;
    missingSets.set(setName, cards.length);
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
    if (m.outcome === "no-number") numberMisses.set(setName, (numberMisses.get(setName) || 0) + 1);
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

const top = (map, n = 25) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

if (missingSets.size) {
  console.log(`\nSets tcgdex has no counterpart for (${missingSets.size} sets, ${tally["no-set"]} cards).`);
  console.log(`Some are genuinely not indexed — World Championship decks, old promos — but a`);
  console.log(`set here with a familiar name is us and them spelling it differently, which is`);
  console.log(`fixable. Biggest first:`);
  for (const [name, n] of top(missingSets)) console.log(`  ${String(n).padStart(5)}  ${name}`);
  if (missingSets.size > 25) console.log(`  … and ${missingSets.size - 25} more`);
}

if (numberMisses.size) {
  console.log(`\nSets matched, but numbers inside them didn't (${tally["no-number"]} cards):`);
  for (const [name, n] of top(numberMisses, 15)) console.log(`  ${String(n).padStart(5)}  ${name}`);
  if (numberMisses.size > 15) console.log(`  … and ${numberMisses.size - 15} more`);
}

if (clashes.length) {
  console.log(`\nRefused because the names disagree (${clashes.length}) — worth an eye, since each is`);
  console.log(`either a set-name collision or a card tcgdex numbers differently:`);
  for (const c of clashes.slice(0, 20)) {
    console.log(`  ${c.expansion} #${c.collector_number}: ours "${c.name}" vs theirs "${c.theirName}"`);
  }
}
