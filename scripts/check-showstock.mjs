/**
 * The show pool, and the price that goes on a label.
 *
 *   node scripts/check-showstock.mjs      (or: npm run check)
 *
 * Two things are pinned here, and they fail in opposite directions.
 *
 * The LADDER is arithmetic, so it is a table: the band boundaries, the tie
 * direction and the floor clamp are all places an "obvious" tidy-up silently
 * changes what gets charged. £2.49 and £2.99 landing on the same £3 sticker is
 * intended, not a rounding bug someone should fix.
 *
 * The GATE is the one that matters. Everywhere else in this codebase a bad
 * price is absorbed or editable — a comp moves a weighted median by pennies, a
 * listing gets its price changed. A sticker is printed, stuck to a card, and
 * carried to a table, where the only correction is peeling it off in front of a
 * customer. So a price built on nothing, or built on asking prices, is HELD.
 * The false-positive cases below (Medium confidence prices; a High-confidence
 * sold price) are the ones worth keeping: they are what fails loudly if the
 * gate is ever widened into "hold anything we're unsure about", which would
 * quietly leave a whole box of stock with no prices on show day.
 *
 * The one thing the gate deliberately does NOT hold is a price set by hand —
 * that case lives in check-override.mjs, next to the rest of what an override
 * does, rather than being split across both files.
 */
import { readFileSync } from "node:fs";
import {
  stickerPence,
  stickerFor,
  buildPool,
  poolLabel,
  stickerRows,
  stickerSummary,
  STICKER_MIN_PENCE,
  HELD_CONFIDENCE
} from "../apps/app/lib/showstock.js";
import { batchColumns, isMissingPoolName } from "../apps/app/lib/batch-store.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// --- 1. the cash ladder ----------------------------------------------------
// [recommended pence, sticker pence, why this case is here]
const LADDER = [
  [249, 200, "the pricing floor (£2.49) rounds down to £2"],
  [299, 300, "£2.99 and £2.49 deliberately collapse onto neighbouring rungs"],
  [349, 300, "mid-band down"],
  [1249, 1200, "£12.49 -> £12"],
  [1950, 2000, "£19.50 ties up, not down"],
  [2000, 2000, "£20 is the top of the £1 band and is already round"],
  [2001, 2000, "just over £20 switches to £5 steps and lands on £20"],
  [2250, 2500, "£22.50 ties up to £25"],
  [2749, 2500, "£27.49 -> £25"],
  [8375, 8500, "£83.75 -> £85"],
  [10000, 10000, "£100 is the top of the £5 band"],
  [10001, 10000, "just over £100 switches to £10 steps"],
  [10500, 11000, "£105 is a tie in the £10 band and goes up, like every other tie"],
  [83500, 84000, "the Umbreon VMAX: £835 -> £840"],
  [50, STICKER_MIN_PENCE, "50p clamps to the £1 minimum"],
  [20, STICKER_MIN_PENCE, "20p would round to nothing — the clamp catches it"],
  [0, null, "no price is not a £1 sticker"],
  [-100, null, "a negative price is nonsense, not a cheap card"],
  [null, null, "null in, null out"],
  [undefined, null, "undefined in, null out"]
];
for (const [input, want, why] of LADDER) {
  eq(`ladder ${input} (${why})`, stickerPence(input), want);
}

// A rung is never below the floor, and never above what the card sells for by
// more than one step — the property behind the table above.
for (let p = 100; p <= 200000; p += 137) {
  const s = stickerPence(p);
  const step = p <= 2000 ? 100 : p <= 10000 ? 500 : 1000;
  if (s < STICKER_MIN_PENCE) fail(`ladder ${p} fell below the £1 minimum (${s})`);
  if (Math.abs(s - p) > step) fail(`ladder ${p} moved more than one ${step}p step (${s})`);
}

// --- 2. the gate -----------------------------------------------------------
const rec = (over = {}) => ({
  finalPence: 83500,
  confidence: "High",
  dataSource: "sold",
  included: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ...over
});

eq("a High-confidence sold price gets a sticker", stickerFor(rec()),
  { pence: 84000, held: false, reason: null, overridden: false });
eq("Medium is priced too — the gate is not 'anything we're unsure of'",
  stickerFor(rec({ confidence: "Medium" })), { pence: 84000, held: false, reason: null, overridden: false });

