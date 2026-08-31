/**
 * Which migrations are actually applied?
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/check-migrations.mjs
 *
 * Or, with no checkout and no key in your hands: **Actions → Which migrations
 * are applied? → Run workflow**.
 *
 * READ-ONLY. It asks whether each object exists and changes nothing.
 *
 * WHY THIS EXISTS ALONGSIDE supabase/HEALTH_CHECK.sql. That file is the same
 * question asked in SQL, and it is still the better answer when you have the
 * dashboard open: one paste, one Run, and it can read row counts this cannot.
 * But it needs a human at the SQL editor, so nobody else — a script, an Action,
 * an agent working on this repo — can ever answer "what's still to do". This
 * can, from the two secrets the warmer and the image backfill already hold.
 *
 * HOW IT ASKS. Through PostgREST, not SQL — the service-role key is a REST
 * credential and cannot execute arbitrary statements. A table is probed with a
 * zero-row select, a column by naming it in one, and both come back with the
 * same error codes apps/app/lib/copyqueue.js and wants-store.js already read
 * (42P01, 42703, PostgREST's schema-cache complaint). Functions are read off
 * the OpenAPI document PostgREST serves at the REST root — **never by calling
 * them**: `claim_soldcomps_slot` hands out a pacer slot, and a health check
 * that quietly consumes one is a health check that changes the thing it
 * measures.
 *
 * A zero-row select is the cheapest possible question: it returns no data, so
 * it costs one round trip and reads nothing of yours.
 */
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — the anon key cannot see past RLS).");
  process.exit(1);
}
const HEAD = { apikey: key, Authorization: `Bearer ${key}` };

/**
 * Every migration that changes the schema, and the objects that prove it ran.
 *
 * 018 is absent on purpose: it imports Yu-Gi-Oh! rather than changing the
 * schema, so there is nothing to probe. The catalogue summary at the end says
 * whether it ran.
 */
const MIGRATIONS = [
  ["012", "listing photos", [["bucket", "listing-photos"]]],
  ["013", "deals", [["table", "deal_cards"], ["column", "purchases", "pricing_mode"]]],
  ["014", "purchase receipts", [["column", "purchases", "receipt_paths"]]],
  ["015", "multi-game catalogue", [["column", "card_catalog", "game"], ["table", "cm_games"], ["table", "cm_sets"]]],
  ["016", "show checkouts", [["table", "stock_checkouts"], ["column", "stack_cards", "checked_out_at"]]],
  ["017", "price guide", [["table", "cm_price_latest"], ["table", "cm_price_history"]]],
  ["019", "public price page", [["table", "soldcomps_cache"], ["table", "public_rate_limit"]]],
  ["020", "catalogue fuzzy search", [["column", "card_catalog", "name_plain"], ["function", "search_catalog_fuzzy"]]],
  ["021", "soldcomps pacer", [["table", "soldcomps_pacer"], ["function", "claim_soldcomps_slot"]]],
  ["022", "card images", [["column", "card_catalog", "image_small"], ["column", "card_catalog", "image_checked_at"]]],
  ["023", "saved batches", [["table", "price_batches"], ["table", "price_batch_items"]]],
  ["024", "show stickers", [["column", "stock_checkouts", "sticker_pence"], ["column", "price_batches", "pool_name"]]],
  ["025", "app comp cache", [["table", "app_comp_cache"]]],
  ["026", "show wants", [["table", "show_wants"]]],
  ["027", "listing copies", [["column", "stack_cards", "copy_seq"], ["column", "stack_cards", "scan_url"], ["table", "listing_copy_state"]]]
];

/**
 * Present, absent, or — the answer that matters most — UNKNOWN.
 *
 * A network failure and a missing table must never look alike. Reporting a
 * table as absent because the request timed out invites someone to re-run a
 * migration against a database that already has it, and while every migration
 * here is written to be safely re-runnable, "I was told it was missing" is a
 * bad reason to run anything against production.
 */
const PRESENT = "present", ABSENT = "absent", UNKNOWN = "unknown";

/** Does this error mean the object is missing, rather than the request failing? */
function isAbsent(code, message) {
  const m = String(message || "");
  return code === "42P01" || code === "42703" ||
    code === "PGRST205" || code === "PGRST204" ||
    /does not exist|schema cache|Could not find the/i.test(m);
}

async function probeRest(path) {
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...HEAD, Range: "0-0", Prefer: "count=none" } });
    if (res.ok) return { state: PRESENT };
    const body = await res.json().catch(() => ({}));
    if (isAbsent(body.code, body.message || body.hint)) return { state: ABSENT };
    return { state: UNKNOWN, note: `HTTP ${res.status}${body.message ? ` — ${body.message}` : ""}` };
  } catch (err) {
    return { state: UNKNOWN, note: err?.message || "request failed" };
  }
}

const probeTable = (t) => probeRest(`${t}?select=*&limit=0`);
const probeColumn = (t, c) => probeRest(`${t}?select=${encodeURIComponent(c)}&limit=0`);

