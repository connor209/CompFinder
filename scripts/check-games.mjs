/**
 * Which game a card of ours is — the reading behind the Show Desk's game chips.
 *
 *   node scripts/check-games.mjs      (or: npm run check)
 *
 * The cases that matter are the refusals. A card read as the WRONG game is a
 * card that silently never makes the show list: it is not on screen under the
 * game you picked, and nothing says it was left out. So every rule here errs
 * toward "unidentified", which is a chip of its own and stays visible:
 *
 *   - bare "magic" is not Magic: The Gathering (Magic Cylinder, Dark Magician);
 *   - a one-word set name is an ordinary word ("Judgment Dragon" is Yu-Gi-Oh,
 *     not the Magic set Judgment);
 *   - a set name two games share says nothing;
 *   - a title naming two games is neither.
 *
 * And the list on screen is the chosen games THEN the top N, which the last
 * block pins against the Show Desk itself.
 *
 * Offline, no Supabase, no framework: games.js is pure.
 */
import { readFileSync } from "node:fs";
import {
  GAMES,
  UNKNOWN_GAME,
  gameOf,
  gameName,
  buildSetGameIndex,
  gameFacets,
  filterByGames
} from "../apps/app/lib/games.js";

let failures = 0;
const fail = (msg) => { failures++; console.error("✕ " + msg); };
const eq = (label, got, want) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---- A catalogue slice: real set names, including the collisions ------------
const SETS = buildSetGameIndex([
  { game: "pokemon", set_name: "Evolving Skies" },
  { game: "pokemon", set_name: "Prismatic Evolutions" },
  { game: "pokemon", set_name: "Jungle" },            // one word: never used
  { game: "magic", set_name: "Judgment" },            // one word: never used
  { game: "magic", set_name: "Future Sight" },
  { game: "magic", set_name: "Other / Promos" },      // placeholder: never used
  { game: "onepiece", set_name: "Romance Dawn" },
  { game: "lorcana", set_name: "The First Chapter" },
  { game: "digimon", set_name: "The First Chapter" }, // shared with the row above: says nothing
  { game: "yugioh", set_name: "Legend of Blue Eyes White Dragon" }
]);

// ---- Table: [label, {category, title}, want] --------------------------------
const CASES = [
  // eBay's category, when it names a game, decides.
  ["category names the game", { category: "Pokémon Individual Cards", title: "Umbreon VMAX 215/203" }, "pokemon"],
  ["category beats the title", { category: "Magic: The Gathering Individual Cards", title: "Pokemon-style playmat" }, "magic"],
  ["generic category is no answer", { category: "CCG Individual Cards", title: "Pokemon Umbreon VMAX 215/203" }, "pokemon"],

  // The title naming the game outright.
  ["Pokémon with the accent", { title: "Pokémon Charizard ex 199/165 151" }, "pokemon"],
  ["MTG abbreviation", { title: "MTG Sheoldred, the Apocalypse DMU NM" }, "magic"],
  ["Magic the Gathering, no colon", { title: "Magic the Gathering Ragavan 138 MH2" }, "magic"],
  ["Yu-Gi-Oh hyphenated", { title: "Yu-Gi-Oh! Ash Blossom MAMA-EN069" }, "yugioh"],
  ["Yugioh unhyphenated", { title: "Yugioh Ghost Ogre 1st Edition" }, "yugioh"],
  ["One Piece by name", { title: "One Piece Card Game Luffy OP05-119 SEC" }, "onepiece"],
  ["One Piece by card code alone", { title: "Monkey D. Luffy OP01-024 Alt Art" }, "onepiece"],
  ["One Piece starter code", { title: "Nami ST01-007" }, "onepiece"],
  ["Lorcana", { title: "Disney Lorcana Elsa Spirit of Winter Enchanted" }, "lorcana"],

  // The refusals.
  ["bare magic is not MTG (Yu-Gi-Oh card)", { title: "Magic Cylinder LON-104 Secret Rare" }, UNKNOWN_GAME],
  ["Dark Magician is not MTG", { title: "Dark Magician LOB-005 1st Edition" }, UNKNOWN_GAME],
  ["one-word set is not evidence", { title: "Judgment Dragon LODT-EN023" }, UNKNOWN_GAME],
  ["one-word Pokémon set is not evidence either", { title: "Jungle Pikachu 60/64" }, UNKNOWN_GAME],
  ["a shared set name says nothing", { title: "Elsa The First Chapter 42/204" }, UNKNOWN_GAME],
  ["a title naming two games is neither", { title: "Pokemon and MTG mixed lot" }, UNKNOWN_GAME],
  ["Digimon code is not One Piece", { title: "Agumon ST1-03" }, UNKNOWN_GAME],
  ["nothing at all", {}, UNKNOWN_GAME],

  // The catalogue fallback, for the titles that name no game.
  ["set name fallback: Pokémon", { title: "Umbreon VMAX 215/203 Evolving Skies" }, "pokemon"],
  ["set name fallback: longest name wins", { title: "Eevee Prismatic Evolutions 075/131" }, "pokemon"],
  ["set name fallback: Magic two-word set", { title: "Tarmogoyf Future Sight 153" }, "magic"],
  ["set name fallback: One Piece", { title: "Roronoa Zoro Romance Dawn SR" }, "onepiece"],
  ["title naming the game beats the set", { title: "Yu-Gi-Oh Legend of Blue Eyes White Dragon Evolving Skies" }, "yugioh"]
];