const low = stickerFor(rec({ confidence: "Low", included: [1, 2] }));
eq("Low confidence is held", { pence: low.pence, held: low.held }, { pence: null, held: true });
if (!/low confidence/.test(low.reason || "")) fail(`a held row must say why — got ${JSON.stringify(low.reason)}`);
if (!/2 comps/.test(low.reason || "")) fail(`a held row must say how thin — got ${JSON.stringify(low.reason)}`);

const none = stickerFor(rec({ confidence: "None", included: [] }));
eq("None confidence is held", { pence: none.pence, held: none.held }, { pence: null, held: true });
eq("one comp is not '1 comps'",
  /1 comp\b/.test(stickerFor(rec({ confidence: "Low", included: [1] })).reason), true);

const active = stickerFor(rec({ dataSource: "active" }));
eq("an asking price never becomes a sticker, however confident",
  { pence: active.pence, held: active.held }, { pence: null, held: true });
if (!/asking/.test(active.reason || "")) fail("a held asking price must say that's why");

eq("no price at all is held", stickerFor(rec({ finalPence: null })).held, true);
eq("no recommendation at all is held", stickerFor(null).held, true);
eq("the held tiers are the thin ones", HELD_CONFIDENCE, ["None", "Low"]);

// --- 3. the pool -----------------------------------------------------------
const CHECKOUTS = [
  { id: "a", sku: "AB11", title: "Umbreon VMAX 215/203 Evolving Skies", event: "London Expo", resolved_at: null },
  { id: "b", sku: "AB12", title: "Charizard V 154/185 Vivid Voltage", event: "London Expo", resolved_at: null },
  { id: "c", sku: "AB13", title: null, event: "London Expo", resolved_at: null },
  { id: "d", sku: "AB14", title: "Pikachu 58/102 Base Set", event: "London Expo", resolved_at: "2026-08-24T10:00:00Z" }
];
const built = buildPool(CHECKOUTS);
eq("only unresolved, titled cards are priced", built.items.map((i) => i.sku), ["AB11", "AB12"]);
eq("a card with no title is reported, not dropped", built.skipped, [{ id: "c", sku: "AB13" }]);
eq("pool items look like pasted items to the pricing path",
  built.items[0], { sku: "AB11", title: "Umbreon VMAX 215/203 Evolving Skies", source: "stock", checkoutId: "a" });
eq("a checked-in card is out of the pool entirely", built.items.some((i) => i.sku === "AB14"), false);
eq("nothing checked out is an empty pool, not a crash", buildPool([]), { items: [], skipped: [] });
eq("null is an empty pool too", buildPool(null), { items: [], skipped: [] });

eq("one event names the run", poolLabel(CHECKOUTS), "London Expo");
eq("two events fall back to the desk",
  poolLabel([{ event: "London" }, { event: "Manchester" }]), "the show desk");
eq("no event falls back to the desk", poolLabel([{ event: "" }, {}]), "the show desk");

// --- 4. run -> sticker rows ------------------------------------------------
const RESULTS = [
  { sku: "AB11", title: "Umbreon VMAX 215/203", rec: rec() },
  { sku: "AB12", title: "Charizard V 154/185", rec: rec({ confidence: "Low", included: [1], finalPence: 1249 }) },
  { sku: "AB13", title: "Snorlax 131/198", rec: null, failed: "SoldComps timed out" }
];
const rows = stickerRows(RESULTS);
eq("a row per card, in run order", rows.map((r) => r.sku), ["AB11", "AB12", "AB13"]);
eq("the priced row carries both numbers",
  { rec: rows[0].recommendedPence, sticker: rows[0].stickerPence }, { rec: 83500, sticker: 84000 });
eq("a held row carries no sticker", rows[1].stickerPence, null);
eq("a failed row is held, not skipped", { held: rows[2].held, sku: rows[2].sku }, { held: true, sku: "AB13" });
eq("the summary counts both sides", stickerSummary(rows), { priced: 1, held: 2 });
eq("an empty run summarises as empty", stickerSummary([]), { priced: 0, held: 0 });

// --- 4b. a price set by hand -----------------------------------------------
// The gate above is a default, not a verdict. Someone holding the card knows
// more than the comps do, and the most important case is exactly the one the
// gate blocks: a held card is unsellable at a table until a human gives it a
// number, so an override has to beat a hold, not just a suggestion.
const OVER = stickerRows(RESULTS, { overrides: { 1: 500, 2: 300 } });
eq("an override rescues a held card", { p: OVER[1].stickerPence, held: OVER[1].held }, { p: 500, held: false });
eq("and a card that failed outright", { p: OVER[2].stickerPence, held: OVER[2].held }, { p: 300, held: false });
eq("a rescued row loses its held reason", OVER[1].reason, null);
eq("a rescued row is marked as hand-set", OVER[1].edited, true);
eq("an untouched row is not", OVER[0].edited, false);
eq("the summary counts a rescued card as priced", stickerSummary(OVER), { priced: 3, held: 0 });

