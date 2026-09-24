/**
 * Comp Finder — the catalogue's set list, as a matcher for titles.
 *
 * Two callers read a set out of a listing title: the pull sheet (through
 * /api/catalog/match-sets, to alphabetise picks) and the storefront (so a
 * visitor can narrow the binder to one set). One loader, so the two can never
 * disagree about which set a card is in.
 *
 * `cm_sets` is the public catalogue — every set name and code we hold, readable
 * by anybody — so it is safe to read with either client. It changes only when
 * the catalogue is re-imported, which is why a warm instance keeps it for ten
 * minutes; a short TTL keeps a fresh import from going unnoticed.
 *
 * Degrades rather than throws: a catalogue migration not yet run, or a failed
 * read, gives `index: null`, and a card with no set is still a card.
 *
 * Framework-free apart from the client it is handed.
 */
import { buildSetIndex, matchSetFromTitle } from "@compfinder/core/setmatch.js";
import { buildSetGameIndex } from "./games.js";

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, index: null, gameIndex: null, available: false };

export async function getSetIndex(supabase) {
  if (cache.index && Date.now() - cache.at < TTL_MS) return cache;
  const rows = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("cm_sets").select("game,set_name,set_code").range(from, from + 999);
      if (error) {
        cache = { at: Date.now(), index: null, gameIndex: null, available: false };
        return cache;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
  } catch {
    cache = { at: Date.now(), index: null, gameIndex: null, available: false };
    return cache;
  }
  // gameIndex rides the same read: the Show Desk's game chips fall back on a
  // set name to tell a Pokémon card from a Magic one, and a second loader
  // would be a second opinion about which sets exist.
  cache = { at: Date.now(), index: buildSetIndex(rows), gameIndex: buildSetGameIndex(rows), available: rows.length > 0 };
  return cache;
}

/** A function title -> { name, code } | null over the index, or one that always answers null. */
export function setMatcher(index) {
  if (!index) return () => null;
  return (title) => matchSetFromTitle(title, index);
}

export { matchSetFromTitle };
