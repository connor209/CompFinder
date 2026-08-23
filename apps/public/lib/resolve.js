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
 *   N1-N4     JP Neo               English: NG, ND, NR, NDE
 *   G1-G2     JP Gym               English: GH, GC
 *   EC1-EC4   JP e-Card            English: EX, AQ, SK
 *   WCP       JP World Champions Pack — named, no English equivalent
 *   EXP/EXS   JP Expansion Pack / Expansion Sheet — the original 1996 base set
 *
 * The N/G/EC families were originally left OUT of this list, on the reasoning
 * that N1-N4 and G1/G2 are Base Set 2, Neo and Gym in English and must not be
 * swept up. That reasoning was from memory of CardMarket's conventions and it
 * was wrong about this catalogue, which uses the opposite convention: N1 is
 * "Gold, Silver, to a New World...", N2 is "Crossing the Ruins...", G1 is
 * "Leaders' Stadium" and G2 is "Challenge from the Darkness" — all Japanese —
 * while the English Neo and Gym sets are NG/ND/NR/NDE and GH/GC, with no digit
 * at all. There is no BS2 in the catalogue. Every pair in check-language.mjs
 * is now one read back out of the catalogue rather than one remembered.
 *
 * MA{digit} is the odd one: MA1 is literally called "Mega Evolution ID/TH",
 * so the family is the Indonesian/Thai line, not Japanese. It is reported as
 * "Asian" rather than guessed at — all that matters downstream is that it is
 * not English. Note the deliberate digit: bare "MA" is English EX Team Magma
 * vs Team Aqua and must stay English.
 */
const JP_LEGACY_CODE = /^(PCG|ADV|EC|DP|BW|XY|SM|CP|L|N|G)\d/;
const JP_LEGACY_EXACT = new Set(["LL", "WCP", "EXP", "EXS"]);
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

/**
 * Splits free text into a card name, a collector number, and a SET HINT.
 *
 * The number used to have to be the last thing typed. Anything after it — the
 * set name — stayed glued to the name, every word of it became a required
 * substring of the card's name, and the query returned nothing at all:
 *
 *   "Umbreon ex 161"                       ->  6 candidates
 *   "Umbreon ex 161 Prismatic Evolutions"  ->  0 candidates
 *
 * That is not a rare way to type. It is also what THIS PAGE puts back in the
 * search box: queryForCard joins name, number and set, so picking a card from
 * the picker leaves text in the box that resolves to nothing if the visitor
 * searches again. Their own successful choice poisoned the next search, and
 * because search() falls through to the raw text when resolution finds
 * nothing, the second search silently priced with no card, no number and no
 * set — with "Prismatic" and "Evolutions" as required words in every comp
 * title.
 *
 * So: everything before the number is the name, everything after it is a hint
 * about the set. The hint is not thrown away — scoreCard uses it, which is
 * what makes naming the set help rather than hurt.
 */
export function parseQuery(text) {
  const raw = String(text || "").trim();
  const strip = (n) => String(n).replace(/^0+(?=\d)/, "");

  const cut = (index, length, number, total) => {
    const name = raw.slice(0, index).replace(/\s+/g, " ").trim();
    const setHint = raw.slice(index + length).replace(/\s+/g, " ").trim();
    return name ? { name, number, total, setHint } : null;
  };

  const slash = raw.match(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/);
  if (slash) {
    const parsed = cut(slash.index, slash[0].length, strip(slash[1]), strip(slash[2]));
    if (parsed) return parsed;
  }

  // First standalone number that still leaves a name in front of it.
  //
  // The letter prefix is not optional decoration: Shiny Vault, Trainer Gallery
  // and Galarian Gallery cards are NUMBERED that way on the card itself —
  // SV40, TG29, GG45, SV107 — so that is what people type. Without it,
  // "Garchomp SV40" parsed no number at all and made "sv40" a required
  // substring of the card's NAME, returning nothing. 20 of the 455 cards in
  // the audit set are numbered like this and every one of them was
  // unreachable.
  //
  // "still leaves a name" matters: "151 Charizard ex 183" would otherwise read
  // the set name as the collector number. Word boundaries mean the 2 in
  // "Porygon2" is not a candidate, and the prefix must be attached to the
  // digits, so the "ex" in "Umbreon ex 161" cannot be swallowed into it.
  for (const m of raw.matchAll(/(?:^|\s)([A-Za-z]{0,3}\d{1,4})(?=\s|$)/g)) {
    const index = m.index + (m[0].length - m[1].length);
    const parsed = cut(index, m[1].length, strip(m[1]), null);
    if (parsed) return parsed;
  }
  return { name: raw, number: null, total: null, setHint: "" };
}

