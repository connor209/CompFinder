/**
 * Builds the large test set by asking the CATALOGUE for collector numbers
 * rather than trusting my memory of them.
 *
 * The 100-card run wasted nine failures on numbers I'd invented — Glaceon ex
 * is 150/131, not 145 — which measured my recall rather than the tool. Every
 * entry here comes back from /api/resolve, so a number is wrong only if the
 * catalogue is.
 *
 * Resolve calls hit Supabase, not SoldComps, so building the list costs no
 * pricing quota at all.
 */
import { writeFileSync } from "node:fs";
import { languageOf } from "../apps/public/lib/resolve.js";

const BASE = "https://comp-finder-public.vercel.app";
const OUT = process.env.BIGSET_OUT || "scripts/bigset.json";

// Chase cards: the ex/V/VMAX/VSTAR/GX line and the alt arts people pay for.
// Deliberately no bulk commons or trainers — the brief was higher-value cards.
const NAMES = [
  "Umbreon ex","Sylveon ex","Espeon ex","Leafeon ex","Glaceon ex","Flareon ex","Vaporeon ex","Jolteon ex","Eevee ex",
  "Umbreon VMAX","Rayquaza VMAX","Sylveon VMAX","Espeon VMAX","Glaceon VMAX","Leafeon VMAX","Flareon VMAX","Jolteon VMAX",
  "Umbreon V","Rayquaza V","Sylveon V","Espeon V","Glaceon V","Leafeon V","Charizard V","Charizard VMAX","Charizard VSTAR",
  "Charizard ex","Mew ex","Blastoise ex","Venusaur ex","Alakazam ex","Zapdos ex","Moltres ex","Articuno ex",
  "Pikachu ex","Pikachu V","Pikachu VMAX","Raichu ex","Mewtwo ex","Mewtwo V","Mewtwo VSTAR",
  "Lugia V","Lugia VSTAR","Ho-Oh V","Giratina V","Giratina VSTAR","Arceus V","Arceus VSTAR",
  "Greninja ex","Bloodmoon Ursaluna ex","Terapagos ex","Hydrapple ex","Pecharunt ex","Fezandipiti ex","Munkidori ex",
  "Latias ex","Latios ex","Roaring Moon ex","Iron Valiant ex","Iron Crown ex","Walking Wake ex","Gardevoir ex",
  "Miraidon ex","Koraidon ex","Chien-Pao ex","Ting-Lu ex","Wo-Chien ex","Chi-Yu ex","Gholdengo ex","Dragapult ex",
  "Milotic ex","Feraligatr ex","Meganium ex","Typhlosion ex","Snorlax ex","Lapras ex","Gengar ex","Machamp ex",
  "Tyranitar ex","Salamence ex","Metagross ex","Garchomp ex","Lucario ex","Zoroark ex","Hydreigon ex","Kyurem ex",
  "Mega Charizard X ex","Mega Charizard Y ex","Mega Gengar ex","Mega Gardevoir ex","Mega Lucario ex","Mega Venusaur ex",
  "Mega Blastoise ex","Mega Dragonite ex","Mega Darkrai ex","Mega Zeraora ex","Mega Chandelure ex","Mega Excadrill ex",
  "Mega Greninja ex","Mega Pyroar ex","Mega Golurk ex","Mega Absol ex","Mega Altaria ex","Mega Kangaskhan ex",
  "Morpeko ex","Salazzle ex","Lurantis ex","Rampardos ex","Wailord ex","Gourgeist ex","Cinccino ex","Beedrill ex",
  "Charizard GX","Mewtwo GX","Rayquaza GX","Umbreon GX","Sylveon GX","Espeon GX","Dusk Mane Necrozma GX",
  "Latias & Latios GX","Pikachu & Zekrom GX","Reshiram & Charizard GX","Mewtwo & Mew GX",
  "Lucario VSTAR","Arceus VSTAR","Giratina VSTAR","Charizard","Blastoise","Venusaur","Pikachu","Mewtwo","Gengar",
  "Snorlax","Dragonite","Gyarados","Alakazam","Machamp","Zapdos","Moltres","Articuno","Lapras","Ninetales",
  "Dondozo","Meltan","Horsea","Spearow","Snorunt","Scorbunny","Froakie","Xerneas","Ampharos","Clefairy",
  "Slowbro","Goldeen","Primarina","Manectric","Armarouge","Silvally","Toucannon","Bastiodon","Dhelmise","Fomantis",
  "Thievul","Inkay","Xurkitree","Jirachi","Celebi V","Tornadus VMAX","Regieleki VMAX","Chesnaught V",
  "Misty's Vitality","Gladion's Final Battle","Brock's Scouting","Misty's Water Command","Team Rocket's Persian ex",
  "Team Rocket's Mewtwo ex","N's Zoroark ex","Iono","Erika's Invitation","Legacy Energy","Air Balloon","Firebreather",
  "Galarian Rapidash","Galarian Slowpoke","Meganium","Salamence","Tyranitar","Metagross","Garchomp","Lucario",
  "Sableye","Kingdra","Vaporeon","Flareon","Jolteon","Leafeon","Glaceon","Espeon","Umbreon","Sylveon"
];

// Rarities worth pricing. Commons and bulk trainers are excluded by design.
const CHASE = /illustration rare|special illustration|secret|hyper|ultra rare|double rare|art rare|rare shiny|amazing rare|holo rare v|rare ultra|rare holo|promo/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const seen = new Set();

for (const [i, name] of NAMES.entries()) {
  process.stdout.write(`\r[${i + 1}/${NAMES.length}] ${name.padEnd(30)}`);
  try {
    const res = await fetch(`${BASE}/api/resolve?q=${encodeURIComponent(name)}`).then((r) => r.json());
    for (const c of (res.candidates || []).slice(0, 6)) {
      if (!c.number || !c.set) continue;
      if (!CHASE.test(c.rarity || "")) continue;
      // English only. The first build took the top three candidates per name
      // and 358 of 512 came back from Japanese and Chinese sets, because the
      // set NAME can't distinguish them — so the audit was largely measuring
      // how we price foreign prints on a UK marketplace, which is a different
      // question from the one being asked.
      if (languageOf({ expansion: c.set, expansion_code: c.code }) !== "English") continue;
      const key = `${c.name}|${c.number}|${c.set}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: c.name, number: c.number, set: c.set, code: c.code, rarity: c.rarity, id: c.id });
    }
  } catch { /* skip */ }
  await sleep(120);
}

console.log(`\n\nresolved ${out.length} distinct chase cards from ${NAMES.length} names`);
const byRarity = {};
for (const c of out) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
console.log(Object.entries(byRarity).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`  ${String(v).padStart(3)} ${k}`).join("\n"));

writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nwrote ${OUT}`);
