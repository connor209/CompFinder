/**
 * /api/batch-comps, title form: a card is an id and a listing title, and the
 * answer is the evidence — every sold listing fetched, each marked with why
 * it would be excluded — not a price. The caller applies the house rules.
 *
 *   { "cards": [ { "id": "JO28", "title": "Kingdra (Cosmos Holo) 032/182 Pokemon" } ] }
 *
 * The title is parsed into name / number / set here and then planned and
 * judged by EXACTLY the pipeline the field-based form uses (planCard +
 * judgeComps in batch-comps.js), so the two forms cannot disagree about which
 * comps are the card. Framework-free, so scripts/check-titlecomps.mjs runs it
 * under bare node.
 *
 * No price is worked out, and nothing ever falls back to ACTIVE listings: a
 * sold lookup that fails is status "timeout" for that card, with no rows.
 */
import { compKey, judgeComps, normaliseCard, planCard } from "./batch-comps.js";
import { promoCodeIn } from "./promo.js";

/** Most cards one title-form request will take. ~35 is the intended size. */
export const TITLE_MAX_CARDS = 50;

/**
 * The caller's reason vocabulary, from the engine's own reasons. The engine
 * has more reasons than the caller asked for; the ones with no honest home in
 * that list keep a code of their own rather than being forced into one, and
 * `excluded_detail` always carries the engine's reason unmapped.
 */
export const REASON_CODES = Object.freeze({
  graded: "graded",
  rawCopy: "graded", // pricing a slab: a raw copy is the other object
  otherGrade: "graded",
  bundle: "bundle",
  multiCardLot: "bundle",
  pickYourOwn: "bundle",
  nameMismatch: "name_mismatch",
  wrongNumber: "name_mismatch",
  setMismatch: "name_mismatch",
  variantMismatch: "variant_mismatch",
  wrongVariant: "variant_mismatch",
  missingVariant: "variant_mismatch",
  plainPrinting: "variant_mismatch",
  promoVariant: "variant_mismatch",
  nonUkLocation: "non_uk",
  foreignPrint: "foreign",
  notThisLanguage: "foreign",
  catalogMismatch: "catalog_mismatch",
  categoryMismatch: "catalog_mismatch",
  // Outside the requested list — no honest mapping into it.
  notACard: "not_a_card",
  priceOutlier: "price_outlier",
  priceOutlierLow: "price_outlier",
  highPostage: "high_postage",
  duplicate: "duplicate",
  stampedCopy: "variant_mismatch",
  yourRule: "your_rule" // a rule you set on this card (price-rules.js)
});

const snake = (s) => String(s).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
export const reasonCode = (engineReason) =>
  engineReason == null ? null : REASON_CODES[engineReason] || snake(engineReason);

// ---------------------------------------------------------------------------
// The title
// ---------------------------------------------------------------------------