// Apostrophes are DELETED, not spaced: people type "team rockets persian ex"
// and "farfetchd", not "team rocket s". Keeping them cost the match entirely —
// "team rockets persian ex 173" scored 25 on the weak all-tokens path against
// 113 for the punctuated form, which was enough to lose confidence.
const norm = (s) => String(s || "")
  .toLowerCase()
  .replace(/'/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
// Collector number, normalised for comparison. Two catalogue quirks to absorb:
// a denominator ("161/131"), and a set code sitting in the number field with a
// space after it — "ASC 022", "PRE 006", "EVS 095" on Prize Pack and promo
// entries. Nobody types the second form; the number printed on the card is the
// numeric part, so that is what has to match.
const bare = (s) => String(s || "")
  .split("/")[0]
  .replace(/^[A-Za-z]{2,4}\s+(?=\d)/, "")
  .replace(/^0+(?=\d)/, "")
  .trim();

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
  const nameScore = nameMatchScore(rowName, wantName);
  if (nameScore === null) {
    // A fuzzy row cannot match by substring — that is the whole reason it was
    // fetched — so score it from its similarity instead of discarding it.
    if (row._similarity == null) return -1;
    score += Math.max(1, Math.min(NAME_FUZZY_MAX, Math.round(row._similarity * NAME_FUZZY_MAX)));
  } else {
    score += nameScore;
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
  // The set the visitor named, if they named one. Worth as much as the
  // confidence threshold on its own: someone who types "Umbreon ex 161
  // Prismatic Evolutions" has told us which card they mean, and should not
  // then be asked to choose between six of them.
  const hint = norm(parsed.setHint);
  const exp = norm(row.expansion);
  const hinted = !!(hint && exp && (exp.includes(hint) || hint.includes(exp)));
  if (hinted) score += 40;

  // A Play! Pokémon Prize Pack entry is a reprint of another card, and the
  // catalogue says so in its number: "Umbreon ex PRE 060" is Prismatic
  // Evolutions 060, "Gengar VMAX FST 157" is Fusion Strike 157. Left level, it
  // trails the card it reprints by 8 — the rarity bonus and nothing else —
  // which is under the confidence threshold, so the page asked the visitor to
  // choose between a card and very nearly itself. That cost 168 queries their
  // answer.
  //
  // An earlier attempt DELETED these entries, and that was worse: it made a
  // Prize Pack card unreachable even when its set was typed in full, so
  // "Mega Charizard Y ex 22 Play! Pokémon Prize Pack Series Nine" confidently
  // returned the Ascended Heroes card. 27 queries went wrong-and-confident
  // that way. So it is a penalty, not a removal, and it stands down entirely
  // when the visitor names the set — ranked down unless you asked for it.
  //
  // It also keys on the Prize Pack SET, not merely on a set code in the
  // number. Keying on the number format alone swept up the Celebrations
  // Classic Collection, whose entries are numbered the same way ("NR 66") but
  // are a genuinely different card from the original at a very different
  // price — not a redistribution of it. Those should tie and be offered as a
  // choice, which is what they now do.
  const redistributed = /prize pack/i.test(row.expansion || "") &&
    /^[A-Za-z]{2,4}\s+\d/.test(String(row.collector_number || ""));
  if (!hinted && redistributed) score -= REPRINT_PENALTY;

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
/**
 * How well the row's name matches what was typed, on its own — separate from
 * the language, rarity and number bonuses that are added on top.
 *
 * Confidence keys off THIS rather than the total, because the total can be
 * bought with bonuses that say nothing about whether we read the visitor
 * right. "Espon ex" matched "Unexpected Response, Miku Nakano" on a
 * coincidental substring for 20, and the English bonus alone lifted it to 50 —
 * over any total-score floor low enough to keep honest weak matches.
 */
const NAME_EXACT = 100;
const NAME_STARTS = 45;
const NAME_ENDS = 25;
const NAME_INCLUDES = 20;
const NAME_TOKENS = 12;

/**
 * Ceiling for a name matched only by trigram similarity — a row the database's
 * fuzzy fallback returned because nothing matched exactly. One BELOW
 * MIN_CONFIDENT_NAME, so a guess at what someone meant is always a suggestion
 * to be shown and never a card to be priced silently.
 *
 * It sits just under the threshold rather than well under it because the gap
 * has to leave room to rank. At 30, similarity was compressed so hard that a
 * PERFECT match scored 30 while a partial one scored 18 — and the partial
 * card's chase-rarity bonus then overtook it: "Charizard LV.X" ranked fourth,
 * behind three plain Charizards it shares only a word with.
 */
const NAME_FUZZY_MAX = NAME_STARTS - 1;

function nameMatchScore(rowName, wantName) {
  if (rowName === wantName) return NAME_EXACT;
  if (rowName.startsWith(wantName + " ")) return NAME_STARTS;
  if (rowName.endsWith(" " + wantName)) return NAME_ENDS;   // "Dark Slowbro" for "slowbro"
  if (rowName.includes(wantName)) return NAME_INCLUDES;
  const tokens = wantName.split(" ").filter((t) => t.length > 1);
  if (!tokens.length || !tokens.every((t) => rowName.includes(t))) return null;
  return NAME_TOKENS;
}

/**
 * Skipping the picker requires the name itself to have matched well — the card
 * IS what was typed, or begins with it. A merely-contains match can be a
 * coincidence, and coincidences should be shown, not priced.
 */
const MIN_CONFIDENT_NAME = NAME_STARTS;

/**
 * How far a reprint drops below the card it reprints. Has to clear the
 * confidence threshold on its own, because the natural gap between them is
 * only the rarity bonus — 8 points, and sometimes nothing at all.
 */
const REPRINT_PENALTY = 45;

/**
 * True when the best candidate matched only by incidental substring — the kind
 * of hit that means the exact search found SOMETHING but probably not what was
 * meant, and the fuzzy fallback deserves a try.
 *
 * The case that needs it: "ns zoroark ex 98" (N's Zoroark ex, typed without
 * the apostrophe) trims down to the token "ns", which appears inside
 * "Origi-NS: Common Set". Rows came back, so the empty-candidates trigger
 * never fired, and the page answered with a card sharing two letters.
 *
 * "endsWith" and better are left alone: "Dark Slowbro" for "slowbro" is a
 * genuine answer, not an accident.
 */
export function looksWeak(candidates, parsed) {
  const best = candidates && candidates[0];
  if (!best) return true;
  return (nameMatchScore(norm(best.row.name), norm(parsed.name)) || 0) <= NAME_INCLUDES;
}

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

  // Confidence is permission to skip the picker and price straight away, so it
  // needs more than "nothing else came close". Two guards, both from real
  // failures:
  //
  //   "Espon ex 34" — a typo for Espeon — returned exactly one candidate,
  //   "Unexpected Response, Miku Nakano" from The Quintessential Quintuplets,
  //   because "Unexpected Res-PONSE" contains "espon". One candidate meant
  //   confident, so it priced a Quintuplets card without asking. Hence both a
  //   score floor and, separately:
  //
  //   if the visitor named a number, the card we are about to price silently
  //   had better carry that number. Miku Nakano is 122, not 34.
  const best = top[0];
  const numberAgrees = !parsed.number || (best && bare(best.row.collector_number) === parsed.number);
  const strongEnough = !!best && (nameMatchScore(norm(best.row.name), norm(parsed.name)) || 0) >= MIN_CONFIDENT_NAME;
  // Never skip the picker on a guess. The fallback runs only when the exact
  // search found nothing, so by definition we are unsure what was typed.
  const isFuzzy = !!best && best.row._similarity != null;
  const clear = top.length === 1 || (top.length > 1 && top[0].score - top[1].score >= 40);

  return { candidates: top, confident: clear && numberAgrees && strongEnough && !isFuzzy, fuzzy: isFuzzy };
}

export default { parseQuery, scoreCard, rankCards };
