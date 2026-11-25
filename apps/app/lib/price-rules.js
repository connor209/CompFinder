/**
 * Your rules for one card: "these sales aren't this card".
 *
 * Asked for 2026-11-25, after a plain card's auto price came back built on
 * prerelease-STAMPED sales — the engine only drops a stamped sale from a plain
 * card's pool when it says "prerelease"; "stamp", "stamped" and "staff" get
 * through (the mirror of the stamped-card rule, left unmeasured on purpose —
 * see CLAUDE.md). A rule is per CARD: set on one, kept, and applied wherever
 * that card is priced through the house route — Add copies, the pricing
 * queue, the Batch screen's house rules — so the correction is made once.
 *
 * A rule is a list of KINDS the app can recognise in a sale's title, plus any
 * words you type, plus a note in your own words. The note is for people; the
 * kinds and words are what the filter can act on. A word in the card's OWN
 * name never excludes anything ("Staff of Nin" can't lose its sales to "no
 * staff stamps"), and a word must stand on its own ("stamp" is not "unstamped").
 *
 * Pure and framework-free: lib/batch-comps.js (the server's filter),
 * lib/lab-draft.js (re-filtering a row's sales at once, no new search) and
 * scripts/check-pricerules.mjs all load it.
 */

export const RULE_KINDS = [
  // Lookahead, never lookbehind (Safari < 16.4). "Stamped addressed envelope"
  // is postage, and "not stamped" is a seller saying the opposite — the same
  // two readings core's isStampedTitle() refuses.
  { key: "stamped", label: "Stamped", hint: "stamp, stamped, staff, prerelease", pattern: /\bpre[\s-]?release\b|\bstamp(?:ed)?\b(?!\s+(?:addressed|envelope|sae))|\bstaff\b/i,
    unless: /\b(?:not|non|un)[\s-]?stamped\b|\bno\s+stamp\b/i },
  { key: "graded", label: "Graded / slab", hint: "PSA, CGC, BGS, SGC, slab, graded", pattern: /\b(?:psa|cgc|bgs|beckett|sgc|slab(?:bed)?|graded)\b/i },
  { key: "lot", label: "Lot / bundle", hint: "lot, bundle, playset, x4", pattern: /\b(?:lot|bundle|playset|joblot)\b|\bx\s?\d+\b|\b\d+\s?x\b/i },
  { key: "language", label: "Other language", hint: "Japanese, Korean, Chinese, German, French…", pattern: /\b(?:japanese|jpn|korean|chinese|german|deutsch|french|français|italian|spanish|portuguese)\b/i },
  { key: "reverse", label: "Reverse holo", hint: "reverse, rev holo", pattern: /\brev(?:erse)?\b/i },
  // A holo sale when your copy isn't (2026-11-25: a Camerupt rule meant for
  // "Holo" titles only ever caught "reverse"). "Non-holo" and "reverse holo"
  // are not holo copies, so they never trip it.
  { key: "holo", label: "Holo", hint: "holo, holofoil — not non-holo or reverse holo", pattern: /\bholo(?:foil|graphic)?\b/i,
    unless: /\bnon[\s-]?holo|\brev(?:erse)?[\s-]*holo/i },
  { key: "nonHolo", label: "Non-holo", hint: "non-holo, non holo", pattern: /\bnon[\s-]?holo\b/i },
  { key: "firstEdition", label: "1st Edition", hint: "1st edition, first edition", pattern: /\b(?:1st|first)\s*ed(?:ition|\.)?\b/i }
];
const KIND = Object.fromEntries(RULE_KINDS.map((k) => [k.key, k]));
export const MAX_WORDS = 8;

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which card a rule belongs to: name, number, set, printing and language, the
 * way the house route reads a card (normaliseCard in batch-comps.js). Never
 * the condition — a stamped copy is no more this card in NM than in LP.
 * Accepts the server's card ({ name, number, set, variant, language }) and an
 * Add copies row ({ cardName, cardNumber, set, card: { finish }, language }).
 */
export function ruleKeyFor(c = {}) {
  const name = c.name ?? c.cardName;
  const number = c.number ?? c.cardNumber;
  const variant = c.variant ?? c.card?.finish ?? "";
  const language = c.language || "English";
  const num = norm(number).replace(/\b0+(\d)/g, "$1");
  return ["v1", norm(name), num, norm(c.set), norm(variant), norm(language)].join("|");
}