/** A main-set collector number: 032/182, 4/102, TG05/TG30, SV001/SV122, 177a/165. */
const COLLECTOR_NUMBER = /(^|[\s#(])([A-Z]{0,4}\d{1,3}[a-z]?\s*\/\s*[A-Z]{0,4}\d{1,4})(?=$|[\s),.|])/i;

const LANGUAGES = ["Japanese", "Korean", "Chinese", "German", "French", "Italian", "Spanish", "Portuguese", "Dutch"];
const LANGUAGE = new RegExp(`\\b(${LANGUAGES.join("|")})\\b`, "i");

const CONDITION =
  /\b(near mint|mint|lightly played|light play|moderately played|heavily played|damaged|nm|lp|mp|hp|dmg|ex)\b(?=[\s/|-]*$)/i;
const CONDITION_CODE = { "near mint": "NM", mint: "NM", nm: "NM", ex: "LP", "lightly played": "LP", "light play": "LP", lp: "LP", "moderately played": "MP", mp: "MP", "heavily played": "HP", hp: "HP", damaged: "DMG", dmg: "DMG" };

/** Words in a listing title that say nothing about which card it is. */
const FILLER = /\b(pok[eé]mon|tcg|trading\s+card(?:\s+game)?|card|english|eng)\b/gi;
/** Rarity words that sit after the number and would only shrink the search. */
const RARITY =
  /\b(?:special illustration rare|illustration rare|hyper rare|secret rare|ultra rare|double rare|holo rare|rare holo|rare|uncommon|common)\b/gi;

const tidy = (s) =>
  String(s || "")
    .replace(/[|•·–—]+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-,:/]+|[\s\-,:/]+$/g, "")
    .trim();

/**
 * Name, collector number, set, language and condition read off a listing
 * title. The name is everything before the number (variant words such as
 * "(Cosmos Holo)" stay in it — planCard reads the variant off it); the set is
 * what follows, less filler, rarity and a trailing condition.
 */
export function parseCardTitle(title) {
  const raw = tidy(title);
  let name = raw;
  let number = "";
  let after = "";

  const main = raw.match(COLLECTOR_NUMBER);
  if (main) {
    const at = main.index + main[1].length;
    number = main[2].replace(/\s+/g, "");
    name = raw.slice(0, at);
    after = raw.slice(at + main[2].length);
  } else {
    const promo = promoCodeIn(raw);
    if (promo) {
      number = promo.code;
      name = raw.slice(0, promo.index);
      after = raw.slice(promo.index + promo.length);
    }
  }

  const langMatch = raw.match(LANGUAGE);
  const language = langMatch ? langMatch[1][0].toUpperCase() + langMatch[1].slice(1).toLowerCase() : "English";

  let condition = "";
  const cond = tidy(after.replace(FILLER, " ")).match(CONDITION) || (!number && tidy(name.replace(FILLER, " ")).match(CONDITION));
  if (cond) condition = CONDITION_CODE[cond[1].toLowerCase()] || "";

  const strip = (s) => tidy(String(s).replace(FILLER, " ").replace(LANGUAGE, " ").replace(CONDITION, " "));
  name = tidy(String(name).replace(FILLER, " ").replace(LANGUAGE, " "));
  if (!number) name = strip(name);
  const set = tidy(strip(after).replace(RARITY, " "));

  return { name: name || raw, number, set, language, condition };
}

/** Two titles that differ only in case and spacing are one card, one search. */
export const titleKey = (title) => String(title || "").trim().replace(/\s+/g, " ").toLowerCase();

/** The plan for a title-form card: parsed, then planned like any other card. */
export function planTitleCard(raw, index = 0) {
  const title = String(raw?.title ?? "").trim();
  const parsed = parseCardTitle(title);
  const card = normaliseCard({ sku: raw?.id ?? raw?.sku ?? "", ...parsed, title }, index);
  return { plan: planCard(card), parsed, title };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

const pounds = (pence) => (pence == null ? null : Math.round(pence) / 100);

/**
 * Every sold listing fetched, in the order SoldComps returned it, each with
 * the reason it would be excluded (null when kept). Prices are as sold:
 * postage is SoldComps' figure, never the zeroed one the engine priced from.
 */
export function judgeTitleCard(plan, comps) {
  const tagged = (comps || []).map((c, i) => ({ ...c, _i: i }));
  const { included, excluded } = judgeComps(plan, tagged);
  const reasonOf = new Map();
  for (const c of included) reasonOf.set(c._i, null);
  for (const c of excluded) reasonOf.set(c._i, c.exclusionReason || "unknown");

  const sold = tagged.map((c) => {
    const s = c._source || {};
    const engine = reasonOf.has(c._i) ? reasonOf.get(c._i) : "unknown";
    return {
      price: pounds(c.itemPricePence),
      postage: pounds(c.postagePence || 0),
      date: s.endedAt || null,
      title: c.title,
      itemId: s.itemId || null,
      url: s.url || null,
      location: c.itemLocation || null, // null = a UK-domestic sale
      excluded_reason: reasonCode(engine),
      excluded_detail: engine
    };
  });
  return { sold, kept: included.length };
}

/** One card's row of the response. */
export function titleCardResult({ id, title, plan, parsed }, outcome) {
  const base = {
    id,
    title,
    query: plan ? plan.queries[0] : null,
    parsed: parsed
      ? { ...parsed, variant: plan && plan.variantKeys.length ? plan.variantKeys : [], promo: !!plan?.promo }
      : null
  };
  if (outcome.status !== "ok" && outcome.status !== "no_sales") {
    return { ...base, status: outcome.status, error: outcome.error || null, sold: [] };
  }
  const { sold, kept } = judgeTitleCard(plan, outcome.comps);
  return {
    ...base,
    status: sold.length ? "ok" : "no_sales",
    fetched_at: outcome.fetchedAt || null,
    from_cache: !!outcome.cached,
    page_full: !!outcome.pageFull,
    n_sold: sold.length,
    n_kept: kept,
    sold
  };
}

/** Is this body the title form? Every card has a title and none has a name. */
export function isTitleRequest(body) {
  const cards = body && body.cards;
  return (
    Array.isArray(cards) &&
    cards.length > 0 &&
    cards.every((c) => c && typeof c.title === "string" && !c.name && !c.cardName && !c.card_name)
  );
}
