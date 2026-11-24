/**
 * The catalogue rows a card has to be matched against (lib/cm-match.js
 * matchCatalog). The one place the matching read is written, shared by the
 * price guide route and the lab's catalogue link, so the two can never match
 * a card differently.
 *
 * A non-English card is read by its PRINTED SET CODE (lib/japanese-sets.js:
 * "Pokemon Card 151" → sv2a; a promo numbered 007/SV-P → SV-P), never by the
 * set's English name. Learned 2026-11-24 on the first link of the lab: all 41
 * cards that failed were Japanese — Cardmarket files its Japanese sets under
 * its own names, so the name read found nothing; and where the name DID exist
 * in English (White Flare, Black Bolt) the Japanese numbering landed on a
 * different English card, which the name guard rightly refused. A code read
 * can only return that set's own cards.
 */
import { japaneseSetCode } from "./japanese-sets.js";

const escape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const COLS = "cardmarket_id,name,collector_number,expansion,expansion_code";

/** English, or the card's language as written. */
const isEnglish = (language) => !language || /^english$/i.test(String(language).trim());

/** The printed code a non-English card's set is read by, or "". */
export function setCodeFor(card = {}) {
  if (isEnglish(card.language)) return "";
  const promo = String(card.number || "").match(/\/\s*([A-Za-z]{1,4}\d*-P)\s*$/);
  if (promo) return promo[1].toUpperCase();
  return card.setCode || japaneseSetCode(card.set) || "";
}

/** The key a card's rows are filed under: its code when it has one, else its set name. */
export function lookupKey(card = {}) {
  const code = setCodeFor(card);
  return code ? `code:${code.toLowerCase()}` : `set:${String(card.set || "").trim().toLowerCase()}`;
}

/**
 * Rows for every card, one read per distinct set (or code). Returns
 * Map(lookupKey → rows | { error }); read a card's with rows.get(lookupKey(card)).
 */
export async function catalogRowsForCards(sb, cards) {
  const wanted = new Map();
  for (const c of cards || []) {
    const k = lookupKey(c);
    if (k === "set:" || wanted.has(k)) continue;
    wanted.set(k, k.startsWith("code:") ? { code: setCodeFor(c) } : { set: String(c.set).trim() });
  }
  const out = new Map();
  await Promise.all([...wanted].map(async ([k, w]) => {
    const q = sb.from("card_catalog").select(COLS);
    const { data, error } = await (w.code ? q.ilike("expansion_code", escape(w.code)) : q.ilike("expansion", escape(w.set))).limit(3000);
    // A code read answers for the card's own set, whatever Cardmarket names it,
    // so the rows are re-labelled with the name the matcher compares against.
    out.set(k, error ? { error: error.message } : (data || []).map((r) => (w.code ? { ...r, expansion: `code:${w.code}` } : r)));
  }));
  return out;
}

/** The set name the matcher should compare a card's rows by (see the re-label above). */
export function matchSetFor(card = {}) {
  const code = setCodeFor(card);
  return code ? `code:${code}` : card.set;
}

/** One read per set name (English cards). Kept for callers that only have names. */
export async function catalogRowsForSets(sb, setNames) {
  const m = await catalogRowsForCards(sb, (setNames || []).map((set) => ({ set })));
  const bySet = new Map();
  for (const [k, v] of m) bySet.set(k.slice(4), v);
  return bySet;
}
