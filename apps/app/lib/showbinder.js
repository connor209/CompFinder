/**
 * Comp Finder — Show Binders.
 *
 * A Show Binder is a physical binder the cards LIVE in between shows. They
 * stay listed on eBay while it sits at home; before a show the whole binder is
 * checked out at once, so nothing in it can sell online while it is on a
 * table; coming back, the binder is checked IN — every card still in a pocket
 * goes back on sale, and the ones that aren't there were sold.
 *
 * Like the toploader box (lib/toploader.js) a binder is a stack with a
 * reserved name, not a table of its own. That is what makes every screen that
 * already finds a card — the pull sheet, Stacks, the counter's ⌖ locate — find
 * it in a binder with no new code, and why it needs no migration. There can be
 * several: every stack whose name starts "Show Binder" is one.
 *
 * Unlike the box, every card in it has a BINDER SKU — "B1-047", the binder's
 * code and the card's slot (binderSlot below). Slots never move, new cards go
 * at the back, and no filing plan ever chooses a binder — a card meant for a
 * stack landing in one is a card nobody finds.
 *
 * Not the same thing as lib/binder.js, which is the DIGITAL binder — the 3x3
 * pages the Show Desk turns round to a customer. That one is a way of showing
 * stock; this one is somewhere stock is kept.
 *
 * Framework-free and app-import-free, so check-showbinder.mjs can load it
 * under bare node.
 */

import { labelName } from "./showstock.js";

/** The one spelling of the prefix. Never written out anywhere else. */
export const SHOW_BINDER_PREFIX = "Show Binder";

/** Pages are still how a binder is turned: a heading every nine slots. */
export const POCKETS_PER_PAGE = 9;

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const PREFIX_RE = new RegExp(`^${SHOW_BINDER_PREFIX.toLowerCase()}(?:$|[^a-z])`);
// "Show Binder 3", "Show Binder 3 · Pokémon", "Show Binder B3 Pokémon".
const NUMBERED_RE = new RegExp(`^${SHOW_BINDER_PREFIX.toLowerCase()}\\s+b?(\\d+)\\b\\s*(?:[·\\-—:]\\s*)?(.*)$`, "i");

/**
 * Is this a Show Binder? Takes a stack row ({ name }) or a bare name.
 * "Show Binder 2" and "show binder — Pokémon" are; "Binder" and "Show
 * Binders" are not, because a stack someone happened to call that is not one
 * we should stop numbering.
 */
export function isShowBinder(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  return PREFIX_RE.test(norm(name));
}

/**
 * A binder's NUMBER, the thing its code is made of (decided 2026-10-19). It
 * lives in the name — "Show Binder 3 · Pokémon" — because a stack has no
 * column for it and a migration would be one more thing to apply by hand,
 * and ✎ Rename keeps it. So the code survives every rename, and a label
 * printed as B3-047 a month ago still names this binder.
 */
export function binderNumber(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  if (!isShowBinder(name)) return null;
  const m = NUMBERED_RE.exec(String(name).trim().replace(/\s+/g, " "));
  return m ? Number(m[1]) : null;
}

/** "B3", or null for a binder with no number yet (see codeless()). */
export function binderCode(stackOrName) {
  const n = binderNumber(stackOrName);
  return n == null ? null : `B${n}`;
}

