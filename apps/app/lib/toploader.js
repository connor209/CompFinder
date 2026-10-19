/**
 * Comp Finder — the toploader box.
 *
 * Cards pulled for a show are priced, stickered and put in a toploader. In a
 * month with a show every weekend, filing them back into the stacks on Sunday
 * night only to pull, re-price and re-sleeve the same cards on Friday is the
 * whole job done twice. So a card coming back can go to the TOPLOADER BOX
 * instead: off the stacks, still ours, back on sale on eBay, and one click
 * from the next show.
 *
 * The box is a stack with a reserved name, not a table of its own. That is
 * what makes every screen that already finds a card — the pull sheet, Stacks,
 * the counter's ⌖ locate, a returning card's "spot" — find it in the box with
 * no new code, and it needs no migration: the code works the day it ships.
 *
 * What makes it NOT a stack is that it has no order. Nobody counts to card 37
 * in a box of toploaders; you flick through it by name. So it never shows a
 * position (`positionLabel()` in stackpos.js asks this file), the pull sheet
 * lists it by name, and the filing plans for the stacks never choose it — a
 * card meant for a stack landing in the box is a card nobody finds.
 *
 * Framework-free and app-import-free, so check-toploader.mjs can load it under
 * bare node.
 */

import { isShowBinder } from "./showbinder.js";

/** The one spelling of the box's name. Never written out anywhere else. */
export const TOPLOADER_STACK_NAME = "Toploaders";

/** `return_mode` on a checkout filed into the box (016 leaves it free text). */
export const TOPLOADER_RETURN_MODE = "toploader";

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Is this the toploader box? Takes a stack row ({ name }) or a bare name, and
 * is forgiving about case and spacing — a box someone made by hand on the
 * Stacks screen as "toploaders " is still the box.
 */
export function isToploaderStack(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  return norm(name) === norm(TOPLOADER_STACK_NAME);
}

/** The box among a list of stacks, or null if it has never been made. */
export function toploaderStackOf(stacks) {
  return (stacks || []).find((s) => isToploaderStack(s)) || null;
}

/**
 * A "stack" with no order: the toploader box, or a Show Binder (see
 * lib/showbinder.js). Both are flicked through by name, so neither ever shows
 * a position and both list by title. The box and the binders differ in what
 * they are FOR, which is why the toploader-only rules still ask
 * isToploaderStack(); anything about order asks this.
 */
export function isUnorderedStack(stackOrName) {
  return isToploaderStack(stackOrName) || isShowBinder(stackOrName);
}

/**
 * Stacks a filing plan may choose. The box and the binders are filed into by
 * their own buttons and never by "the tightest fit" — they have no capacity
 * and no order, and a plan that picked one would be hiding cards in the one
 * place without positions.
 */
export function fileableStacks(stacks) {
  return (stacks || []).filter((s) => !isUnorderedStack(s));
}

/**
 * The box's id, making it the first time. Callers hold the stacks already, so
 * finding it costs nothing; creating it is one insert, once.
 */
export async function ensureToploaderStack(sb, userId, stacks) {
  const have = toploaderStackOf(stacks);
  if (have) return { ok: true, id: have.id, created: false };
  const { data, error } = await sb
    .from("card_stacks")
    .insert({ user_id: userId, name: TOPLOADER_STACK_NAME })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Couldn't create the toploader box." };
  return { ok: true, id: data.id, created: true };
}

/**
 * The sticker a toploaded card takes to its next show.
 *
 * The label is still on the toploader, so the checkout should say what the
 * label says. That is the card's most recent checkout, if it came BACK — a
 * card sold or cancelled has nothing to carry — and only if that checkout had
 * a sticker. Re-pricing ("Price this pool", ✎ £) writes over it as it would
 * any sticker, which is how the price gets interrogated.
 *
 * `prev` is the latest RESOLVED stock_checkouts row for the stack card.
 * Returns whole pence, or null for nothing to carry.
 */
export function carriedSticker(prev) {
  if (!prev || prev.resolution !== "returned") return null;
  const p = prev.sticker_pence == null ? NaN : Number(prev.sticker_pence);
  return Number.isFinite(p) && p > 0 ? Math.round(p) : null;
}

/**
 * Recommended show stock: toploaded cards first, then by value. They are
 * already priced, stickered and sleeved, so bringing one costs nothing — and
 * the box is mostly the dear cards anyway.
 */
export function compareRecs(a, b) {
  if (!!a.toploaded !== !!b.toploaded) return a.toploaded ? -1 : 1;
  return (b.pricePence ?? 0) - (a.pricePence ?? 0);
}

/** By name, the way the box is flicked through. Untitled cards last. */
export function compareByTitle(a, b) {
  const x = norm(a?.title);
  const y = norm(b?.title);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}
