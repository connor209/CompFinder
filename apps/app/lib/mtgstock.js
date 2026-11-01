/**
 * Comp Finder — Magic stock: one multi-quantity listing per card, the copies
 * kept chaos-sorted in stacks.
 *
 * Listing a Magic single on eBay one copy at a time is more work than the card
 * is worth, so a Magic card is ONE listing at quantity N, and the N copies
 * live wherever they happened to be filed — two in MTG-A, four in MTG-G, four
 * in MTG-AZ. Every copy is its own `stack_cards` row carrying the LISTING's
 * SKU, because an eBay order carries the listing's SKU and nothing about which
 * copy sold. Which copy to pull is then the pull sheet's decision
 * (`allocateCopies()` in copyqueue.js), made against the stacks as they stand.
 *
 * The input is a CardUploader export, unchanged. This file decides, for every
 * row of it, which card it IS and where that card is already listed:
 *
 * - **The identity is name, set, collector number, finish, condition and
 *   language.** Two copies share a listing only if a buyer could be sent
 *   either and not complain. An LP copy on an NM listing is a return; a foil
 *   on a non-foil listing is a gift; a Japanese copy is a different product.
 *   The collector number is what separates showcase, borderless and extended
 *   art printings in modern sets, which is why it is part of the key and the
 *   treatment words are not.
 *
 * - **The listing SKU is DERIVED from the identity, deterministically.** That
 *   is what makes "is this card already listed?" an exact question rather than
 *   a guess off a title: the same card always builds the same SKU, so the
 *   second file finds the listing the first file made. A short hash of the
 *   whole identity sits on the end, so two sets whose names slug the same can
 *   never share a listing — a readable prefix alone would merge them, and a
 *   merged listing ships the wrong card.
 *
 * - **The SKU never looks like a stack position.** `stackFromSku()` reads
 *   `MTG-A12` as Stack MTG-A, card 12, and the nightly auto-import would file a
 *   whole multi-quantity listing as one card at that address. Four or more
 *   segments can never parse that way, and `check-mtgstock.mjs` pins it.
 *
 * - **A row that cannot be identified is REFUSED and named, never guessed.**
 *   A missing condition or set does not fail loudly downstream — it builds a
 *   different SKU, which quietly opens a second listing for a card we already
 *   list, or worse, matches the wrong one. The whole class of fault here is
 *   something that was on screen and did not get read.
 *
 * - **A file uploaded twice adds nothing the second time.** Every copy keeps
 *   its first scan URL in `scan_url` (migration 027), and a row whose scan is
 *   already on a stack card is counted as already in stock. Without 027 that
 *   guard is unavailable, and the screen says so rather than pretending.
 *
 * - **A listing that failed to go up is finished by running the file again.**
 *   Copies of a card that sit in a stack with no listing behind them — an eBay
 *   call that fell over after the cards were filed — are folded into the next
 *   plan for that card, so the quantity of the listing it creates covers them.
 *
 * Framework-free and app-import-free (bar its siblings), so
 * check-mtgstock.mjs can load it under bare node. Nothing here touches
 * packages/core: what a card fetches on our eBay has no business changing what
 * Last Comp tells a stranger it is worth.
 */
import { GAMES } from "./games.js";

/** Every listing SKU this file builds starts with this, and nothing else's does. */
export const MTG_SKU_PREFIX = "MTG-";

/** The eBay category for CCG singles, the same default the bulk lister uses. */
export const MTG_CATEGORY_ID = "183454";

/** CardUploader's own placeholder price, on every row it writes. Not a price. */
export const PLACEHOLDER_PENCE = 249;

/** eBay's card-condition descriptors, by our condition code. */
export const CONDITION_IDS = { NM: "400010", LP: "400011", MP: "400012", HP: "400013", DMG: "400014" };
export const CONDITION_NAMES = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };

/** CardUploader's set placeholders — `*C:Set` when it could not tell. */
const GENERIC_SETS = new Set(["miscellaneous cards & products", "miscellaneous", "other", ""]);

const LANGUAGE_CODES = {
  english: "EN", japanese: "JA", german: "DE", french: "FR", italian: "IT",
  spanish: "ES", portuguese: "PT", russian: "RU", korean: "KO", chinese: "ZH",
  "chinese simplified": "ZH", "simplified chinese": "ZH",
  "chinese traditional": "ZHT", "traditional chinese": "ZHT", phyrexian: "PH"
};
const TITLE_LANGUAGES = ["Japanese", "German", "French", "Italian", "Spanish", "Portuguese", "Russian", "Korean", "Chinese", "Phyrexian"];

const MAGIC = GAMES.find((g) => g.slug === "magic");

/** Lowercase, accents off, punctuation to spaces, spaces collapsed. */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** FNV-1a, 32-bit, as six base-36 characters. Stable across runtimes. */
function hash6(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/**
 * Is this row a Magic card?
 *
 * CardUploader's `*C:Game` column first: a column that says Magic is Magic,
 * and one naming another game is not. Blank, the TITLE has to name the game
 * the way games.js reads it — "MTG" or "Magic: The Gathering", never a bare
 * "magic", which is Yu-Gi-Oh's Magic Cylinder and every Dark Magician.
 */
export function isMtgItem(item) {
  const game = String(item?.game || "").trim();
  if (game) return /\bmtg\b|\bmagic\b/i.test(game);
  return MAGIC ? MAGIC.pattern.test(String(item?.title || "")) : false;
}

/**
 * The finish, read off the title.
 *
 * The title rather than `*C:Finish`, because the import screen stores and
 * edits the title and does not store that column — so a correction made on
 * the import reaches the identity, and the same row read on two days builds
 * the same SKU. "Non-foil" is ordinary; it is removed before "foil" is looked
 * for, which keeps this free of a regex lookbehind (Safari before 16.4 throws
 * on one; check-corebrowser.mjs greps for it).
 */
export function finishOf(title) {
  const t = String(title || "").replace(/\bnon[\s-]?foil\b/gi, " ");
  if (/\betched\b/i.test(t)) return "etched";
  if (/\bfoil\b/i.test(t)) return "foil";
  return "nonfoil";
}

/** A language code: the column, then the title, then English. */
export function languageOf(item) {
  const col = norm(item?.language);
  if (col) return LANGUAGE_CODES[col] || col.replace(/\s+/g, "").slice(0, 3).toUpperCase();
  const t = String(item?.title || "");
  const named = TITLE_LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`, "i").test(t));
  return named ? LANGUAGE_CODES[named.toLowerCase()] : "EN";
}

/**
 * The collector number as a key: the numerator only ("146/249" is 146),
 * leading zeros off ("0146" is 146), letters kept ("146a" is not 146),
 * uppercase, nothing else.
 */
export function numberKey(raw) {
  const head = String(raw || "").split("/")[0].replace(/^\s*(?:no\.?|#)\s*/i, "");
  const s = head.replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^0+(?=[0-9A-Z])/, "");
  return s;
}

/**
 * Which card a CardUploader row is, or why it cannot be said.
 *
 * Returns `{ ok: true, key, sku, name, set, number, condition, finish,
 * language }` or `{ ok: false, reason }`. The reason is written to be read by
 * somebody holding the card, because they are the one who has to fix it.
 */
export function mtgIdentity(item) {
  if (!item) return { ok: false, reason: "empty row" };
  if (!isMtgItem(item)) {
    const g = String(item.game || "").trim();
    return { ok: false, reason: g ? `not a Magic card (the file says ${g})` : "not a Magic card — the title doesn't name the game and the Game column is blank" };
  }
  if (item.graded) return { ok: false, reason: "graded — a slab is a different product from the raw card" };
  const name = String(item.cardName || "").trim();
  if (!name) return { ok: false, reason: "no card name" };
  const number = numberKey(item.cardNumber);
  if (!number) return { ok: false, reason: "no collector number" };
  const set = String(item.set || "").trim();
  if (GENERIC_SETS.has(set.toLowerCase())) return { ok: false, reason: "no set — CardUploader couldn't identify it; correct it on the import first" };
  const condition = String(item.condition || "").trim().toUpperCase();
  if (!CONDITION_IDS[condition]) return { ok: false, reason: "no condition — a copy is only interchangeable with another of the same condition" };
  const finish = finishOf(item.title);
  const language = languageOf(item);

  const key = [norm(name), norm(set), number, finish, condition, language].join("|");
  const nameSlug = norm(name).replace(/\s+/g, "").toUpperCase().slice(0, 12) || "CARD";
  const parts = [MTG_SKU_PREFIX + nameSlug, number.slice(0, 6), condition];
  if (finish === "foil") parts.push("F");
  if (finish === "etched") parts.push("E");
  if (language !== "EN") parts.push(language);
  parts.push(hash6(key));
  return { ok: true, key, sku: parts.join("-"), name, set, number, condition, finish, language };
}

/**
 * Is this one of OUR multi-quantity Magic SKUs?
 *
 * The test the pull sheet uses to decide that copies of a SKU are
 * interchangeable and may be picked by stack. Four or more dash segments after
 * the prefix: `MTG-A12`, a game-tagged stack position, never qualifies.
 */
export function isMtgListingSku(sku) {
  const s = String(sku || "").trim().toUpperCase();
  return s.startsWith(MTG_SKU_PREFIX) && /^MTG(?:-[A-Z0-9]+){4,}$/.test(s);
}

/** How many physical copies a row stands for. A blank or silly quantity is one. */
export function copiesOf(item) {
  const n = parseInt(String(item?.quantity ?? ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 1;
}

/** A row's own price in pence, or null when it is blank or the placeholder. */
export function filePricePence(item) {
  const n = Number(String(item?.startPrice ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const p = Math.round(n * 100);
  return p === PLACEHOLDER_PENCE ? null : p;
}

/**
 * Could an existing listing whose SKU is NOT ours be this card?
 *
 * Offered on screen as a choice, never acted on by itself — a listing made
 * by hand says what its seller typed, and a title is not evidence about the
 * object. Every word of the name, the collector number as a whole word, the
 * same finish, and — only when the title states one — the same condition.
 */
export function titleCouldBe(title, id) {
  const t = norm(title);
  if (!t) return false;
  const words = new Set(t.split(" "));
  for (const w of norm(id.name).split(" ")) if (w && !words.has(w)) return false;
  const num = id.number.toLowerCase();
  const nums = t.split(" ").map((w) => w.replace(/^0+(?=[0-9a-z])/, ""));
  if (!nums.includes(num)) return false;
  if (finishOf(title) !== id.finish) return false;
  const stated = conditionInTitle(title);
  if (stated && stated !== id.condition) return false;
  return true;
}

function conditionInTitle(title) {
  const t = String(title || "");
  if (/\b(?:nm|near\s*mint|m\/nm|nm\/m)\b/i.test(t)) return "NM";
  if (/\b(?:lp|lightly\s*played|ex|excellent)\b/i.test(t)) return "LP";
  if (/\b(?:mp|moderately\s*played|played)\b/i.test(t)) return "MP";
  if (/\b(?:hp|heavily\s*played)\b/i.test(t)) return "HP";
  if (/\b(?:dmg|damaged|poor)\b/i.test(t)) return "DMG";
  return null;
}

const lc = (s) => String(s || "").trim().toLowerCase();

/**
 * The plan for one file.
 *
 *   items       CardUploader rows (extractItems / restoreItems shape)
 *   listings    our `ebay_listings` rows: { ebay_item_id, sku, title, quantity }
 *   stackCards  our `stack_cards` rows: { id, sku, ebay_item_id, scan_url,
 *               pulled_at, checked_out_at }
 *   scanGuard   false when `scan_url` could not be read (027 pending)
 *
 * Returns:
 *   groups   one per card: { id, rows, copies, scans[], action, listing,
 *            candidates[], orphans, pricePence, title, images[], reason? }
 *              action  "add"     — a listing for this card exists; add to it
 *                      "create"  — none does; list it at quantity `copies`
 *                      "ambiguous" — two of our listings carry this SKU
 *   refused  [{ item, reason }]   rows that could not be identified
 *   already  [item]               rows whose scan is already on a stack card
 */
export function planMtgIntake({ items = [], listings = [], stackCards = [], scanGuard = true } = {}) {
  const refused = [];
  const already = [];
  const knownScans = new Set();
  if (scanGuard) for (const c of stackCards) if (c?.scan_url) knownScans.add(String(c.scan_url));

  // The listings, by SKU. A listing we made a moment ago may not have been
  // synced into ebay_listings yet, but its copies already carry its item id —
  // so the stack is asked as well, or the next file would list the card twice.
  const listingsBySku = new Map();
  const addListing = (sku, row) => {
    const k = lc(sku);
    if (!k) return;
    if (!listingsBySku.has(k)) listingsBySku.set(k, new Map());
    const m = listingsBySku.get(k);
    const id = String(row.ebay_item_id || "");
    if (id && !m.has(id)) m.set(id, row);
  };
  for (const l of listings) if (l?.sku && l?.ebay_item_id) addListing(l.sku, l);
  for (const c of stackCards) {
    if (c?.sku && c?.ebay_item_id && !c.pulled_at && isMtgListingSku(c.sku)) {
      addListing(c.sku, { ebay_item_id: String(c.ebay_item_id), sku: c.sku, title: c.title || "", quantity: null, fromStack: true });
    }
  }

  // Copies already filed under one of our SKUs with no listing behind them.
  const orphanCount = new Map();
  for (const c of stackCards) {
    if (!c?.sku || c.pulled_at || c.checked_out_at || !isMtgListingSku(c.sku)) continue;
    if (c.ebay_item_id) continue;
    const k = lc(c.sku);
    orphanCount.set(k, (orphanCount.get(k) || 0) + 1);
  }

  const groups = new Map();
  const seenScans = new Set();
  for (const item of items) {
    const id = mtgIdentity(item);
    if (!id.ok) { refused.push({ item, reason: id.reason }); continue; }
    const scan = (item.images || [])[0] || null;
    if (scan && (knownScans.has(scan) || seenScans.has(scan))) { already.push(item); continue; }
    if (scan) seenScans.add(scan);
    if (!groups.has(id.key)) groups.set(id.key, { id, rows: [], copies: 0, scans: [] });
    const g = groups.get(id.key);
    g.rows.push(item);
    const n = copiesOf(item);
    g.copies += n;
    // One scan per COPY; a quantity-2 row has two copies and one photograph,
    // and only the first copy may claim it or the guard would refuse the
    // second copy of the very row that brought it in.
    for (let i = 0; i < n; i++) g.scans.push(i === 0 ? scan : null);
  }

  const out = [];
  for (const g of groups.values()) {
    const k = lc(g.id.sku);
    const ours = [...(listingsBySku.get(k)?.values() || [])];
    const prices = [...new Set(g.rows.map(filePricePence).filter((p) => p != null))];
    const first = g.rows[0];
    const base = {
      id: g.id,
      rows: g.rows,
      copies: g.copies,
      scans: g.scans,
      title: String(first.title || "").trim().slice(0, 80),
      images: (first.images || []).slice(0, 2),
      pricePence: prices.length === 1 ? prices[0] : null,
      priceConflict: prices.length > 1,
      orphans: 0,
      candidates: [],
      listing: null
    };
    if (ours.length > 1) {
      out.push({ ...base, action: "ambiguous", reason: `${ours.length} listings carry ${g.id.sku} — end the extra one on eBay first`, listings: ours });
      continue;
    }
    if (ours.length === 1) {
      out.push({ ...base, action: "add", listing: ours[0], orphans: orphanCount.get(k) || 0 });
      continue;
    }
    const candidates = listings.filter((l) => l?.ebay_item_id && !isMtgListingSku(l.sku) && titleCouldBe(l.title, g.id));
    out.push({ ...base, action: "create", orphans: orphanCount.get(k) || 0, candidates });
  }
  out.sort((a, b) => a.id.name.localeCompare(b.id.name) || a.id.key.localeCompare(b.id.key));
  return { groups: out, refused, already };
}

/**
 * The listing a "create" sends: title, price, the copies AND any orphans as
 * its quantity, the first copy's scans, and the item specifics eBay's CCG
 * category asks for. The photograph is of one copy; the description says it
 * is representative, which is the honest version of a multi-quantity listing
 * of copies that are interchangeable by construction.
 */
export function listingFor(group, { pricePence, title, description = "", defaults = {} } = {}) {
  const id = group.id;
  const finishName = id.finish === "foil" ? "Foil" : id.finish === "etched" ? "Etched Foil" : "Regular";
  const cond = CONDITION_NAMES[id.condition];
  const desc = description ||
    `${title}\n\nCondition: ${cond}. ${finishName === "Regular" ? "Non-foil" : finishName}.` +
    `\n\nThe photograph is of one copy; every copy on this listing is the same card in the same condition.` +
    `\n\nSent in a penny sleeve and top-loader. Happy to combine postage.`;
  return {
    title: String(title || group.title || "").slice(0, 80),
    sku: id.sku,
    price: Number(pricePence) / 100,
    quantity: group.copies + (group.orphans || 0),
    conditionId: CONDITION_IDS[id.condition],
    categoryId: defaults.categoryId || MTG_CATEGORY_ID,
    postcode: defaults.postcode || "",
    location: defaults.postcode || "United Kingdom",
    shippingService: defaults.shippingService || "UK_RoyalMailSecondClassStandard",
    shippingCost: Number(defaults.shippingCost) || 0,
    returnsDays: defaults.returnsDays ?? "30",
    dispatchDays: defaults.dispatchDays || "3",
    description: desc,
    imageUrls: group.images,
    specifics: [
      { name: "Game", value: "Magic: The Gathering" },
      { name: "Card Name", value: id.name },
      { name: "Set", value: id.set },
      { name: "Card Number", value: id.number },
      { name: "Finish", value: finishName },
      { name: "Card Condition", value: cond },
      { name: "Language", value: languageName(id.language) }
    ]
  };
}

function languageName(code) {
  const hit = Object.entries(LANGUAGE_CODES).find(([, c]) => c === code);
  if (!hit) return code;
  return hit[0].replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * The stack rows a group files, in order, at the back of the chosen stack.
 * Every copy carries the LISTING's SKU — ours, or the SKU of the hand-made
 * listing it was added to — because that is what an order will carry.
 */
export function stackRowsFor(group, { sku, stackId, userId, startPosition, itemId = null, withScan = true }) {
  const rows = [];
  for (let i = 0; i < group.copies; i++) {
    const row = {
      user_id: userId,
      stack_id: stackId,
      position: startPosition + i,
      sku,
      title: group.title,
      ebay_item_id: itemId
    };
    if (withScan && group.scans[i]) row.scan_url = group.scans[i];
    rows.push(row);
  }
  return rows;
}

/** One line for a refused row: which card, and why. */
export function refusedLabel({ item, reason }) {
  const what = [item?.cardName || item?.title || item?.sku || "a row", item?.cardNumber].filter(Boolean).join(" ");
  return `${what}: ${reason}`;
}
