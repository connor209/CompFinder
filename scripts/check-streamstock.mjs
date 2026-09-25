/**
 * Stream stock: the eBay Live box — what goes in it, when a card comes home,
 * where the pull sheet sends you, and that none of it leaks onto a show screen.
 *
 *   node scripts/check-streamstock.mjs      (or: npm run check)
 *
 * The case that matters most is the last group. A stream card is a checked-out
 * card, and every screen that reads open checkouts reads them as "at a show" —
 * the Show Desk, its counter, its binder, Show history, and the QR storefront
 * on a stranger's phone. Each of those filters on the pool now, and a NEW
 * reader of `stock_checkouts` that does not decide about the pool fails here
 * rather than quietly putting the stream box on a table.
 *
 * The rest are table tests: a row with no pool is a show row (or the Show Desk
 * empties the day 031 is applied), a skipped lot is not an airing, a card
 * three times unsold goes home, and the pull sheet numbers a card where it
 * physically is rather than where the app now says it is.
 *
 * Offline, no Supabase, no framework.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  poolOf, isShowCheckout, isStreamCheckout, showOnly, streamOnly, isMissingPool, withPool,
  streamHideMode, conditionCode, nameTerms, matchesNames, streamCandidates, recommendStream,
  duplicateKey, priceBands, CONDITIONS, DEFAULT_PICK_MODE, DEFAULT_MAX_COPIES,
  airingCounts, boxStatus, topUpCount, pullSheet, latestBatch, matchAired, streamTally,
  AIRINGS_BEFORE_RETURN, STREAMS_BACKSTOP, SHOW_POOL, STREAM_POOL
} from "../apps/app/lib/streamstock.js";
import { airedIds, AIRED_MIN_MS } from "../apps/app/lib/livestream.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const file = (p) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
let passed = 0;
const fail = (msg) => { console.error(`  ✕ ${msg}`); failures++; };
const ok = (label, cond) => { if (cond) passed++; else fail(label); };
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

/* --------------------------------------------------------------- 1. pools */

eq("a row with no pool is a show row", poolOf({ id: 1 }), SHOW_POOL);
eq("null is a show row", poolOf(null), SHOW_POOL);
eq("an explicit show row", poolOf({ pool: "show" }), SHOW_POOL);
eq("a stream row", poolOf({ pool: "stream" }), STREAM_POOL);
eq("only the exact word is a stream", poolOf({ pool: "Stream" }), SHOW_POOL);
ok("isShowCheckout on a pre-031 row", isShowCheckout({ sku: "A1" }));
ok("isStreamCheckout on a stream row", isStreamCheckout({ pool: "stream" }));
const mixed = [{ id: "s1" }, { id: "s2", pool: "show" }, { id: "t1", pool: "stream" }];
eq("showOnly keeps show rows and pre-031 rows", showOnly(mixed).map((r) => r.id), ["s1", "s2"]);
eq("streamOnly keeps the stream box", streamOnly(mixed).map((r) => r.id), ["t1"]);
eq("showOnly of nothing", showOnly(null), []);

ok("a missing pool column is recognised", isMissingPool({ code: "42703", message: "column stock_checkouts.pool does not exist" }));
ok("PostgREST's schema-cache wording too", isMissingPool({ message: "Could not find the 'pool' column of 'stock_checkouts' in the schema cache" }));
ok("pool_name (migration 024) is not this column", !isMissingPool({ code: "42703", message: "column price_batches.pool_name does not exist" }));
ok("a dropped connection is not a missing column", !isMissingPool({ message: "Failed to fetch" }));

