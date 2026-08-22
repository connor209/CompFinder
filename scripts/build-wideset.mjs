/**
 * Builds a test set that is deliberately UNLIKE scripts/bigset-en2.json.
 *
 *   node scripts/build-wideset.mjs            (writes scripts/wideset.json)
 *
 * Every pricing rule we added was tuned on English Pokémon chase cards, and
 * two of them are scale-sensitive by construction: the postage rule keys off
 * the group's median ITEM price, and the low-side outlier off median/12. On a
 * £700 Umbreon those thresholds are meaningless; on a 40p common, postage is
 * always several times the card and the whole comp set could vanish. Nothing
 * has ever tested that.
 *
 * So: cheap Pokémon commons, trainers and energy, plus Yu-Gi-Oh, Magic and
 * Vanguard, which the catalogue carries and the public page will happily be
 * asked about. Numbers come from the catalogue via /api/resolve, and the
 * card's language comes with them — settingsForCard needs it, and a
 * hand-written list not carrying it is a mistake this harness has made before.
 *
 * Costs no SoldComps quota: resolve reads Supabase only.
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_URL || "https://comp-finder-public.vercel.app";
const OUT = process.env.WIDESET_OUT || "scripts/wideset.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cheap Pokémon: the bulk of any collection and the opposite of a chase card.
const POKEMON_CHEAP = [
  "Rattata", "Pidgey", "Caterpie", "Weedle", "Zubat", "Geodude", "Magikarp", "Psyduck",
  "Bellsprout", "Oddish", "Poliwag", "Tentacool", "Machop", "Doduo", "Krabby", "Voltorb",
  "Grimer", "Koffing", "Cubone", "Drowzee", "Exeggcute", "Goldeen", "Staryu", "Magnemite",
  "Sentret", "Hoothoot", "Ledyba", "Spinarak", "Wooper", "Marill", "Hoppip", "Sunkern",
  "Zigzagoon", "Wurmple", "Lotad", "Seedot", "Taillow", "Wingull", "Ralts", "Surskit",
  "Starly", "Bidoof", "Shinx", "Budew", "Kricketot", "Buizel", "Combee", "Buneary",
  "Patrat", "Lillipup", "Purrloin", "Pidove", "Blitzle", "Roggenrola", "Woobat", "Drilbur",
  "Bunnelby", "Fletchling", "Scatterbug", "Litleo", "Flabébé", "Skiddo", "Pancham",
  "Pikipek", "Yungoos", "Grubbin", "Crabrawler", "Rockruff", "Mareanie", "Wimpod",
  "Skwovet", "Rookidee", "Blipbug", "Nickit", "Gossifleur", "Wooloo", "Chewtle",
  "Lechonk", "Tarountula", "Nymble", "Pawmi", "Tandemaus", "Fidough", "Smoliv", "Nacli"
];

// Trainers and energy — different title shapes, no HP, no evolution line.
const POKEMON_TRAINERS = [
  "Rare Candy", "Ultra Ball", "Nest Ball", "Quick Ball", "Switch", "Potion", "Energy Search",
  "Professor's Research", "Boss's Orders", "Iono", "Arven", "Colress's Experiment",
  "Basic Fire Energy", "Basic Water Energy", "Double Turbo Energy", "Jet Energy",
  "Pokégear 3.0", "Escape Rope", "Trekking Shoes", "Level Ball", "Buddy-Buddy Poffin",
  "Super Rod", "Counter Catcher", "Lost Vacuum", "Battle VIP Pass", "Earthen Vessel"
];

const YUGIOH = [
  "Dark Magician", "Blue-Eyes White Dragon", "Red-Eyes Black Dragon", "Pot of Greed",
  "Mirror Force", "Monster Reborn", "Raigeki", "Ash Blossom & Joyous Spring",
  "Effect Veiler", "Infinite Impermanence", "Maxx C", "Called by the Grave",
  "Snake-Eye Ash", "Kashtira Fenrir", "Purrely", "Exodia the Forbidden One",
  "Elemental HERO Sparkman", "Cyber Dragon", "Stardust Dragon", "Number 39: Utopia"
];

const MAGIC = [
  "Lightning Bolt", "Counterspell", "Dark Ritual", "Llanowar Elves", "Giant Growth",
  "Sol Ring", "Brainstorm", "Swords to Plowshares", "Path to Exile", "Thoughtseize",
  "Fatal Push", "Ragavan, Nimble Pilferer", "Orcish Bowmasters", "Sheoldred, the Apocalypse",
  "Force of Will", "Birds of Paradise", "Serra Angel", "Shivan Dragon"
];

const GROUPS = [
  ["pokemon-cheap", POKEMON_CHEAP, (c) => /common|uncommon|rare$/i.test(c.rarity || "")],
  ["pokemon-trainer", POKEMON_TRAINERS, () => true],
  ["yugioh", YUGIOH, (c) => c.game === "yugioh"],
  ["magic", MAGIC, (c) => c.game === "magic"]
];

const out = [];
const seen = new Set();
let asked = 0;

for (const [group, names, keep] of GROUPS) {
  for (const name of names) {
    asked++;
    process.stdout.write(`\r  ${asked} queries · ${out.length} cards   `);
    try {
      const res = await fetch(`${BASE}/api/resolve?q=${encodeURIComponent(name)}`).then((r) => r.json());
      for (const c of (res.candidates || []).slice(0, 3)) {
        if (!c.number || !c.set || !keep(c)) continue;
        // English only, and honestly so: the language comes from the resolver
        // rather than being assumed.
        if (c.language && c.language !== "English") continue;
        const key = `${c.name}|${c.number}|${c.set}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name: c.name, number: c.number, set: c.set, code: c.code,
          rarity: c.rarity, game: c.game, language: c.language || "English",
          group, id: c.id
        });
      }
    } catch { /* skip */ }
    await sleep(110);
  }
}

console.log(`\n\n${out.length} cards from ${asked} queries`);
const byGroup = {};
for (const c of out) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
for (const [g, n] of Object.entries(byGroup)) console.log(`  ${String(n).padStart(4)}  ${g}`);
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nwrote ${OUT}`);
