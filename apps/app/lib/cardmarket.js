/**
 * Cardmarket stock — Magic singles kept in a chaos sort, sold only on
 * Cardmarket, picked from a daily order file.
 *
 * The physical system, as it is run (decided 2026-11-11):
 *
 * - Cards are scanned in CardUploader 50 at a time and stored in SCAN ORDER
 *   behind a divider. Dividers run A, B … Z, AA, AB … like spreadsheet
 *   columns, and every load starts on a fresh divider — a part-filled one is
 *   never topped up.
 * - In the app a divider is a stack named `MTG-<letters>` (the Yu-Gi-Oh
 *   stacks are `YGO-A`; same convention, `stackFromSku()` already reads
 *   `MTG-C37`). The boxes are in their own part of the office, and the prefix
 *   keeps them apart in the app the same way.
 * - A card's SKU (`MTG-C37`) is a NAME, assigned at load and never changed. Its
 *   position is a LIVE count: these are unsleeved, unlabelled cards, so when
 *   card 12 goes the card that was 37th is physically the 36th you count to.
 *   That is `liveRanks()` in stackpos.js, the same rule every stack follows.
 *
 * Nothing here is listed on eBay, so a Cardmarket stack is not a stack an
 * eBay screen may reason about: Reconcile would call every card in it "not
 * listed", and a filing plan would put a returned Pokémon card behind an MTG
 * divider. `isCardmarketStack()` is the one test, and those screens ask it.
 *
 * Matching is on Cardmarket's PRODUCT ID, the one field all three files carry
 * (`cardmarketId` in CardUploader and TCG PowerTools, `Product ID` in the
 * order export). Nothing else survives the trip: names grow a back face
 * ("Emeritus of Ideation // Ancestral Recall"), sets are renamed ("Magic 2015
 * (M15)" / "Magic 2015"), collector numbers change (the timeshifted Spined
 * Sliver is 101 in one file and 0 in the other). Two copies that agree on
 * product, condition, finish, language, signed and altered are the same
 * article to the buyer, so either may be sent — the pick list sends you to
 * the one nearest the front.
 *
 * Framework-free and import-free, so check-cardmarket.mjs loads it under bare
 * node and toploader.js can import it without a cycle.
 */

export const CARDMARKET_PREFIX = "MTG-";
export const DIVIDER_SIZE = 50;

/** Cardmarket's grades, best first. */
export const CM_GRADES = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

/**
 * Our grade to Cardmarket's, from the house conditioning guide (Granite City
 * Collectables, Part A + B, decided 2026-11-11). Read off what each of OUR
 * grades allows, not off a US-to-EU conversion chart:
 *
 *   NM  → NM  fewer than three wear points, close look only. Never MT: our NM
 *             is "not pack-fresh" by its own wording.
 *   LP  → EX  light flaws, none severe, no crease, bend or dent.
 *   MP  → GD  all-round or corner wear, NO crease of any kind (B1). Cardmarket's
 *             "Light Played" allows bends and minor creases, so ours is better.
 *   HP  → LP  a bend, dent or short crease, still intact (B1). Cardmarket's
 *             "Light Played" is this, whatever the name suggests.
 *   DMG → PO  "not a playable copy". Cardmarket's PL implies it still plays.
 *
 * So "LP" means two different things in this workflow, and every screen that
 * shows a grade says whose it is.
 *
 * This is the ONLY conversion. The app writes the file TCG PowerTools imports
 * with the grades already in Cardmarket's terms (`tcgptImportCsv`), so the
 * listing tool converts nothing and cannot disagree with the pick list. A
 * card's Cardmarket grade is worked out from OUR grade every time it is
 * needed, never read back from a stored copy, so changing this table can
 * never strand the cards already loaded under the old one.
 */
export const CU_TO_CM = { NM: "NM", LP: "EX", MP: "GD", HP: "LP", DMG: "PO" };

/** Our grades, best first. */
export const HOUSE_GRADES = ["NM", "LP", "MP", "HP", "DMG"];

