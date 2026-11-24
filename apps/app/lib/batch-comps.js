/**
 * Pricing a whole batch from one request — the rules behind /api/batch-comps.
 *
 * The route does the fetching (auth, the user's SoldComps key, the cache, the
 * pacing). Everything that decides what a card IS, which comps are it, and
 * what it should go up at lives here, framework-free, so that:
 *
 * - scripts/check-batchcomps.mjs runs it under bare node against fixtures;
 * - Quick Search reads a card's variant and promo number the same way
 *   (`prefilterComps`), rather than growing a second opinion about Cosmos.
 *
 * The ENGINE (packages/core recommend()) still makes every judgement it
 * already makes — graded, lots, proxies, pick-lists, reverse holo, stamps,
 * foreign prints, non-UK sellers, outliers. This file adds the two things the
 * app was missing, both app-side:
 *
 * - a promo's number is its code ("BW33"), and its comps say "promo";
 * - variants.js — Cosmos, Cracked Ice, 1st Edition and the rest.
 *
 * and then prices the survivors under the house rules (house-pricing.js),
 * which are a policy and not the engine's figure.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import CardUploaderCsv from "./carduploader.js";
import { appNameTokens, applyNumberGuards, dropForeignPostage, settingsForText, stripNumberingPrefix } from "./matching.js";
import { isPromoCard, promoNumber, promoNumberPattern, anyPromoOfPrefix } from "./promo.js";
import { compVariants, detectVariants, isReverseKind, isSoftVariant, nameWithoutVariants, queryWordsFor, subjectTextFor, variantExclusion, variantLabel, withoutReverseWords } from "./variants.js";
import { housePrice, houseTotal, resolveRules, rulesForGame, conditionCode, decide, gameCode, spreadTooWide } from "./house-pricing.js";
import { UNPRICED_PENCE } from "./zero-price.js";
import { japaneseSetCode } from "./japanese-sets.js";

/** Most cards one request will take. A page of 50 is the normal batch. */
export const MAX_CARDS = 100;

/** The SoldComps options every batch card is fetched with. */
export const BATCH_FETCH_OPTIONS = Object.freeze({
  ebaySite: "ebay.co.uk",
  // Worldwide, then filtered to UK on eBay's own location field (null means
  // domestic on the UK site). One request answers both "how many UK sales"
  // and, when there are none, "how many anywhere".
  itemLocation: "worldwide",
  soldAfterDays: 90
});

/** Plain-English reasons, for a human reading `excluded[]`. */
export const REASON_TEXT = {
  nameMismatch: "Title doesn't name this card",
  graded: "Graded slab",
  rawCopy: "Raw copy (pricing a slab)",
  otherGrade: "Different grade",
  notACard: "Proxy, replica or not a card",
  bundle: "Lot or bundle",
  multiCardLot: "Multi-card lot",
  pickYourOwn: "\"Choose your card\" listing",
  promoVariant: "A different promo (league / championship / prerelease)",
  foreignPrint: "Other language",
  notThisLanguage: "Doesn't say it's this language (an English copy shares the number)",
  plainPrinting: "Ordinary copy (pricing a stamped one)",
  variantMismatch: "Wrong printing (reverse holo vs plain)",
  wrongVariant: "Wrong variant",
  missingVariant: "Doesn't say it's this variant",
  wrongNumber: "Different collector number",
  nonUkLocation: "Non-UK seller",
  setMismatch: "Doesn't name the set",
  catalogMismatch: "eBay catalogue says a different product",
  categoryMismatch: "eBay category says a different product",
  priceOutlier: "Price far above the rest",
  priceOutlierLow: "Price far below the rest",
  highPostage: "Postage implausible for one card",
  duplicate: "Same listing found twice"
};

const GENERIC_SET = CardUploaderCsv.GENERIC_SET_VALUES;

const pounds = (pence) => (pence == null ? null : Math.round(pence) / 100);

