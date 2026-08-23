/**
 * The rules that decide which picture goes with which card.
 *
 *   node scripts/check-images.mjs      (or: npm run check)
 *
 * No network, no database — every case here is a real pairing from the
 * 2026-08-23 match run, kept because each one is somewhere a reasonable rule
 * gets it wrong. The failure that matters is not a missing image, it's the
 * WRONG image: a picture is the most confident-looking thing on the page, and
 * one of the wrong card discredits the price beside it.
 */
import { numKey, setFamily, nameAgrees, imageUrls, indexByNumber, matchCard } from "./lib/card-images.mjs";

let failures = 0;
const fail = (m) => { console.error(`  ${m}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };

// --- numbers ----------------------------------------------------------------
// Ours are zero-padded, theirs are padded differently in every sub-set.
const NUMBERS = [
  ["060", "60"], ["60", "60"], ["2", "2"], ["002", "2"],
  ["SV99", "sv99"], ["SV099", "sv99"], ["SV9", "sv9"], ["SV009", "sv9"],
  ["TG24", "tg24"], ["TG01", "tg1"], ["GG59", "gg59"], ["GG01", "gg1"],
  ["sv40", "sv40"], ["SV40", "sv40"],
  // Left alone rather than mangled: a slash form or a stray word isn't a
  // number we can normalise, and guessing at one invites a wrong match.
  ["161/131", "161/131"], ["", ""], ["promo", "promo"]
];
for (const [input, want] of NUMBERS) eq(`numKey(${JSON.stringify(input)})`, numKey(input), want);
// The padding rule must not merge two genuinely different cards.
if (numKey("SV1") === numKey("SV10")) fail("numKey: SV1 and SV10 must stay distinct");
if (numKey("1") === numKey("10")) fail("numKey: 1 and 10 must stay distinct");

// --- set families -----------------------------------------------------------
const THEIR_SETS = [
  { id: "swsh4.5", name: "Shining Fates" },
  { id: "swsh4.5sv", name: "Shining Fates Shiny Vault" },
  { id: "sm115", name: "Hidden Fates" },
  { id: "sma", name: "Hidden Fates Shiny Vault" },
  { id: "swsh11", name: "Lost Origin" },
  { id: "swsh11.5tg", name: "Lost Origin Trainer Gallery" },
  { id: "swsh12.5", name: "Crown Zenith" },
  { id: "swsh12.5gg", name: "Crown Zenith Galarian Gallery" },
  { id: "sv08.5", name: "Prismatic Evolutions" },
  { id: "base3", name: "Base Set" },
  { id: "base4", name: "Base Set 2" },
  { id: "ex2", name: "Dragon" },
  { id: "ex15", name: "Dragon Frontiers" },
  { id: "sm7.5", name: "Dragon Majesty" },
  { id: "dv1", name: "Dragon Vault" },
  { id: "base5", name: "Team Rocket" },
  { id: "ex7", name: "Team Rocket Returns" },
  { id: "xy1", name: "XY" },
  { id: "xyp", name: "XY Black Star Promos" },
  { id: "tk-xy-b", name: "XY trainer Kit (Bisharp)" },
  { id: "cel25", name: "Celebrations" },
  { id: "cel25cc", name: "Celebrations Classic Collection" }
];
const family = (name) => setFamily(name, THEIR_SETS).map((s) => s.id);

eq("family: Shining Fates", family("Shining Fates").join(","), "swsh4.5,swsh4.5sv");
// The ids have nothing in common here — the name is the only link.
eq("family: Hidden Fates", family("Hidden Fates").join(","), "sm115,sma");
eq("family: Lost Origin", family("Lost Origin").join(","), "swsh11,swsh11.5tg");
eq("family: Crown Zenith", family("Crown Zenith").join(","), "swsh12.5,swsh12.5gg");
eq("family: a set with no sub-set", family("Prismatic Evolutions").join(","), "sv08.5");
eq("family: an unknown set", family("WCD 2024").join(","), "");
// Sets whose names extend another set's name but are separate products. Each
// of these was merged by the first version of the rule, and merging any of
// them puts one card's art on another card's number.
const NOT_SUBSETS = [
  ["Base Set", "base3", "Base Set 2"],
  ["Dragon", "ex2", "Dragon Frontiers / Majesty / Vault"],
  ["Team Rocket", "base5", "Team Rocket Returns"],
  ["XY", "xy1", "XY Black Star Promos and eight Trainer Kits"],
  ["Celebrations", "cel25", "Celebrations Classic Collection"]
];
for (const [parent, parentId, why] of NOT_SUBSETS) {
  eq(`family: ${parent} must not swallow ${why}`, family(parent).join(","), parentId);
}

// --- names ------------------------------------------------------------------
// The catalogue and tcgdex write the same card differently in three ways that
// between them refused 1,477 real pairings on the first full run.
const SAME_CARD = [
  // Spacing of the Mega prefix.
  ["MAggron EX", "M Aggron EX"],
  ["MGardevoir EX", "M Gardevoir EX"],
  // Symbols spelled out on our side.
  ["Nidoran [M]", "Nidoran\u2642"],
  ["Nidoran [F]", "Nidoran\u2640"],
  ["Giovanni's Nidoran [F]", "Giovanni's Nidoran\u2640"],
  // The δ already says Delta Species; Cardmarket writes both.
  ["Pikachu \u03b4 Delta Species", "Pikachu \u03b4"],
  ["Deoxys \u03b4 Delta Species", "Deoxys \u03b4"],
  // One letter apart, and the same card since 1999.
  ["Imposter Professor Oak", "Impostor Professor Oak"]
];
for (const [ours, theirs] of SAME_CARD) {
  if (!nameAgrees(ours, theirs)) fail(`nameAgrees: ${ours} should match ${theirs}`);
}

// The tolerance that makes those work must not reach far enough to swap a
// card for its counterpart. Nidoran♂ and Nidoran♀ are one symbol apart, are
// different cards with different numbers, and are exactly the pair a loose
// rule puts the wrong picture on.
const DIFFERENT_CARDS = [
  ["Nidoran [M]", "Nidoran [F]"],
  ["Nidoran\u2642", "Nidoran\u2640"],
  ["Nidoran [M]", "Nidoran\u2640"],
  ["Nidoking", "Nidoqueen"],
  ["Zacian V", "Zamazenta V"],
  ["Mew", "Mewtwo"]
];
for (const [ours, theirs] of DIFFERENT_CARDS) {
  if (nameAgrees(ours, theirs)) fail(`nameAgrees: ${ours} must NOT match ${theirs}`);
}

// Their name often carries a disambiguator ours doesn't. At one number in one
// set there is only one card, so a parenthetical can't be what tells two
// apart — refusing these would throw away art for cards matched correctly.
if (!nameAgrees("Professor's Research", "Professor's Research (Professor Oak)")) {
  fail("nameAgrees: a parenthetical suffix should not block a match");
}
if (!nameAgrees("Boss's Orders", "Boss's Orders (Ghetsis)")) fail("nameAgrees: Boss's Orders");
if (!nameAgrees("Umbreon ex", "Umbreon EX")) fail("nameAgrees: suffix casing");
if (!nameAgrees("N's Zoroark ex", "N's Zoroark ex")) fail("nameAgrees: apostrophes");
// And the guard still has to bite.
if (nameAgrees("Charizard", "Blastoise")) fail("nameAgrees: different cards must not match");
if (nameAgrees("Umbreon ex", "Espeon ex")) fail("nameAgrees: different Pokémon must not match");
if (nameAgrees("", "Charizard")) fail("nameAgrees: an empty name must never agree");

// --- image urls -------------------------------------------------------------
const urls = imageUrls("https://assets.tcgdex.net/en/sv/sv08.5/161");
eq("small url", urls.small, "https://assets.tcgdex.net/en/sv/sv08.5/161/low.webp");
eq("large url", urls.large, "https://assets.tcgdex.net/en/sv/sv08.5/161/high.png");
eq("a trailing slash doesn't double up", imageUrls("https://x/1/").small, "https://x/1/low.webp");
eq("no base means no url", imageUrls(null).small, null);

// --- the whole decision -----------------------------------------------------
const cardsBySetId = new Map([
  ["swsh4.5", [
    { id: "swsh4.5-1", localId: "1", name: "Bulbasaur", image: "https://a/swsh4.5/1" },
    // A plain number that also exists in the vault: the parent must win.
    { id: "swsh4.5-72", localId: "072", name: "Zacian V", image: "https://a/swsh4.5/72" }
  ]],
  ["swsh4.5sv", [
    { id: "swsh4.5sv-SV099", localId: "SV099", name: "Skwovet", image: null },
    { id: "swsh4.5sv-SV007", localId: "SV007", name: "Blipbug", image: "https://a/sv/7" },
    { id: "swsh4.5sv-72", localId: "72", name: "Something Else", image: "https://a/sv/72" }
  ]]
]);
const idx = indexByNumber(setFamily("Shining Fates", THEIR_SETS), cardsBySetId);

eq("matched", matchCard({ name: "Bulbasaur", number: "001" }, idx).outcome, "matched");
eq("matched url", matchCard({ name: "Bulbasaur", number: "001" }, idx).small, "https://a/swsh4.5/1/low.webp");
// Padded on their side, unpadded on ours.
eq("sub-set match across padding", matchCard({ name: "Blipbug", number: "SV7" }, idx).outcome, "matched");
// They list the card but have no art for it — a gap, and it must be reported
// as one rather than as a match with a null URL.
eq("listed with no art", matchCard({ name: "Skwovet", number: "SV99" }, idx).outcome, "no-art");
eq("number we don't have", matchCard({ name: "Whatever", number: "999" }, idx).outcome, "no-number");
eq("name guard bites", matchCard({ name: "Charizard", number: "001" }, idx).outcome, "name-clash");
// The parent's card, not the vault's, for a plain number present in both.
eq("parent wins a collision", matchCard({ name: "Zacian V", number: "72" }, idx).theirId, "swsh4.5-72");
// Accepts either of our column namings, since the backfill reads catalogue
// rows and the probe reads audit fixtures.
eq("collector_number works too", matchCard({ name: "Bulbasaur", collector_number: "1" }, idx).outcome, "matched");

if (failures) {
  console.error(`\nimages: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`images: ${NUMBERS.length} number, ${SAME_CARD.length + DIFFERENT_CARDS.length} name, plus set-family and match cases hold.`);
