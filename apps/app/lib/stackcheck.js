/**
 * Comp Finder — checking a stack in your hand against the stack on screen.
 *
 * You hold the physical stack and go through it card by card. The app shows
 * the card it expects next. Each card in your hand gets one of these answers:
 *
 *   ✓ it matches         move on
 *   it's a later card    that card comes up to here (the common case: two
 *                        cards swapped, or one filed a few places out)
 *   it's from elsewhere  a card the system has in ANOTHER stack moves in here
 *   it's not in the app  a new row is added here
 *   the expected one isn't here   it goes on the "not found" list, and at the
 *                        end you decide whether to pull it or leave it
 *
 * ↑ and ↓ on any row move a card one place by hand.
 *
 * NOTHING IS WRITTEN UNTIL "Save order". The check is a draft on this device.
 * Going through a stack is slow, one-handed work, often done in stages and on
 * bad wifi, and a stack half-renumbered by a dropped connection is worse than
 * one left alone. So the draft is kept in localStorage and resumed, and it is
 * only ever read back against the stack as it is NOW (`restoreCheck`). That is
 * the same rule as a binder check-in: a card pulled or checked out since the
 * draft was started drops out of it, and a card added since goes at the back.
 *
 * WHAT THE SAVE WRITES is `position`, the stored sort key (lib/stackpos.js),
 * never a SKU. A SKU is a name and does not move. The new order gets the slots
 * the stack's present cards ALREADY had, sorted, so a card that is away at a
 * show keeps its place relative to the count (a gap after the 14th card stays
 * after the 14th card). Only rows whose position actually changes are written.
 *
 * Framework-free and app-import-free, so check-stackcheck.mjs can load it
 * under bare node.
 */
import { liveRanks } from "./stackpos.js";

const NEW_PREFIX = "new:";
export const CHECK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A card that is physically in its stack right now. */
const present = (c) => c && !c.pulled_at && !c.checked_out_at;

/** The stack's present cards in live order, by the one rule (stackpos.js). */
export function liveOrder(cards, stackId) {
  const mine = (cards || []).filter((c) => present(c) && c.stack_id === stackId);
  const ranks = liveRanks(mine);
  return mine.sort((a, b) => ranks.get(a.id) - ranks.get(b.id));
}

/**
 * A new check over one stack.
 *
 * `order` is the card ids in the order the system has them. Everything ABOVE
 * `cursor` has been seen in the hand; `order[cursor]` is the card expected
 * next. `missing` is the ids that were expected and not in the hand. `extra`
 * describes a card that came from somewhere else: a card from another stack,
 * or a new one (id `new:N`).
 */
export function startCheck(stackId, cards, now = Date.now()) {
  return {
    v: 1,
    stackId,
    order: liveOrder(cards, stackId).map((c) => c.id),
    cursor: 0,
    missing: [],
    extra: {},
    nextNew: 1,
    startedAt: now,
    touchedAt: now
  };
}

const touch = (s, over, now = Date.now()) => ({ ...s, ...over, touchedAt: now });
const clampCursor = (cursor, order) => Math.max(0, Math.min(cursor, order.length));

/** The card in the hand matches the card expected. */
export function confirmCurrent(s) {
  if (s.cursor >= s.order.length) return s;
  return touch(s, { cursor: s.cursor + 1 });
}

/** The card expected next is not in the hand. */
export function notHere(s) {
  const id = s.order[s.cursor];
  if (id == null) return s;
  const order = s.order.filter((x) => x !== id);
  // A card we added during this check that turns out not to be here is simply
  // undone: it was never in the app's stack.
  if (String(id).startsWith(NEW_PREFIX) || s.extra[id]) {
    const extra = { ...s.extra };
    delete extra[id];
    return touch(s, { order, extra, cursor: clampCursor(s.cursor, order) });
  }
  return touch(s, { order, missing: [...s.missing, id], cursor: clampCursor(s.cursor, order) });
}

/**
 * The card in the hand is `id`, which the app has elsewhere in this stack (or
 * on the not-found list). It moves to here, and counts as seen.
 */
export function bringHere(s, id) {
  const at = s.order.indexOf(id);
  const wasMissing = s.missing.includes(id);
  if (at < 0 && !wasMissing) return s;
  let cursor = s.cursor;
  const order = s.order.filter((x) => x !== id);
  // Pulling a card out from ABOVE the cursor shifts the cursor up by one.
  if (at >= 0 && at < cursor) cursor -= 1;
  order.splice(cursor, 0, id);
  return touch(s, {
    order,
    missing: wasMissing ? s.missing.filter((x) => x !== id) : s.missing,
    cursor: cursor + 1
  });
}

