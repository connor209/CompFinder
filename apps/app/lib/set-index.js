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
import { buildSetIndex, matchSetFromTitle as coreMatch, normalizeForMatch } from "@compfinder/core/setmatch.js";
import { buildSetGameIndex } from "./games.js";

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, index: null, gameIndex: null, available: false };

/**
 * Every row of `cm_sets`, or null when it could not be read. `cm_sets` is a
 * VIEW that groups the whole card catalogue, so each page of this read runs
 * that aggregate again — which is why it is cached here per instance, and
 * across instances by whoever can (the storefront, through Next's data cache).
 */
export async function readSetRows(supabase) {
  const rows = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("cm_sets").select("game,set_name,set_code").range(from, from + 999);
      if (error) return null;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
  } catch {
    return null;
  }
  return rows;
}

/** The two indexes over a set of rows; rows of null is "no catalogue". */
export function setIndexFromRows(rows) {
  if (!rows) return { at: Date.now(), index: null, gameIndex: null, available: false };
  // gameIndex rides the same read: the Show Desk's game chips fall back on a
  // set name to tell a Pokémon card from a Magic one, and a second loader
  // would be a second opinion about which sets exist.
  return { at: Date.now(), index: appSetIndex(rows), gameIndex: buildSetGameIndex(rows), available: rows.length > 0 };
}

export async function getSetIndex(supabase) {
  if (cache.index && Date.now() - cache.at < TTL_MS) return cache;
  cache = setIndexFromRows(await readSetRows(supabase));
  return cache;
}

/**
 * "&" and "and" are one word here. The catalogue writes "Sun & Moon" and
 * sellers write "Sun and Moon"; normalising strips the ampersand and keeps the
 * word, so the two never met and "Sun and Moon Base Set" fell through to the
 * 1999 Base Set. Applied to set names and titles alike, so it can only ever
 * make a name and a title that already agreed agree again.
 */
function andForm(s) {
  return String(s || "").replace(/&/g, " and ");
}

/**
 * The modern era base sets, as sellers title them. Cardmarket names each one
 * after its era alone ("Sun & Moon", "Scarlet & Violet", "XY"), and a seller
 * writes "SM Base Set", "Scarlet and Violet Base Set", "XY Base Set" — which,
 * longest name first, reads as the 1999 Base Set: "base set" is as long as
 * "sun moon" and longer than "xy". So an era word in front of "base (set)" is
 * read as that era, before anything is matched. Patterns are over normalised
 * text, where "S&M" has become "s and m".
 */
const ERA_BASE = [
  [/ (?:sm|s and m|sun and moon|sun moon) base(?: set)? /g, " sun and moon "],
  [/ (?:swsh|sword and shield|sword shield) base(?: set)? /g, " sword and shield "],
  [/ (?:sv|svi|s and v|scarlet and violet|scarlet violet) base(?: set)? /g, " scarlet and violet "],
  [/ (?:bw|b and w|black and white|black white) base(?: set)? /g, " black and white "],
  [/ (?:dp|d and p|diamond and pearl|diamond pearl) base(?: set)? /g, " diamond and pearl "],
  [/ (?:hgss|heartgold and soulsilver|heartgold soulsilver|heart gold soul silver) base(?: set)? /g, " heartgold and soulsilver "],
  [/ (?:me|mega evolution) base(?: set)? /g, " mega evolution "],
  [/ xy base(?: set)? /g, " xy "]
];

/**
 * The 1999 Base Set is numbered out of 102. A title that only says "Base Set"
 * but carries a number out of something else is one of the era base sets with
 * the era left off; the denominators below are unambiguous, and anything else
 * gets no set rather than the wrong one — a card with no set still shows
 * under "All sets", a card under the wrong set is hidden from the right one.
 */
const BASE_SET = "base set";
const BASE_SET_TOTAL = 102;
const ERA_BY_TOTAL = new Map([
  [149, " sun and moon "], [202, " sword and shield "], [198, " scarlet and violet "],
  [146, " xy "], [114, " black and white "]
]);

/** The title as the matcher should read it. Exported for the check. */
export function canonicalSetTitle(title) {
  let t = normalizeForMatch(andForm(title));
  for (const [re, era] of ERA_BASE) t = t.replace(re, era);
  return t;
}

/**
 * The catalogue's set list, ready to match titles against.
 *
 * Built by core's buildSetIndex() over names in their "and" form, with the
 * catalogue's own spelling put back on every entry so a filter still says
 * "Sun & Moon". Plus a word index over the names: core walks every name in
 * the catalogue for every title, which over a few thousand sets and a few
 * thousand listings measured 3.5 seconds of CPU on the storefront's first
 * load. A name can only be in a title if its first word is, so each title now
 * checks the handful of names that start with one of its own words — and
 * takes the earliest of those in core's longest-first order, which is the
 * name core would have picked.
 */
export function appSetIndex(rows) {
  const original = new Map();
  const formed = (rows || []).map((r) => {
    const name = andForm(r?.set_name).replace(/\s+/g, " ").trim();
    if (!original.has(name)) original.set(name, String(r?.set_name || "").trim());
    return { ...r, set_name: name };
  });
  const index = buildSetIndex(formed);
  for (const e of index.names) e.name = original.get(e.name) || e.name;
  for (const v of index.codes.values()) v.name = original.get(v.name) || v.name;
  const byFirst = new Map();
  index.names.forEach((e, i) => {
    const first = e.norm.split(" ")[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(i);
  });
  index.byFirst = byFirst;
  return index;
}

function matchCanonical(hay, index) {
  if (index.byFirst) {
    let best = -1;
    for (const tok of new Set(hay.trim().split(" "))) {
      for (const i of index.byFirst.get(tok) || []) {
        if ((best === -1 || i < best) && hay.includes(` ${index.names[i].norm} `)) best = i;
      }
    }
    if (best !== -1) return { name: index.names[best].name, code: index.names[best].code || "" };
    // Names exhausted: core's code pass is a token lookup, already cheap.
    return coreMatch(hay, { names: [], codes: index.codes });
  }
  return coreMatch(hay, index);
}

/**
 * title -> { name, code } | null. Every caller in the app comes through here
 * (the pull sheet's route, My listings, the storefront), and core's matcher is
 * left as it is — Last Comp does not use it, and the era reading is about how
 * OUR listings are titled.
 */
export function matchSetFromTitle(title, index) {
  if (!index || !title) return null;
  const hay = canonicalSetTitle(title);
  const hit = matchCanonical(hay, index);
  if (!hit || normalizeForMatch(hit.name).trim() !== BASE_SET) return hit;
  const total = String(title).match(/\b\d{1,3}\s*\/\s*(\d{2,3})\b/);
  if (!total || Number(total[1]) === BASE_SET_TOTAL) return hit;
  const era = ERA_BY_TOTAL.get(Number(total[1]));
  return era ? matchCanonical(era, index) : null;
}

/** A function title -> { name, code } | null over the index, or one that always answers null. */
export function setMatcher(index) {
  if (!index) return () => null;
  return (title) => matchSetFromTitle(title, index);
}
