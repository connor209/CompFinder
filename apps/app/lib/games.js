/**
 * Comp Finder — which GAME a card of ours is, read off what we already hold.
 *
 * A stack card carries a SKU and a title and nothing else, so there is no
 * column to filter on; the game has to be read. Three signals, in the order
 * they are trusted:
 *
 *   1. eBay's category name ("Pokémon Individual Cards"). Often it says
 *      nothing — plenty of singles sit in the generic "CCG Individual Cards",
 *      where the game is an item specific the sync never sees — so a category
 *      that names no game is simply no answer, never "other".
 *   2. The title naming the game outright: "Pokémon", "MTG", "Magic: The
 *      Gathering", "Yu-Gi-Oh", "One Piece", or a One Piece card code (OP01-013).
 *   3. A catalogue SET name found in the title, if that name belongs to exactly
 *      one game. "Evolving Skies" is Pokémon; a name two games share says
 *      nothing.
 *
 * **A card none of them settles is UNKNOWN, and stays on screen as such.**
 * Guessing is the expensive direction: a Pokémon card filed under Magic is a
 * card that silently never makes the show list. Unknown is a chip of its own,
 * so it can be picked, counted and fixed rather than lost.
 *
 * **Two readings deliberately refused**, both pinned by check-games.mjs:
 *   - bare "magic". Yu-Gi-Oh has Magic Cylinder, and every Dark Magician
 *     contains the letters. It takes "MTG" or the full name.
 *   - a set name of ONE word. Single-word sets are ordinary words — Judgment,
 *     Mirage, Tempest, Onslaught are Magic sets and also Yu-Gi-Oh card names,
 *     so "Judgment Dragon" would read as Magic. Two words or more, or nothing.
 *
 * If a title names two games (a mixed lot, say), it is unknown rather than
 * whichever came first.
 *
 * Framework-free: the Show Desk and the check both call it.
 */
import { normalizeForMatch } from "@compfinder/core/setmatch.js";

/** The games we sell, in the order their chips are drawn. Slugs match cm_games. */
export const GAMES = [
  { slug: "pokemon", name: "Pokémon", pattern: /\bpok[eé]mon\b/i },
  { slug: "onepiece", name: "One Piece", pattern: /\bone\s*piece\b|\b(?:OP|ST|EB|PRB)\d{2}-\d{3}\b/i },
  { slug: "magic", name: "Magic", pattern: /\bmtg\b|\bmagic\s*:?\s*the\s+gathering\b/i },
  { slug: "yugioh", name: "Yu-Gi-Oh!", pattern: /\byu-?gi-?oh\b/i },
  { slug: "lorcana", name: "Lorcana", pattern: /\blorcana\b/i },
  { slug: "dragonball", name: "Dragon Ball", pattern: /\bdragon\s*ball\b/i },
  { slug: "digimon", name: "Digimon", pattern: /\bdigimon\b/i },
  { slug: "fleshandblood", name: "Flesh and Blood", pattern: /\bflesh\s+(?:and|&)\s+blood\b/i },
  { slug: "riftbound", name: "Riftbound", pattern: /\briftbound\b/i },
  { slug: "vanguard", name: "Vanguard", pattern: /\bcardfight\b|\bvanguard\b/i },
  { slug: "weissschwarz", name: "Weiss Schwarz", pattern: /\bwei(?:ss|ß)\s*schwarz\b/i }
];

export const UNKNOWN_GAME = "unknown";

const NAMES = new Map(GAMES.map((g) => [g.slug, g.name]));

/** Display name for a slug, including the unknown bucket and games we have no row for. */
export function gameName(slug) {
  if (slug === UNKNOWN_GAME) return "Unidentified";
  return NAMES.get(slug) || slug;
}

/** Every game a piece of text names outright. More than one means it settles nothing. */
function gamesNamedIn(text) {
  if (!text) return [];
  return GAMES.filter((g) => g.pattern.test(String(text))).map((g) => g.slug);
}

/**
 * Set names that point at one game, from cm_sets rows ([{game, set_name}]).
 * A name two games share is dropped, not given to whichever came first, and so
 * is any name of fewer than two words. Longest first, so the most specific
 * name wins, as in matchSetFromTitle().
 */
export function buildSetGameIndex(rows) {
  const byName = new Map(); // norm -> slug, or null when shared
  for (const r of rows || []) {
    const name = String(r?.set_name || "").trim();
    const game = String(r?.game || "").trim();
    if (!name || !game || name === "Other / Promos") continue;
    const norm = normalizeForMatch(name).trim();
    if (norm.split(" ").length < 2 || !/[a-z]/.test(norm)) continue;
    if (!byName.has(norm)) byName.set(norm, game);
    else if (byName.get(norm) !== game) byName.set(norm, null);
  }
  return [...byName.entries()]
    .filter(([, game]) => game)
    .map(([norm, game]) => ({ norm, game }))
    .sort((a, b) => b.norm.length - a.norm.length);
}

function gameFromSet(title, setIndex) {
  if (!setIndex || setIndex.length === 0 || !title) return null;
  const hay = normalizeForMatch(title);
  for (const e of setIndex) {
    if (hay.includes(` ${e.norm} `)) return e.game;
  }
  return null;
}

/**
 * The game a card is, or UNKNOWN_GAME. `category` is eBay's category name,
 * `title` the listing or stack title, `setIndex` from buildSetGameIndex (may
 * be null when the catalogue could not be read — the other two still answer).
 */
export function gameOf({ category, title } = {}, setIndex = null) {
  const byCategory = gamesNamedIn(category);
  if (byCategory.length === 1) return byCategory[0];

  const byTitle = gamesNamedIn(title);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) return UNKNOWN_GAME;

  return gameFromSet(title, setIndex) || UNKNOWN_GAME;
}

/**
 * The chips: every game present among the rows, with a count, in GAMES order,
 * unknown last. Built from the rows so a chip that would show nothing is never
 * offered. `gameKey` reads the slug off a row.
 */
export function gameFacets(rows, gameKey = (r) => r.game) {
  const counts = new Map();
  for (const r of rows || []) {
    const g = gameKey(r) || UNKNOWN_GAME;
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const order = [...GAMES.map((g) => g.slug)];
  const rank = (slug) => (slug === UNKNOWN_GAME ? Infinity : order.indexOf(slug) === -1 ? order.length : order.indexOf(slug));
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: gameName(slug), count }))
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name));
}

/**
 * Is this row in the chosen games? Nothing chosen is every game. A row with no
 * `game` on it counts as unknown, never as a match for everything — so the
 * Show Desk's lists, which tag their rows once, and a row that somehow missed
 * the tagging still answer the same question.
 */
export function inGames(row, chosen, gameKey = (r) => r?.game) {
  if (!chosen || chosen.size === 0) return true;
  return chosen.has(gameKey(row) || UNKNOWN_GAME);
}

/**
 * Narrow rows to the chosen games. An empty choice is every game — the chips
 * start with nothing picked and everything showing, which is the list as it
 * was before there were chips.
 */
export function filterByGames(rows, chosen, gameKey = (r) => r.game) {
  if (!chosen || chosen.size === 0) return rows || [];
  return (rows || []).filter((r) => inGames(r, chosen, gameKey));
}
