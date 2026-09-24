/**
 * Comp Finder — a visitor's wish list on the storefront.
 *
 * Somebody flips the binder on their phone, taps ♡ on what they like, and at
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
 * render the list is matched back to the binder: a card still there shows its
 * CURRENT price, and one that has gone (sold, returned, re-priced out of the
 * box) says so rather than quoting a figure we no longer stand behind.
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
 * The list against the binder as it stands now.
 *
 * Each row is the live card when there is one — current price, current
 * picture — and the snapshot marked `gone` when there is not. A gone card has
 * no price in the total: we would be quoting a figure for a card we may no
 * longer have.
 */
export function reconcileWishlist(list, cards) {
  const live = new Map();
  for (const c of cards || []) {
    const id = wishKey(c);
    if (id && !live.has(id)) live.set(id, c);
  }
  const rows = (list || []).map((it) => {
    const card = live.get(it.id);
    if (!card) return { ...it, gone: true, card: null };
    return { ...wishItem(card, it.addedAt), id: it.id, gone: false, card };
  });
  const priced = rows.filter((r) => !r.gone && r.pricePence != null);
  return {
    rows,
    count: rows.length,
    available: rows.filter((r) => !r.gone).length,
    gone: rows.filter((r) => r.gone).length,
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