{
  const asked = [];
  const run = async (cols) => {
    asked.push(cols);
    return cols.includes("pool") ? { error: { code: "42703", message: "column stock_checkouts.pool does not exist" } } : { data: [{ id: 1 }] };
  };
  const r = await withPool(run, "id,sku");
  eq("withPool asks with the column first", asked[0], "id,sku,pool");
  eq("and without it when the column is missing", asked[1], "id,sku");
  eq("returning the rows from the fallback", r.data, [{ id: 1 }]);
  const asked2 = [];
  const r2 = await withPool(async (cols) => { asked2.push(cols); return { error: { message: "permission denied" } }; }, "id");
  eq("any other error is returned, not retried", [asked2.length, r2.error.message], [1, "permission denied"]);
}

eq("the stream box never leaves a listing live", streamHideMode("none"), "auto");
eq("no preference is auto", streamHideMode(undefined), "auto");
eq("out-of-stock only is kept", streamHideMode("quantity"), "quantity");
eq("end and relist is kept", streamHideMode("ended"), "ended");

/* ----------------------------------------------------------- 2. condition */

eq("NM in the title", conditionCode("Charizard 4/102 Base Set NM"), "NM");
eq("a slab is graded before anything else", conditionCode("PSA 10 Umbreon VMAX 215/203 Gem Mint"), "graded");
eq("lightly played written out", conditionCode("Pikachu 58/102 lightly played"), "LP");
eq("60 HP is a stat, not Heavily Played", conditionCode("Mew 60 HP Promo"), "unknown");
eq("'not graded' is not a slab", conditionCode("Gengar 94/162 NM not graded"), "NM");
eq("nothing said", conditionCode("Eevee 133/165"), "unknown");

/* --------------------------------------------------------------- 3. names */

eq("commas separate alternatives", nameTerms("charizard, umbreon vmax"), [["charizard"], ["umbreon", "vmax"]]);
eq("blank is no filter", nameTerms("  ,  "), []);
ok("empty terms match everything", matchesNames("anything at all", []));
ok("mew matches Mew", matchesNames("Mew 151/165 Pokemon 151", nameTerms("mew")));
ok("mew does NOT match Mewtwo — a whole word, or 100 wrong cards in a box", !matchesNames("Mewtwo GX 72/73", nameTerms("mew")));
ok("every word of one alternative is required", !matchesNames("Umbreon V 94/203", nameTerms("umbreon vmax")));
ok("and found in any order", matchesNames("VMAX Umbreon 215/203", nameTerms("umbreon vmax")));
ok("any alternative will do", matchesNames("Pikachu 58/102", nameTerms("charizard, pikachu")));
ok("accents are flattened", matchesNames("Flabébé 101/195", nameTerms("flabebe")));

