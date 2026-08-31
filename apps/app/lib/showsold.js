/**
 * Comp Finder — selling several cards at once, at the table.
 *
 * A customer at a show rarely buys one card. They put four on the counter, you
 * take the money, and every one of those cards has to leave the box: pulled
 * from its stack for good, its eBay listing ended so it can't sell twice, and
 * a price recorded so the day's takings mean something. Doing that one row at
 * a time is four prompts and four round trips with somebody waiting.
 *
 * This file is the rules behind the desk's bulk **£ Sold**. It is deliberately
 * separate from showfilter.js — that file decides WHICH rows a bulk action
 * acts on (see `selectionFor()`, the rule that costs cards), this one decides
 * what selling them means — and it is framework-free and Supabase-free so
 * scripts/check-showsold.mjs can load it under bare node.
 *
 * Three rules hold it together:
 *
 * - **A sale defaults to the sticker, because the sticker is what was asked.**
 *   The number on the card is the number the customer read; retyping it four
 *   times is four chances to get it wrong. It stays editable, because haggling
 *   is the norm at a show and what goes in the P&L has to be what changed
 *   hands rather than what was printed.
 * - **A card with no sticker is sold WITHOUT a price, never at £0.** The
 *   single-card prompt has always allowed that ("leave blank to record without
 *   a price"), and it matters more in bulk: a zero is a claim that the card was
 *   given away, and it would drag the takings figure down silently. No price
 *   is a gap you can see.
 * - **Nothing is confirmed that isn't listed.** Marking a card sold ends its
 *   listing and pulls it permanently — there is no undo — so the panel names
 *   every card, its price, and how many listings are about to end. That is
 *   also what makes freezing the selection safe: the rows in the panel are the
 *   rows that were on screen when the button was pressed.
 */
import { parseOverridePence, poundsStr } from "./price-override.js";

/**
 * The sticker price as text for an input box — blank when there isn't one.
 *
 * Blank rather than "0.00": an empty box is an invitation to type the price
 * that was actually agreed, and a zero is a number somebody has to notice and
 * clear before it becomes a false record of a giveaway.
 */
export function stickerText(co) {
  const p = co?.sticker_pence;
  return p != null && Number.isFinite(Number(p)) ? (Number(p) / 100).toFixed(2) : "";
}

/** The prices a bulk sale starts from: each card's own sticker, keyed by row id. */
export function soldDraft(rows) {
  const draft = {};
  for (const co of rows || []) {
    if (co?.id == null) continue;
    draft[co.id] = stickerText(co);
  }
  return draft;
}

/**
 * Does marking this card sold have to end an eBay listing?
 *
 * A card checked out by ENDING its listing already has nothing live to end;
 * one hidden by zeroing the quantity is still a listing, and eBay's
 * out-of-stock control will happily put it back on sale. Everything with an
 * item id that wasn't ended has to go, or the card sells a second time to
 * somebody who will never receive it.
 */
export function endsListing(co) {
  return Boolean(co?.ebay_item_id) && co?.hide_method !== "ended";
}

/**
 * The typed prices, parsed, one entry per card and in the order given.
 *
 * Parsed through `parseOverridePence` rather than a parser of its own: it is
 * already the app's definition of "a price somebody typed", down to the
 * wording of the refusals, and a second one would drift. Blank is not an
 * error — it is the "record without a price" case above.
 */
export function soldEntries(rows, draft = {}) {
  return (rows || []).filter(Boolean).map((row) => {
    const raw = draft[row.id] ?? "";
    const { pence, error } = parseOverridePence(raw);
    return { id: row.id, row, raw, pence, error, ends: endsListing(row) };
  });
}

/**
 * What the confirm panel says out loud, and what the button is allowed to do.
 *
 * `ok` is false while any box is unreadable — a bulk sale that skipped the bad
 * rows and went ahead with the rest would leave you to work out afterwards
 * which cards went through, with the customer already gone.
 */
export function soldSummary(entries) {
  const rows = entries || [];
  const priced = rows.filter((e) => !e.error && e.pence != null);
  const errors = rows.filter((e) => e.error);
  return {
    count: rows.length,
    priced: priced.length,
    unpriced: rows.length - priced.length - errors.length,
    totalPence: priced.reduce((t, e) => t + e.pence, 0),
    ending: rows.filter((e) => e.ends).length,
    errors: errors.map((e) => ({ id: e.id, error: e.error })),
    ok: rows.length > 0 && errors.length === 0
  };
}

/**
 * The line the desk shows when it is done.
 *
 * Built here so the single-card path and the bulk path phrase a sale the same
 * way, and so the failures are never dropped: a card whose listing wouldn't
 * end is still sold, and the only place that can be said is this message.
 */
export function soldMessage({ sold = 0, totalPence = 0, priced = 0, warnings = [] } = {}) {
  const cards = `${sold} card${sold === 1 ? "" : "s"}`;
  const money = priced > 0 ? ` for ${poundsStr(totalPence)}` : "";
  const noPrice = sold - priced;
  const gap = noPrice > 0 ? ` (${noPrice} without a price)` : "";
  const warn = warnings.length ? ` ⚠ ${warnings.join(" · ")}` : "";
  return `Marked ${cards} sold${money}${gap}.${warn}`;
}