/** "£2.49", "2.49", 2.49, "249p" → pence. */
export function parseMoneyPence(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const t = String(v).trim().replace(/[£,\s]/g, "");
  if (/^\d+p$/i.test(t)) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const strip = (s) => String(s ?? "").trim();
const plain = (s) => strip(s).normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * One card from whatever shape it arrived in: the documented API fields, the
 * snake_case a person types, or a CardUploader row.
 */
export function normaliseCard(raw = {}, index = 0) {
  const pick = (...keys) => {
    for (const k of keys) if (raw[k] != null && strip(raw[k]) !== "") return raw[k];
    return "";
  };
  const variantKeys = Array.isArray(raw.variantKeys) ? raw.variantKeys : Array.isArray(raw.variant_keys) ? raw.variant_keys : null;
  return {
    index,
    sku: strip(pick("sku", "SKU", "CustomLabel")),
    name: strip(pick("name", "cardName", "card_name")),
    number: strip(pick("number", "cardNumber", "card_number")),
    set: strip(pick("set", "setName", "set_name")),
    setCode: strip(pick("setCode", "set_code", "*C:Set Code", "C:Set Code")),
    year: strip(pick("year", "*C:Year Manufactured")),
    variant: strip(pick("variant", "finish", "printing")),
    variantKeys,
    condition: strip(pick("condition")),
    language: strip(pick("language")) || "English",
    // Count sales in every language (CardCropper's "All languages"): a
    // foreign-language copy is evidence about the card, not another card.
    anyLanguage: raw.any_language === true || raw.anyLanguage === true || /^(any|all)(\s+languages?)?$/i.test(strip(pick("language"))),
    game: gameCode(pick("game", "Game", "*C:Game", "category")),
    // Count sales from sellers outside the UK (a per-batch choice on Add
    // copies): for cards whose UK supply is thin, mostly Japanese. Postage is
    // capped in the total either way, so £31 of shipping cannot inflate one.
    overseas: raw.overseas === true || raw.any_seller === true,
    title: strip(pick("title")),
    currentPence: raw.current_pence != null ? Number(raw.current_pence) : parseMoneyPence(pick("current_price", "currentPrice", "price", "startPrice"))
  };
}

/**
 * Cards from a raw CardUploader CSV. Reuses the Batch screen's own reader for
 * the fields it already knows, and reads the finish columns it doesn't
 * (`*C:Finish`, `*C:Speciality`, `C:Features`) straight off the row, because a
 * variant is the thing a batch most needs and the Batch screen never kept it.
 */
export function cardsFromCsv(csvText) {
  const items = CardUploaderCsv.extractItems(csvText);
  const rows = CardUploaderCsv.rowsToObjects(CardUploaderCsv.parseCsv(csvText))
    .filter((r) => strip(r["*C:Card Name"]) && strip(r["*C:Card Number"]));
  const finishKeys = (row) =>
    Object.keys(row).filter((k) => /finish|speciality|specialty|features|parallel|variant/i.test(k));
  return items.map((it, i) => {
    const row = rows[i] || {};
    const variant = finishKeys(row).map((k) => strip(row[k])).filter(Boolean).join(" ");
    return normaliseCard(
      {
        sku: it.sku,
        name: it.cardName,
        number: it.cardNumber,
        set: it.set,
        variant,
        condition: it.condition === "Unknown" ? it.conditionLabel : it.condition,
        language: it.language || "English",
        title: it.title,
        current_price: it.startPrice
      },
      i
    );
  });
}

// ---------------------------------------------------------------------------
// What the card is, and how it is searched
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Japanese promos, core names, and the title the engine reads
// ---------------------------------------------------------------------------

const JP_PROMO_CODE = /^(SV|S|SM|XY|BW|M|DP|L|ADV|PCG)-?P$/i;

/** { code: "SV-P", digits: "001" } for a Japanese promo number, or null. */
export function parseJpPromo(number, set = "") {
  const n = strip(number);
  let m = n.match(/^(\d{1,3})\s*\/\s*([A-Z]{1,3}-?P)$/i) || null;
  if (m && JP_PROMO_CODE.test(m[2])) return { digits: m[1].padStart(3, "0"), code: m[2].toUpperCase().replace(/^(\w+?)-?P$/, "$1-P") };
  m = n.match(/^([A-Z]{1,3}-?P)\s*-?\s*(\d{1,3})$/i);
  if (m && JP_PROMO_CODE.test(m[1])) return { digits: m[2].padStart(3, "0"), code: m[1].toUpperCase().replace(/^(\w+?)-?P$/, "$1-P") };
  const s = String(set || "").match(/\b(SV|S|SM|XY|BW|M)-?P\b/i);
  if (s && /^\d{1,3}$/.test(n)) return { digits: n.padStart(3, "0"), code: `${s[1].toUpperCase()}-P` };
  return null;
}

/** Owner prefixes and mechanic suffixes a seller may leave off: "Moltres" for "Team Rocket's Moltres EX". */
const OWNER_PREFIX = /^(?:team\s+rocket['’]?s|[a-z]+['’]s)\s+/i;
const MECHANIC_SUFFIX = /\s+(?:ex|gx|v|vmax|vstar|v-union|lv\.?\s?x|break|prime|legend|star|δ|delta species)$/i;

/** The name with an owner's prefix and a mechanic suffix taken off, or "" if nothing came off. */
export function coreNameOf(baseName) {
  let core = String(baseName || "");
  for (let i = 0; i < 2; i++) core = core.replace(MECHANIC_SUFFIX, "");
  core = core.replace(OWNER_PREFIX, "").trim();
  return core && core.toLowerCase() !== String(baseName || "").toLowerCase() ? core : "";
}

/**
 * The title as the ENGINE reads it, spelled the way the card's own name is:
 * a seller's "Team Rockets Moltres" or "TR Moltres" is "Team Rocket's
 * Moltres", so the name test does not drop it for a missing apostrophe. Only
 * the engine's copy changes; every comp comes back with its own title.
 */
export function engineTitle(plan, title) {
  let t = String(title || "");
  for (const tok of plan.nameTokens || []) {
    const m = String(tok).match(/^(.+?)['’]s$/i);
    if (!m) continue;
    const base = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\b${base}(?:['’]\\s?s|s)?\\b`, "gi"), tok);
  }
  if (/^team\s+rocket['’]?s\b/i.test(plan.baseName || "")) t = t.replace(/\bTR\b/g, "Team Rocket's");
  // A sale carrying the card's own number and its core name ("Moltres ex
  // 015/098") is this card even without the owner or the suffix: the number
  // is what makes that safe, since one card in a set carries it. The engine
  // reads it with the full name in front, so the name test passes.
  if (plan.coreName && plan.number && !/^\d{1,4}[a-z]?$/i.test(plan.number) && namesOwnNumber(plan, t)) {
    const core = plan.coreName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasAll = (plan.nameTokens || []).every((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`, "i").test(t));
    if (!hasAll && new RegExp(`\\b${core}\\b`, "i").test(t)) t = `${plan.baseName} ${t}`;
  }
  return t;
}

// ---------------------------------------------------------------------------
// The search ladder (depth 3)
// ---------------------------------------------------------------------------

/** A Japanese/Korean/Chinese set code as sellers write it: sv2a, s12a, sm10b, SV4a. */
const ASIAN_SET_CODE = /\b(?:sv|s|sm|xy|bw|dp|pt|l|cp|m|svg|sva|svn)\d{1,2}[a-z]\b/i;

/** The words that say a sale is in a given language, in a title. */
const LANGUAGE_WORDS = {
  japanese: "japanese|japan|jpn|jp|jap",
  korean: "korean|korea|kor|kr",
  chinese: "chinese|china|chn|cn|simplified|traditional",
  german: "german|deutsch|ger|de",
  french: "french|fran[cç]ais|fra|fr",
  italian: "italian|italiano|ita",
  spanish: "spanish|espa[nñ]ol|esp",
  portuguese: "portuguese|portugu[eê]s|por",
  dutch: "dutch|nederlands|nl"
};

/**
 * What a sale's title must carry to count for a non-English card: its
 * language's word, an Asian set code (sv2a) for the Asian languages, or the
 * card's own set name or code. Without it the widest searches would pool the
 * English copy that shares the card's number — Japanese 151 is numbered
 * exactly like English 151.
 */
export function languageMarker(language, setName = "", setCode = "") {
  const key = String(language || "").trim().toLowerCase();
  const words = LANGUAGE_WORDS[key];
  if (!words) return null;
  const parts = [`\\b(?:${words})\\b`];
  // A title in Japanese script is a Japanese card's title (kana, or kanji).
  if (key === "japanese") parts.push("[\\u3040-\\u30ff\\u4e00-\\u9faf]");
  if (["japanese", "korean", "chinese"].includes(key)) parts.push(ASIAN_SET_CODE.source);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const name = plain(setName).trim();
  if (name && name.length >= 4) parts.push(esc(name));
  if (setCode && /^[A-Za-z0-9-]{2,8}$/.test(setCode)) parts.push(`\\b${esc(setCode)}\\b`);
  return new RegExp(parts.join("|"), "i");
}

/**
 * Every way to ask for one card, narrowest first, duplicates dropped. Each is
 * an eBay search, and eBay needs every word — so each rung drops or respells
 * one thing sellers are inconsistent about: the set, the printing's words, the
 * number's zero padding, the number's denominator, the language word.
 */
export function searchLadder({ baseName, coreName = "", variantWords = "", number = "", promo = false, jpPromo = null, setForQuery = "", setName = "", langWord = "", setCode = "", english = true }) {
  const q = (...parts) => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const rungs = [];
  const add = (rung, query) => { if (query && !rungs.some((r) => r.query.toLowerCase() === query.toLowerCase())) rungs.push({ rung, query }); };
  const m = !promo && String(number).match(/^([A-Z]{0,4})(\d{1,4})([a-z]?)\s*\/\s*([A-Z]{0,4}\d{1,4})$/i);
  const unpadded = m && m[2].replace(/^0+(?=\d)/, "") !== m[2] ? `${m[1]}${m[2].replace(/^0+(?=\d)/, "")}${m[3]}/${m[4]}` : "";
  const numerator = m ? `${m[1]}${m[2]}${m[3]}` : "";

  add("exact", q(baseName, variantWords, number, setForQuery, langWord));
  add("noset", q(baseName, variantWords, number, langWord));
  if (variantWords) add("noprinting", q(baseName, number, langWord));
  if (unpadded) add("unpadded", q(baseName, variantWords, unpadded, langWord));
  if (numerator) add("numerator", q(baseName, variantWords, numerator, langWord));
  if (!english && !jpPromo && setCode && /^[A-Za-z0-9-]{2,8}$/.test(setCode)) add("setcode", q(baseName, variantWords, number || "", setCode));
  if (jpPromo) {
    add("promocode", q(baseName, variantWords, `${jpPromo.code} ${jpPromo.digits}`, langWord));
    add("promoword", q(baseName, variantWords, jpPromo.digits, jpPromo.code, "promo"));
  }
  // The name sellers shorten: "Moltres 015/098" for Team Rocket's Moltres EX.
  // The number is what makes this safe — one card in a set carries it.
  if (coreName && number && !/^\d{1,4}[a-z]?$/i.test(number)) add("corename", q(coreName, variantWords, number, langWord));
  if (!english) add("nolanguage", q(baseName, variantWords, number));
  // No number to anchor on — or a bare one ("38") sellers don't write: the
  // set is the only thing between this card and every other copy of its
  // name, so ask for it as sellers might write it, without the number.
  const bare = !promo && /^\d{1,4}[a-z]?$/i.test(number);
  if ((!number || bare) && setName) add("withset", q(baseName, variantWords, setName));
  if (bare && setCode && /^[A-Za-z0-9-]{2,8}$/.test(setCode)) add("codenonumber", q(baseName, variantWords, setCode));
  if (bare) add("nonumber", q(baseName, variantWords, langWord));
  if (!number && variantWords) add("nameonly", q(baseName, langWord));
  return rungs;
}

/**
 * Everything decided about a card before any request is made: what it is,
 * the queries that will be sent, and the settings its comps are judged by.
 */
export function planCard(card) {
  const english = !card.language || /^english$/i.test(card.language) || /^(any|all)\b/i.test(card.language);
  // A Japanese promo ("001/SV-P", "SV-P 001", or 001 in an "SV-P" promo set)
  // is read as a promo code, never as a number out of a set total.
  const jpPromo = parseJpPromo(card.number, card.set);
  const promo = Boolean(jpPromo) || isPromoCard({ number: card.number, set: card.set });
  // What CardUploader writes in the number column is not always a printed
  // number: "DAR" on an unnumbered energy is Cardmarket's code, and no seller
  // writes it. A number with no digit is no number.
  const rawNumber = jpPromo ? `${jpPromo.digits}/${jpPromo.code}` : promo ? promoNumber(card.number) : strip(card.number);
  const number = /\d/.test(rawNumber) ? rawNumber : "";
  // A bare number ("38", no "/total") is too weak to be a REQUIRED word —
  // sellers write "038/028" or the set code — so it searches but never
  // filters on its own.
  const bareNumber = !promo && /^\d{1,4}[a-z]?$/i.test(number);
  const { keys, unrecognised } = detectVariants({
    name: card.name,
    variant: card.variant,
    set: card.set,
    title: card.title,
    variantKeys: card.variantKeys
  });

  // The name as eBay sellers write it: no Cardmarket brackets, no variant
  // words (those go into the query on their own terms, and into the filter as
  // a REQUIRED variant rather than a required literal token).
  // A bracketed aside the variant table could not place ("(Rainbow Foil)")
  // comes out too: it is reported as unrecognised, and left in it would make
  // every word in it a REQUIRED name token — "(Master Ball Pattern)" demanded
  // "Pattern" of every sale and found none. "Unown (E)" keeps its letter.
  const baseName = nameWithoutVariants(card.name)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^()]*)\)/g, (m, inner) => (/^[A-Z0-9!?]{1,2}$/i.test(inner.trim()) ? m : " "))
    // Cardmarket's "Basic Darkness Energy" is "Darkness Energy" to a seller.
    .replace(/^basic\s+(?=\S+\s+energy\b)/i, "")
    .replace(/\s{2,}/g, " ").trim() || card.name;
  const setUsable = card.set && !GENERIC_SET.has(card.set.toLowerCase());
  // A promo's code already names its set, and "Black and White Promos" is
  // nowhere in how anybody titles one — in the query it only shrinks the page.
  // Nor does a non-English set name: CardUploader writes Cardmarket's
  // ("Pokemon Card 151", "Shiny Treasure ex") and sellers of Japanese cards
  // write the code ("sv2a") or nothing. eBay needs every word, so the set cost
  // 4 of 5 UK Geodude Master Ball sales (TEST3, 2026-11-24). Name, number and
  // language already pin a Japanese card.
  const setForQuery = setUsable && !promo && english ? plain(card.set) : "";
  const langWord = english ? "" : card.language;

  const compose = (withSet) =>
    [baseName, queryWordsFor(keys), number, withSet ? setForQuery : "", langWord]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const queries = [compose(true)];
  if (setForQuery) queries.push(compose(false));

  // The full ladder (depth 3): the same card asked every way sellers title it.
  // Every rung is run and merged, each sale once; the filter — not the search
  // — decides what counts, so a wide rung adds evidence and never a card.
  // The printed set code: the file's, else Cardmarket's Japanese set name looked up.
  const setCode = card.setCode || (jpPromo ? jpPromo.code : /^japanese$/i.test(card.language || "") ? japaneseSetCode(card.set) : "");
  const ladder = searchLadder({ baseName, coreName: coreNameOf(baseName), variantWords: queryWordsFor(keys), number, promo, jpPromo, setForQuery, setName: setUsable && !promo ? plain(card.set) : "", langWord, setCode, english });

  // The text the engine's subject readers see. Variant words that core reads
  // itself (reverse, stamped) are written in so its reading and ours agree.
  const subjectText = [baseName, number, subjectTextFor(keys), card.title, langWord].filter(Boolean).join(" ");
  const settings = settingsForText(subjectText, { promo });
  if (card.anyLanguage && settings.excludeKeywords?.foreignPrint) {
    const { foreignPrint, ...rest } = settings.excludeKeywords; // eslint-disable-line no-unused-vars
    settings.excludeKeywords = rest;
  }

  // Hyphenated names are two words to a seller as often as one ("Chi Yu",
  // "Ho Oh"): split, each word still required, so both spellings count.
  const nameTokens = appNameTokens(
    CompFinderPricing.simplifyTitle([baseName, promo || bareNumber ? "" : stripNumberingPrefix(number)].filter(Boolean).join(" "), settings.stripWords)
  ).flatMap((t) => (/^[^-\s]+(?:-[^-\s]+)+$/.test(t) && !/^\d/.test(t) ? t.split("-") : [t]));

  // A card with no number has only its name and set between it and every
  // other copy of that name: a Golden Box Lightning Energy pooled 20p basics
  // and a ten-card lot. So a sale must name a distinctive word of the set,
  // when the set has one ("Golden"); an era or "Unnumbered Energies" says
  // nothing and imposes nothing.
  // A bare number ("38") anchors nothing either — it is not a required word,
  // and the ladder searches without it — so it takes the same set rule.
  const setWords = (!number || bareNumber) && setUsable ? distinctiveSetWords(card.set) : [];
  // A "/total" card's sale that leaves the total off ("Zubat #041", "No. 041")
  // has nothing tying it to THIS set — the numerator-only search returns every
  // set's card 41. Such a sale must name the set instead: a word of it or its
  // code. (A set with no distinctive word and no code imposes nothing.)
  const denominator = (!promo && String(number).match(/\/\s*[A-Z]{0,4}(\d{1,4})$/i)?.[1]) || "";
  const setEvidence = setUsable ? distinctiveSetWords(card.set) : [];

  return {
    card,
    english,
    promo,
    number,
    baseName,
    variantKeys: keys,
    unrecognisedVariant: unrecognised,
    set: setUsable ? card.set : null,
    queries,
    ladder,
    languageMarker: english || card.anyLanguage ? null : languageMarker(card.language, setUsable ? card.set : "", setCode),
    setWords,
    denominator,
    setEvidence,
    year: /^(19|20)\d\d$/.test(card.year || "") ? Number(card.year) : null,
    setCode,
    settings,
    nameTokens,
    condition: conditionCode(card.condition),
    game: card.game || "pokemon",
    anyLanguage: !!card.anyLanguage,
    overseas: !!card.overseas,
    coreName: coreNameOf(baseName),
    jpPromo
  };
}

// ---------------------------------------------------------------------------
// Which comps are the card
// ---------------------------------------------------------------------------

export function compKey(c) {
  const s = c._source || {};
  return s.itemId ? `id:${s.itemId}` : s.url ? `url:${s.url}` : `t:${c.title}|${c.itemPricePence}|${s.endedAt || ""}`;
}

/** Merge pages from several searches, each sale once. */
export function mergeComps(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages) {
    for (const c of page || []) {
      const k = compKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/** Set-name words that say nothing about which printing a card is. */
const SET_STOP = new Set(("pokemon pokémon card cards tcg set series collection edition era the of and ex gx v " +
  "unnumbered energies energy anniversary 25th sun moon sword shield scarlet violet black white diamond pearl " +
  "promo promos box japanese english base expansion special dark light").split(" "));

/** The words of a set name a seller would have to write to mean it ("Golden"). */
export function distinctiveSetWords(setName) {
  const words = plain(setName).toLowerCase().split(/[^a-z0-9]+/);
  const strong = words.filter((w) => w.length >= 4 && !SET_STOP.has(w) && !/^\d+$/.test(w));
  if (strong.length) return strong;
  // Nothing better: a set like "25th Anniversary Collection" is still told
  // apart by its "25th" — a weaker word, used only when it is all there is,
  // so "25th Anniversary Golden Box" still asks for "Golden".
  return words.filter((w) => SECONDARY_SET_WORDS.has(w));
}

/** Set words too common to require when a set has a better one, but better than nothing. */
const SECONDARY_SET_WORDS = new Set(["25th", "anniversary", "celebrations", "classic"]);

/** Not a TCG card at all: Bandai's Carddass and Sealdass, Topsun, vending and gum stickers. */
const OTHER_PRODUCT = /\b(?:carddass|sealdass|topsun|bandai|meiji|amada|vending|sticker|tazo|pog)\b/i;

/** Whether a title carries the card's own "n/total" (zero padding either side ignored). */
function hasOwnFraction(plan, title) {
  const m = String(plan.number || "").match(/^([A-Z]{0,4})0*(\d{1,4})[a-z]?\s*\/\s*([A-Z]{0,4})0*(\d{1,4})$/i);
  if (!m) return true;
  return new RegExp(`(^|[^A-Z0-9])${m[1]}0*${m[2]}[a-z]?\\s*/\\s*${m[3]}0*${m[4]}(?![0-9])`, "i").test(title);
}

/** A sale of several copies: "x10", "10x", "lot of 4", "playset". */
const QUANTITY_LOT = /\b(?:[2-9]|\d{2,})\s*x\b|\bx\s*(?:[2-9]|\d{2,})\b|\blot\s+of\b|\bplay\s*sets?\b|\bjob\s*lot\b/i;

/**
 * Set and era names that carry "and" or "&" without being two cards.
 */
const JOINED_NAMES = /\b(?:black|sun|sword|scarlet|heart\s*gold|diamond|ruby|fire\s*red|x)\s*(?:&|and)\s*(?:white|moon|shield|violet|soul\s*silver|pearl|sapphire|leaf\s*green|y)\b/gi;

const flat = (s) => plain(s).toLowerCase().replace(/[^a-z0-9&+,]+/g, " ").replace(/\s+/g, " ").trim();

/** Whether a sale title carries the card's own number (zero padding ignored). */
function namesOwnNumber(plan, title) {
  if (plan.promo) { const rx = promoNumberPattern(plan.number); return rx ? rx.test(title) : false; }
  const m = String(plan.number).match(/^([A-Z]{0,4})0*(\d{1,4})/i);
  if (!m) return false;
  return new RegExp(`(^|[^A-Z0-9])${m[1]}0*${m[2]}(?![0-9])`, "i").test(title);
}

/**
 * A sale that lists several cards by name — "Fearow, Cacturne, Cradily" sold
 * for £22.41 and was counted as a Fearow 36/100 comp (CardCropper, 21 Nov
 * 2026). The engine catches lots that SAY they are lots; this catches the
 * ones that only list. A title carrying the card's own number is the card
 * whatever else it says, and the card's own name ("Pikachu & Zekrom GX") and
 * set names ("Black and White", "Sun & Moon") are taken out before looking
 * for a comma, an &, a + or an "and". A card with no number has nothing to
 * tell its own sale from a list, so it is never judged this way.
 */
export function listsOtherCards(plan, title) {
  if (!plan.number) return false;
  if (namesOwnNumber(plan, title || "")) return false;
  let t = ` ${flat(title).replace(JOINED_NAMES, " ")} `;
  for (const own of [plan.baseName, plan.set].filter(Boolean)) {
    const f = flat(own).replace(JOINED_NAMES, " ").trim();
    if (f) t = t.split(` ${f} `).join("  ");
  }
  return /,|\s&\s|\s\+\s|\sand\s/.test(` ${t.replace(/\s+/g, " ")} `);
}

/**
 * The two app-side rules, ahead of the engine: the promo number and the
 * variant. Both return the comp with an `exclusionReason` rather than
 * dropping it, so nothing leaves quietly.
 */
export function prefilterComps(plan, comps) {
  const kept = [];
  const excluded = [];
  // A SOFT variant (mirror holo) is not required of a sale — most never say
  // it. But when at least two sales DO say it, the market is telling mirror
  // and plain apart, and pooling them averages a £3 card with a 60p one; then
  // it is required like any other.
  const softKeys = (plan.variantKeys || []).filter((k) => isSoftVariant(k));
  const hardened = softKeys.filter((k) => (comps || []).filter((c) => compVariants(c.title || "").includes(k)).length >= 2);
  const ours = plan.promo ? promoNumberPattern(plan.number) : null;
  const anyCode = plan.promo ? anyPromoOfPrefix(plan.number) : null;
  for (const c of comps || []) {
    const t = c.title || "";
    if (ours) {
      // A promo comp is ours if it carries our code. One carrying a different
      // code of the same series, or a main-set "61/124", is another card.
      // One with no number at all stays — sold comps without a number are
      // real evidence, and the name filter has still to run.
      if (!ours.test(t)) {
        anyCode.lastIndex = 0;
        if (anyCode.test(t) || /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(t)) {
          excluded.push({ ...c, exclusionReason: "wrongNumber" });
          continue;
        }
      }
    }
    if (plan.jpPromo) {
      const own = new RegExp(`(^|[^0-9])0*${Number(plan.jpPromo.digits)}([^0-9]|$)`);
      if (!own.test(t) && (/\b\d{1,3}\s*\/\s*\d{2,3}\b/.test(t) || /\b(?:sv|s|sm|xy|bw|m)-?p\b/i.test(t))) {
        excluded.push({ ...c, exclusionReason: "wrongNumber", exclusionDetail: `not ${plan.jpPromo.digits}/${plan.jpPromo.code}` });
        continue;
      }
    }
    if (OTHER_PRODUCT.test(t) && !(/\bsticker\b/i.test(t) && !/\b(carddass|sealdass|bandai|topsun)\b/i.test(t) && (plan.variantKeys || []).includes("ditto"))) {
      excluded.push({ ...c, exclusionReason: "notACard", exclusionDetail: "another product (Carddass, Topsun, sticker…)" });
      continue;
    }
    if (plan.year) {
      const years = [...t.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
      if (years.length && years.every((y) => Math.abs(y - plan.year) > 1)) {
        excluded.push({ ...c, exclusionReason: "setMismatch", exclusionDetail: `says ${years[0]}, the card is ${plan.year}` });
        continue;
      }
    }
    if (plan.denominator && !hasOwnFraction(plan, t)) {
      const named = (plan.setEvidence || []).some((w) => new RegExp(`\\b${w}\\b`, "i").test(plain(t)))
        || (plan.setCode && new RegExp(`\\b${plan.setCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
      if ((plan.setEvidence?.length || plan.setCode) && !named) {
        excluded.push({ ...c, exclusionReason: "setMismatch", exclusionDetail: `no /${plan.denominator} and doesn't name the set` });
        continue;
      }
    }
    if (QUANTITY_LOT.test(t)) {
      excluded.push({ ...c, exclusionReason: "bundle", exclusionDetail: "several copies" });
      continue;
    }
    // The set's code ("s8a") names it as well as any word of its name does.
    const namesSet = (plan.setWords || []).some((w) => new RegExp(`\\b${w}\\b`, "i").test(plain(t)))
      || (plan.setCode && new RegExp(`\\b${plan.setCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
    if (plan.setWords?.length && !namesSet) {
      excluded.push({ ...c, exclusionReason: "setMismatch", exclusionDetail: `doesn't say ${plan.setWords.join(" / ")}` });
      continue;
    }
    if (hardened.length && hardened.some((k) => !compVariants(t).includes(k))) {
      excluded.push({ ...c, exclusionReason: "missingVariant", exclusionDetail: hardened.map(variantLabel).join(", ") + " (sellers tell it apart)" });
      continue;
    }
    if (plan.languageMarker && !plan.languageMarker.test(t)) {
      excluded.push({ ...c, exclusionReason: "notThisLanguage", exclusionDetail: plan.card?.language || "" });
      continue;
    }
    if (listsOtherCards(plan, t)) {
      excluded.push({ ...c, exclusionReason: "multiCardLot", exclusionDetail: "lists other cards" });
      continue;
    }
    const v = variantExclusion(t, plan.variantKeys, plan.baseName);
    if (v) {
      excluded.push({ ...c, exclusionReason: v.reason, exclusionDetail: variantLabel(v.variant) });
      continue;
    }
    kept.push(c);
  }
  return { kept, excluded };
}

/** The collector-number guards, with what they drop recorded rather than lost. */
function numberGuards(plan, comps) {
  if (plan.promo || !plan.number) return { kept: comps, excluded: [] };
  const kept = applyNumberGuards(comps, plan.number);
  if (kept.length === comps.length) return { kept, excluded: [] };
  const keep = new Set(kept);
  return { kept, excluded: comps.filter((c) => !keep.has(c)).map((c) => ({ ...c, exclusionReason: "wrongNumber" })) };
}

function saleOut(c, rules) {
  const s = c._source || {};
  return {
    price: pounds(c.itemPricePence),
    postage: pounds(c.postagePence || 0),
    total: pounds(houseTotal(c, rules)),
    date: s.endedAt || null,
    title: c.title,
    item_id: s.itemId || null,
    url: s.url || null
  };
}

/**
 * A card's whole answer from the comps its searches returned.
 *
 * `fetch` describes what was asked: the queries actually sent, whether a page
 * came back full, and when the data was fetched.
 */
/**
 * Which of a card's comps are the card: the app-side prefilter, the number
 * guards, then the engine. Every comp comes out in exactly one of `included`
 * or `excluded`, the latter carrying `exclusionReason`. Both contracts of
 * /api/batch-comps judge through this, so they cannot disagree about a comp.
 *
 * Postage on a comp the engine sees may have been zeroed by
 * dropForeignPostage (`postageDropped` holds what it was).
 */
export function judgeComps(plan, comps) {
  const pre = prefilterComps(plan, comps);
  const guarded = numberGuards(plan, pre.kept);
  let forEngine = dropForeignPostage(guarded.kept).comps;
  // A pattern reverse (Master Ball, Poké Ball): the engine must not read
  // "reverse" in a sale as another printing. It sees the title without those
  // words; every comp comes back out with its own title.
  const pattern = isReverseKind(plan.variantKeys);
  forEngine = forEngine.map((c) => {
    let t = engineTitle(plan, c.title);
    if (pattern) t = withoutReverseWords(t);
    return t === c.title ? c : { ...c, _title: c.title, title: t };
  });
  const rec = CompFinderPricing.recommend(forEngine, plan.settings, plan.nameTokens, "sold", plan.number || null, plan.set);
  const own = (c) => (c._title != null ? (({ _title, ...rest }) => ({ ...rest, title: _title }))(c) : c);
  return {
    rec,
    pre,
    included: (rec.included || []).map(own),
    excluded: [...pre.excluded, ...guarded.excluded, ...(rec.excluded || []).map(own)]
  };
}

export function evaluateCard(plan, comps, fetch = {}, rulesIn) {
  const rules = rulesForGame(resolveRules(rulesIn), plan.game);
  const judged = judgeComps(plan, comps);
  const { rec, pre } = judged;
  // Put back: a sale the engine left out ONLY for its postage. The total caps
  // postage anyway, so the sale is still evidence of what the card made. The
  // engine marks highPostage after every name and printing test has passed,
  // so a sale put back here is one it had already accepted as the card.
  // With overseas sellers counted, a sale left out only for its seller's
  // country is put back the same way: the engine marks nonUkLocation after
  // every name and printing test has passed.
  const backReasons = new Set(["highPostage", ...(plan.overseas ? ["nonUkLocation"] : [])]);
  const putBack = judged.excluded.filter((c) => backReasons.has(c.exclusionReason)).map((c) => ({ ...c, putBack: true }));
  const included = [...judged.included, ...putBack];
  const excludedAll = judged.excluded.filter((c) => !backReasons.has(c.exclusionReason));
  const nonUk = judged.excluded.filter((c) => c.exclusionReason === "nonUkLocation").length;

  const held = !!rec.priceHeld;
  const house = housePrice(included, plan.condition, rules);
  const suggestedPence = held ? null : house.suggestedPence;

  const dates = included.map((c) => c._source && c._source.endedAt).filter(Boolean).sort();
  const allUkDates = comps.filter((c) => !c.itemLocation).map((c) => c._source && c._source.endedAt).filter(Boolean).sort();

  // Was this card perhaps the variant? A base card whose search came back
  // mostly as one variant is worth a look before trusting the plain price.
  const wrongVariant = pre.excluded.filter((c) => c.exclusionReason === "wrongVariant").length;
  const missingVariant = pre.excluded.filter((c) => c.exclusionReason === "missingVariant").length;
  const variantUncertain =
    plan.unrecognisedVariant.length > 0 ||
    (plan.variantKeys.length === 0 && wrongVariant > 0 && wrongVariant >= included.length) ||
    (plan.variantKeys.length > 0 && included.length === 0 && missingVariant > 0);

  const n = included.length;
  const flags = {
    few_comps: n < rules.minCompsForPercentile,
    variant_uncertain: variantUncertain,
    wide_spread: spreadTooWide(house.totals),
    no_uk_comps: n === 0,
    price_held: held
  };
  const notes = [];
  if (flags.no_uk_comps) notes.push(nonUk > 0 ? `No UK sales matched; ${nonUk} worldwide sale(s) did.` : "No sales matched this card in 90 days.");
  if (plan.unrecognisedVariant.length) notes.push(`Variant text not recognised: ${plan.unrecognisedVariant.join(", ")}.`);
  if (flags.variant_uncertain && plan.variantKeys.length === 0 && wrongVariant > 0) {
    notes.push(`${wrongVariant} sale(s) were a variant (${[...new Set(pre.excluded.filter((c) => c.exclusionReason === "wrongVariant").map((c) => c.exclusionDetail))].join(", ")}) — check this card isn't one.`);
  }
  if (held) notes.push(rec.note);
  const highBack = putBack.filter((c) => c.exclusionReason === "highPostage").length;
  if (highBack) notes.push(`${highBack} sale(s) counted although their postage was high — the total caps postage at £${(rules.postageCapPence / 100).toFixed(2)}.`);
  if (plan.overseas && nonUk) notes.push(`${nonUk} sale(s) from sellers outside the UK counted.`);
  const verdict = decide({
    nSales: n, totals: house.totals, suggestedPence, currentPence: plan.card.currentPence,
    condition: plan.condition, putBack: highBack,
    unrecognised: plan.unrecognisedVariant, numberless: !plan.number || /^\d{1,4}[a-z]?$/i.test(plan.number) && !plan.promo
  }, rules);
  for (const f of verdict.flags) if (!(f in flags)) flags[f] = true;

  return {
    index: plan.card.index,
    sku: plan.card.sku,
    input: {
      name: plan.card.name, number: plan.card.number, set: plan.card.set, variant: plan.card.variant,
      condition: plan.card.condition, language: plan.card.language
    },
    query: fetch.queries ? fetch.queries[0] : plan.queries[0],
    queries_sent: fetch.queries || [],
    matched: {
      name: plan.baseName,
      number: plan.number,
      set: plan.set,
      promo: plan.promo,
      variant: plan.variantKeys.length ? plan.variantKeys.map(variantLabel).join(" + ") : "Base",
      variant_keys: plan.variantKeys,
      language: plan.card.language || "English"
    },
    n_comps: n,
    worldwide_comps: n + nonUk,
    last_sold: dates.length ? dates[dates.length - 1] : null,
    newest_uk_listing_seen: allUkDates.length ? allUkDates[allUkDates.length - 1] : null,
    fetched_at: fetch.fetchedAt || null,
    from_cache: fetch.cached ?? null,
    page_full: !!fetch.pageFull,
    sales: included.map((c) => ({ ...saleOut(c, rules), ...(c.putBack ? { put_back: true, put_back_reason: c.exclusionReason } : {}) })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    excluded: excludedAll.map((c) => ({
      ...saleOut(c, rules),
      reason: c.exclusionReason,
      reason_text: REASON_TEXT[c.exclusionReason] || c.exclusionReason,
      ...(c.exclusionDetail ? { detail: c.exclusionDetail } : {})
    })),
    p40: house.method === "none" ? null : pounds(house.method === "lowest" ? house.totals[0] : house.basisPence),
    pricing: {
      method: house.method,
      basis: pounds(house.basisPence),
      lp_price: pounds(house.lpPence),
      condition: house.condition,
      multiplier: house.multiplier
    },
    suggested_price: pounds(suggestedPence),
    suggested_pence: suggestedPence,
    decision: verdict.decision,
    decision_reason: verdict.reason,
    game: plan.game,
    any_language: plan.anyLanguage,
    floor_price: pounds(rules.floorPence),
    set_code: plan.setCode || null,
    overseas: plan.overseas,
    engine_price: pounds(rec.finalPence),
    confidence: rec.confidence,
    flags,
    notes,
    current_price: pounds(plan.card.currentPence)
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Should another search be asked for this card? */
export function wantsFallback(result, rules) {
  return result.n_comps < resolveRules(rules).minCompsForPercentile && !result.page_full;
}

/**
 * "Check prices" mode: does the suggestion differ from what the card is on at
 * by more than £1 or 30% (both settable)? A card with no suggestion, or no
 * current price, always needs a look and is always returned.
 */
export function priceDiffers(result, { absPounds = 1, pct = 30 } = {}) {
  const cur = result.current_price;
  const sug = result.suggested_price;
  if (sug == null || cur == null) return { differs: true, reason: sug == null ? "no suggested price" : "no current price" };
  const diff = Math.round((sug - cur) * 100) / 100;
  const rel = cur > 0 ? Math.abs(diff) / cur * 100 : Infinity;
  const differs = Math.abs(diff) > absPounds || rel > pct;
  return { differs, diff, pct: Number.isFinite(rel) ? Math.round(rel) : null };
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * sku,suggested_price — the two columns CardUploader needs.
 *
 * A card with no price is written as 0.00, never blank and never left out —
 * the app's zero-price rule (lib/zero-price.js): a blank is what the eye skips,
 * and a CardUploader file already carries £2.49 on every row, the same figure
 * as the floor, so a card nothing priced would go up looking priced. eBay
 * refuses to list at zero, which is the point. `unpricedSkus()` names them.
 */
export function resultsCsv(results) {
  const lines = ["sku,suggested_price"];
  for (const r of results) {
    const pence = r.suggested_pence == null ? UNPRICED_PENCE : r.suggested_pence;
    lines.push(`${csvCell(r.sku)},${(pence / 100).toFixed(2)}`);
  }
  return lines.join("\n") + "\n";
}

/** The SKUs written at 0.00, so a caller can refuse to upload until they're priced. */
export function unpricedSkus(results) {
  return results.filter((r) => r.suggested_pence == null).map((r) => r.sku || `#${r.index + 1}`);
}
