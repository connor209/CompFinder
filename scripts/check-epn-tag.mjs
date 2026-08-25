/**
 * What an affiliate link reports about itself.
 *
 *   node scripts/check-epn-tag.mjs      (or: npm run check)
 *
 * The EPN dashboard is the only per-page traffic signal this site has — the
 * privacy page promises no analytics, and means it — so a sub-ID that silently
 * changes shape doesn't cost a number on a screen, it costs the ability to
 * compare this month to last. Four things are pinned:
 *
 *   1. The IDs themselves, against real published sets, so a change to slugify
 *      for some unrelated reason fails here rather than in a dashboard nobody
 *      reconciles.
 *   2. The slot prefix. Three slots have been reporting since the campaign ID
 *      went live; the card is additive, and a prefix match on `buy-hero` must
 *      keep selecting what it always selected.
 *   3. That epn.js's sanitiser passes our IDs through UNCHANGED. It rewrites
 *      anything outside [A-Za-z0-9_-] to a dash, which would quietly re-spell
 *      every ID the day slugify started emitting something else.
 *   4. That nobody hand-writes a customId at a call site again.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SLOTS, cardCustomId } from "../apps/public/lib/epn-tag.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const SCREEN = "apps/public/app/card/[q]/CardScreen.js";

let failed = 0;
function eq(label, got, want) {
  if (got !== want) {
    console.error(`  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    failed += 1;
  }
}
function ok(label, cond) {
  if (!cond) {
    console.error(`  ${label}`);
    failed += 1;
  }
}

/* -- 1. the IDs, on real sets from the published manifest ----------------- */
const CASES = [
  // [card, expected sub-ID, why this one is here]
  [{ set: "Prismatic Evolutions", number: "131" }, "buy-hero-prismatic-evolutions-131",
   "the ordinary case — 48 of the published cards are this set"],
  [{ set: "151", number: "009" }, "buy-hero-151-009",
   "a set whose NAME is digits; the number keeps its padding"],
  [{ set: "Champion's Path", number: "SV1" }, "buy-hero-champions-path-sv1",
   "curly apostrophe closes up, letter-prefixed number lowercases"],
  [{ set: "Pokémon GO", number: "TG20" }, "buy-hero-pokemon-go-tg20",
   "é survives as e — 'pokmon' would be a different bucket forever"],
  [{ set: "SWSH Black Star Promos", number: "SWSH284" }, "buy-hero-swsh-black-star-promos-swsh284",
   "the long one, well inside eBay's 256"],
  [{ set: "Evolving Skies" }, "buy-hero-evolving-skies",
   "no collector number — dropped, not padded with a placeholder"],
  [{}, "buy-hero",
   "a typed URL for a card we never published: degrades to what it reported before"]
];
for (const [card, want, why] of CASES) {
  eq(`cardCustomId("buy-hero", ${JSON.stringify(card)}) — ${why}`, cardCustomId("buy-hero", card), want);
}

/* -- 2. the slot prefix, which is the continuity ------------------------- */
const CARD = { set: "Evolving Skies", number: "215" };
for (const slot of Object.keys(SLOTS)) {
  const id = cardCustomId(slot, CARD);
  ok(`${slot} still prefix-matches its own slot (got ${id})`, id === slot || id.startsWith(slot + "-"));
  // ...and doesn't prefix-match a DIFFERENT slot. buy-hero vs buy-heroic would
  // both be selected by a naive `startsWith` filter in the dashboard.
  for (const other of Object.keys(SLOTS)) {
    if (other !== slot) ok(`${slot} is not read as ${other}`, !id.startsWith(other + "-") && id !== other);
  }
}

// An unknown slot must throw rather than report into a bucket nobody reads.
let threw = false;
try { cardCustomId("buy-heroo", CARD); } catch { threw = true; }
ok("an unrecognised slot throws", threw);

/* -- 3. epn.js must not re-spell what we hand it ------------------------- */
// CAMPID is read once at module load, so it is set before the import.
process.env.NEXT_PUBLIC_EPN_CAMPID = "5339194433";
const { epnLink } = await import("../packages/core/epn.js");
for (const [card] of CASES) {
  for (const slot of Object.keys(SLOTS)) {
    const id = cardCustomId(slot, card);
    const got = new URL(epnLink("https://www.ebay.co.uk/itm/123", { customId: id })).searchParams.get("customid");
    eq(`epn.js passes ${JSON.stringify(id)} through unchanged`, got, id || null);
  }
}

/* -- 4. nobody hand-writes one again ------------------------------------- */
const screen = read(SCREEN);
const literals = screen.match(/customId:\s*"[^"]*"/g) || [];
ok(
  `${SCREEN} builds every customId through cardCustomId (found literal ${literals.join(", ")})`,
  literals.length === 0
);
for (const slot of Object.keys(SLOTS)) {
  ok(`${SCREEN} still uses the ${slot} slot`, screen.includes(`tag("${slot}")`));
}
// Every tag() call on the screen names a slot we know about.
for (const used of screen.match(/tag\("([^"]+)"\)/g) || []) {
  const slot = used.slice(5, -2);
  ok(`${SCREEN} tags with a declared slot (${slot})`, Object.hasOwn(SLOTS, slot));
}

if (failed) {
  console.error(`\ncheck-epn-tag: ${failed} failed`);
  process.exit(1);
}
console.log(`check-epn-tag: ok (${CASES.length} cards × ${Object.keys(SLOTS).length} slots)`);
