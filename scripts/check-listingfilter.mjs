/**
 * Filtering My listings by what a card is: game, set, condition, printing,
 * asking price.
 *
 *   node scripts/check-listingfilter.mjs      (or: npm run check)
 *
 * The cases that matter are the leftovers: a title the catalogue can't place
 * and a listing with no condition are buckets of their own, never dropped
 * and never counted as a match for everything. And a grep that the screen
 * reads each of these through the shared module rather than a copy of its own.
 *
 * Offline, no Supabase, no framework.
 */
import { readFileSync } from "node:fs";
import { buildSetIndex } from "@compfinder/core/setmatch.js";
import { buildSetIndex as coreIndex, matchSetFromTitle as coreMatch } from "@compfinder/core/setmatch.js";
import { setMatcher, appSetIndex, matchSetFromTitle } from "../apps/app/lib/set-index.js";
import { buildSetGameIndex, gameOf } from "../apps/app/lib/games.js";
import {
  tagListing,
  matchesListingFilters,
  isListingFiltering,
  listingFacets,
  askPence,
  NO_SET,
  NO_CONDITION,
  EMPTY_LISTING_FILTERS
} from "../apps/app/lib/listingfilter.js";

let failures = 0;
const fail = (m) => { failures++; console.error("  ✗ " + m); };
const ok = (cond, m) => { if (!cond) fail(m); };

const setOf = setMatcher(buildSetIndex([
  { game: "pokemon", set_name: "Evolving Skies", set_code: "EVS" },
  { game: "pokemon", set_name: "Cosmic Eclipse", set_code: "CEC" }
]));

const L = (title, price, extra = {}) => ({ ebay_item_id: title, title, price_value: price, price_currency: "GBP", extra });
const umbreon = L("Pokemon Umbreon VMAX 215/203 Evolving Skies NM", 850);
const slab = L("PSA 10 Pokemon Umbreon VMAX 215/203 Evolving Skies", 1900);
const emboar = L("Emboar Reverse Holo 33/236 Cosmic Eclipse Pokemon LP", 0.99);
const mystery = L("Pokemon card job lot", 4.99);

const T = new Map([umbreon, slab, emboar, mystery].map((l) => [l.ebay_item_id, tagListing(l, { setOf })]));
const tag = (l) => T.get(l.ebay_item_id);

ok(tag(umbreon).set === "Evolving Skies", "Umbreon is filed under Evolving Skies");
ok(tag(emboar).set === "Cosmic Eclipse", "Emboar is filed under Cosmic Eclipse");
ok(tag(mystery).set === NO_SET, "a title naming no set is 'No set found', not a guess");
ok(tag(umbreon).game === "pokemon", "Umbreon is a Pokémon card");
ok(tag(emboar).printing.reverse && !tag(umbreon).printing.reverse, "reverse holo is read off the title");
ok(tag(slab).printing.graded && !tag(umbreon).printing.graded, "a PSA 10 is graded and the raw copy is not");
ok(tag(mystery).condition === NO_CONDITION, "no condition written is 'Not stated'");
ok(tag(umbreon).condition !== NO_CONDITION, "NM in the title is a condition");

// Without a catalogue every set reads as unplaced and nothing throws.
ok(tagListing(umbreon).set === NO_SET, "no catalogue → no set, never a crash");

const pass = (l, c) => matchesListingFilters(l, tag(l), c);
ok(!isListingFiltering(EMPTY_LISTING_FILTERS), "the empty filter is not filtering");
ok([umbreon, slab, emboar, mystery].every((l) => pass(l, EMPTY_LISTING_FILTERS)), "the empty filter passes everything");
ok(pass(umbreon, { set: "Evolving Skies" }) && !pass(emboar, { set: "Evolving Skies" }), "set narrows to that set");
ok(pass(mystery, { set: NO_SET }) && !pass(umbreon, { set: NO_SET }), "'No set found' is a bucket of its own");
ok(pass(slab, { printing: "graded" }) && !pass(umbreon, { printing: "graded" }), "graded keeps slabs only");
ok(pass(umbreon, { printing: "raw" }) && !pass(slab, { printing: "raw" }), "raw drops slabs");
ok(pass(emboar, { printing: "reverse" }) && !pass(umbreon, { printing: "reverse" }), "reverse keeps reverse holos only");
ok(pass(emboar, { price: "u5" }) && pass(mystery, { price: "u5" }) && !pass(umbreon, { price: "u5" }), "under £5 is on the ask");
ok(pass(umbreon, { price: "100+" }), "£850 is £100+");
ok(askPence({ price_value: 4.99 }) === 499 && askPence({}) === null, "ask in pence, null when missing");
ok(!pass({ title: "x" }, { price: "u5" }), "a listing with no ask is in no price band");
ok(!pass(umbreon, { set: "Evolving Skies", printing: "graded" }) && pass(slab, { set: "Evolving Skies", printing: "graded" }), "filters AND together");