/** A rule as stored: known kinds only, words trimmed and capped, a note. */
export function normaliseRule(input = {}) {
  const kinds = [...new Set((input.kinds || []).filter((k) => KIND[k]))];
  const words = [...new Set((input.words || []).map((w) => norm(w)).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, MAX_WORDS);
  const note = String(input.note ?? "").trim().slice(0, 500);
  return { kinds, words, note };
}

export const isEmptyRule = (r) => !r || (!(r.kinds || []).length && !(r.words || []).length);

/** "no stamped · no 'shadowless'" — what a rule does, in words. */
export function describeRule(r) {
  if (isEmptyRule(r)) return "";
  return [...(r.kinds || []).map((k) => `no ${KIND[k]?.label.toLowerCase() || k}`), ...(r.words || []).map((w) => `no "${w}"`)].join(" · ");
}

/** A word as a whole-word pattern: "stamp" never matches "unstamped". */
function wordPattern(w) {
  const left = /^\w/.test(w) ? "\\b" : "";
  const right = /\w$/.test(w) ? "\\b" : "";
  return new RegExp(`${left}${escape(w)}${right}`, "i");
}

/**
 * Does this sale break the rule? Returns what it tripped ("stamped",
 * 'word "shadowless"') or null. A match that is part of the card's own name
 * is ignored — the rule is about what else a title says.
 */
export function saleBreaksRule(title, rule, cardName = "") {
  if (isEmptyRule(rule)) return null;
  const t = String(title || "");
  // Take the card's own name out of the title before looking, so a word in
  // the name can never trip the rule.
  const own = norm(cardName);
  const rest = own ? norm(t).split(own).join(" ") : norm(t);
  for (const k of rule.kinds || []) {
    const kind = KIND[k];
    if (kind && kind.pattern.test(rest) && !(kind.unless && kind.unless.test(rest))) return kind.label.toLowerCase();
  }
  for (const w of rule.words || []) {
    if (wordPattern(w).test(rest)) return `"${w}"`;
  }
  return null;
}

/** The rules a server read hands back, as Map ruleKey → rule. */
export function rulesByKey(rows) {
  const m = new Map();
  for (const r of rows || []) if (r?.card_key) m.set(r.card_key, normaliseRule({ kinds: r.kinds, words: r.words, note: r.note }));
  return m;
}

/**
 * A feedback comment carrying the rule, so scripts/export-feedback.mjs can
 * count which kinds people keep adding — the evidence a rule for EVERY card
 * would be argued from. "[rule: stamped, word:shadowless] the note".
 */
export function ruleComment(rule) {
  const tags = [...(rule.kinds || []), ...(rule.words || []).map((w) => `word:${w}`)];
  return `[rule: ${tags.join(", ")}]${rule.note ? ` ${rule.note}` : ""}`.slice(0, 500);
}

/** The tags back out of a feedback comment, for the export's tally. */
export function ruleTagsFromComment(comment) {
  const m = String(comment || "").match(/^\[rule: ([^\]]*)\]/);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Why one SALE isn't this card — a note on an automated pick you unticked
 * (Add copies → see sales → "why not?"). The note stays on the batch row
 * beside the sale and goes to feedback; a reason that is also a rule kind can
 * become this card's rule in the same step. Keys are stored: add, don't rename.
 */
export const SALE_REASONS = [
  { key: "stamped", label: "Stamped", kind: "stamped" },
  { key: "graded", label: "Graded / slab", kind: "graded" },
  { key: "lot", label: "Lot / bundle", kind: "lot" },
  { key: "language", label: "Other language", kind: "language" },
  { key: "reverse", label: "Reverse holo", kind: "reverse" },
  { key: "holo", label: "Holo (ours isn't)", kind: "holo" },
  { key: "nonHolo", label: "Non-holo (ours is holo)", kind: "nonHolo" },
  { key: "otherCard", label: "Different card or set" },
  { key: "condition", label: "Condition (damaged, played)" },
  { key: "price", label: "Price looks wrong" },
  { key: "other", label: "Something else" }
];
const SALE_REASON = Object.fromEntries(SALE_REASONS.map((r) => [r.key, r]));
export const saleReasonLabel = (k) => SALE_REASON[k]?.label || k || "";
export const ruleKindForReason = (k) => SALE_REASON[k]?.kind || null;

/** A note as kept on the row: a known reason, a short text, when. Null when empty. */
export function normaliseSaleNote(input = {}, at = new Date()) {
  const why = SALE_REASON[input.why] ? input.why : null;
  const text = String(input.text ?? "").trim().slice(0, 300);
  if (!why && !text) return null;
  return { why: why || "other", text, at: new Date(at).toISOString() };
}

/** The feedback comment for one sale: `[sale: stamped] text — "title" £6.29`. */
export function saleComment(note, sale = {}) {
  const total = sale.total != null ? ` £${Number(sale.total).toFixed(2)}` : "";
  return `[sale: ${note.why}]${note.text ? ` ${note.text}` : ""} — "${String(sale.title || "").slice(0, 200)}"${total}`.slice(0, 500);
}

/** The reason back out of a sale comment, for the export's tally. */
export function saleTagFromComment(comment) {
  const m = String(comment || "").match(/^\[sale: ([^\]]*)\]/);
  return m ? m[1].trim() : null;
}
