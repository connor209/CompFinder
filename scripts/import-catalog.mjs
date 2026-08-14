#!/usr/bin/env node
// Comp Finder — bulk-import the multi-game card catalogue into Supabase.
//
// Reads the cleaned per-game CSVs (columns already match card_catalog:
// cardmarket_id,name,collector_number,rarity,expansion,expansion_code,
// scryfall_id,tcgplayer_id,game,category) and upserts them in batches using
// the service-role key. Idempotent: re-running updates rows in place, so it
// doubles as the "top up a new game later" tool.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-catalog.mjs ./catalog            # all *.csv in dir
//     node scripts/import-catalog.mjs ./catalog/magic.csv  # a single file
//
// Requires @supabase/supabase-js (already a dependency).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/import-catalog.mjs <dir-or-file.csv>");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const BATCH = 1000;
const INT_COLS = new Set(["cardmarket_id"]);

// Minimal RFC-4180 CSV line parser (handles quoted fields + escaped quotes).
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function importFile(path) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length < 2) return 0;
  const header = rows[0];
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const obj = {};
    header.forEach((h, idx) => {
      let v = r[idx] ?? "";
      if (INT_COLS.has(h)) obj[h] = v === "" ? null : parseInt(v, 10);
      else obj[h] = v === "" ? null : v;
    });
    if (obj.cardmarket_id == null) continue;
    records.push(obj);
  }

  let done = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await supabase.from("card_catalog").upsert(chunk, { onConflict: "cardmarket_id" });
    if (error) { console.error(`  ✗ ${path} @${i}: ${error.message}`); process.exit(1); }
    done += chunk.length;
    process.stdout.write(`\r  ${path}: ${done}/${records.length}`);
  }
  process.stdout.write("\n");
  return done;
}

const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith(".csv")).map((f) => join(target, f))
  : [target];

let total = 0;
for (const f of files) total += await importFile(f);
console.log(`Done — ${total} rows imported/updated across ${files.length} file(s).`);
