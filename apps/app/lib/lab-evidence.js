/**
 * The sales behind a price, laid out to be interrogated (Add copies → open a
 * row → Sales found). A thin card is where the rules are least sure and you
 * are most useful: you can see "that £22 one is a lot" or "that 60p one is
 * the plain copy" in a second, and the price should follow what you picked.
 *
 * Pure. The house rules are house-pricing.js's own — this file only decides
 * WHICH sales they are run over: the ones the filter counted, or the ones you
 * ticked. Nothing here talks to eBay or the database.
 */
import { housePrice, resolveRules, rulesForGame } from "./house-pricing.js";

/** Most sales kept on a row: counted ones always, left-out ones up to this. */
export const EVIDENCE_CAP = 120;

/** Short words for why a sale was left out, for a row and a table cell. */
export const REASON_SHORT = {
  yourRule: "your rule",
  stampedCopy: "stamped copy",
  nameMismatch: "different name",
  wrongNumber: "different number",
  setMismatch: "different set",
  graded: "graded",
  rawCopy: "raw copy",
  otherGrade: "other grade",
  notACard: "not a card",
  bundle: "lot",
  multiCardLot: "lot",
  pickYourOwn: "pick-your-card",
  promoVariant: "other promo",
  foreignPrint: "other language",
  notThisLanguage: "language not stated",
  plainPrinting: "plain copy",
  variantMismatch: "other printing",
  wrongVariant: "other printing",
  missingVariant: "doesn't say printing",
  nonUkLocation: "overseas seller",
  catalogMismatch: "eBay says other card",
  categoryMismatch: "eBay says other card",
  priceOutlier: "price far above",
  priceOutlierLow: "price far below",
  highPostage: "high postage",
  duplicate: "duplicate"
};

const shortOf = (reason) => REASON_SHORT[reason] || String(reason || "left out").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** A stable id for one sale: the listing, else its URL, else title + total + date. */
export function saleId(s) {
  return String(s.item_id || s.url || `${s.title}|${s.total}|${s.date || ""}`);
}

/**
 * One list of every sale a /api/batch-comps result fetched: counted first
 * (newest first), then left out, each with why. Capped, counted sales never
 * cut. `total` and `price` are pounds, as the API sends them.
 */
export function evidenceFrom(result) {
  if (!result) return [];
  const counted = (result.sales || []).map((s) => ({
    id: saleId(s), title: s.title || "", price: s.price, postage: s.postage, total: s.total,
    date: s.date || null, url: s.url || null, counted: true,
    reason: s.put_back ? (s.put_back_reason === "nonUkLocation" ? "overseas, counted" : "high postage, counted") : ""
  }));
  const out = (result.excluded || []).map((s) => ({
    id: saleId(s), title: s.title || "", price: s.price, postage: s.postage, total: s.total,
    date: s.date || null, url: s.url || null, counted: false, reasonCode: s.reason || null,
    reason: shortOf(s.reason) + (s.detail ? ` (${s.detail})` : "")
  }));
  const seen = new Set();
  const all = [];
  for (const e of [...counted, ...out]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    all.push(e);
  }
  const keep = all.filter((e) => e.counted);
  const rest = all.filter((e) => !e.counted).slice(0, Math.max(0, EVIDENCE_CAP - keep.length));
  return [...keep, ...rest];
}

/** "found 14 · counted 5 · 4 other printing · 3 language not stated" — the row's one line. */
export function evidenceSummary(evidence) {
  const list = evidence || [];
  const counted = list.filter((e) => e.counted).length;
  const why = {};
  for (const e of list) if (!e.counted) { const k = e.reason.replace(/\s*\(.*$/, ""); why[k] = (why[k] || 0) + 1; }
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`);
  return [`found ${list.length}`, `counted ${counted}`, ...top].join(" · ");
}

/** Which sales a price is run over: what you ticked, else what the filter counted. */
export function chosenSales(evidence, picks) {
  const list = evidence || [];
  if (Array.isArray(picks)) {
    const on = new Set(picks.map(String));
    return list.filter((e) => on.has(String(e.id)));
  }
  return list.filter((e) => e.counted);
}

/**
 * The house price over a choice of sales, worked out exactly as the server
 * would (house-pricing.js): totals with postage capped, p40 or the lowest
 * under four, up the ladder off the game's floor, the condition step.
 */
export function evidencePrice(evidence, picks, { condition = "NM", game = "" } = {}) {
  const chosen = chosenSales(evidence, picks);
  const rules = rulesForGame(resolveRules(), game);
  const comps = chosen.map((e) => ({
    itemPricePence: Math.round((Number(e.price) || 0) * 100),
    postagePence: Math.round((Number(e.postage) || 0) * 100)
  }));
  const h = housePrice(comps, condition, rules);
  return { n: chosen.length, method: h.method, basisPence: h.basisPence, suggestedPence: h.suggestedPence, totals: h.totals, floorPence: rules.floorPence };
}

/** Whether your picks differ from what the filter counted. */
export function picksDiffer(evidence, picks) {
  if (!Array.isArray(picks)) return false;
  const a = new Set(picks.map(String));
  const b = new Set((evidence || []).filter((e) => e.counted).map((e) => String(e.id)));
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}