/* ---------------------------------------------------------- 4. candidates */

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const CARDS = [
  { id: "a", sku: "A1", stack_id: "S", position: 1, title: "Charizard ex 199/165 NM" },
  { id: "b", sku: "A2", stack_id: "S", position: 2, title: "Pikachu 58/102", checked_out_at: daysAgo(3) },
  { id: "c", sku: "A3", stack_id: "S", position: 3, title: "Gengar 94/162" },
  { id: "d", sku: "A4", stack_id: "S", position: 4, title: "Eevee 133/165" },
  { id: "e", sku: "A5", stack_id: "S", position: 5, title: "Umbreon VMAX 215/203 LP" },
  { id: "f", sku: "A6", stack_id: "S", position: 6, title: "Mew 151/165 MP" },
  { id: "g", sku: "A7", stack_id: "S", position: 7, title: "Snorlax", pulled_at: daysAgo(40) },
  { id: "h", sku: null, stack_id: "S", position: 8, title: "Loose card" },
  { id: "i", sku: "A9", stack_id: "S", position: 9, title: "PSA 10 Lugia V 186/195" }
];
const LISTINGS = [
  { ebay_item_id: 1, sku: "A1", price_value: "120.00", quantity: 1, extra: { category: "Pokémon Individual Cards" } },
  { ebay_item_id: 2, sku: "A2", price_value: "5.00", quantity: 0 },
  { ebay_item_id: 3, sku: "A3", price_value: "40.00", quantity: 0 },
  { ebay_item_id: 5, sku: "A5", price_value: "800.00", quantity: 1 },
  { ebay_item_id: 6, sku: "A6", price_value: "15.00", quantity: 3 },
  { ebay_item_id: 9, sku: "A9", price_value: "300.00", quantity: 1 }
];
const RETURNED = [
  { stack_card_id: "e", resolution: "returned", resolved_at: daysAgo(5) },
  { stack_card_id: "f", resolution: "returned", resolved_at: daysAgo(60) },
  { stack_card_id: "a", resolution: "sold", resolved_at: daysAgo(2) }
];
const cand = streamCandidates({ cards: CARDS, listings: LISTINGS, recentStream: RETURNED, now: NOW });
eq("offered: the free, priced, raw cards outside the cooldown", cand.rows.map((r) => r.sku).sort(), ["A1", "A6"]);
eq("left out, and counted", cand.skipped, { away: 1, soldOut: 1, unpriced: 1, cooldown: 1, graded: 1, noSku: 1 });
ok("a slab is never offered for the box (decided 2026-09-25)", !cand.rows.some((r) => r.condition === "graded"));
ok("and graded is not a condition chip", !CONDITIONS.some((c) => c.key === "graded"));
ok("a pulled card is neither offered nor counted", !cand.rows.some((r) => r.sku === "A7"));
ok("a card back from the box 60 days ago is offered again", cand.rows.some((r) => r.sku === "A6"));
ok("a SOLD checkout is not a cooldown", cand.rows.some((r) => r.sku === "A1"));
eq("cooldown 0 lets the returned card straight back", streamCandidates({ cards: CARDS, listings: LISTINGS, recentStream: RETURNED, now: NOW, cooldownDays: 0 }).rows.map((r) => r.sku).sort(), ["A1", "A5", "A6"]);
const a1 = cand.rows.find((r) => r.sku === "A1");
eq("price in pence off our own ask", a1.pricePence, 12000);
eq("the item id travels, for matching the relay later", a1.itemId, "1");
eq("the game off the category", a1.game, "pokemon");
eq("quantity carried, so a ×3 listing can say so", cand.rows.find((r) => r.sku === "A6").quantity, 3);

/* ------------------------------------------------------------ 5. recommend */

const ROWS = [
  { card: { id: 1 }, sku: "B1", title: "Charizard ex 199/165", pricePence: 12000, game: "pokemon", condition: "NM" },
  { card: { id: 2 }, sku: "B2", title: "Pikachu 58/102", pricePence: 500, game: "pokemon", condition: "LP" },
  { card: { id: 3 }, sku: "B3", title: "Blue-Eyes White Dragon LOB-001", pricePence: 9000, game: "yugioh", condition: "unknown" },
  { card: { id: 4 }, sku: "B4", title: "Umbreon VMAX 215/203", pricePence: 80000, game: "pokemon", condition: "graded" },
  { card: { id: 5 }, sku: "B10", title: "Charizard V 17/189", pricePence: 1500, game: "pokemon", condition: "NM" },
  { card: { id: 6 }, sku: "B9", title: "Charizard V 17/189", pricePence: 1500, game: "pokemon", condition: "NM" }
];
// The filters, on "top" with no duplicate limit so each is tested on its own.
const plain = (o) => recommendStream(ROWS, { mode: "top", maxCopies: 0, ...o });
const top = plain({ count: 3 });
eq("top: dearest first, cut to the count", top.picks.map((r) => r.sku), ["B4", "B1", "B3"]);
eq("matched is before the cut", top.matched, 6);
eq("equal prices by SKU as read off a box (B9 before B10)", plain({ count: 10, names: "charizard v" }).picks.map((r) => r.sku), ["B9", "B10"]);
eq("games", plain({ count: 10, games: new Set(["yugioh"]) }).picks.map((r) => r.sku), ["B3"]);
eq("conditions", plain({ count: 10, conditions: new Set(["LP", "graded"]) }).picks.map((r) => r.sku), ["B4", "B2"]);
eq("a price range, both ends inclusive", plain({ count: 10, minPence: 1500, maxPence: 12000 }).picks.map((r) => r.sku), ["B1", "B3", "B9", "B10"]);
eq("characters", plain({ count: 10, names: "charizard" }).picks.map((r) => r.sku), ["B1", "B9", "B10"]);
eq("count 0 picks nothing", plain({ count: 0 }).picks, []);
eq("an empty choice of games is every game", plain({ count: 10, games: new Set() }).picks.length, 6);

