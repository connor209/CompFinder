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
import { detectVariants, finishFixedFor, fixedFinishTitle, nameWithoutVariants, queryWordsFor, subjectTextFor, variantExclusion, variantLabel } from "./variants.js";
import { housePrice, houseTotal, resolveRules, conditionCode } from "./house-pricing.js";
import { UNPRICED_PENCE } from "./zero-price.js";

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
    variant: strip(pick("variant", "finish", "printing")),
    variantKeys,
    condition: strip(pick("condition")),
    language: strip(pick("language")) || "English",
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

/**
 * Everything decided about a card before any request is made: what it is,
 * the queries that will be sent, and the settings its comps are judged by.
 */
export function planCard(card) {
  const english = !card.language || /^english$/i.test(card.language);
  const promo = isPromoCard({ number: card.number, set: card.set });
  const number = promo ? promoNumber(card.number) : strip(card.number);
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
  const baseName = nameWithoutVariants(card.name).replace(/\[[^\]]*\]/g, " ").replace(/\s{2,}/g, " ").trim() || card.name;
  const setUsable = card.set && !GENERIC_SET.has(card.set.toLowerCase());
  // A promo's code already names its set, and "Black and White Promos" is
  // nowhere in how anybody titles one — in the query it only shrinks the page.
  const setForQuery = setUsable && !promo ? plain(card.set) : "";
  const langWord = english ? "" : card.language;

  const compose = (withSet) =>
    [baseName, queryWordsFor(keys), number, withSet ? setForQuery : "", langWord]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const queries = [compose(true)];
  if (setForQuery) queries.push(compose(false));

  // The text the engine's subject readers see. Variant words that core reads
  // itself (reverse, stamped) are written in so its reading and ours agree.
  const subjectText = [baseName, number, subjectTextFor(keys), card.title, langWord].filter(Boolean).join(" ");
  const settings = settingsForText(subjectText, { promo });

  const nameTokens = appNameTokens(
    CompFinderPricing.simplifyTitle([baseName, promo ? "" : stripNumberingPrefix(number)].filter(Boolean).join(" "), settings.stripWords)
  );

  return {
    card,
    english,
    promo,
    number,
    baseName,
    variantKeys: keys,
    variantExplicit: Array.isArray(card.variantKeys),
    unrecognisedVariant: unrecognised,
    set: setUsable ? card.set : null,
    queries,
    settings,
    nameTokens,
    condition: conditionCode(card.condition)
  };
}

// ---------------------------------------------------------------------------
// Which comps are the card
// ---------------------------------------------------------------------------

function compKey(c) {
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

/**
 * The two app-side rules, ahead of the engine: the promo number and the
 * variant. Both return the comp with an `exclusionReason` rather than
 * dropping it, so nothing leaves quietly.
 */
export function prefilterComps(plan, comps) {
  const kept = [];
  const excluded = [];
  const ours = plan.promo ? promoNumberPattern(plan.number) : null;
  const anyCode = plan.promo ? anyPromoOfPrefix(plan.number) : null;
  const fixed = finishFixedFor(plan.variantKeys || []);
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
    const v = variantExclusion(t, plan.variantKeys, plan.baseName);
    if (v) {
      excluded.push({ ...c, exclusionReason: v.reason, exclusionDetail: variantLabel(v.variant) });
      continue;
    }
    kept.push(fixed ? fixedFinishTitle(c) : c);
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
    title: c._title ?? c.title,
    item_id: s.itemId || null,
    url: s.url || null
  };
}

function spreadIsWide(totals, ratio) {
  if (totals.length < 2) return false;
  const s = [...totals].sort((a, b) => a - b);
  if (s.length < 4) return s[0] > 0 && s[s.length - 1] / s[0] >= ratio + 1;
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  return q1 > 0 && q3 / q1 >= ratio;
}

/**
 * A card's whole answer from the comps its searches returned.
 *
 * `fetch` describes what was asked: the queries actually sent, whether a page
 * came back full, and when the data was fetched.
 */
export function evaluateCard(plan, comps, fetch = {}, rulesIn) {
  const rules = resolveRules(rulesIn);
  const pre = prefilterComps(plan, comps);
  const guarded = numberGuards(plan, pre.kept);
  const forEngine = dropForeignPostage(guarded.kept).comps;
  const rec = CompFinderPricing.recommend(forEngine, plan.settings, plan.nameTokens, "sold", plan.number || null, plan.set);

  const included = rec.included || [];
  const excludedAll = [...pre.excluded, ...guarded.excluded, ...(rec.excluded || [])];
  const nonUk = excludedAll.filter((c) => c.exclusionReason === "nonUkLocation").length;

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
    // Only when the variant was GUESSED: a card the caller said is the base
    // card (variant_keys: []) has answered the question this flag asks.
    (!plan.variantExplicit && plan.variantKeys.length === 0 && wrongVariant > 0 && wrongVariant >= included.length) ||
    (plan.variantKeys.length > 0 && included.length === 0 && missingVariant > 0);

  const n = included.length;
  const flags = {
    few_comps: n < rules.minCompsForPercentile,
    variant_uncertain: variantUncertain,
    wide_spread: spreadIsWide(house.totals, CompFinderPricing.DEFAULT_SETTINGS.wideSpreadQ3Q1Ratio),
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
    sales: included.map((c) => saleOut(c, rules)).sort((a, b) => String(b.date).localeCompare(String(a.date))),
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
    engine_price: pounds(rec.finalPence),
    confidence: rec.confidence,
    flags,
    notes,
    current_price: pounds(plan.card.currentPence)
  };
}

/**
 * What this card is LISTED at in the UK right now, judged by the same rules as
 * the sold comps (variant, promo number, graded, lots, foreign…). Evidence for
 * the guard only — an asking price never sets a price here.
 */
export function askingEvidence(plan, activeComps, rulesIn) {
  const rules = resolveRules(rulesIn);
  const pre = prefilterComps(plan, activeComps);
  const guarded = numberGuards(plan, pre.kept);
  const rec = CompFinderPricing.recommend(dropForeignPostage(guarded.kept).comps, plan.settings, plan.nameTokens, "active", plan.number || null, plan.set);
  const totals = (rec.included || []).map((c) => houseTotal(c, rules)).sort((a, b) => a - b);
  if (!totals.length) return { medianGbp: null, n: 0 };
  const m = Math.floor(totals.length / 2);
  const med = totals.length % 2 ? totals[m] : (totals[m - 1] + totals[m]) / 2;
  return { medianGbp: Math.round(med) / 100, n: totals.length };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The price a card may be LISTED at: the suggestion, unless the guard held it.
 * A result the guard never saw (an error row, a direct evaluateCard call) falls
 * back to the suggestion.
 */
export function listablePence(r) {
  return "listable_pence" in r ? r.listable_pence : r.suggested_pence;
}

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
 * sku,suggested_price — the two columns CardUploader needs. The price is the
 * LISTABLE one: a card the guard held (price-guard.js) is written 0.00 too.
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
    const lp = listablePence(r);
    const pence = lp == null ? UNPRICED_PENCE : lp;
    lines.push(`${csvCell(r.sku)},${(pence / 100).toFixed(2)}`);
  }
  return lines.join("\n") + "\n";
}

/** The SKUs written at 0.00, so a caller can refuse to upload until they're priced. */
export function unpricedSkus(results) {
  return results.filter((r) => listablePence(r) == null).map((r) => r.sku || `#${r.index + 1}`);
}