const f = listingFacets([...T.values()]);
ok(f.sets[f.sets.length - 1].key === NO_SET, "'No set found' is listed last");
ok(f.sets.find((s) => s.key === "Evolving Skies")?.count === 2, "set counts are counted");
ok(f.conditions[f.conditions.length - 1].key === NO_CONDITION, "'Not stated' is listed last");
ok(f.games.some((g) => g.key === "pokemon"), "the game options come from the listings");

// --- "Base Set" is four sets ------------------------------------------------
// The catalogue names the modern base sets after their era alone; sellers
// write "<era> Base Set", which longest-first used to read as the 1999 one.
{
  const idx = appSetIndex([
    ["Base Set", "BS"], ["Base Set 2", "B2"], ["Sun & Moon", "SUM"], ["Sword & Shield", "SSH"],
    ["Scarlet & Violet", "SVI"], ["XY", "XY"], ["Black & White", "BLW"], ["Evolving Skies", "EVS"]
  ].map(([set_name, set_code]) => ({ game: "pokemon", set_name, set_code })));
  const read = (t) => matchSetFromTitle(t, idx)?.name ?? null;
  const cases = [
    ["Charizard 4/102 Pokemon Base Set Holo", "Base Set"],
    ["Pikachu 58/102 Base Set Shadowless", "Base Set"],
    ["Pikachu 87/130 Base Set 2", "Base Set 2"],
    ["Pikachu 25/149 Sun and Moon Base Set", "Sun & Moon"],
    ["Pikachu 25/149 Sun & Moon Base Set", "Sun & Moon"],
    ["Rowlet 9/149 SM Base Set Reverse Holo", "Sun & Moon"],
    ["Grookey 11/202 Sword and Shield Base Set", "Sword & Shield"],
    ["Zacian V 138/202 Sword & Shield", "Sword & Shield"],
    ["Miraidon ex 81/198 SV Base Set", "Scarlet & Violet"],
    ["Pikachu 62/198 Scarlet and Violet Base Set", "Scarlet & Violet"],
    ["Squirtle 7/146 XY Base Set", "XY"],
    ["Snivy 1/114 Black and White Base Set", "Black & White"],
    // The era left off: the number says which base set it is.
    ["Pikachu 62/198 Base Set", "Scarlet & Violet"],
    ["Rowlet 9/149 Pokemon Base Set", "Sun & Moon"],
    // A number out of something we cannot place is no set, never the wrong one.
    ["Mystery 5/77 Base Set", null],
    ["Umbreon VMAX 215/203 Evolving Skies", "Evolving Skies"]
  ];
  for (const [t, want] of cases) ok(read(t) === want, `"${t}" read as ${JSON.stringify(read(t))}, want ${JSON.stringify(want)}`);
  ok(idx.names.every((e) => !/ and /.test(e.name) || !/&/.test(e.name)), "a set name lost the catalogue's own spelling");

  // The word index must pick exactly what core's full walk picks, on titles
  // where the and/era readings do not apply — it is a speed-up, not a rule.
  const words = "dark light star crown shining fates lost origin silver tempest paldea evolved obsidian flames neo genesis".split(" ");
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push({ game: ["pokemon", "magic"][i % 2], set_name: `${words[i % 16]} ${words[(i * 5) % 16]}${i % 3 ? "" : " " + words[(i * 11) % 16]}`, set_code: `Q${i}` });
  const fast = appSetIndex(rows), slow = coreIndex(rows);
  let same = 0, n = 0;
  for (let i = 0; i < 2000; i++) {
    const t = `Card ${i} ${words[i % 16]} ${words[(i * 3) % 16]} ${words[(i * 7) % 16]} ${words[(i * 5) % 16]} Q${i % 500}`;
    n++;
    if (JSON.stringify(matchSetFromTitle(t, fast)) === JSON.stringify(coreMatch(t, slow))) same++;
  }
  ok(same === n, `the word index disagreed with core's matcher on ${n - same} of ${n} titles`);
  const gi = buildSetGameIndex(rows);
  const walk = (t) => { const hay = ` ${t.toLowerCase()} `; const e = gi.find((x) => hay.includes(` ${x.norm} `)); return e ? e.game : "unknown"; };
  let gsame = 0;
  for (let i = 0; i < 2000; i++) {
    const t = `x ${words[i % 16]} ${words[(i * 3) % 16]} ${words[(i * 7) % 16]} ${words[(i * 5) % 16]}`;
    if (gameOf({ title: t }, gi) === walk(t)) gsame++;
  }
  ok(gsame === 2000, `the game reader's word index disagreed with the full walk on ${2000 - gsame} titles`);
}

// The screen goes through the module, not a copy of its readings.
const inv = readFileSync(new URL("../apps/app/app/panel/Inventory.js", import.meta.url), "utf8");
ok(/matchesListingFilters/.test(inv) && /tagListing/.test(inv), "Inventory.js filters through lib/listingfilter.js");
ok(!/matchSetFromTitle|inferCondition/.test(inv), "Inventory.js reads a set or condition off a title by itself");

if (failures) { console.error(`check-listingfilter: ${failures} failure(s)`); process.exit(1); }
console.log("check-listingfilter: ok");
