/**
 * The query string a card is searched by, and the cache key that string
 * hashes to.
 *
 *   node scripts/check-cardquery.mjs      (or: npm run check)
 *
 * Why this is worth a test of its own: nothing about getting it wrong looks
 * wrong. Three callers have to derive the same key from the same card —
 *
 *   the search box   a visitor picks a suggestion and prices it
 *   a card page      renders server-side from whatever is already cached
 *   the warmer       fills that cache before a crawler arrives
 *
 * — and if a card page joins the name and number even slightly differently, it
 * doesn't show a wrong price. It shows no cached price, on every card, forever,
 * while the code reads as though it is working and the warmer keeps writing
 * entries nobody reads. Same shape of failure as the liquidity read having two
 * definitions, which took measuring 40 cards to notice.
 *
 * The golden keys below are pinned deliberately. Changing the derivation is
 * allowed — but it silently invalidates every entry already in
 * soldcomps_cache, so it should be a decision rather than a side effect of
 * tidying, and this is what makes it one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { cardFromRow, queryForCard, normaliseQuery, EBAY_SITE } from "../apps/public/lib/card-query.js";
const DEFAULT_SOLD_WINDOW = 90;
import { cacheKeyFor } from "../apps/public/lib/cache-key.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };

// --- 1. the row shape the query is built from -------------------------------
// A real catalogue row, and the shape /api/resolve and /api/suggest both hand
// to the page. `name` is CLEANED, which is the part that matters: the raw
// Cardmarket name carries variant parens and duplicated leading words, and
// searching those finds nothing.
const ROW = {
  cardmarket_id: 805555,
  name: "Charizard ex",
  collector_number: "199/165",
  expansion: "151",
  expansion_code: "MEW",
  rarity: "Special Illustration Rare",
  game: "pokemon",
  image_small: "https://assets.tcgdex.net/en/sv/sv03.5/199/low.webp"
};
const CARD = cardFromRow(ROW);
eq("cardFromRow id", CARD.id, 805555);
eq("cardFromRow name", CARD.name, "Charizard ex");
eq("cardFromRow number", CARD.number, "199/165");
eq("cardFromRow set", CARD.set, "151");
eq("cardFromRow code", CARD.code, "MEW");
eq("cardFromRow language", CARD.language, "English");
eq("cardFromRow image", CARD.image, ROW.image_small);
// Missing art is a gap, not a failure — the picker and the card page both have
// to read fine without it.
eq("cardFromRow image absent", cardFromRow({ ...ROW, image_small: null }).image, null);
// The name is cleaned rather than passed through. If this ever stops being
// true, every query built from the catalogue diverges from every query built
// from a visitor's click. Three real Cardmarket spellings, one per rule:
eq(
  "cardFromRow strips a bracketed format tag",
  cardFromRow({ ...ROW, name: "Charizard ex [D-Format]" }).name,
  "Charizard ex"
);
eq(
  "cardFromRow strips a variant parenthetical",
  cardFromRow({ ...ROW, name: "Charizard ex (V.1 - Feature Rare)" }).name,
  "Charizard ex"
);
eq(
  "cardFromRow splits Cardmarket's jammed Mega prefix",
  cardFromRow({ ...ROW, name: "MRayquaza EX" }).name,
  "M Rayquaza EX"
);
// Conservative on purpose, and the query depends on it staying that way: a
// parenthetical that is part of the actual name must survive, or the search
// loses the words that identify the card.
eq(
  "cardFromRow leaves a named parenthetical alone",
  cardFromRow({ ...ROW, name: "Charizard ex (V1)" }).name,
  "Charizard ex (V1)"
);
// A Japanese print is a different product at a different price, and the set
// name alone doesn't say so — the code does.
eq(
  "cardFromRow reads language off the code",
  cardFromRow({ ...ROW, expansion: "Nine Colors Gathering", expansion_code: "sv11w" }).language,
  "Japanese"
);

// --- 2. the query string ----------------------------------------------------
const QUERIES = [
  ["name, number and set", CARD, "Charizard ex 199/165 151"],
  ["no number", { name: "Moonbreon", set: "Evolving Skies" }, "Moonbreon Evolving Skies"],
  ["no set", { name: "Iono", number: "237/193" }, "Iono 237/193"],
  ["name alone", { name: "Charizard" }, "Charizard"],
  // Whitespace is collapsed rather than preserved: the gaps left by an absent
  // number or set must not survive into the string, or they change the hash.
  ["gaps collapse", { name: "Pikachu", number: "", set: "" }, "Pikachu"]
];
for (const [label, card, want] of QUERIES) eq(`queryForCard: ${label}`, queryForCard(card), want);

// --- 3. normalisation -------------------------------------------------------
for (const [label, input] of [
  ["already normal", "charizard ex 199/165 151"],
  ["mixed case", "Charizard EX 199/165 151"],
  ["double spaces", "Charizard  ex   199/165 151"],
  ["padded", "  Charizard ex 199/165 151  "]
]) {
  eq(`normaliseQuery: ${label}`, normaliseQuery(input), "charizard ex 199/165 151");
}

// --- 4. the cache key, pinned ----------------------------------------------
// Regenerate deliberately if the derivation changes, knowing it empties the
// cache. Never "fix" a mismatch by pasting in the new value without saying so.
const Q = queryForCard(CARD);
const GOLDEN = {
  "sold, 90 days": [cacheKeyFor(Q, true, 90), "35fa1abf1e5847ffe34c5bfa40591ca9d897b56a2ae6510e33fe58c0c2851e7f"],
  "sold, 30 days": [cacheKeyFor(Q, true, 30), "95863490388786b06b4f15a8d7b9d193740e88592c99e0a116f0f29327f08c8e"],
  "active": [cacheKeyFor(Q, false, 90), "293a9f1186d9ac5965cab3fa9e87b696a968a5d26514310b59e7510915601159"],
  "a different card entirely": [cacheKeyFor("Umbreon VMAX 215 Evolving Skies", true, 90), "ba56037e26a4f9380b6618d4a1875660edbd120c4192299101d24379d4b19914"]
};
for (const [label, [got, want]] of Object.entries(GOLDEN)) {
  if (got !== want) fail(`cache key drifted for ${label} — every existing entry becomes unreachable.\n     expected ${want}\n     got      ${got}`);
}

// The four have to be four. Collapsing any pair would serve active listings as
// sold comps, or a 30-day window from a 90-day entry, or two cards as one.
const distinct = new Set(Object.values(GOLDEN).map(([got]) => got));
eq("sold/active and the two windows are separate entries", distinct.size, 4);

// Case and spacing must NOT split an entry: two visitors typing the same card
// differently should cost one API call, not two.
if (cacheKeyFor("Charizard  EX 199/165 151", true, 90) !== cacheKeyFor(Q, true, 90)) {
  fail("cache key is sensitive to case or spacing — the same card would cost two API calls");
}

// --- 5. the whole path, end to end -----------------------------------------
// What a card page does (catalogue row → card → query → key) has to land on
// what the search box wrote (card from /api/resolve → query → key). Same
// function both ends is the point; this asserts nobody has quietly forked it.
const fromCatalogue = cacheKeyFor(queryForCard(cardFromRow(ROW)), true, DEFAULT_SOLD_WINDOW);
const fromSearchBox = cacheKeyFor("Charizard ex 199/165 151", true, DEFAULT_SOLD_WINDOW);
eq("a card page finds what the search box cached", fromCatalogue, fromSearchBox);
eq("the marketplace in the key", EBAY_SITE, "ebay.co.uk");

// --- 6. tripwire: nobody derives a key of their own -------------------------
// The liquidity check earns its keep with a grep like this. Same reasoning: a
// second derivation is invisible until someone measures a cache hit rate.
const OWNER = "apps/public/lib/cache-key.js";
const SELF = "scripts/check-cardquery.mjs";
const SKIP_DIRS = new Set([".next", "node_modules"]);
const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs)$/.test(full)) continue;
    const rel = relative(ROOT, full);
    if (rel === OWNER || rel === SELF) continue;
    const text = readFileSync(full, "utf8");
    // A hash fed anything that looks like the key's own ingredients. Turnstile
    // hashes too, but never with a marketplace or a sold flag in the payload.
    if (/createHash\(\s*["']sha256["']\s*\)[\s\S]{0,200}?(ebaySite|ebay\.co\.uk|sold\s*\?)/.test(text)) {
      offenders.push(rel);
    }
  }
}
for (const d of ["apps/public", "apps/app", "scripts", "packages/core"]) walk(join(ROOT, d));
for (const o of offenders) fail(`a second cache-key derivation outside ${OWNER}: ${o}`);

if (failures) {
  console.error(`\ncard query: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log(
  `card query: ${QUERIES.length} query + ${Object.keys(GOLDEN).length} pinned-key cases hold ` +
  `(row shape, normalisation, end-to-end parity, second-derivation tripwire).`
);
