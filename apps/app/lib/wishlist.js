/**
 * Comp Finder — a visitor's wish list on the storefront.
 *
 * Somebody browses our stock on their phone, taps ♡ on what they like, and at
 * the table shows us one screen: every card they picked, with its picture, its
 * price and a total. That screen replaces "the Gengar, no, the other one,
 * page four I think" — which is the request flow docs/SHOW_STOREFRONT.md
 * deferred, without any of what made it expensive.
 *
 * **It lives on the visitor's phone and nowhere else.** No table, no route, no
 * name or number collected: the storefront stays read-only, a stranger's
 * choices are theirs, and nothing on our side has to be held or justified.
 * localStorage, keyed by the link's own path, so two shows' lists never mix
 * and the list dies with the link.
 *
 * **What is kept is a snapshot, and the live card wins.** Card keys on the
 * storefront are positions ("box-3"), which move the moment stock changes, so
 * an item is keyed on what the card IS — its section and its name. On every
 * render the list is matched back to the cards on screen: a card still there
 * shows its CURRENT price, and one not seen this visit keeps its saved price
 * and says so (see reconcileWishlist()).
 *
 * **A snapshot is an allow-list too.** It is built key by key from a
 * projected card, which is already public, so nothing private can reach it;
 * built key by key anyway, because a spread would carry whatever the card
 * grows next.
 *
 * Framework-free, so scripts/check-storefront.mjs can load it under bare node.
 */
import { normalise } from "./showfilter.js";
import { counterPrice } from "./showcounter.js";

/** Enough for a real haul; not enough for a list to be the whole binder. */
export const WISHLIST_MAX = 60;

export const WISH_FIELDS = ["id", "source", "name", "set", "condition", "pricePence", "priceText", "priceFrom", "image", "addedAt"];

/** What a card IS, stable across reloads: its section and its name. */
export function wishKey(card) {
  const name = normalise(card?.name);
  return name ? `${card?.source === "online" ? "online" : "box"}:${name}` : "";
}

/** The storage key for one link's list. The path carries the token; nothing else does. */
export function wishStorageKey(path) {
  return `cf-wish:${String(path || "").split("?")[0]}`;
}

/** One card, as the list keeps it. */
export function wishItem(card, now = Date.now()) {
  const pence = card?.pricePence == null || !Number.isFinite(Number(card.pricePence)) ? null : Math.round(Number(card.pricePence));
  return {
    id: wishKey(card),
    source: card?.source === "online" ? "online" : "box",
    name: String(card?.name || "Card"),
    set: card?.set ? String(card.set) : null,
    condition: card?.condition ?? null,
    pricePence: pence,
    priceText: counterPrice(pence),
    priceFrom: Boolean(card?.priceFrom),
    image: card?.image || null,
    addedAt: now
  };
}

/** Anything that came back from storage, cleaned; junk is dropped rather than drawn. */
export function cleanWishlist(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    const item = wishItem(it, Number(it.addedAt) || 0);
    item.id = it.id;
    out.push(item);
    if (out.length >= WISHLIST_MAX) break;
  }
  return out;
}

export function hasWish(list, card) {
  const id = wishKey(card);
  return Boolean(id) && (list || []).some((it) => it.id === id);
}

/** Add or remove, newest first. A full list refuses rather than dropping the oldest. */
export function toggleWish(list, card, now = Date.now()) {
  const id = wishKey(card);
  if (!id) return { list: list || [], added: false, full: false };
  const cur = list || [];
  if (cur.some((it) => it.id === id)) return { list: cur.filter((it) => it.id !== id), added: false, full: false };
  if (cur.length >= WISHLIST_MAX) return { list: cur, added: false, full: true };
  return { list: [wishItem(card, now), ...cur], added: true, full: false };
}

export function removeWish(list, id) {
  return (list || []).filter((it) => it.id !== id);
}

/**
 * The list against the cards as they stand now.
 *
 * Each row is the live card when there is one — current price, current
 * picture — and otherwise the snapshot. With `complete` (the cards are the
 * whole stock, as the desk's binder is) a card that is not there has GONE: no
 * price in the total, since we would be quoting a figure for a card we may no
 * longer have.
 *
 * The storefront is not complete. It holds only the cards this visit has
 * been shown — the front page and whatever was searched — because the list
 * never leaves the phone, so the server cannot be asked about it. A card not
 * among those is UNCHECKED rather than gone: it keeps the price it was saved
 * at and says so, and the desk's scan (matchWishCodes) is what finds a card
 * that has really gone.
 */