export function cmCondition(code) {
  return CU_TO_CM[String(code || "").trim().toUpperCase()] || null;
}

const norm = (s) => String(s ?? "").trim();
const truthy = (v) => /^(true|1|yes|x)$/i.test(norm(v));

// ── dividers ─────────────────────────────────────────────────────────────────

/** Is this a Cardmarket divider? Takes a stack row ({ name }) or a bare name. */
export function isCardmarketStack(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  return /^MTG-[A-Z]+$/i.test(norm(name));
}

/** "MTG-AC" → "AC". Null for anything that is not a divider. */
export function dividerLetters(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  const m = norm(name).match(/^MTG-([A-Z]+)$/i);
  return m ? m[1].toUpperCase() : null;
}

/** A=1 … Z=26, AA=27 — spreadsheet columns. 0 for anything else. */
export function letterIndex(letters) {
  const s = norm(letters).toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 0;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 → A, 26 → Z, 27 → AA. */
export function lettersOf(n) {
  let s = "";
  let k = Math.floor(n);
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

/** The divider after the last one in use, or A. Every load starts fresh. */
export function nextDivider(stacks) {
  let max = 0;
  for (const s of stacks || []) max = Math.max(max, letterIndex(dividerLetters(s)));
  return lettersOf(max + 1);
}

/** Walking order: A before B before Z before AA. */
export function compareDividers(a, b) {
  return letterIndex(dividerLetters(a)) - letterIndex(dividerLetters(b));
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Rows of cells. Quotes, doubled quotes, CRLF and a byte-order mark — the TCG
 * PowerTools export starts with one, and a header read through it names its
 * first column "﻿cardmarketId", which is a column that never matches.
 */
export function parseCsvText(text, delimiter = ",") {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function byHeader(rows) {
  const head = (rows[0] || []).map((h) => norm(h));
  const at = (name) => head.indexOf(name);
  return { head, at };
}

/** A price as Cardmarket writes it in either locale: "1.9" or "1,9". */
export function parsePrice(raw) {
  const t = norm(raw).replace(/[€£\s]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ── 1. the load: a CardUploader Magic export ─────────────────────────────────

const CU_REQUIRED = ["quantity", "name", "set", "condition", "language", "cardmarketId"];

/**
 * A CardUploader Magic export, one physical card per entry, in scan order.
 *
 * A row's quantity is expanded into that many cards, since each is a card in
 * the box. A row with no product id is KEPT, unmatchable and counted: it is
 * still a card behind the divider, and dropping it would shift every card
 * after it by one.
 */
export function parseCardUploaderMtg(text) {
  const rows = parseCsvText(text, ",");
  const { head, at } = byHeader(rows);
  const missing = CU_REQUIRED.filter((c) => at(c) < 0);
  if (rows.length === 0) return { cards: [], error: "The file is empty." };
  if (missing.length) {
    return { cards: [], error: `This doesn't look like a CardUploader Cardmarket export — no ${missing.join(", ")} column. Export with the Cardmarket format.` };
  }
  const cell = (r, name) => (at(name) >= 0 ? norm(r[at(name)]) : "");
  const cards = [];
  let noProduct = 0;
  let oddCondition = 0;
  for (const r of rows.slice(1)) {
    if (r.length < head.length / 2) continue;
    const qty = Math.max(1, parseInt(cell(r, "quantity"), 10) || 1);
    const productId = parseInt(cell(r, "cardmarketId"), 10) || null;
    const condition = cell(r, "condition").toUpperCase();
    const card = {
      productId,
      name: cell(r, "name"),
      set: cell(r, "set"),
      cn: cell(r, "cn"),
      rarity: cell(r, "rarity"),
      condition,
      cmCondition: cmCondition(condition),
      language: cell(r, "language") || "English",
      foil: truthy(cell(r, "isFoil")),
      signed: truthy(cell(r, "isSigned")),
      altered: false,
      firstEd: truthy(cell(r, "isFirstEd"))
    };
    if (!productId) noProduct += qty;
    if (!card.cmCondition) oddCondition += qty;
    for (let i = 0; i < qty; i++) cards.push(card);
  }
  return { cards, noProduct, oddCondition, error: null };
}

/**
 * Deal the cards behind fresh dividers, 50 each, starting at `start`.
 * Refused, rather than merged, if any divider it needs already exists.
 */
export function planLoad(cards, { start, stacks = [], size = DIVIDER_SIZE } = {}) {
  const first = letterIndex(start);
  if (!first) return { dividers: [], error: "The starting divider must be letters only — A, B … AA." };
  const n = Math.ceil((cards || []).length / size);
  const taken = new Set((stacks || []).map((s) => dividerLetters(s)).filter(Boolean));
  const dividers = [];
  for (let d = 0; d < n; d++) {
    const letters = lettersOf(first + d);
    if (taken.has(letters)) {
      return { dividers: [], error: `Divider MTG-${letters} already has cards in the app. Every load starts on a fresh divider — start at MTG-${nextDivider(stacks)} or later.` };
    }
    const slice = cards.slice(d * size, (d + 1) * size);
    dividers.push({
      letters,
      name: `${CARDMARKET_PREFIX}${letters}`,
      cards: slice.map((card, i) => ({ ...card, position: i + 1, sku: `${CARDMARKET_PREFIX}${letters}${i + 1}` }))
    });
  }
  return { dividers, error: null };
}

/** FNV-1a over the file, so the same export is never loaded twice. */
export function fileFingerprint(text) {
  const s = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The `stack_cards.cm` object for a loaded card. One shape, written here. */
export function cmFields(card, fingerprint) {
  return {
    product_id: card.productId,
    name: card.name,
    set: card.set,
    cn: card.cn || null,
    condition: card.condition,
    cm_condition: card.cmCondition,
    language: card.language,
    foil: !!card.foil,
    signed: !!card.signed,
    altered: !!card.altered,
    file: fingerprint || null
  };
}

/** What the app calls the card — read on Stacks and the stack checker. */
export function cmTitle(card) {
  return [card.name, card.set ? `(${card.set})` : "", card.condition, card.foil ? "Foil" : "", card.language && card.language !== "English" ? card.language : ""]
    .filter(Boolean).join(" ");
}

/**
 * The file TCG PowerTools imports: the CardUploader export exactly as it came,
 * with the condition column rewritten into Cardmarket's grades. Every other
 * column and the row order are untouched, so it imports as the original did.
 * A grade the table does not know is left as it was and counted — TCG
 * PowerTools will then convert it itself, which the listing check reports.
 */
export function tcgptImportCsv(text) {
  const rows = parseCsvText(text, ",");
  const ci = (rows[0] || []).map(norm).indexOf("condition");
  if (ci < 0) return { csv: "", unknown: 0, error: "No condition column." };
  let unknown = 0;
  const out = rows.map((r, i) => {
    if (i === 0) return r;
    const g = cmCondition(r[ci]);
    if (!g) { unknown += 1; return r; }
    const copy = r.slice();
    copy[ci] = g;
    return copy;
  });
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return { csv: out.map((r) => r.map(q).join(",")).join("\n") + "\n", unknown, error: null };
}

/** The import file's name: the CardUploader one, marked. */
export function tcgptImportName(name) {
  const base = String(name || "carduploader.csv").replace(/\.csv$/i, "");
  return `${base}-cardmarket-grades.csv`;
}

// ── the article key ──────────────────────────────────────────────────────────

/** Same article to the buyer: product, grade, finish, language, signed, altered. */
export function articleKey({ productId, condition, foil, signed, altered, language }) {
  return [productId || "?", condition || "?", foil ? "F" : "-", signed ? "S" : "-", altered ? "A" : "-", norm(language).toLowerCase() || "?"].join("|");
}

/** Everything but the grade — the near miss when a listing's grade was moved. */
export function looseKey({ productId, foil, signed, altered, language }) {
  return [productId || "?", foil ? "F" : "-", signed ? "S" : "-", altered ? "A" : "-", norm(language).toLowerCase() || "?"].join("|");
}

/** A stack card as an article, from its `cm` column. Null without one. */
export function articleOfCard(card) {
  const cm = card?.cm;
  if (!cm || !cm.product_id) return null;
  return {
    productId: cm.product_id,
    condition: cmCondition(cm.condition),
    foil: !!cm.foil, signed: !!cm.signed, altered: !!cm.altered,
    language: cm.language || "English"
  };
}

// ── 2. the day's orders: Cardmarket's "ArticlesInPaidOrders" ─────────────────

/**
 * The export's header row is not a header. Its first cell is the category,
 * the fourth a count ("3 Articles") and the seventh the total ("4.81") — all
 * three change with every file. So columns are read by POSITION, and the two
 * cells that do not change are checked, so a Cardmarket redesign is refused
 * loudly instead of picking the wrong card quietly.
 */
const PO = { seq: 0, productId: 1, qty: 2, name: 3, localized: 4, expansion: 5, price: 6, comment: 7, condition: 8, rarity: 9, cn: 10, language: 11, orderId: 12, foil: 13, signed: 14, altered: 15 };

export function parsePaidOrders(text) {
  const raw = String(text || "");
  const delimiter = (raw.split(/\r?\n/)[0] || "").includes(";") ? ";" : ",";
  const rows = parseCsvText(raw, delimiter);
  if (rows.length === 0) return { lines: [], error: "The file is empty." };
  const head = rows[0].map(norm);
  if (head[PO.productId] !== "Product ID" || head[PO.orderId] !== "Order ID" || head.length < 16) {
    return { lines: [], error: "This isn't Cardmarket's paid-orders export (ArticlesInPaidOrders) — its columns aren't where they should be. If Cardmarket has changed the file, nothing has been matched." };
  }
  const lines = [];
  for (const r of rows.slice(1)) {
    const productId = parseInt(norm(r[PO.productId]), 10) || null;
    const orderId = norm(r[PO.orderId]);
    if (!productId || !orderId) continue;
    lines.push({
      seq: parseInt(norm(r[PO.seq]), 10) || null,
      productId,
      quantity: Math.max(1, parseInt(norm(r[PO.qty]), 10) || 1),
      name: norm(r[PO.name]),
      expansion: norm(r[PO.expansion]),
      price: parsePrice(r[PO.price]),
      comment: norm(r[PO.comment]),
      condition: norm(r[PO.condition]).toUpperCase(),
      cn: norm(r[PO.cn]),
      language: norm(r[PO.language]) || "English",
      orderId,
      foil: truthy(r[PO.foil]),
      signed: truthy(r[PO.signed]),
      altered: truthy(r[PO.altered])
    });
  }
  return { lines, error: null };
}

/**
 * Which card in the box answers each unit sold.
 *
 * `cards` is every card in the Cardmarket dividers, PULLED ONES INCLUDED:
 * a card committed from an earlier upload carries the order it went to
 * (`cm.order_id`), and those units are counted as done. Without that, the
 * same file uploaded twice would send you for a second copy of every card.
 *
 * Copies are taken front first (lowest divider, lowest position): any copy is
 * correct, and the front is the least counting.
 *
 * There is no near miss. The grade is converted in one place, so a sale in a
 * grade the box does not hold is a listing somebody changed by hand, and the
 * card in the box is not the card that buyer paid for. It is reported as
 * unmatched, with the grades the box DOES hold that product in, so the
 * listing can be found and put right.
 */
export function matchOrders(lines, cards, stacks) {
  const stackOrder = new Map((stacks || []).map((s) => [s.id, letterIndex(dividerLetters(s))]));
  const front = (a, b) =>
    (stackOrder.get(a.stack_id) || 0) - (stackOrder.get(b.stack_id) || 0) ||
    (a.position ?? 0) - (b.position ?? 0) ||
    String(a.id).localeCompare(String(b.id));

  const exact = new Map();
  const loose = new Map();
  const committed = new Map();
  for (const c of cards || []) {
    const art = articleOfCard(c);
    if (!art) continue;
    if (c.pulled_at) {
      if (c.cm?.order_id) {
        const k = `${c.cm.order_id}|${looseKey(art)}`;
        committed.set(k, (committed.get(k) || 0) + 1);
      }
      continue;
    }
    if (c.checked_out_at) continue;
    const k = articleKey(art);
    if (!exact.has(k)) exact.set(k, []);
    exact.get(k).push(c);
    const lk = looseKey(art);
    if (!loose.has(lk)) loose.set(lk, []);
    loose.get(lk).push(c);
  }
  for (const list of exact.values()) list.sort(front);

  const used = new Set();
  const take = (list) => {
    const c = (list || []).find((x) => !used.has(x.id));
    if (c) used.add(c.id);
    return c || null;
  };

  const picks = [];
  const unmatched = [];
  let done = 0;
  for (const l of lines || []) {
    const art = { productId: l.productId, condition: l.condition, foil: l.foil, signed: l.signed, altered: l.altered, language: l.language };
    const ck = `${l.orderId}|${looseKey(art)}`;
    let units = l.quantity;
    const already = Math.min(units, committed.get(ck) || 0);
    if (already) {
      committed.set(ck, (committed.get(ck) || 0) - already);
      done += already;
      units -= already;
    }
    for (let u = 0; u < units; u++) {
      const card = take(exact.get(articleKey(art)));
      if (card) picks.push({ line: l, card });
      else {
        const others = (loose.get(looseKey(art)) || []).filter((x) => !used.has(x.id));
        const grades = [...new Set(others.map((x) => x.cm?.condition).filter(Boolean))];
        unmatched.push({ line: l, boxGrades: grades });
      }
    }
  }
  return { picks, unmatched, done };
}

/**
 * The walk. Divider by divider in letter order, each one FRONT TO BACK, with
 * the number each card is at right now — the way the eBay pull sheet reads.
 * The divider's whole stack comes out and is counted through in the hand, so
 * a card taken out on the way is still counted past; the numbers only close
 * up when the picks are ticked and Mark pulled saves them. (Deepest first was
 * tried, for pulling one card at a time off a stack left standing, and it is
 * not how this stock is picked — decided 2026-11-12.) `ranks` is
 * `liveRanks()` over the same cards (passed in, so this file imports
 * nothing).
 */
export function walkOrder(picks, stacks, ranks) {
  const byStack = new Map();
  for (const p of picks || []) {
    const id = p.card.stack_id;
    if (!byStack.has(id)) byStack.set(id, []);
    byStack.get(id).push({ ...p, rank: ranks?.get(p.card.id) ?? null });
  }
  const named = new Map((stacks || []).map((s) => [s.id, s]));
  return [...byStack.entries()]
    .map(([id, rows]) => ({ stackId: id, name: named.get(id)?.name || "?", rows: rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) }))
    .sort((a, b) => compareDividers(a.name, b.name));
}

/** One pile per Cardmarket order, numbered as Cardmarket numbers them. */
export function pilesOf(picks) {
  const map = new Map();
  for (const p of picks || []) {
    const id = p.line.orderId;
    if (!map.has(id)) map.set(id, { orderId: id, seq: p.line.seq, picks: [] });
    map.get(id).picks.push(p);
  }
  return [...map.values()].sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.orderId.localeCompare(b.orderId));
}

/** What a committed pick writes back onto the card's `cm`. */
export function pulledCm(card, line) {
  return { ...(card.cm || {}), order_id: line.orderId, sold_price: line.price ?? null, sold_condition: line.condition };
}

// ── 3. the check: a TCG PowerTools stock export ──────────────────────────────

/** TCG PowerTools leaves this where autoprice found nothing. */
export const PLACEHOLDER_PRICE = 1000;

export function parseTcgptExport(text) {
  const rows = parseCsvText(text, ",");
  const { at } = byHeader(rows);
  if (rows.length === 0) return { rows: [], error: "The file is empty." };
  if (at("cardmarketId") < 0 || at("condition") < 0 || at("price") < 0) {
    return { rows: [], error: "This doesn't look like a TCG PowerTools stock export — no cardmarketId, condition or price column." };
  }
  const cell = (r, name) => (at(name) >= 0 ? norm(r[at(name)]) : "");
  const out = [];
  for (const r of rows.slice(1)) {
    const productId = parseInt(cell(r, "cardmarketId"), 10) || null;
    if (!productId) continue;
    out.push({
      productId,
      quantity: Math.max(1, parseInt(cell(r, "quantity"), 10) || 1),
      name: cell(r, "name"),
      set: cell(r, "set"),
      condition: cell(r, "condition").toUpperCase(),
      language: cell(r, "language") || "English",
      foil: truthy(cell(r, "isFoil")),
      signed: truthy(cell(r, "isSigned")),
      altered: false,
      price: parsePrice(cell(r, "price"))
    });
  }
  return { rows: out, error: null };
}

/**
 * Is every card in the box for sale, as the card it is?
 *
 * - `unlisted`: in the box, not in the export at all.
 * - `damaged`: the same, for our DMG cards. Kept apart and not called a
 *   problem: a DMG card is listed only when it is worth enough (decided
 *   2026-11-11), which is TCG PowerTools' floor price deciding, not a fault.
 * - `regraded`: listed in a grade other than the one the table gives it —
 *   TCG PowerTools converted it again, or it was edited by hand.
 * - `placeholder`: listed at TCG PowerTools' 1000, or with no price — autoprice
 *   found nothing and the listing kept the import's stand-in.
 * - `elsewhere`: listed copies the box does not hold. Counted, not listed: the
 *   export covers the whole Cardmarket account, which may hold stock that was
 *   never loaded here.
 */
export function checkListings(cards, rows) {
  const box = new Map();
  const boxLoose = new Map();
  for (const c of cards || []) {
    if (c.pulled_at || c.checked_out_at) continue;
    const art = articleOfCard(c);
    if (!art) continue;
    const k = articleKey(art);
    if (!box.has(k)) box.set(k, { art, name: c.cm?.name || c.title, condition: c.cm?.condition, count: 0, skus: [] });
    const b = box.get(k);
    b.count += 1;
    if (c.sku) b.skus.push(c.sku);
    const lk = looseKey(art);
    boxLoose.set(lk, (boxLoose.get(lk) || 0) + 1);
  }
  const listed = new Map();
  const listedLoose = new Map();
  const placeholder = [];
  for (const r of rows || []) {
    const k = articleKey(r);
    listed.set(k, (listed.get(k) || 0) + r.quantity);
    if (box.has(k) && (r.price == null || r.price >= PLACEHOLDER_PRICE)) placeholder.push(r);
    const lk = looseKey(r);
    if (!listedLoose.has(lk)) listedLoose.set(lk, new Map());
    const g = listedLoose.get(lk);
    g.set(r.condition, (g.get(r.condition) || 0) + r.quantity);
  }
  const unlisted = [];
  const damaged = [];
  const regraded = [];
  // A grade listed beyond what the box holds in that grade is where a moved
  // grade went; spend it once.
  const spare = new Map();
  for (const [lk, grades] of listedLoose) {
    for (const [g, n] of grades) {
      const inBox = [...box.values()].filter((b) => looseKey(b.art) === lk && b.art.condition === g).reduce((s, b) => s + b.count, 0);
      if (n > inBox) spare.set(`${lk}|${g}`, n - inBox);
    }
  }
  // Shortfalls are matched to spare listings most-likely-cause first. Within
  // one product, a box grade whose LETTERS are the listed grade wins (our LP
  // put up as Cardmarket LP is the conversion a tool makes by default), then
  // the nearest grade on Cardmarket's scale. First-come would hand a spare LP
  // listing to the DMG copy as readily as to the LP one.
  const shorts = [];
  for (const [k, b] of box) {
    const short = b.count - (listed.get(k) || 0);
    if (short > 0) shorts.push({ b, left: short });
  }
  const rank = (g) => CM_GRADES.indexOf(g);
  const pairs = [];
  for (const sh of shorts) {
    const lk = looseKey(sh.b.art);
    for (const g of (listedLoose.get(lk) || new Map()).keys()) {
      if (!(spare.get(`${lk}|${g}`) > 0)) continue;
      const sameLetters = sh.b.condition === g ? 0 : 1;
      pairs.push({ sh, g, sk: `${lk}|${g}`, cost: sameLetters * 100 + Math.abs(rank(g) - rank(sh.b.art.condition)) });
    }
  }
  pairs.sort((x, y) => x.cost - y.cost);
  for (const p of pairs) {
    const n = Math.min(p.sh.left, spare.get(p.sk) || 0);
    if (n <= 0) continue;
    regraded.push({ name: p.sh.b.name, boxCondition: p.sh.b.condition, listedAs: p.g, count: n, skus: p.sh.b.skus });
    spare.set(p.sk, spare.get(p.sk) - n);
    p.sh.left -= n;
  }
  for (const { b, left } of shorts) {
    if (left > 0) (b.condition === "DMG" ? damaged : unlisted).push({ name: b.name, condition: b.condition, count: left, skus: b.skus });
  }
  let elsewhere = 0;
  for (const [k, n] of listed) elsewhere += Math.max(0, n - (box.get(k)?.count || 0));
  elsewhere -= regraded.reduce((s, r) => s + r.count, 0);
  return { unlisted, damaged, regraded, placeholder, elsewhere: Math.max(0, elsewhere) };
}

// ── 4. the stock list ────────────────────────────────────────────────────────

/**
 * Prices to save from a TCG PowerTools export, one per article. A listing is
 * one article at one price, but the export can carry the same article twice
 * (two listings of one card); the LOWER price is kept, so a stock value is
 * never flattered by the dearer of two asks. Placeholder and missing prices
 * are not prices and are left out. Returns [{ article_key, price }].
 */
export function pricesFromExport(rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (r.price == null || r.price <= 0 || r.price >= PLACEHOLDER_PRICE) continue;
    const k = articleKey(r);
    if (!best.has(k) || r.price < best.get(k)) best.set(k, r.price);
  }
  return [...best.entries()].map(([article_key, price]) => ({ article_key, price }));
}

/**
 * The stock list: cards still in the box, identical copies folded into one
 * row. A row is one ARTICLE (the key a sale is matched on), so the count on it
 * is how many a buyer could order and the price is the listing's.
 *
 * `ranks` is liveRanks() over the same cards, so a location reads the same as
 * the pick list's. `prices` is Map<article_key, { price, priced_at }>. A card
 * with no product id still has a row — it is in the box — and no key.
 */
export function stockRows(cards, stacks, ranks, prices) {
  const named = new Map((stacks || []).map((s) => [s.id, s.name]));
  const groups = new Map();
  for (const c of cards || []) {
    if (c.pulled_at) continue;
    const cm = c.cm || {};
    const art = articleOfCard(c);
    const key = art ? articleKey(art) : `card:${c.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        hasKey: !!art,
        name: cm.name || c.title || "",
        set: cm.set || "",
        cn: cm.cn || "",
        grade: cm.condition || "",
        cmGrade: art?.condition || null,
        foil: !!cm.foil,
        language: cm.language || "English",
        copies: []
      });
    }
    groups.get(key).copies.push({
      id: c.id,
      sku: c.sku,
      divider: named.get(c.stack_id) || "?",
      rank: c.checked_out_at ? null : ranks?.get(c.id) ?? null,
      away: !!c.checked_out_at
    });
  }
  const out = [];
  for (const g of groups.values()) {
    g.copies.sort((a, b) => compareDividers(a.divider, b.divider) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
    const p = g.hasKey ? prices?.get(g.key) : null;
    out.push({
      ...g,
      count: g.copies.length,
      dividers: [...new Set(g.copies.map((x) => x.divider))],
      price: p ? Number(p.price) : null,
      pricedAt: p?.priced_at || null,
      value: p ? Math.round(Number(p.price) * g.copies.length * 100) / 100 : null
    });
  }
  return out;
}

/** "MTG-B 2, 9 · MTG-D 31" — where each copy is right now. */
export function locationText(row) {
  const by = new Map();
  for (const c of row.copies) {
    if (!by.has(c.divider)) by.set(c.divider, []);
    by.get(c.divider).push(c.away ? "away" : c.rank ?? "?");
  }
  return [...by.entries()].map(([d, ns]) => `${d} ${ns.join(", ")}`).join(" · ");
}

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Search (every word must appear in the name or set) and the filters, AND-ed. */
export function filterStock(rows, { q = "", divider = "", grade = "", foil = "" } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return (rows || []).filter((r) => {
    if (divider && !r.dividers.includes(divider)) return false;
    if (grade && r.grade !== grade) return false;
    if (foil === "foil" && !r.foil) return false;
    if (foil === "plain" && r.foil) return false;
    if (!words.length) return true;
    const hay = fold(`${r.name} ${r.set} ${r.cn}`);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Sorts. A row with no price sorts LAST in both value directions: treating it
 * as zero would head the cheapest-first view with the cards nobody has priced,
 * the same rule the Show Desk's away list follows.
 */
export function sortStock(rows, sort = "name") {
  const list = (rows || []).slice();
  const byName = (a, b) => a.name.localeCompare(b.name) || a.set.localeCompare(b.set) || HOUSE_GRADES.indexOf(a.grade) - HOUSE_GRADES.indexOf(b.grade);
  const priced = (dir) => (a, b) => {
    if (a.value == null && b.value == null) return byName(a, b);
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return dir * (a.value - b.value) || byName(a, b);
  };
  if (sort === "value-desc") return list.sort(priced(-1));
  if (sort === "value-asc") return list.sort(priced(1));
  if (sort === "location") {
    return list.sort((a, b) => compareDividers(a.copies[0].divider, b.copies[0].divider) || (a.copies[0].rank ?? 1e9) - (b.copies[0].rank ?? 1e9));
  }
  if (sort === "count") return list.sort((a, b) => b.count - a.count || byName(a, b));
  return list.sort(byName);
}

/**
 * Totals over rows. Unpriced copies are COUNTED, never valued at zero — a
 * total that silently treats them as worthless is the flattering-by-omission
 * kind of wrong.
 */
export function stockTotals(rows) {
  let cards = 0;
  let priced = 0;
  let unpriced = 0;
  let value = 0;
  let oldest = null;
  for (const r of rows || []) {
    cards += r.count;
    if (r.value == null) unpriced += r.count;
    else {
      priced += r.count;
      value += r.value;
      if (r.pricedAt && (!oldest || r.pricedAt < oldest)) oldest = r.pricedAt;
    }
  }
  return { cards, priced, unpriced, value: Math.round(value * 100) / 100, oldestPrice: oldest };
}

/** Per divider: cards in it now and what the priced ones come to. */
export function dividerTotals(rows) {
  const by = new Map();
  for (const r of rows || []) {
    for (const c of r.copies) {
      if (!by.has(c.divider)) by.set(c.divider, { divider: c.divider, cards: 0, value: 0, unpriced: 0 });
      const d = by.get(c.divider);
      d.cards += 1;
      if (r.price == null) d.unpriced += 1;
      else d.value = Math.round((d.value + r.price) * 100) / 100;
    }
  }
  return [...by.values()].sort((a, b) => compareDividers(a.divider, b.divider));
}

/** What went: pulled cards, newest first, with the order and price they carry. */
export function soldRows(cards, stacks) {
  const named = new Map((stacks || []).map((s) => [s.id, s.name]));
  return (cards || [])
    .filter((c) => c.pulled_at)
    .map((c) => ({
      id: c.id,
      sku: c.sku,
      divider: named.get(c.stack_id) || "?",
      name: c.cm?.name || c.title || "",
      set: c.cm?.set || "",
      grade: c.cm?.condition || "",
      soldGrade: c.cm?.sold_condition || null,
      orderId: c.cm?.order_id || null,
      price: c.cm?.sold_price ?? null,
      pulledAt: c.pulled_at
    }))
    .sort((a, b) => String(b.pulledAt).localeCompare(String(a.pulledAt)));
}