eq("an override replaces a suggestion too",
  stickerRows(RESULTS, { overrides: { 0: 50000 } })[0].stickerPence, 50000);
eq("the suggestion is still carried, so the screen can offer it back",
  stickerRows(RESULTS, { overrides: { 0: 50000 } })[0].suggestedPence, 84000);
eq("an override equal to the suggestion is not 'edited' — a reprint is not a change",
  stickerRows(RESULTS, { overrides: { 0: 84000 } })[0].edited, false);

for (const [bad, why] of [[0, "zero"], [null, "null"], [-100, "negative"], ["", "empty"], [NaN, "NaN"]]) {
  eq(`${why} is not an override, it is no override`,
    stickerRows(RESULTS, { overrides: { 1: bad } })[1].held, true);
}

// --- 5. one definition of the sticker --------------------------------------
// The number shown on screen, the number written onto the checkout and the
// number in the CSV all come through stickerRows(). A second call to the
// ladder anywhere else is how they start disagreeing, and the disagreement
// would be invisible: every one of them looks like a plausible price.
const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
if (!panel.includes("stickerRows(")) {
  fail("Panel.js no longer goes through stickerRows() — the screen can now disagree with the label");
}
if (/\bstickerPence\s*\(/.test(panel)) {
  fail("Panel.js calls the ladder directly — it should read the sticker off stickerRows(), not round its own");
}
const showstock = readFileSync(new URL("../apps/app/lib/showstock.js", import.meta.url), "utf8");
if (/^\s*import\s+.*from\s+["']@\//m.test(showstock)) {
  fail("showstock.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
}

// The Show Desk is the only way into the pool, and the pool is named in the
// URL rather than handed over in state — state is exactly what a slug change
// throws away (see the note in app/panel/[[...slug]]/page.js).
const desk = readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8");
if (!desk.includes("pool=show")) {
  fail("ShowDesk.js no longer links to the pool — there is no way to price a show's stock");
}

// --- 6. a deployed column that isn't there yet -----------------------------
// Migrations here are applied by hand, so the code always ships before the
// column exists. Postgres rejects a whole statement that names a missing
// column, so a required pool_name would take the saved-runs list and every
// save down with it — including runs that have nothing to do with a show.
eq("pool_name is read while it's believed to exist", batchColumns().includes("pool_name"), true);
eq("Postgres refusing pool_name is recognised",
  isMissingPoolName({ message: 'column price_batches.pool_name does not exist' }), true);
eq("it's also recognised from the details field",
  isMissingPoolName({ details: "Could not find the 'pool_name' column of 'price_batches'" }), true);
eq("an unrelated failure is not mistaken for it",
  isMissingPoolName({ message: "duplicate key value violates unique constraint" }), false);
eq("no error is not a missing column", isMissingPoolName(null), false);

const store = readFileSync(new URL("../apps/app/lib/batch-store.js", import.meta.url), "utf8");
for (const fn of ["saveBatch", "loadBatch", "listBatches"]) {
  const body = store.slice(store.indexOf(`export async function ${fn}`));
  const next = body.slice(1).search(/\nexport (async )?function/);
  if (!/isMissingPoolName/.test(next === -1 ? body : body.slice(0, next))) {
    fail(`${fn}() does not retry without pool_name — it breaks entirely until migration 024 is applied`);
  }
}

// --- 7. the column the sticker is written to -------------------------------
const migration = readFileSync(new URL("../supabase/migrations/024_show_stickers.sql", import.meta.url), "utf8");
for (const col of ["sticker_pence", "sticker_set_at", "sticker_batch_id"]) {
  if (!migration.includes(col)) fail(`migration 024 no longer adds ${col}`);
}
if (!/add column if not exists/i.test(migration)) {
  fail("migration 024 must be re-runnable — it is applied by hand in the SQL editor");
}

if (failures) {
  console.error(`\ncheck-showstock: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-showstock: OK — the pool prices what's away, and a thin price never reaches a label.");