/**
 * The card in the hand is not in this stack at all. `card` is either a row
 * from another stack ({ id, sku, title, stack_id, stackName }) or, with no id,
 * a card the app has never seen ({ sku, title }). It goes in here, seen.
 */
export function addHere(s, card) {
  if (!card) return s;
  let id = card.id;
  let nextNew = s.nextNew;
  if (!id) id = `${NEW_PREFIX}${nextNew++}`;
  if (s.order.includes(id)) return bringHere(s, id);
  const order = [...s.order];
  order.splice(s.cursor, 0, id);
  const extra = {
    ...s.extra,
    [id]: {
      sku: String(card.sku || "").trim(),
      title: card.title || "",
      fromStack: card.id ? card.stack_id || null : null,
      fromName: card.id ? card.stackName || null : null
    }
  };
  return touch(s, { order, extra, nextNew, cursor: s.cursor + 1 });
}

/** Move one card a place up (delta -1) or down (+1). The cursor stays put. */
export function moveCard(s, id, delta) {
  const at = s.order.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= s.order.length) return s;
  const order = [...s.order];
  [order[at], order[to]] = [order[to], order[at]];
  return touch(s, { order });
}

/** Go back to (or skip ahead to) a row: everything above it counts as seen. */
export function setCursor(s, index) {
  return touch(s, { cursor: clampCursor(index, s.order) });
}

/** Put a not-found card back where it is expected next, as if never marked. */
export function unmissing(s, id) {
  if (!s.missing.includes(id)) return s;
  const order = [...s.order];
  order.splice(s.cursor, 0, id);
  return touch(s, { order, missing: s.missing.filter((x) => x !== id) });
}

/**
 * What a typed SKU is, from where the check stands. Looked up in THIS stack
 * first (in the order, then on the not-found list), then in the other stacks.
 *
 * Exact SKU, case-insensitive: "AB1" must never answer for "AB11", because
 * the answer moves a card.
 *
 *   { kind: "here",     id }              this stack, still to come or already seen
 *   { kind: "missing",  id }              this stack, marked not found
 *   { kind: "elsewhere", card }           a present card in another stack
 *   { kind: "away",     card }            checked out to a show — refused
 *   { kind: "unknown" }                   no card in the app has that SKU
 *
 * Several copies with one SKU in this stack: the first one still to come is
 * the useful answer, since a seen copy is already accounted for.
 */
export function locateSku(s, sku, allCards) {
  const want = String(sku || "").trim().toLowerCase();
  if (!want) return { kind: "unknown" };
  const byId = new Map((allCards || []).map((c) => [c.id, c]));
  const skuOf = (id) => String(s.extra[id]?.sku ?? byId.get(id)?.sku ?? "").toLowerCase();

  const ahead = s.order.slice(s.cursor).find((id) => skuOf(id) === want);
  if (ahead) return { kind: "here", id: ahead };
  const miss = s.missing.find((id) => skuOf(id) === want);
  if (miss) return { kind: "missing", id: miss };
  const behind = s.order.slice(0, s.cursor).find((id) => skuOf(id) === want);
  if (behind) return { kind: "here", id: behind, seen: true };

  const others = (allCards || []).filter((c) => c && !c.pulled_at && c.stack_id !== s.stackId && String(c.sku || "").toLowerCase() === want);
  const there = others.find((c) => !c.checked_out_at);
  if (there) return { kind: "elsewhere", card: there };
  if (others.length) return { kind: "away", card: others[0] };
  return { kind: "unknown" };
}

/**
 * The draft against the stack as it is now. Anything pulled or checked out
 * since the draft was made drops out (counted); a card that has arrived in
 * the stack since goes at the back (counted). A card brought in from another
 * stack is kept only while that card is still present somewhere.
 */
