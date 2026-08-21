import { detectLanguage } from "@compfinder/core/catalog.js";

/**
 * Language from the EXPANSION CODE, which the set name can't give us.
 *
 * catalog.js says so itself: "Japanese sets mostly don't name the language
 * either, so they fall through to English here". The app compensates with a
 * manual language toggle; this page has none, so a search for Rayquaza VMAX
 * was ranking Japanese sets — Nine Colors Gathering, Fearless Terastal, Abyss
 * Eye — as if they were English, and pricing the wrong card at full
 * confidence. Across the 512-card test set, 358 came from sets with no English
 * marker in the name.
 *
 * The codes do carry it. Checked against all 132 codes in that set: not one
 * English code contains a lowercase letter, while every modern Japanese set
 * does (m5, s6a, sv2a, sm8b, SV3s). Chinese sets end in C with a digit in the
 * code (CSV3C, CBB2C, 151C) — bare "ASC" for Ascended Heroes has no digit and
 * stays English.
 *
 * That left the pre-2016 Japanese sets, whose codes are all-caps. They were
 * costing real accuracy, not just ranking: of the 184-card audit set, the
 * cards that ended up unpriceable or priced off a single comp were dominated
 * by MA5 Shadow Threat, MA4 Void Blast, XY7 Bandit Ring, XY6 Emerald Break
 * and BW7 Plasma Gale — sets with no English print at all, so eBay returns
 * either nothing that matches or one stray import.
 *
 * A bare "contains a digit" rule would have caught them and also caught the
 * English sets it must not: BS2 (Base Set 2), N1-N4 (Neo), G1/G2 (Gym). So
 * this matches the Japanese code FAMILIES instead, each checked against the
 * English codes of the same era to be sure they can't collide:
 *
 *   PCG1-12   JP e-Card/PCG        English era codes: EX, AQ, SK
 *   ADV1-5    JP ADV               English: RS, SS, DR, MA, HL, FL...
 *   DP1-6     JP Diamond & Pearl   English: DP, MT, SW, GE, MD, LA, SF
 *   L1-L5/LL  JP HGSS "LEGEND"     English: HS, UL, UD, TM, CL
 *   BW1-9     JP Black & White     English: BLW, EPO, NVI, NXD, DEX, PLS...
 *   XY1-12    JP XY                English: XY, FLF, FFI, PHF, PRC, AOR...
 *   SM1-12    JP Sun & Moon        English: SUM, GRI, BUS, CIN, UPR, LOT...
 *   CP1-6     JP XY concept packs  English: CPA (Champion's Path, no digit)
 *   WCP       JP World Champions Pack — named, no English equivalent
 *
 * MA{digit} is the odd one: MA1 is literally called "Mega Evolution ID/TH",
 * so the family is the Indonesian/Thai line, not Japanese. It is reported as
 * "Asian" rather than guessed at — all that matters downstream is that it is
 * not English. Note the deliberate digit: bare "MA" is English EX Team Magma
 * vs Team Aqua and must stay English.
 */
const JP_LEGACY_CODE = /^(PCG|ADV|DP|BW|XY|SM|CP|L)\d/;
const JP_LEGACY_EXACT = new Set(["LL", "WCP"]);
// Japanese promos are named "<era>-P": XY-P, S-P, SM-P, SV-P, PCG-P. The
// English promo codes never take that shape — they are SWSH, SVP, XYPR, SMP,
// NP, PLAY, BEST — so the trailing "-P" is unambiguous. Caught a Japanese
// Machamp EX and a Japanese Sordward & Shielbert in an English-only test set.
const JP_PROMO_CODE = /^[A-Z]{1,4}\d*-P$/;
const ASIAN_CODE = /^MA\d/;

export function languageOf(row) {
  const named = detectLanguage(row.expansion);
  if (named !== "English") return named;
  const code = String(row.expansion_code || row.code || "");
  if (!code) return "English";
  // Chinese first: their codes contain a lowercase letter too (CS4aC), so
  // testing for lowercase before this would label them Japanese.
  if (/\d/.test(code) && /C$/.test(code)) return "Chinese";
  if (/[a-z]/.test(code)) return "Japanese";
  if (ASIAN_CODE.test(code)) return "Asian";
  if (JP_PROMO_CODE.test(code)) return "Japanese";
  if (JP_LEGACY_CODE.test(code) || JP_LEGACY_EXACT.has(code)) return "Japanese";
  return "English";
}

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

  // English prints dominate a UK marketplace; other languages stay reachable,
  // just not the default guess. The penalty is larger than the old +25 bonus
  // because an exact name match on a Japanese set was otherwise outscoring a
  // near match on the English one.
  const lang = languageOf(row);
  if (lang === "English") score += 30;
  else score -= 45;

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