/** Every Show Binder among a list of stacks, by number, then name. */
export function showBindersOf(stacks) {
  return (stacks || [])
    .filter((s) => isShowBinder(s))
    .sort((a, b) => (binderNumber(a) ?? Infinity) - (binderNumber(b) ?? Infinity)
      || String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
}

const nextNumber = (existingNames) =>
  Math.max(0, ...(existingNames || []).map((n) => binderNumber(n) ?? 0)) + 1;

/** "Show Binder 3" — one past the highest number already used. */
export function nextBinderName(existingNames) {
  return `${SHOW_BINDER_PREFIX} ${nextNumber(existingNames)}`;
}

/**
 * Binders that have no number — named by hand, or renamed before codes
 * existed ("Show Binder Pokémon") — each given the next free one, keeping
 * their label: [{ id, name: "Show Binder 4 · Pokémon" }]. The desk applies
 * these once and says so, because a binder with no code cannot give its
 * cards a binder SKU.
 */
export function codeless(stacks) {
  const names = (stacks || []).map((s) => s.name);
  const out = [];
  for (const b of showBindersOf(stacks)) {
    if (binderNumber(b) != null) continue;
    const n = nextNumber(names);
    const label = binderSuffix(b.name);
    const name = `${SHOW_BINDER_PREFIX} ${n}${label ? ` · ${label}` : ""}`;
    names.push(name);
    out.push({ id: b.id, name });
  }
  return out;
}

/**
 * The part of a binder's name after its code — "Pokémon" out of "Show Binder
 * 3 · Pokémon" — which is what a rename edits. The prefix and the number are
 * not offered for editing: the prefix makes the stack a binder, and the
 * number is the code on every label it has printed.
 */
export function binderSuffix(name) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!isShowBinder(n)) return n;
  const m = NUMBERED_RE.exec(n);
  if (m) return m[2].trim();
  return n.slice(SHOW_BINDER_PREFIX.length).replace(/^[\s\-—:·]+/, "").trim();
}

/**
 * The full stack name for a rename: prefix, the binder's own number, then
 * what was typed — "Show Binder 3 · Pokémon". Blank goes back to plain "Show
 * Binder 3". Typing the prefix as well is forgiven rather than doubled.
 * Returns null for a label over 40 characters or a name ANOTHER stack has
 * (case-blind) — two stacks of one name would point every screen that finds
 * a card by its stack name at the wrong one.
 */
export function renamedBinder(typed, existingNames = [], currentName = "") {
  let rest = String(typed ?? "").trim().replace(/\s+/g, " ");
  if (isShowBinder(rest)) rest = binderSuffix(rest);
  if (rest.length > 40) return null;
  const n = binderNumber(currentName) ?? nextNumber(existingNames);
  const name = `${SHOW_BINDER_PREFIX} ${n}${rest ? ` · ${rest}` : ""}`;
  const key = norm(name);
  if (key === norm(currentName)) return name;
  if ((existingNames || []).some((x) => norm(x) === key)) return null;
  return name;
}

/**
 * A card's BINDER SKU: the binder's code and its slot, "B1-047" (decided
 * 2026-10-19, replacing the p4-7 pocket labels). The slot is the card's
 * `position` in the binder and never changes: a sold or removed card leaves
 * its number behind, and NEW CARDS GO AT THE BACK — one past the highest
 * slot the binder has ever used, sold cards included, so a code on an old
 * label never comes to mean a different card. The binder sits in slot order;
 * ↻ Re-pocket A–Z is the only thing that renumbers it.
 *
 * Returns { sku, page } — the page is still a heading every nine slots, the
 * way the binder is turned at check-in — or null for a card with no slot.
 * A binder with no code yet reads "#047".
 */
export function binderSlot(stackOrName, position) {
  const n = Math.round(Number(position));
  if (!Number.isFinite(n) || n < 1) return null;
  const code = binderCode(stackOrName);
  const num = String(n).padStart(3, "0");
  return { sku: code ? `${code}-${num}` : `#${num}`, page: Math.ceil(n / POCKETS_PER_PAGE) };
}

/**
 * Slots for `count` new cards: after the back of the binder. `maxUsed` is the
 * highest position the binder has EVER held (maxPosition() reads pulled cards
 * too, which is what stops a sold card's code being reused).
 */
export function nextSlots(maxUsed, count) {
  const base = Math.max(0, Math.round(Number(maxUsed)) || 0);
  return Array.from({ length: Math.max(0, count | 0) }, (_, i) => base + 1 + i);
}