export function restoreCheck(saved, cards, now = Date.now()) {
  if (!saved || saved.v !== 1 || !saved.stackId || !Array.isArray(saved.order)) return null;
  if (now - (saved.touchedAt || 0) > CHECK_TTL_MS) return null;
  const alive = new Map((cards || []).filter(present).map((c) => [c.id, c]));
  const keep = (id) => String(id).startsWith(NEW_PREFIX) || alive.has(id);

  let cursor = saved.cursor || 0;
  const order = [];
  let dropped = 0;
  saved.order.forEach((id, i) => {
    if (keep(id)) order.push(id);
    else { dropped++; if (i < (saved.cursor || 0)) cursor--; }
  });
  const missing = (saved.missing || []).filter((id) => {
    if (alive.has(id)) return true;
    dropped++;
    return false;
  });
  const extra = {};
  for (const [id, e] of Object.entries(saved.extra || {})) if (order.includes(id)) extra[id] = e;
  // Present in this stack now but not in the draft at all: arrived since.
  const known = new Set([...order, ...missing]);
  const arrived = liveOrder(cards, saved.stackId).map((c) => c.id).filter((id) => !known.has(id));
  return {
    session: { ...saved, order: [...order, ...arrived], missing, extra, cursor: clampCursor(cursor, order) },
    dropped,
    arrived: arrived.length
  };
}

/**
 * What "Save order" writes.
 *
 *   updates  [{ id, position, stack_id? }]   only rows that change
 *   inserts  [{ key, sku, title, position }] cards new to the app
 *   pulls    [id]                             not-found cards you chose to pull
 *
 * A not-found card you did NOT choose to pull goes to the BACK of the stack.
 * It was not where the app said, so the back is the least wrong place for it,
 * and it is on screen there for the next check.
 *
 * The positions are the slots the stack's present cards already held, sorted
 * and made strictly increasing (two rows can share a position, and a shared
 * one would let the id tie-break reorder them behind your back). A stack
 * growing by a card from elsewhere or a new card takes slots past the highest
 * position ANY unpulled card in the stack holds, away cards included, so the
 * new card never ties with a card at a show.
 */
export function savePlan(s, cards, pullIds = []) {
  const pull = new Set(pullIds);
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const own = (cards || []).filter((c) => present(c) && c.stack_id === s.stackId);
  const kept = s.missing.filter((id) => !pull.has(id));
  const final = [...s.order, ...kept];

  const slots = own.map((c) => c.position ?? 0).sort((a, b) => a - b);
  let top = Math.max(0, ...(cards || []).filter((c) => c && !c.pulled_at && c.stack_id === s.stackId).map((c) => c.position ?? 0));
  while (slots.length < final.length) slots.push(++top);
  const positions = [];
  for (let i = 0; i < final.length; i++) {
    positions.push(i === 0 ? slots[0] : Math.max(slots[i], positions[i - 1] + 1));
  }

  const updates = [];
  const inserts = [];
  final.forEach((id, i) => {
    const position = positions[i];
    if (String(id).startsWith(NEW_PREFIX)) {
      const e = s.extra[id] || {};
      inserts.push({ key: id, sku: e.sku || "", title: e.title || "", position });
      return;
    }
    const row = byId.get(id);
    if (!row) return;
    if (row.stack_id !== s.stackId) updates.push({ id, position, stack_id: s.stackId });
    else if ((row.position ?? null) !== position) updates.push({ id, position });
  });
  return { updates, inserts, pulls: s.missing.filter((id) => pull.has(id)) };
}

/** A one-line account of a check, for the screen and the save confirmation. */
export function checkSummary(s, cards) {
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const fromElsewhere = Object.keys(s.extra).filter((id) => !id.startsWith(NEW_PREFIX)).length;
  const added = Object.keys(s.extra).filter((id) => id.startsWith(NEW_PREFIX)).length;
  const original = liveOrder(cards, s.stackId).map((c) => c.id);
  // Moved = the fewest cards you would have to lift to get from the old order
  // to the new one: everything outside the longest run still in its original
  // order. One card lifted from 30 to 5 is one move, not 25.
  const was = new Map(original.map((id, i) => [id, i]));
  const seq = s.order.filter((id) => was.has(id) && byId.get(id)?.stack_id === s.stackId).map((id) => was.get(id));
  const tails = [];
  for (const x of seq) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;
  }
  const moved = seq.length - tails.length;
  return {
    seen: s.cursor,
    total: s.order.length,
    missing: s.missing.length,
    fromElsewhere,
    added,
    moved,
    done: s.cursor >= s.order.length
  };
}

const KEY = (stackId) => `cf-stack-check:${stackId}`;

/** The saved draft for a stack, or null. Never throws. */
export function loadCheck(stackId) {
  try {
    const raw = globalThis.localStorage?.getItem(KEY(stackId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeCheck(s) {
  try { globalThis.localStorage?.setItem(KEY(s.stackId), JSON.stringify(s)); } catch {}
}

export function clearCheck(stackId) {
  try { globalThis.localStorage?.removeItem(KEY(stackId)); } catch {}
}