for (const [label, input, want] of CASES) eq(label, gameOf(input, SETS), want);

// The fallback degrades rather than throws when the catalogue could not be read.
eq("no catalogue: title still answers", gameOf({ title: "Pokemon Mew 151" }, null), "pokemon");
eq("no catalogue: set-only title is unknown", gameOf({ title: "Umbreon VMAX 215/203 Evolving Skies" }, null), UNKNOWN_GAME);

// Every slug is a cm_games slug or yugioh (which has its own catalogue, migration 018).
const CM_GAMES = ["pokemon", "magic", "lorcana", "onepiece", "dragonball", "digimon", "fleshandblood", "riftbound", "vanguard", "weissschwarz", "yugioh"];
for (const g of GAMES) if (!CM_GAMES.includes(g.slug)) fail(`GAMES has a slug the catalogue never uses: ${g.slug}`);
eq("unknown has a name", gameName(UNKNOWN_GAME), "Unidentified");

// ---- Facets and the filter --------------------------------------------------
const rows = [
  { id: 1, game: "magic" }, { id: 2, game: "pokemon" }, { id: 3, game: UNKNOWN_GAME },
  { id: 4, game: "pokemon" }, { id: 5, game: "onepiece" }
];
const facets = gameFacets(rows);
eq("facets: GAMES order, unknown last", facets.map((f) => f.slug).join(","), "pokemon,onepiece,magic,unknown");
eq("facets: counted", facets.find((f) => f.slug === "pokemon").count, 2);
eq("facets: a game we hold none of is not offered", facets.some((f) => f.slug === "lorcana"), false);

eq("no choice is every game", filterByGames(rows, new Set()).length, 5);
eq("one game", filterByGames(rows, new Set(["pokemon"])).map((r) => r.id).join(","), "2,4");
eq("two games, order kept", filterByGames(rows, new Set(["onepiece", "magic"])).map((r) => r.id).join(","), "1,5");
eq("unknown is choosable", filterByGames(rows, new Set([UNKNOWN_GAME])).map((r) => r.id).join(","), "3");

// ---- The Show Desk: filter THEN cut, and act only on what is on screen -------
const desk = readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8");
if (!/filterByGames\(recPool, recGames\)\.slice\(/.test(desk)) {
  fail("ShowDesk.js must filter the pool by game BEFORE taking the top N — otherwise \"top 20 One Piece\" is whatever One Piece made the overall top 20");
}
if (!/const chosen = recChosen\.map/.test(desk) || !/\(recs \|\| \[\]\)\.filter\(\(r\) => !recOff\.has/.test(desk)) {
  fail("ShowDesk.js must check out only rows on screen (recs) that were not unticked — a card another game chip hides must never be checked out");
}
if (/recSel/.test(desk)) fail("ShowDesk.js still carries recSel — the recommended list's ticks are recOff now, one definition");

if (failures) {
  console.error(`\n${failures} game check(s) failed.`);
  process.exit(1);
}
console.log(`✓ games: ${CASES.length + 2} readings, facets, filter-then-cut on the Show Desk`);
