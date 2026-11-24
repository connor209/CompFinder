/**
 * One identity per card (decided 2026-11-24).
 *
 * The app had half a dozen spellings of "which card is this": stockcheck's
 * cardKey (number + a word of the name), the lab's key (name|number|set|
 * condition, plus the language), the stream box's duplicateKey, CardUploader's
 * CS- SKU, the eBay item id, and Cardmarket's own matcher run fresh on every
 * screen. Most of the bugs worth writing up lived where two of those disagreed
 * — a reverse holo read as the plain card, a Japanese copy joining the English
 * listing, the Master Ball pattern pooled with the plain Geodude.
 *
 * The anchor is the Cardmarket PRODUCT (card_catalog.cardmarket_id), matched
 * once by lib/cm-match.js and stored on the stack card (migration 045). A
 * product already tells the Master Ball pattern from the plain card. What it
 * does NOT carry is put beside it here: the printing (a reverse holo is the
 * same product, priced apart), the language, and the grade of a slab. The
 * condition is the COPY's, not the card's, and is never part of the identity.
 *
 * Pure.
 */

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const LANG_CODE = { english: "", japanese: "ja", korean: "ko", chinese: "zh", german: "de", french: "fr", italian: "it", spanish: "es", portuguese: "pt" };

/** The language part: English is nothing, so every older key is unchanged by it. */
export function languagePart(language) {
  const k = norm(language);
  if (!k || k === "english") return "";
  return LANG_CODE[k] ?? k.replace(/\s+/g, "-");
}

/** Whether the card is the reverse holo printing, read narrowly (Reverse Valley is a card). */
export function isReversePrinting(card = {}) {
  return /\brev(?:erse)?\b[\s.-]*(?:holo|foil)/i.test(`${card.finish || ""} ${card.variant || ""} ${card.title || ""}`);
}

/**
 * The identity key: "cm:<product>" plus "|rev", "|<lang>", "|g<grade>" where
 * they apply — or, for a card not linked to the catalogue, a "txt:" key from
 * its own fields, which is only ever compared with other "txt:" keys. Null
 * when there is nothing to key on.
 */
export function identityKey(card = {}) {
  const extra = [
    isReversePrinting(card) ? "rev" : "",
    languagePart(card.language),
    card.grade != null && card.grade !== "" ? `g${String(card.grade).toLowerCase().replace(/\s+/g, "")}` : ""
  ].filter(Boolean);
  const id = card.cardmarketId ?? card.cardmarket_id;
  if (id != null && id !== "") return ["cm:" + String(id), ...extra].join("|");
  const name = norm(card.name), number = norm(String(card.number || "").split("/")[0]).replace(/^0+(?=\d)/, ""), set = norm(card.set);
  if (!name || (!number && !set)) return null;
  return [`txt:${name}#${number}#${set}`, ...extra].join("|");
}

/** Whether a key is anchored on the catalogue rather than spelled from text. */
export const isLinked = (key) => typeof key === "string" && key.startsWith("cm:");

/**
 * Listings of the SAME card in the SAME condition, both still selling: the
 * copies should be on one listing (the lab joins a card to its live listing;
 * two of them means the keys disagreed when it was listed). Rows are the
 * Inventory's ({ id, identity, condition, status }). Returns Map(row id →
 * other row ids). Ended listings never count.
 */
export function duplicateListings(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || !r.identity || r.status === "ended") continue;
    const k = `${r.identity}::${String(r.condition || "").toUpperCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.id);
  }
  const out = new Map();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out.set(id, ids.filter((x) => x !== id));
  }
  return out;
}