/* --------------------------------------------------- 5b. the mix and dupes */

eq("the default is a spread", DEFAULT_PICK_MODE, "spread");
eq("the default is no duplicates", DEFAULT_MAX_COPIES, 1);
ok("two copies of one card are one key", duplicateKey("Charizard V 17/189 Darkness Ablaze") === duplicateKey("Charizard V 17/189 NM"));
ok("a reverse holo is not the plain copy", duplicateKey("Emboar 33/236 Reverse Holo") !== duplicateKey("Emboar 33/236"));
ok("a stamped copy is not the plain one", duplicateKey("Shedinja 14/107 Prerelease Stamp") !== duplicateKey("Shedinja 14/107"));
ok("different numbers are different cards", duplicateKey("Pikachu 58/102") !== duplicateKey("Pikachu 60/64"));
ok("a title with no number still dedupes against itself", duplicateKey("Mystery Lot Card") === duplicateKey("mystery lot card"));

eq("one copy: B9 and B10 are the same card, so one goes", recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v" }).picks.map((r) => r.sku), ["B9"]);
eq("and the refusal is counted", recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v" }).capped, 1);
eq("two copies lets both in", recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v", maxCopies: 2 }).picks.length, 2);
eq("0 is no limit", recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v", maxCopies: 0 }).picks.length, 2);
eq("copies already in the box count toward the limit",
  recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v", held: ["Charizard V 17/189 Brilliant Stars"] }).picks, []);
eq("a reverse holo in the box does not block the plain card",
  recommendStream(ROWS, { mode: "top", count: 10, names: "charizard v", held: ["Charizard V 17/189 Reverse Holo"] }).picks.length, 1);

{
  // 100 distinct cards from £1 to ~£1000, dearest-heavy at the top by count.
  const wide = Array.from({ length: 100 }, (_, i) => ({
    card: { id: `w${i}` }, sku: `W${i}`, title: `Card ${i} ${i + 1}/200`,
    pricePence: Math.round(100 * Math.pow(1000, i / 99)), game: "pokemon", condition: "NM"
  }));
  const bands = priceBands(wide);
  eq("five bands", bands.length, 5);
  eq("bands run cheapest to dearest, end to end", [bands[0].loPence, bands[4].hiPence], [100, 100000]);
  ok("log steps: each band's top is the next one's bottom", bands.every((b, i) => i === 0 || b.loPence === bands[i - 1].hiPence));
  eq("one band when every card costs the same", priceBands([{ pricePence: 500 }, { pricePence: 500 }]).length, 1);
  eq("no bands for nothing", priceBands([]), []);

  const spread = recommendStream(wide, { count: 20 });
  eq("a spread fills the count", spread.picks.length, 20);
  eq("every band gives its share", spread.bands.map((b) => b.picked), [4, 4, 4, 4, 4]);
  ok("it reaches the cheap end, not just the top", spread.picks.some((r) => r.pricePence < 500));
  ok("and still includes the dear end", spread.picks.some((r) => r.pricePence > 50000));
  const topOnly = recommendStream(wide, { mode: "top", count: 20 });
  ok("top mode is the dear end only — what the first version did", topOnly.picks.every((r) => r.pricePence > 20000));
  eq("picks are shown dearest first either way", spread.picks.map((r) => r.pricePence), [...spread.picks.map((r) => r.pricePence)].sort((a, b) => b - a));
  ok("a band spreads WITHIN itself: its cheapest and dearest are both taken", (() => {
    const inTop = wide.filter((r) => r.pricePence >= bands[4].loPence);
    const got = new Set(spread.picks.map((r) => r.sku));
    return got.has(inTop[0].sku) && got.has(inTop[inTop.length - 1].sku);
  })());

  // A thin band gives its unused share to the others.
  const lopsided = [...wide.slice(0, 60), wide[99]];
  const lop = recommendStream(lopsided, { count: 20 });
  eq("a thin band's share goes to the others, and the count is still met", lop.picks.length, 20);
  ok("the lone dear card is in", lop.picks.some((r) => r.sku === "W99"));

  const fewer = recommendStream(wide.slice(0, 3), { count: 20 });
  eq("asking for more than there is takes all there is", fewer.picks.length, 3);

  const dupes = [...wide.slice(0, 10), ...wide.slice(0, 10).map((r) => ({ ...r, card: { id: `${r.card.id}b` }, sku: `${r.sku}b` }))];
  const d = recommendStream(dupes, { count: 20 });
  eq("with one copy each, ten cards is all a spread can take", d.picks.length, 10);
  eq("and it says ten were passed over", d.capped, 10);
}

/* ------------------------------------------------------------ 6. the box */

const co = (id, out) => ({ id, pool: "stream", checked_out_at: out, sku: id, ebay_item_id: `item-${id}` });
const BOX = [co("x", "2026-09-01T10:00:00Z"), co("y", "2026-09-01T10:00:00Z"), co("z", "2026-09-01T10:00:00Z"), co("w", "2026-09-20T10:00:00Z")];
const air = (checkout_id, outcome) => ({ checkout_id, outcome });
const AIRINGS = [
  air("x", "unsold"), air("x", "unsold"), air("x", "unsold"),
  air("y", "unsold"), air("y", "unsold"), air("y", null),
  air("z", "sold")
];
eq("airing counts", Object.fromEntries(airingCounts(AIRINGS)), {
  x: { unsold: 3, sold: 0, pending: 0 }, y: { unsold: 2, sold: 0, pending: 1 }, z: { unsold: 0, sold: 1, pending: 0 }
});
const st = (id) => boxStatus(BOX, AIRINGS, []).find((s) => s.checkout.id === id);
eq(`${AIRINGS_BEFORE_RETURN} unsold airings and it goes home`, [st("x").due, st("x").reason], [true, "aired"]);
eq("an airing not yet packed is not a chance used", [st("y").due, st("y").aired, st("y").pending], [false, 2, 1]);
eq("a sale is not an unsold airing", st("z").aired, 0);

const closed = (d) => ({ streamed_on: d, closed_at: `${d}T23:00:00Z` });
const SIX = ["2026-09-02", "2026-09-05", "2026-09-09", "2026-09-12", "2026-09-16", "2026-09-19"].map(closed);
const back = boxStatus(BOX, [], SIX);
eq(`${STREAMS_BACKSTOP} streams unreached and it goes home anyway`, [back[0].due, back[0].reason, back[0].streams], [true, "backstop", 6]);
eq("streams before the card went in do not count", [back[3].due, back[3].streams], [false, 0]);
eq("an OPEN stream does not count toward the backstop",
  boxStatus(BOX, [], [...SIX.slice(0, 5), { streamed_on: "2026-09-19", closed_at: null }])[0].due, false);
eq("a stream on the day the card went in counts",
  boxStatus([co("v", "2026-09-19T09:00:00Z")], [], [closed("2026-09-19")])[0].streams, 1);

const status = boxStatus(BOX, AIRINGS, []);
eq("top-up: target less the cards staying", topUpCount(200, status), 197);
eq("top-up never goes negative", topUpCount(2, status), 0);
eq("an empty box tops up to the target", topUpCount(200, []), 200);

/* ---------------------------------------------------------- 7. pull sheet */

{
  const t = "2026-09-25T09:00:00Z";
  const stackCards = [
    { id: "s1", stack_id: "S", position: 1 },
    { id: "s2", stack_id: "S", position: 2, pulled_at: t },            // sold weeks ago
    { id: "s3", stack_id: "S", position: 3, checked_out_at: t },       // pulling now
    { id: "s4", stack_id: "S", position: 4, checked_out_at: t },       // away at a SHOW
    { id: "s5", stack_id: "S", position: 5, checked_out_at: t },       // pulling now
    { id: "s6", stack_id: "S", position: 6 },
    { id: "t1", stack_id: "T", position: 1, checked_out_at: t }        // pulling now
  ];
  const pull = [
    { id: "p3", stack_card_id: "s3", sku: "S3" },
    { id: "p5", stack_card_id: "s5", sku: "S5" },
    { id: "pt", stack_card_id: "t1", sku: "T1" },
    { id: "px", stack_card_id: "gone", sku: "X" }
  ];
  const sheet = pullSheet(pull, stackCards, new Map([["S", "AB"], ["T", "C"]]));
  const s = sheet.stacks.find((g) => g.stackId === "S");
  // Physically in S right now: s1, s3, s5, s6 (s2 pulled, s4 at a show).
  eq("ranked as the stack physically stands, deepest first", s.rows.map((r) => [r.checkout.sku, r.rank]), [["S5", 3], ["S3", 2]]);
  eq("the depth counts the cards still to be pulled", s.depth, 4);
  eq("stacks in box order", sheet.stacks.map((g) => g.name), ["AB", "C"]);
  eq("a card whose stack card has gone is listed, not dropped", sheet.unplaced.map((c) => c.sku), ["X"]);
  // Pull S5 first; S3's number must still be right.
  const afterFirst = stackCards.map((c) => (c.id === "s5" ? { ...c, pulled_at: t } : c));
  const again = pullSheet([pull[0]], afterFirst, new Map());
  eq("pulling deepest first keeps the next number true", again.stacks[0].rows[0].rank, 2);
}

eq("the latest batch is the latest DAY's checkouts, still open",
  latestBatch([
    { id: 1, checked_out_at: "2026-09-18T10:00:00Z" },
    { id: 2, checked_out_at: "2026-09-25T10:00:00Z" },
    { id: 3, checked_out_at: "2026-09-25T11:30:00Z" },
    { id: 4, checked_out_at: "2026-09-26T08:00:00Z", resolved_at: "2026-09-26T09:00:00Z" }
  ]).map((c) => c.id),
  [2, 3]);
eq("no open checkouts, no batch", latestBatch([]), []);

/* ------------------------------------------------------------ 8. airings */

{
  const m = matchAired(["item-x", "item-y", "item-x", "demo-1"], BOX);
  eq("aired lots match the box on item id", m.matched.map((c) => c.id), ["x", "y"]);
  eq("each lot once", m.matched.length, 2);
  eq("a lot not in the box is counted, not dropped", m.unknown, ["demo-1"]);
}
eq("a skipped lot is not an airing", airedIds([["a", AIRED_MIN_MS - 1], ["b", AIRED_MIN_MS], ["c", 30000]]), ["b", "c"]);
ok("the threshold is long enough that Next is a skip", AIRED_MIN_MS >= 5000);
eq("stream tally", streamTally([
  { outcome: "sold", hammer_pence: 2500 }, { outcome: "sold", hammer_pence: null }, { outcome: "unsold" }, { outcome: null }
]), { aired: 4, sold: 2, unsold: 1, pending: 1, hammerPence: 2500 });

/* ------------------------------------------------ 9. the show screens (greps) */

/**
 * Every file that READS `stock_checkouts` has to have decided about the pool.
 * The allowed exceptions each say why they are not a show screen.
 */
const NOT_A_SHOW_SCREEN = {
  "apps/app/lib/checkout.js": "writes checkouts and restores them; decides nothing about who sees them",
  "apps/app/lib/deal.js": "sells the ONE checkout it was handed, by id",
  "apps/app/app/panel/Accounts.js": "sums sold_price_pence, which a stream sale never writes (the price goes on the airing)",
  "apps/app/app/settings/AccountData.js": "the account's own data export — everything, on purpose"
};
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}
const readers = walk(join(ROOT, "apps/app")).filter((p) => /from\(\s*["']stock_checkouts["']\s*\)/.test(readFileSync(p, "utf8")));
ok("found the stock_checkouts readers (has the app moved?)", readers.length >= 6);
for (const p of readers) {
  const rel = relative(ROOT, p).split("\\").join("/");
  if (NOT_A_SHOW_SCREEN[rel] || rel.endsWith("StreamStock.js")) continue;
  const src = readFileSync(p, "utf8");
  ok(`${rel} reads stock_checkouts without deciding about the stream box — use showOnly()/withPool() from lib/streamstock.js`,
    /showOnly\(|isStreamCheckout\(|isShowCheckout\(/.test(src));
}

const desk = file("apps/app/app/panel/ShowDesk.js");
ok("the Show Desk's open list is show stock only", /setOpen\(showOnly\(/.test(desk));
ok("and so is its recent activity", /setHistory\(showOnly\(/.test(desk));
const store = file("apps/app/lib/storefront-store.js");
ok("the storefront — a stranger's phone — serves show stock only", /storefrontStock\(showOnly\(/.test(store));
ok("and reads the pool column to know", /POOL_COLUMN/.test(store) && /export const POOL_COLUMN = "pool"/.test(store));
ok("Show history leaves stream sales out of a show's takings", /showOnly\(await pagedSelect/.test(file("apps/app/app/panel/ShowHistory.js")));
const panel = file("apps/app/app/panel/Panel.js");
ok("the show pool, saved stickers and sticker write-back all filter", (panel.match(/showOnly\(/g) || []).length >= 3);

const inv = file("apps/app/app/panel/Inventory.js");
const deals = (inv.match(/<DealButton\b/g) || []).length;
const guarded = (inv.match(/inStreamBox\(g\) \? null :\s*\(?\s*<DealButton\b/g) || []).length;
ok("My listings has DealButtons to guard", deals >= 2);
eq("every ＋ Deal in My listings is withheld from a stream card (no crossover)", guarded, deals);

const co16 = file("apps/app/lib/checkout.js");
ok("a show checkout never names the pool column (it must work before 031)", /if \(stream\) row\.pool = "stream"/.test(co16) && !/pool:\s*pool\b/.test(co16));

const ss = file("apps/app/app/panel/StreamStock.js");
ok("a stream sale writes no cash-sale price (Accounts counts it through ebay_sales)", /sellLine\(sb, checkoutLine\(co\), null,/.test(ss));
ok("stream checkouts are made with the stream hide mode", /streamHideMode\(getHideMode\(\)\)/.test(ss) && /pool: "stream"/.test(ss));

// The two new tables are named in one file.
for (const p of walk(join(ROOT, "apps"))) {
  const rel = relative(ROOT, p).split("\\").join("/");
  if (rel.endsWith("lib/stream-store.js")) continue;
  const src = readFileSync(p, "utf8");
  ok(`${rel} names live_streams/stream_airings — only stream-store.js may`, !/["'`](live_streams|stream_airings)["'`]/.test(src));
}

const relay = file("tools/stream-relay/server.mjs");
ok("the relay reports aired lots through livestream.js's threshold", /airedIds\(onAir\)/.test(relay));
ok("clearing the queue keeps the record of what aired", !/case "clear":[^\n]*onAir\.clear/.test(relay));

ok("npm run check runs this file", /check-streamstock\.mjs/.test(file("package.json")));

if (failures) {
  console.error(`\ncheck-streamstock: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`check-streamstock: ${passed} checks passed`);
