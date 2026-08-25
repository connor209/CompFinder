/**
 * Pulls a saved batch run out of Supabase and writes it as a corpus the
 * offline harnesses can price, re-price and argue with, for free.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/dump-batch.mjs --list
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/dump-batch.mjs --batch <id> --out corpus.json
 *
 *   node scripts/recurse-batch.mjs --corpus corpus.json     # then tune, free
 *
 * WHY. Every pricing rule on this branch has been tuned against three cards
 * reconstructed from screenshots, which is not a corpus — it is three
 * anecdotes, and CLAUDE.md is explicit that a rule judged on the two examples
 * that prompted it gets reversed later. apps/public has probe-rules.mjs for
 * exactly this reason; the app had no equivalent because its comps only ever
 * lived in React state.
 *
 * Migration 023 changed that. A saved run already stores the FULL
 * recommendation for every card — `included[]` and `excluded[]`, each comp with
 * its price, postage, sold date, location and exclusion reason. So the comps
 * behind a 67-card run are already sitting in the database, and reading them
 * costs nothing at SoldComps: a saved run is a record of a price decision, not
 * a live quote. That is the whole reason re-opening one is free, and it makes
 * this the app's cheapest possible tuning loop.
 *
 * A comp is stored CUT DOWN to what the results screen renders (see
 * batch-store.js), so the corpus carries what pricing.js needs and not much
 * else. It is enough to re-run recommend() end to end, which is the point.
 *
 * SERVICE-ROLE KEY. Reading past the RLS policy needs it. Same posture as
 * backfill-images.mjs: run it locally or from a manually-triggered Action,
 * never off a push, and never commit the key or the corpus it writes — a run
 * carries your inventory's SKUs and asking prices.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BATCH = argOf("--batch", null);
const OUT = argOf("--out", "corpus.json");
const LIST = args.includes("--list");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
    "The service-role key is needed to read past RLS. Don't commit it, and don't\n" +
    "commit the corpus either — a run carries your SKUs and asking prices."
  );
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

if (LIST || !BATCH) {
  const { data, error } = await supabase
    .from("price_batches")
    .select("id, label, created_at, item_count, pool_name")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) { console.error(`Could not list runs: ${error.message}`); process.exit(1); }
  if (!data || !data.length) {
    console.log("No saved runs. Migration 023 may not be applied, or the run predates it —\n" +
                "in which case re-run the batch and it will save this time.");
    process.exit(0);
  }
  console.log(`${data.length} saved run(s), newest first:\n`);
  for (const b of data) {
    console.log(`  ${b.id}  ${String(b.created_at).slice(0, 16).replace("T", " ")}  ${String(b.item_count ?? "?").padStart(3)} cards  ${b.label || ""}${b.pool_name ? ` [${b.pool_name}]` : ""}`);
  }
  if (!BATCH) console.log(`\nThen: node scripts/dump-batch.mjs --batch <id> --out corpus.json`);
  process.exit(0);
}

const { data: items, error } = await supabase
  .from("price_batch_items")
  .select("position, title, sku, query, failed, rec, active_rec, set_name, card_number, name_tokens")
  .eq("batch_id", BATCH)
  .order("position", { ascending: true });
if (error) { console.error(`Could not read that run: ${error.message}`); process.exit(1); }
if (!items || !items.length) { console.error(`No items under batch ${BATCH}.`); process.exit(1); }

// included[] + excluded[] IS the comp pool as fetched: every comp the run saw,
// with the reason each was dropped. Putting them back together reconstructs
// what SoldComps returned, which is what a harness needs to re-price the card
// under a different rule.
const cards = [];
let comps = 0, stripped = 0;
for (const it of items) {
  const rec = it.rec || null;
  const pool = [...((rec && rec.included) || []), ...((rec && rec.excluded) || [])];
  if (rec && !pool.length) stripped++;      // a row whose comps failed to store — see batch-store.js
  comps += pool.length;
  cards.push({
    sku: it.sku || "", title: it.title || "", query: it.query || "",
    set: it.set_name || null, cardNumber: it.card_number || null,
    failed: it.failed || null,
    shipped: rec ? { rawPence: rec.rawPence ?? null, finalPence: rec.finalPence ?? null,
                     confidence: rec.confidence ?? null, dataSource: rec.dataSource ?? null,
                     used: (rec.included || []).length, excluded: (rec.excluded || []).length,
                     note: rec.note || "" } : null,
    activeShipped: it.active_rec ? { rawPence: it.active_rec.rawPence ?? null, used: (it.active_rec.included || []).length } : null,
    comps: pool
  });
}

writeFileSync(OUT, JSON.stringify({ batchId: BATCH, dumpedAt: new Date().toISOString(), cards }, null, 1));
console.log(`${cards.length} cards, ${comps} comps → ${OUT}`);
if (stripped) console.log(`  ${stripped} row(s) kept their price but not their comps (see batch-store.js's per-row retry) — they will price as empty.`);
console.log(`\n  node scripts/recurse-batch.mjs --corpus ${OUT}`);
console.log("  Don't commit that file — it carries your SKUs and asking prices.");