/** Slot order, then by name for a card with no slot. */
export function comparePockets(a, b) {
  const x = Number(a?.position);
  const y = Number(b?.position);
  const hx = Number.isFinite(x) && x >= 1;
  const hy = Number.isFinite(y) && y >= 1;
  if (hx && hy) return x - y;
  if (hx || hy) return hx ? -1 : 1;
  const p = norm(a?.title);
  const q = norm(b?.title);
  if (!p || !q) return (p ? 0 : 1) - (q ? 0 : 1);
  return p.localeCompare(q, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * What a card is called, for sorting A–Z by name: the label's reading of the
 * title (labelName — brackets, "Pokémon TCG" and everything after the number
 * gone), with the other games' prefixes off the front too, so "MTG Lightning
 * Bolt" files under L and "Pokemon Charizard ex" under C. Flattened so
 * "Flabébé" sorts with "Flabebe".
 */
const GAME_PREFIX = /^(?:mtg|magic(?:\s*:?\s*the\s+gathering)?|yu[\s-]?gi[\s-]?oh!?|ygo|one\s*piece|lorcana|digimon|dragon\s*ball(?:\s*super)?|card|single)\b[\s:-]*/i;
export function nameKey(title) {
  let s = labelName(title, 999);
  for (let i = 0; i < 3 && GAME_PREFIX.test(s); i++) s = s.replace(GAME_PREFIX, "");
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A–Z by card name, then the rest of the title (set, number), then SKU — so
 * every Charizard sits together and two copies always land in the same order.
 * A card with no title sorts last.
 */
export function compareByCardName(a, b) {
  const x = nameKey(a?.title);
  const y = nameKey(b?.title);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  const opt = { numeric: true, sensitivity: "base" };
  return x.localeCompare(y, undefined, opt)
    || norm(a?.title).localeCompare(norm(b?.title), undefined, opt)
    || String(a?.sku || "").localeCompare(String(b?.sku || ""), undefined, opt);
}

/** The binder view's sort choices. Pocket order is the binder as it sits. */
export const BINDER_VIEW_SORTS = [
  { key: "pocket", label: "Binder SKU order" },
  { key: "name", label: "Name A–Z" },
  { key: "price-desc", label: "Price, high first" },
  { key: "price-asc", label: "Price, low first" }
];

/**
 * binderContents() rows in the chosen order. A card with no price sorts last
 * in BOTH price directions — as £0 it would head the cheap-first list with
 * cards that have no price at all. Ties fall back to pocket order.
 */
export function sortBinderRows(rows, sort = "pocket") {
  const list = [...(rows || [])];
  const byPocket = (a, b) => comparePockets(a.card, b.card);
  const price = (dir) => (a, b) => {
    const x = a.pricePence;
    const y = b.pricePence;
    if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0) || byPocket(a, b);
    return (x - y) * dir || byPocket(a, b);
  };
  if (sort === "name") return list.sort((a, b) => compareByCardName(a.card, b.card) || byPocket(a, b));
  if (sort === "price-desc") return list.sort(price(-1));
  if (sort === "price-asc") return list.sort(price(1));
  return list.sort(byPocket);
}

/**
 * Re-pocket a binder A–Z by card name: pocket 1 is the first name
 * alphabetically, and the gaps close up. This is the one thing that moves
 * cards between pockets, and it is only ever done on a click, because every
 * move it plans is a card somebody has to pick up and put somewhere else.
 *
 * Refused while any card is away at a show: its pocket is waiting for it, and
 * re-pocketing around a card that is not there would give its slot away and
 * send it home to a pocket that has moved. Check the binder in first.
 *
 * Returns { ok: true, moves: [{ card, from, to }], order } where `order` is
 * every card in its NEW pocket order (the sheet you rearrange from) and
 * `moves` only the cards whose pocket changes; or { ok: false, away }.
 */
export function repocketPlan(cards, binderId, isAway = (c) => !!c.checked_out_at, binderName = null) {
  const inside = (cards || []).filter((c) => c && c.stack_id === binderId && !c.pulled_at);
  const away = inside.filter((c) => isAway(c));
  if (away.length) return { ok: false, away };
  const order = [...inside].sort(compareByCardName).map((card, i) => ({
    card,
    from: binderSlot(binderName, card.position),
    to: binderSlot(binderName, i + 1),
    position: i + 1
  }));
  return { ok: true, order, moves: order.filter((m) => Math.round(Number(m.card.position)) !== m.position) };
}

/**
 * How full each binder is, and how much of it is away. `cards` is stack_cards
 * rows; `isAway(card)` is the desk's own reading (isCardAway in showfilter.js)
 * so a lost flag cannot make an away card look like it is at home.
 *
 * Returns Map(binderId → { home, away }). A pulled card is gone and counts as
 * neither.
 */
export function binderCounts(binders, cards, isAway = (c) => !!c.checked_out_at) {
  const out = new Map((binders || []).map((b) => [b.id, { home: 0, away: 0 }]));
  for (const c of cards || []) {
    const n = out.get(c.stack_id);
    if (!n || c.pulled_at) continue;
    if (isAway(c)) n.away += 1;
    else n.home += 1;
  }
  return out;
}

/**
 * What is in a binder, one row per card, in page order (comparePockets).
 *
 * `cards` is stack_cards rows. `isAway(card)` is the desk's own reading, so a
 * card on a table says so even with its flag lost. `offSale(sku)` is
 * offSaleReason() over the listings: "sold", "outofstock", "notlisted" or
 * null for on sale. `priceOf(sku)` is what we ask on eBay, in pence, or null.
 *
 * Away is asked FIRST: a checked-out card's listing is hidden on purpose, so
 * its listing reads as sold out, and calling a card on a table "sold on eBay"
 * would send somebody looking for an order that does not exist. A pulled card
 * has left the binder and is not a row at all.
 *
 * Returns { rows: [{ card, status, pricePence, slot }], counts, valuePence } where
 * status is "home" | "away" | "sold" | "outofstock" | "notlisted", counts
 * keys the same, and valuePence sums the prices of cards still ours to sell
 * (home and away) — a sold card's price is not stock.
 */
export function binderContents(cards, binderId, { isAway = (c) => !!c.checked_out_at, offSale = () => null, priceOf = () => null, binderName = null } = {}) {
  const counts = { home: 0, away: 0, sold: 0, outofstock: 0, notlisted: 0 };
  let valuePence = 0;
  const rows = [];
  for (const card of cards || []) {
    if (!card || card.stack_id !== binderId || card.pulled_at) continue;
    let status = "home";
    if (isAway(card)) status = "away";
    else {
      const why = offSale(card.sku);
      if (why === "sold" || why === "outofstock" || why === "notlisted") status = why;
    }
    const p = priceOf(card.sku);
    const pricePence = Number.isFinite(p) && p > 0 ? Math.round(p) : null;
    counts[status] += 1;
    if (pricePence != null && (status === "home" || status === "away")) valuePence += pricePence;
    rows.push({ card, status, pricePence, slot: binderSlot(binderName, card.position) });
  }
  rows.sort((a, b) => comparePockets(a.card, b.card));
  return { rows, counts, valuePence };
}

/**
 * The binder's checkouts still to check in: open, SHOW pool, out of this
 * binder. The stream box never takes a binder card out, but a checkout row is
 * the one place that can say so, so it is asked.
 */
export function openFromBinder(checkouts, binderId) {
  return (checkouts || []).filter((co) =>
    co && co.stack_id === binderId && !co.resolved_at && (co.pool == null || co.pool === "show")
  );
}

/**
 * Checking a binder back in. `open` is openFromBinder(); `missing` is the set
 * of checkout ids the person holding the binder said are NOT in it.
 *
 * Every open card lands in exactly one list: `back` goes back on sale in the
 * binder, `sold` is recorded as sold at the show. Nothing is left open, which
 * is the point — a card neither relisted nor sold is a listing hidden for
 * ever. An id in `missing` that is not one of the open cards is ignored: it
 * was sold or returned from the desk since the list was drawn.
 */
export function binderCheckIn(open, missing) {
  const gone = missing instanceof Set ? missing : new Set(missing || []);
  const back = [];
  const sold = [];
  for (const co of open || []) (gone.has(co.id) ? sold : back).push(co);
  return { back, sold };
}

export default {
  SHOW_BINDER_PREFIX, isShowBinder, showBindersOf, nextBinderName,
  binderSuffix, renamedBinder, binderCounts, binderContents,
  POCKETS_PER_PAGE, binderNumber, binderCode, codeless, binderSlot, nextSlots, comparePockets,
  openFromBinder, binderCheckIn,
  nameKey, compareByCardName, BINDER_VIEW_SORTS, sortBinderRows, repocketPlan
};
