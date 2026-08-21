import { detectLanguage } from "@compfinder/core/catalog.js";

/**
 * Ranking for catalogue lookups.
 *
 * The old suggest endpoint returned whatever Postgres handed back, which meant
 * "slowbro" produced five Dark Slowbros from 1999 and no Slowbro, and "umbreon"
 * put Online Code Cards above actual cards. Nothing was scored, so the
 * strongest signal available — whether the name actually IS what was typed —
 * went unused.
 *
 * Everything here is derived from the catalogue alone: it has no release dates
 * and no popularity data, so recency can't be a signal. Match quality has to
 * carry it, which turns out to be enough for the cases that were failing.
 */

// Not cards. They pollute any name search because the product name contains
// the card's name — "Online Code Card (Umbreon Blister)" matches "umbreon".
const NON_CARD = /\b(online code|code card|booster|bundle|display|tin|blister|collection box|elite trainer|deck box|sleeves|binder|portfolio|playmat)\b/i;

// Physically different objects that share a name and confuse a price lookup.
const ODDITY = /\b(oversized|jumbo|giant|xxl)\b/i;

/** Pulls a collector number out of free text: "223/165" or a trailing "223". */
export function parseQuery(text) {
  const raw = String(text || "").trim();
  const slash = raw.match(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/);
  if (slash) {
    return {
      name: raw.replace(slash[0], " ").replace(/\s+/g, " ").trim(),
      number: slash[1].replace(/^0+(?=\d)/, ""),
      total: slash[2].replace(/^0+(?=\d)/, "")
    };
  }
  const trailing = raw.match(/^(.*?)\s+(\d{1,4})$/);
  if (trailing && trailing[1].trim()) {
    return { name: trailing[1].trim(), number: trailing[2].replace(/^0+(?=\d)/, ""), total: null };
  }
  return { name: raw, number: null, total: null };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
const bare = (s) => String(s || "").split("/")[0].replace(/^0+(?=\d)/, "").trim();

/**
 * Scores one catalogue row against the parsed query. Additive and deliberately
 * blunt: the point is that an exact name beats a substring, not that the
 * weights are finely tuned.
 */
export function scoreCard(row, parsed) {
  const wantName = norm(parsed.name);
  const rowName = norm(row.name);
  if (!wantName) return -1;

  let score = 0;

  // Name match quality — the signal that was missing entirely.
  if (rowName === wantName) score += 100;
  else if (rowName.startsWith(wantName + " ")) score += 45;
  else if (rowName.endsWith(" " + wantName)) score += 25; // "Dark Slowbro" for "slowbro"
  else if (rowName.includes(wantName)) score += 20;
  else {
    const tokens = wantName.split(" ").filter((t) => t.length > 1);
    if (!tokens.length || !tokens.every((t) => rowName.includes(t))) return -1;
    score += 12;
  }

  // A stated collector number is the strongest disambiguator there is.
  if (parsed.number) {
    const rowNum = bare(row.collector_number);
    if (rowNum && rowNum === parsed.number) score += 80;
    else if (rowNum) score -= 25; // they named a number and this isn't it
  }

  // English prints dominate a UK marketplace; other languages are still
  // reachable, just not the default guess.
  if (detectLanguage(row.expansion) === "English") score += 25;

  // "… : Additionals" are duplicate rows of the same set.
  if (/additional/i.test(row.expansion || "")) score -= 12;

  if (NON_CARD.test(row.name || "")) score -= 120;
  if (ODDITY.test(row.name || "") || ODDITY.test(row.rarity || "")) score -= 60;

  // Chase rarities are what people look up; commons are rarely the intent
  // unless they typed a number, which is already scored above.
  if (/illustration rare|special illustration|secret|hyper|ultra rare|double rare/i.test(row.rarity || "")) score += 8;
  if (/^promo$/i.test(row.rarity || "") && !/promo/i.test(wantName)) score -= 10;

  return score;
}

/**
 * Ranked candidates, plus whether we're confident enough to skip asking.
 *
 * Confidence is a GAP test, not a threshold: two cards scoring 150 and 148 are
 * a question for the visitor however high the numbers are, while 150 against
 * 70 is an answer. Asking when we know is friction; guessing when we don't is
 * how a Charizard ex 223/165 gets priced off a 223/197.
 */
export function rankCards(rows, parsed, limit = 6) {
  const scored = rows
    .map((row) => ({ row, score: scoreCard(row, parsed) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // The catalogue carries a set and its ": Additionals" companion as separate
  // rows for the same physical card. Left in, they become two near-identical
  // options and the confidence gap collapses, so we'd stop and ask the visitor
  // to choose between a card and itself. Collapse to the best-scoring row.
  const seen = new Map();
  for (const entry of scored) {
    const key = [
      norm(entry.row.name),
      bare(entry.row.collector_number),
      norm(String(entry.row.expansion || "").replace(/\s*:?\s*additionals?\b/i, ""))
    ].join("|");
    if (!seen.has(key)) seen.set(key, entry);
  }
  const top = [...seen.values()].slice(0, limit);
  const confident = top.length === 1 || (top.length > 1 && top[0].score - top[1].score >= 40);
  return { candidates: top, confident };
}

export default { parseQuery, scoreCard, rankCards };
