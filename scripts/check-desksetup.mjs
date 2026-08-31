/**
 * What the Show Desk says is missing, and — mostly — what it refuses to say.
 *
 *   node scripts/check-desksetup.mjs      (or: npm run check)
 *
 * The case that matters is the negative one. A probe that fails because the
 * venue wifi dropped must never come back as "go and run a migration": the
 * person reading it is at a show, cannot check, and has to believe it. It is
 * the same rule check-migrations.mjs exits non-zero for, and it was wrong there
 * first — pointed at a dead port, that script's first version reported a clean
 * bill of health, which is the same mistake with the sign flipped.
 */
import {
  probeState, deskSetup, setupSummary, PRESENT, ABSENT, UNKNOWN
} from "../apps/app/lib/desk-setup.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const ok = (label, got) => { if (!got) fail(`${label} — expected truthy, got ${JSON.stringify(got)}`); };

// --- 1. reading a probe ----------------------------------------------------
eq("no error is the column being there", probeState(null), PRESENT);
eq("Postgres' missing column", probeState({ code: "42703", message: 'column stock_checkouts.sticker_pence does not exist' }), ABSENT);
eq("Postgres' missing table", probeState({ code: "42P01", message: 'relation "public.show_wants" does not exist' }), ABSENT);
eq("PostgREST's schema cache", probeState({ message: "Could not find the 'pool_name' column in the schema cache" }), ABSENT);
eq("a code we don't recognise, with the right words", probeState({ code: "", message: "column does not exist" }), ABSENT);

// THE ONE THAT MATTERS. Anything that is not the schema saying no is unknown,
// and unknown never reaches the screen as a missing migration.
eq("a dropped connection is not a missing migration", probeState({ message: "TypeError: Failed to fetch" }), UNKNOWN);
eq("nor is a timeout", probeState({ code: "57014", message: "canceling statement due to statement timeout" }), UNKNOWN);
eq("nor is being rate limited", probeState({ code: "", message: "Too many requests" }), UNKNOWN);
eq("nor is an error with nothing in it", probeState({}), UNKNOWN);
eq("nor is a permission refusal — that is RLS, and the column exists",
  probeState({ code: "42501", message: "permission denied for table stock_checkouts" }), UNKNOWN);

// --- 2. what gets reported -------------------------------------------------
eq("everything applied says nothing at all",
  deskSetup({ stickers: PRESENT, poolName: PRESENT, wants: PRESENT }), []);
eq("three failed probes say nothing at all",
  deskSetup({ stickers: UNKNOWN, poolName: UNKNOWN, wants: UNKNOWN }), []);
eq("and that is also the default, so a caller that never ran the probes is silent",
  deskSetup(), []);
eq("no argument at all is still silent", deskSetup(undefined), []);

const both = deskSetup({ stickers: ABSENT, poolName: ABSENT, wants: ABSENT });
eq("024 and 026, in that order", both.map((e) => e.migration), ["024", "026"]);
eq("each names the file to run", both.map((e) => e.file), ["024_show_stickers.sql", "026_show_wants.sql"]);

// 024 is ONE file to run however many of its columns are missing, and the two
// halves fail differently, so the entry says which.
eq("one entry for 024 even with both halves gone", both.filter((e) => e.migration === "024").length, 1);
const stickersOnly = deskSetup({ stickers: ABSENT, poolName: PRESENT, wants: PRESENT });
ok("the sticker half names stickers", /Sticker prices won't save/.test(stickersOnly[0].effect));
ok("...and does not claim the pool half is broken", !/pool/i.test(stickersOnly[0].effect));
const poolOnly = deskSetup({ stickers: PRESENT, poolName: ABSENT, wants: PRESENT });
ok("the pool half says stickers are fine", /Stickers themselves are fine/.test(poolOnly[0].effect));

// A half-applied 024 is still reported: someone ran part of the file.
eq("half of 024 is still one thing to run", poolOnly.map((e) => e.migration), ["024"]);

// A mix of absent and unknown reports only what it actually knows.
eq("an unknown alongside an absent reports only the absent",
  deskSetup({ stickers: ABSENT, poolName: UNKNOWN, wants: UNKNOWN }).map((e) => e.migration), ["024"]);

// --- 3. the wording on the banner -----------------------------------------
// Every effect is written as what will not work today, not as a fact about a
// database: "migration 024 is pending" is true and useless with a customer
// waiting.
for (const e of both) {
  ok(`${e.migration} says what it costs you`, e.effect.length > 20 && /won't|not/i.test(e.effect));
}
eq("one missing migration reads as one", setupSummary(both.slice(0, 1)), "Migration 024 hasn't been run yet");
eq("two read as two", setupSummary(both), "Migrations 024 and 026 haven't been run yet");
eq("nothing missing says nothing", setupSummary([]), "");
eq("and neither does nothing at all", setupSummary(null), "");

if (failures) {
  console.error(`\ncheck-desksetup: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-desksetup: OK — it says what a pending migration costs you, and stays quiet when it cannot tell.");