async function probeBucket(id) {
  try {
    const res = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(id)}`, { headers: HEAD });
    if (res.ok) return { state: PRESENT };
    if (res.status === 404) return { state: ABSENT };
    return { state: UNKNOWN, note: `HTTP ${res.status}` };
  } catch (err) {
    return { state: UNKNOWN, note: err?.message || "request failed" };
  }
}

/**
 * The RPCs PostgREST is willing to expose, read once off its OpenAPI document.
 * Never by calling them — see the file header.
 */
let RPCS = null;
async function loadRpcs() {
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { ...HEAD, Accept: "application/openapi+json" } });
    if (!res.ok) return null;
    const doc = await res.json();
    return new Set(Object.keys(doc?.paths || {})
      .filter((p) => p.startsWith("/rpc/"))
      .map((p) => p.slice(5)));
  } catch {
    return null;
  }
}
async function probeFunction(name) {
  if (RPCS === null) return { state: UNKNOWN, note: "could not read PostgREST's API document" };
  return RPCS.has(name) ? { state: PRESENT } : { state: ABSENT };
}

const probe = ([kind, a, b]) =>
  kind === "table" ? probeTable(a)
  : kind === "column" ? probeColumn(a, b)
  : kind === "bucket" ? probeBucket(a)
  : probeFunction(a);

const label = ([kind, a, b]) =>
  kind === "column" ? `${a}.${b}` : kind === "function" ? `${a}()` : kind === "bucket" ? `${a} bucket` : a;

/** Which games are in the catalogue — the only evidence 018 ran. */
async function games() {
  try {
    const res = await fetch(`${url}/rest/v1/cm_games?select=slug&order=slug`, { headers: HEAD });
    if (!res.ok) return null;
    return (await res.json()).map((g) => g.slug);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Asking ${url.replace(/^https?:\/\//, "")} what it has.\n`);
  RPCS = await loadRpcs();

  const todo = [];
  const unclear = [];
  for (const [num, name, checks] of MIGRATIONS) {
    const results = await Promise.all(checks.map(probe));
    const missing = checks.filter((_, i) => results[i].state === ABSENT);
    const unknowns = results.filter((r) => r.state === UNKNOWN);

    let mark, detail;
    if (unknowns.length) {
      mark = "?";
      detail = `could not tell — ${unknowns[0].note}`;
      unclear.push(num);
    } else if (!missing.length) {
      mark = "OK";
      detail = "applied";
    } else if (missing.length === checks.length) {
      mark = "--";
      detail = "NOT APPLIED";
      todo.push([num, name, "not applied"]);
    } else {
      // Half a migration is the one state worth shouting about: it means
      // something failed partway through, and re-running the file is the fix.
      mark = "!!";
      detail = `PARTLY applied — missing ${missing.map(label).join(", ")}`;
      todo.push([num, name, `partly applied — missing ${missing.map(label).join(", ")}`]);
    }
    console.log(`  ${mark.padEnd(3)} ${num}  ${name.padEnd(24)} ${detail}`);
  }

  const g = await games();
  console.log(`\n  ··  018  ${"yu-gi-oh (data only)".padEnd(24)} ${
    g === null ? "could not read cm_games" :
    g.includes("yugioh") ? `applied — catalogue holds ${g.length} game(s)` :
    `NOT applied — catalogue holds ${g.length ? g.join(", ") : "nothing"}`}`);

  console.log("");

  // An unanswered question must never read as a clean bill of health. The
  // first version printed "nothing to apply" when the database was simply
  // unreachable and every single probe had failed — the most confident
  // possible way to say the opposite of the truth. Anything unclear makes the
  // whole run inconclusive and exits non-zero, so an Action shows red.
  if (unclear.length) {
    const every = unclear.length === MIGRATIONS.length;
    console.log(every
      ? "Could not reach the database at all — every probe failed."
      : `Could not get a straight answer about ${unclear.join(", ")}.`);
    console.log("That is NOT the same as those migrations being missing. Nothing here is a verdict:");
    console.log("check the URL and the service-role key, then run it again before running any SQL.");
    if (todo.length) {
      console.log(`\n(${todo.length} other migration(s) did answer, and answered "not applied" — listed below.)\n`);
    } else {
      process.exitCode = 1;
      return;
    }
  }
  if (!todo.length) {
    console.log("Nothing to apply. Every schema migration in supabase/migrations/ is present.");
    return;
  }
  console.log(`${todo.length} to apply, oldest first — Supabase dashboard → SQL Editor → paste → Run:\n`);
  for (const [num, name, why] of todo) {
    const file = `supabase/migrations/${num}_*.sql`;
    console.log(`  ${file.padEnd(34)} ${name} — ${why}`);
  }
  console.log("\nEvery file is written to be safely re-runnable, so a partly-applied one is fixed");
  console.log("by running the whole file again. 012–016 can also go in together via supabase/APPLY_PENDING.sql.");
}

main().catch((err) => { console.error(err?.message || err); process.exit(1); });
