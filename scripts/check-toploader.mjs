/**
 * The toploader box: cards kept priced and sleeved between shows.
 *
 *   node scripts/check-toploader.mjs      (or: npm run check)
 *
 * A month with a show every weekend: pulling cards out of the stacks, pricing
 * them, sleeving them, then filing them back on Sunday only to do it all again
 * on Friday. Coming back from a show they can go to the BOX instead — off the
 * stacks, back on sale on eBay, one click from the next show with the sticker
 * they already carry.
 *
 * What this pins, and what each costs if it slips:
 *
 * - The box has NO POSITIONS. A number on a card in an unordered box sends
 *   somebody counting through toploaders for a card 37 that does not exist.
 * - A filing plan never picks it. It is always the emptiest "stack", so the
 *   tightest-fit rule would choose it the first time a return fits, and cards
 *   meant for a stack would vanish into a box nobody counts.
 * - The sticker CARRIES — from a card that came back, never from one that
 *   sold, and never into the stream box, which has no stickers.
 * - Recommended show stock leads with the box: already priced and sleeved.
 * - The pull sheet's pick list and pack hand walk the same order, box last.
 */
import { readFileSync } from "node:fs";
import {
  TOPLOADER_STACK_NAME, TOPLOADER_RETURN_MODE,
  isToploaderStack, toploaderStackOf, fileableStacks, ensureToploaderStack,
  carriedSticker, compareRecs, compareByTitle
} from "../apps/app/lib/toploader.js";
import { positionLabel, locationsBySku } from "../apps/app/lib/stackpos.js";
import { planReallocation, checkoutStackCard } from "../apps/app/lib/checkout.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- 1. which stack is the box ----------------------------------------------
eq("the reserved name", isToploaderStack(TOPLOADER_STACK_NAME), true);
eq("a stack row", isToploaderStack({ id: "t", name: "Toploaders" }), true);
eq("made by hand with a stray space and lower case", isToploaderStack(" toploaders "), true);
eq("a letter stack is not the box", isToploaderStack("A"), false);
eq("a name that merely mentions it is not the box", isToploaderStack("Toploaders 2"), false);
eq("nothing is not the box", isToploaderStack(null), false);
eq("found among stacks", toploaderStackOf([{ id: "a", name: "A" }, { id: "t", name: "Toploaders" }])?.id, "t");
eq("absent until made", toploaderStackOf([{ id: "a", name: "A" }]), null);
eq("filed with its own return mode", TOPLOADER_RETURN_MODE, "toploader");

// --- 2. no positions --------------------------------------------------------
eq("a stack still counts", positionLabel("A", 12, 40), "A · 12 of 40");
eq("the box never shows a number", positionLabel("Toploaders", 12, 40), "🗂 Toploaders");
eq("not even with no depth", positionLabel("Toploaders", 3), "🗂 Toploaders");
// The counter's ⌖ locate still finds a card in the box — by box, not number.
const locs = locationsBySku(
  [
    { id: "1", stack_id: "t", sku: "A50", position: 1 },
    { id: "2", stack_id: "a", sku: "A51", position: 1 }
  ],
  new Map([["t", "Toploaders"], ["a", "A"]])
);
eq("a toploaded card is locatable", locs.get("a50"), "🗂 Toploaders");
eq("a stacked one still counts", locs.get("a51"), "A · 1 of 1");

// --- 3. filing plans never choose the box ------------------------------------
const STACKS = [
  { id: "a", name: "A", used: 95 },
  { id: "t", name: "Toploaders", used: 0 },
  { id: "b", name: "B", used: 40 }
];
eq("fileableStacks drops the box", fileableStacks(STACKS).map((s) => s.id), ["a", "b"]);
const plan = planReallocation(3, fileableStacks(STACKS), 100);
eq("three cards go to the tightest STACK, not the empty box", plan.groups.map((g) => g.stackId), ["a"]);
const big = planReallocation(150, fileableStacks(STACKS), 100);
eq("an overflow opens a new stack rather than spilling into the box",
  big.groups.some((g) => g.stackId === "t"), false);

// --- 4. the sticker carries, and only from a card that came back ------------
eq("returned with a sticker", carriedSticker({ resolution: "returned", sticker_pence: 1500 }), 1500);
eq("a numeric string from the API", carriedSticker({ resolution: "returned", sticker_pence: "2000" }), 2000);
eq("sold — nothing to carry", carriedSticker({ resolution: "sold", sticker_pence: 1500 }), null);
eq("returned with no sticker", carriedSticker({ resolution: "returned", sticker_pence: null }), null);
eq("a zero is no sticker", carriedSticker({ resolution: "returned", sticker_pence: 0 }), null);
eq("no previous checkout", carriedSticker(null), null);
eq("a database without 024 has no column at all", carriedSticker({ resolution: "returned" }), null);

// --- 5. ordering ------------------------------------------------------------
const recs = [
  { id: "dear", pricePence: 50000, toploaded: false },
  { id: "box-cheap", pricePence: 500, toploaded: true },
  { id: "box-dear", pricePence: 9000, toploaded: true },
  { id: "mid", pricePence: 2000, toploaded: false }
];
eq("toploaded first, then by value", [...recs].sort(compareRecs).map((r) => r.id), ["box-dear", "box-cheap", "dear", "mid"]);
const titles = [{ title: "Umbreon VMAX 215/203" }, { title: "" }, { title: "charizard ex 199/165" }, { title: "Gengar 94/102" }];
eq("the box by name, untitled last", [...titles].sort(compareByTitle).map((t) => t.title),
  ["charizard ex 199/165", "Gengar 94/102", "Umbreon VMAX 215/203", ""]);