export function reconcileWishlist(list, cards, { complete = true } = {}) {
  const live = new Map();
  for (const c of cards || []) {
    const id = wishKey(c);
    if (id && !live.has(id)) live.set(id, c);
  }
  const rows = (list || []).map((it) => {
    const card = live.get(it.id);
    if (!card) return complete ? { ...it, gone: true, unchecked: false, card: null } : { ...it, gone: false, unchecked: true, card: null };
    return { ...wishItem(card, it.addedAt), id: it.id, gone: false, unchecked: false, card };
  });
  const priced = rows.filter((r) => !r.gone && r.pricePence != null);
  return {
    rows,
    count: rows.length,
    available: rows.filter((r) => !r.gone).length,
    gone: rows.filter((r) => r.gone).length,
    unchecked: rows.filter((r) => r.unchecked).length,
    ask: rows.filter((r) => !r.gone && r.pricePence == null).length,
    // "from" prices are the cheapest copy, so the total is a floor when any is.
    totalPence: priced.reduce((n, r) => n + r.pricePence, 0),
    totalFrom: priced.some((r) => r.priceFrom)
  };
}

/** Read and write, wrapped: private mode, full storage and old browsers all say no. */
export function loadWishlist(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return cleanWishlist(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function saveWishlist(storage, key, list) {
  try {
    if (!list || list.length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// --- Handing the list to us: a QR on their screen, scanned by our phone ----
//
// The list never leaves the visitor's phone by any network. What it CAN do is
// show a QR that our phone scans, and the QR carries the list itself — so the
// storefront stays read-only and nothing is stored anywhere but the two
// screens. It opens the Show Desk (behind our login), which knows what the
// storefront does not: where each copy is, and how to put it in a deal.
//
// Each card goes as a short hash of its wishKey rather than its name. A name
// is up to 64 characters and a list is up to sixty cards; hashed, a full list
// is a QR a phone reads off another phone's screen in a glance. The desk
// hashes its own pockets the same way and matches. The hash is of a card name
// already on a public page, so nothing private rides in the URL either way.

/** Where the handoff lands. The desk slug, behind the app's login. */
export const WISH_HANDOFF_PATH = "/panel/shows";

/** FNV-1a, 32-bit, base36: one card's code, at most seven characters. */
export function wishCode(id) {
  let h = 0x811c9dc5;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The codes for a list's cards that are still in the binder, in list order. */
export function wishCodes(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.gone || !r.id) continue;
    const c = wishCode(r.id);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The URL the visitor's QR carries. */
export function wishHandoffUrl(origin, codes) {
  const list = (codes || []).slice(0, WISHLIST_MAX).join(".");
  return `${String(origin || "").replace(/\/+$/, "")}${WISH_HANDOFF_PATH}?wish=${list}`;
}

/** The codes out of a `wish=` value, junk refused rather than guessed at. */
export function parseWishCodes(value) {
  const out = [];
  for (const raw of String(value || "").split(".")) {
    const c = raw.trim().toLowerCase();
    if (/^[0-9a-z]{1,7}$/.test(c) && !out.includes(c)) out.push(c);
    if (out.length >= WISHLIST_MAX) break;
  }
  return out;
}

/**
 * The codes against the desk's own binder, in the visitor's order.
 *
 * `cards` are binder pockets — the desk's, carrying copy ids it can resolve to
 * its own rows. A code that matches nothing is a card that has gone since the
 * visitor tapped ♡, and is counted rather than dropped. Two pockets sharing a
 * code (a 32-bit collision, or one name in both sections) both come back:
 * showing us one card too many is harmless; hiding the one they meant is not.
 */
export function matchWishCodes(codes, cards) {
  const byCode = new Map();
  for (const c of cards || []) {
    const id = wishKey(c);
    if (!id) continue;
    const code = wishCode(id);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(c);
  }
  const matched = [];
  const missing = [];
  for (const code of codes || []) {
    const hit = byCode.get(code);
    if (hit) matched.push(...hit);
    else missing.push(code);
  }
  return { matched, missing };
}