// --- 6. against a fake Supabase: create once, carry on checkout -------------
/** Just enough of the query builder, recording what was asked. */
function fakeSb({ prev = null } = {}) {
  const log = { inserts: [], reads: [] };
  const builder = (table) => {
    const q = { table, filters: [] };
    const chain = {
      select() { return chain; },
      eq(k, v) { q.filters.push([k, v]); return chain; },
      ilike() { return chain; },
      not() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { if (table === "stock_checkouts") log.reads.push(q); return Promise.resolve({ data: table === "stock_checkouts" ? prev : null, error: null }); },
      single() { return Promise.resolve({ data: { id: `${table}-new` }, error: null }); },
      update() { return { eq: () => Promise.resolve({ error: null }) }; },
      insert(row) { log.inserts.push({ table, row }); return chain; }
    };
    return chain;
  };
  return { log, from: builder, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
}

{
  const sb = fakeSb();
  const made = await ensureToploaderStack(sb, "u1", [{ id: "a", name: "A" }]);
  eq("the box is made on first use", made.created, true);
  eq("under the reserved name", sb.log.inserts[0]?.row?.name, TOPLOADER_STACK_NAME);
  const sb2 = fakeSb();
  const again = await ensureToploaderStack(sb2, "u1", [{ id: "t", name: "Toploaders" }]);
  eq("and found, not made twice", [again.id, again.created, sb2.log.inserts.length], ["t", false, 0]);
}

const CARD = { id: "c1", stack_id: "t", sku: "A50", title: "Umbreon VMAX 215/203", ebay_item_id: null };
{
  const sb = fakeSb({ prev: { resolution: "returned", sticker_pence: 85000 } });
  const r = await checkoutStackCard(sb, { card: CARD, stackName: "Toploaders", event: "Glasgow", hideMode: "none" });
  const row = sb.log.inserts.find((i) => i.table === "stock_checkouts")?.row;
  eq("out of the box, the label's price comes too", row?.sticker_pence, 85000);
  eq("and the screen is told", r.stickerPence, 85000);
  eq("asked about THIS card's last checkout", sb.log.reads[0]?.filters, [["stack_card_id", "c1"]]);
}
{
  const sb = fakeSb({ prev: { resolution: "returned", sticker_pence: 85000 } });
  await checkoutStackCard(sb, { card: { ...CARD, stack_id: "a" }, stackName: "A", hideMode: "none" });
  const row = sb.log.inserts.find((i) => i.table === "stock_checkouts")?.row;
  eq("out of a stack, no sticker — it was taken out of its sleeve", "sticker_pence" in (row || {}), false);
  eq("and nothing is read for it", sb.log.reads.length, 0);
}
{
  const sb = fakeSb({ prev: { resolution: "returned", sticker_pence: 85000 } });
  await checkoutStackCard(sb, { card: CARD, stackName: "Toploaders", hideMode: "none", pool: "stream" });
  const row = sb.log.inserts.find((i) => i.table === "stock_checkouts")?.row;
  eq("the stream box takes no sticker", "sticker_pence" in (row || {}), false);
}
{
  const sb = fakeSb({ prev: { resolution: "sold", sticker_pence: 85000 } });
  await checkoutStackCard(sb, { card: CARD, stackName: "Toploaders", hideMode: "none" });
  const row = sb.log.inserts.find((i) => i.table === "stock_checkouts")?.row;
  eq("a checkout that never came back carries nothing", "sticker_pence" in (row || {}), false);
}

// --- 7. greps ---------------------------------------------------------------
// One spelling of the name. A second literal is how the box ends up as two.
for (const f of [
  "apps/app/app/panel/ShowDesk.js", "apps/app/app/panel/PullSheet.js", "apps/app/app/panel/Stacks.js",
  "apps/app/app/panel/StreamStock.js", "apps/app/lib/checkout.js", "apps/app/lib/stackpos.js"
]) {
  if (/["'`]Toploaders?["'`]/i.test(read(f))) fail(`${f} spells the box's name itself — use TOPLOADER_STACK_NAME / isToploaderStack()`);
}
const desk = read("apps/app/app/panel/ShowDesk.js");
if (!/const stacksWithSpace = useMemo\(\s*\(\) => fileableStacks\(stacks\)/.test(desk)) {
  fail("ShowDesk's stacksWithSpace no longer goes through fileableStacks() — Reallocate and Pick a stack can choose the box");
}
if (!/checkin\(selected, TOPLOADER_RETURN_MODE\)/.test(desk)) fail("ShowDesk has lost its 🗂 To toploaders check-in");
if (!/\.sort\(compareRecs\)/.test(desk)) fail("Recommended show stock no longer leads with the toploader box");
const stream = read("apps/app/app/panel/StreamStock.js");
for (const m of stream.matchAll(/planReallocation\(([^\n]*)/g)) {
  if (!m[1].includes("fileableStacks(")) fail("StreamStock plans a filing over every stack, the box included");
}
// Pick and Pack walk the same order, or Pack numbers the hand wrong.
const sheet = read("apps/app/app/panel/PullSheet.js");
const walks = (sheet.match(/stackWalkCompare\(/g) || []).length;
if (walks < 3) fail(`PullSheet sorts stacks through stackWalkCompare() ${walks - 1} time(s) — pick AND pack must both`);
if ((sheet.match(/return pileCompare\(/g) || []).length !== 1) {
  fail("PullSheet orders stacks with pileCompare() outside stackWalkCompare() — the box would sort among the letters");
}
if (/^\s*import\s+.*from\s+["']@\//m.test(read("apps/app/lib/toploader.js"))) {
  fail("toploader.js has picked up an app-aliased import — it has to stay loadable under bare node");
}

if (failures) {
  console.error(`\ncheck-toploader: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-toploader: OK — the box has no positions, no filing plan picks it, and the sticker comes with the card.");
