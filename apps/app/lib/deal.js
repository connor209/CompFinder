/**
 * Comp Finder — the Current Deal.
 *
 * A customer at a show puts four cards on the table and asks what you want for
 * the lot. Until now that was two screens and two round trips per card: mark
 * each one **⤴ Show** in My listings (which checks it out and HIDES the eBay
 * listing), then walk to the Show desk and mark each one **£ Sold** (which
 * ENDS the same listing). Two eBay calls per card, in two places, while
 * somebody waits.
 *
 * This is one basket instead. You add cards to it from wherever you found
 * them, agree a number, and the whole lot sells in a single pass.
 *
 * Five rules hold it together, and the first two only work as a pair:
 *
 * 1. **Adding is inert.** No eBay call, no checkout, no write — a line in a
 *    list on this device. A customer who changes their mind costs one tap to
 *    undo, which matters because on venue wifi you cannot reliably un-hide a
 *    listing you hid by mistake. The cost is a few minutes where the card is
 *    still live online; that window already existed while they were deciding.
 *
 * 2. **Selling does the whole job in one pass, and ends the listing ONCE.**
 *    See sellLine(): a card already in the box is the desk's existing path; a
 *    card still live on eBay gets a checkout row written already resolved.
 *    Checking out only to immediately sell would spend two calls to reach the
 *    same place.
 *
 * 3. **The money is written before the eBay calls, and a failed call never
 *    rolls a sale back.** A hall with bad wifi is exactly when you are
 *    busiest. A lost sale is unrecoverable; an un-ended listing is a retry,
 *    and the count and the reason are both handed back.
 *
 * 4. **A line with no price cannot be sold.** Same rule as exportGuard() in
 *    zero-price.js, for the same reason: the whole class of fault here is
 *    something that was on screen and did not get read. Type a number or
 *    untick the card.
 *
 * 5. **A line is an allow-list**, built key by key — never a checkout row or a
 *    listing row spread into an object with the private parts dropped. The
 *    same discipline as counterRow() in showcounter.js, and it is why the
 *    basket can be handed to a screen a customer can see later without
 *    anybody re-auditing what a `stock_checkouts` column means.
 *
 * Deliberately framework-free and app-import-free (bar price-override.js,
 * which is the same), so scripts/check-deal.mjs can load it under bare node
 * and the eBay call can be handed in as a fake.
 */

import { parseOverridePence, poundsStr } from "./price-override.js";

const KEY = "cf-current-deal";

/**
 * Bumped when the stored shape changes. A basket from an older build is
 * DROPPED rather than drawn — half a line is worse than no line, and this one
 * is read at a table with somebody waiting.
 */
const VERSION = 1;

/** One deal at a time, and a table that needs more than this is a wholesale
 *  order rather than a deal — those want the Batch screen. */
export const MAX_LINES = 80;

/**
 * How long a basket survives.
 *
 * A deal is a conversation at a table, and it ends one of two ways: the money
 * changes hands, or they walk off. Neither leaves anything worth keeping until
 * tomorrow — and a stale basket is worse than an empty one, because the rows
 * in it have moved on. The card may have sold from the desk, gone back in its
 * stack, or been sold online overnight, and every one of those makes the
 * figures on screen a lie about stock. Twelve hours is "started today".
 */
export const DEAL_TTL_MS = 12 * 60 * 60 * 1000;

/** Where a line came from. The two sources differ in exactly one place —
 *  sellLine() — and nowhere else in this file. */
export const FROM_BOX = "box";       // an open stock_checkouts row: already away
export const FROM_LIVE = "live";     // an ebay_listings row: never checked out

/** How a line got its price, for the small grey line under the figure. Order
 *  matters: it is the fallback chain, best evidence first. */
export const PRICE_SOURCES = ["sticker", "listed", "market", "hand"];

const PRICE_LABELS = {
  sticker: "sticker",
  listed: "your eBay ask",
  market: "market",
  hand: "you typed it"
};

/** Prose for the small line under a price. */
export function priceSourceLabel(src) {
  return PRICE_LABELS[src] || "no price";
}

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ lines */

function penceFromPounds(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function clean(v) {
  return v == null || v === "" ? null : String(v);
}

/**
 * A line from a My listings row (an `ebay_listings` group).
 *
 * `marketPence` is the repricing figure where one has been fetched — the
 * bottom of the fallback chain, and absent far more often than not.
 */
export function listingLine(row, { marketPence = null } = {}) {
  if (!row) return null;
  const itemId = clean(row.ebay_item_id);
  const sku = clean(row.sku);
  if (!itemId && !sku) return null;
  const ask = penceFromPounds(row.price_value);
  const price = ask != null ? ask : marketPence != null ? marketPence : null;
  return {
    id: `L:${itemId || sku}`,
    from: FROM_LIVE,
    sku,
    title: clean(row.title) || "Untitled listing",
    image: clean(row.image_url),
    itemId,
    checkoutId: null,
    stackCardId: null,
    // A live listing has not been hidden, so there is nothing to skip when the
    // sale ends it. See sellLine().
    hideMethod: null,
    price,
    priceSource: ask != null ? "listed" : marketPence != null ? "market" : null,
    // What the price was before anybody typed over it, so the drawer can say
    // "was £34.00" without a second lookup.
    basePrice: price,
    on: true
  };
}

/**
 * A line from a Show desk row (an open `stock_checkouts` row).
 *
 * `listedPence` is what the same SKU is asking on eBay, read through the
 * listings the desk already holds — the middle of the chain, and the same
 * lookup the sticker panel uses rather than a second SKU match that could
 * drift from it.
 */
export function checkoutLine(co, { listedPence = null } = {}) {
  if (!co || !co.id) return null;
  const sticker = co.sticker_pence != null ? Number(co.sticker_pence) : null;
  const price = sticker != null ? sticker : listedPence != null ? listedPence : null;
  return {
    id: `C:${co.id}`,
    from: FROM_BOX,
    sku: clean(co.sku),
    title: clean(co.title) || clean(co.sku) || "Card",
    image: null, // filled by the caller from the desk's own picture map
    itemId: clean(co.ebay_item_id),
    checkoutId: String(co.id),
    stackCardId: clean(co.stack_card_id),
    hideMethod: clean(co.hide_method),
    price,
    priceSource: sticker != null ? "sticker" : listedPence != null ? "listed" : null,
    basePrice: price,
    on: true
  };
}

/* ------------------------------------------------------------------ basket */

export function emptyDeal(event = null) {
  return { v: VERSION, startedAt: nowIso(), event: clean(event), totalPence: null, lines: [] };
}

/** Is this card already in the basket?
 *
 *  Two questions, not one. The id catches the same row added twice; the SKU
 *  catches the card that is BOTH checked out and still carrying a live
 *  listing row, which would otherwise go in once from each screen and sell
 *  the customer one card at two prices.
 */
export function inDeal(deal, { id = null, sku = null } = {}) {
  const lines = deal?.lines || [];
  if (id && lines.some((l) => l.id === id)) return true;
  if (sku && lines.some((l) => l.sku && l.sku.toLowerCase() === String(sku).toLowerCase())) return true;
  return false;
}

export function addLine(deal, line) {
  const d = deal || emptyDeal();
  if (!line || inDeal(d, line)) return d;
  if ((d.lines || []).length >= MAX_LINES) return d;
  return { ...d, lines: [...(d.lines || []), line] };
}

export function removeLine(deal, id) {
  if (!deal) return emptyDeal();
  return { ...deal, lines: (deal.lines || []).filter((l) => l.id !== id) };
}

/** Unticking keeps the line in the basket. That is how you sell three of the
 *  four and keep the fourth in play while they think about it. */
export function setLineOn(deal, id, on) {
  if (!deal) return emptyDeal();
  return { ...deal, lines: (deal.lines || []).map((l) => (l.id === id ? { ...l, on: Boolean(on) } : l)) };
}

/**
 * Set one line's price by hand.
 *
 * This CLEARS the lot total, and that is the point rather than a side effect:
 * you have gone back to pricing card by card, so there is no agreed lot figure
 * left for the split to honour. Leaving it set would show a total that no
 * longer equals the sum of its parts.
 */
export function setLinePrice(deal, id, pence) {
  if (!deal) return emptyDeal();
  return {
    ...deal,
    totalPence: null,
    lines: (deal.lines || []).map((l) =>
      l.id === id ? { ...l, price: pence == null ? null : Number(pence), priceSource: pence == null ? null : "hand" } : l
    )
  };
}

export function setDealTotal(deal, pence) {
  if (!deal) return emptyDeal();
  return { ...deal, totalPence: pence == null ? null : Number(pence) };
}

/** Read a typed price. Reuses the override parser, which already refuses zero
 *  — "nothing priced this" and "sold for nothing" are the same mistake. */
export function parseDealPence(text) {
  return parseOverridePence(text);
}

export function activeLines(deal) {
  return (deal?.lines || []).filter((l) => l.on);
}

export function dealSubtotal(deal) {
  return activeLines(deal).reduce((t, l) => t + (l.price ?? 0), 0);
}

/**
 * Split an agreed lot price back across the cards.
 *
 * In proportion to each line's own price, with the LAST line absorbing the
 * rounding remainder so the parts sum to exactly what changed hands. Both
 * halves matter: proportional keeps each card's `sold_price_pence` honest for
 * the P&L, and the exact sum is what stops the takings total disagreeing with
 * the number the customer handed over.
 *
 * A lot total over lines that are all priced at nothing has no proportion to
 * work from, so it splits evenly — the remainder rule still applies.
 */
export function splitDeal(lines, totalPence) {
  const list = lines || [];
  if (list.length === 0) return [];
  const own = list.map((l) => l.price ?? 0);
  if (totalPence == null) return own;
  const sub = own.reduce((t, n) => t + n, 0);
  const out = sub === 0
    ? list.map(() => Math.round(totalPence / list.length))
    : own.map((p) => Math.round((p * totalPence) / sub));
  out[out.length - 1] += totalPence - out.reduce((t, n) => t + n, 0);
  return out;
}

/** id -> the pence that line will actually be sold at. */
export function dealPrices(deal) {
  const on = activeLines(deal);
  const parts = splitDeal(on, deal?.totalPence ?? null);
  return new Map(on.map((l, i) => [l.id, parts[i]]));
}

/** Ticked lines carrying no price. Non-empty means the sale is refused. */
export function dealBlockers(deal) {
  return activeLines(deal).filter((l) => l.price == null);
}

/** Everything the drawer and the bar need, from one call. */
export function dealSummary(deal) {
  const on = activeLines(deal);
  const subtotalPence = dealSubtotal(deal);
  const blockers = dealBlockers(deal);
  const payablePence = deal?.totalPence ?? subtotalPence;
  return {
    count: on.length,
    total: (deal?.lines || []).length,
    subtotalPence,
    payablePence,
    discountPence: subtotalPence - payablePence,
    blockers,
    // A refusal you have to go hunting behind is one that gets ignored, so it
    // names the cards the way exportGuard() does.
    blockedReason: blockers.length
      ? `${blockers.length} card${blockers.length === 1 ? "" : "s"} with no price — ${blockers
          .slice(0, 3)
          .map((l) => l.sku || l.title)
          .join(", ")}${blockers.length > 3 ? ` and ${blockers.length - 3} more` : ""}. Type a number or untick ${blockers.length === 1 ? "it" : "them"}.`
      : null,
    canSell: on.length > 0 && blockers.length === 0
  };
}

/* ----------------------------------------------------------------- storage */

/**
 * The basket lives on THIS device, in localStorage.
 *
 * Not sessionStorage: a phone locks in a pocket between the card going in the
 * basket and the money changing hands, and a tab that reloaded should come
 * back to the same four cards. Not Supabase: the one moment this has to work
 * is the moment the venue wifi is worst.
 */
export function loadDeal(now = Date.now()) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDeal();
    const d = JSON.parse(raw);
    // Junk from an older build is dropped rather than drawn.
    if (!d || d.v !== VERSION || !Array.isArray(d.lines)) return emptyDeal();
    const started = Date.parse(d.startedAt || "");
    if (!Number.isFinite(started) || now - started > DEAL_TTL_MS) return emptyDeal();
    return {
      v: VERSION,
      startedAt: d.startedAt || nowIso(),
      event: clean(d.event),
      totalPence: d.totalPence == null ? null : Number(d.totalPence),
      lines: d.lines.filter((l) => l && l.id && (l.from === FROM_BOX || l.from === FROM_LIVE)).slice(0, MAX_LINES)
    };
  } catch {
    return emptyDeal();
  }
}

export function saveDeal(deal) {
  try {
    localStorage.setItem(KEY, JSON.stringify(deal || emptyDeal()));
  } catch {
    /* a full or blocked store loses the basket, not the sale */
  }
}

export function clearDeal() {
  try { localStorage.removeItem(KEY); } catch { /* best-effort */ }
  return emptyDeal();
}

/**
 * Save, and tell every screen showing the basket.
 *
 * My listings ADDS to the deal and the bar RENDERS it, and those two are
 * siblings rather than parent and child — an event is cheaper than threading
 * a provider through the whole panel, and it keeps this file the only thing
 * that knows where the basket is kept.
 */
const CHANGED = "cf-deal-changed";

export function publishDeal(deal) {
  saveDeal(deal);
  try { window.dispatchEvent(new CustomEvent(CHANGED, { detail: deal })); } catch { /* no window, no listeners */ }
  return deal;
}

export function subscribeDeal(fn) {
  const here = (e) => fn(e.detail || loadDeal());
  // A second window on the same tablet is the same basket; `storage` only
  // fires in the OTHER document, which is exactly the case the event above
  // cannot reach.
  const elsewhere = (e) => { if (!e.key || e.key === KEY) fn(loadDeal()); };
  try {
    window.addEventListener(CHANGED, here);
    window.addEventListener("storage", elsewhere);
    return () => {
      window.removeEventListener(CHANGED, here);
      window.removeEventListener("storage", elsewhere);
    };
  } catch {
    return () => {};
  }
}

/* -------------------------------------------------------------- selling it */

/** The one place this file names the route that ends a listing. */
async function endListingViaApi(itemId) {
  try {
    const res = await fetch("/api/ebay/end-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId })
    }).then((r) => r.json());
    return res && res.ok ? { ok: true } : { ok: false, error: (res && res.error) || "End failed" };
  } catch {
    return { ok: false, error: "Couldn't reach eBay to end the listing." };
  }
}

/**
 * Sell one card at `pence`, whichever world it was in.
 *
 * Ordering is the rule, not a preference: the reads first (they cannot lose
 * anything), then the money, then the card, then eBay. A failure after the
 * money is written is reported and never rolled back.
 *
 * Returns { ok, id, sku, title, pence, did[], warning } — `did` is what
 * actually happened, in order, for the receipt.
 */
export async function sellLine(sb, line, pence, { event = null, userId = null, endListing = endListingViaApi } = {}) {
  const did = [];
  const at = nowIso();
  let warning = null;
  let stackCardId = line.stackCardId || null;
  let stackId = null;
  let stackName = null;

  // A line that never went through a checkout has to be matched to the card in
  // a stack, exactly the way ⤴ Show does it — by SKU, taking one that is
  // neither pulled nor already away.
  if (!stackCardId && line.sku) {
    try {
      const { data } = await sb.from("stack_cards").select("*").ilike("sku", line.sku);
      const card = (data || []).find((c) => !c.pulled_at && !c.checked_out_at);
      if (card) {
        stackCardId = card.id;
        stackId = card.stack_id || null;
      }
    } catch {
      /* no stack match is a gap in the bookkeeping, not a reason to refuse money */
    }
  }
  if (stackId) {
    try {
      const { data } = await sb.from("card_stacks").select("name").eq("id", stackId).maybeSingle();
      stackName = data?.name || null;
    } catch { /* the snapshot name is a nicety */ }
  }

  // ---- the money -----------------------------------------------------------
  let checkoutId = line.checkoutId || null;
  if (checkoutId) {
    // `.is("resolved_at", null)` is the guard, and it is the whole reason this
    // reads back the row it changed: a basket can sit on the counter while the
    // same card is sold or returned from the desk, and resolving an ALREADY
    // resolved checkout would silently count the takings twice. An update that
    // matched nothing comes back empty rather than as an error.
    const { data, error } = await sb
      .from("stock_checkouts")
      .update({ resolved_at: at, resolution: "sold", sold_price_pence: pence })
      .eq("id", checkoutId)
      .is("resolved_at", null)
      .select("id");
    if (error) return { ok: false, id: line.id, sku: line.sku, title: line.title, pence, did, error: error.message };
    if (!data || data.length === 0) {
      return {
        ok: false, id: line.id, sku: line.sku, title: line.title, pence, did,
        error: "already sold or returned since it went in the basket — check Recent activity before recording it again"
      };
    }
    did.push("checkout resolved sold");
  } else {
    const { data, error } = await sb
      .from("stock_checkouts")
      .insert({
        user_id: userId,
        stack_card_id: stackCardId,
        stack_id: stackId,
        stack_name: stackName,
        sku: line.sku || null,
        title: line.title || null,
        ebay_item_id: line.itemId || null,
        event: event || null,
        // Nothing has been hidden yet. Set to 'ended' below only if the call
        // below actually ends it — a row claiming a listing was pulled when it
        // is still live is the one lie this record must not tell.
        hide_method: "none",
        checked_out_at: at,
        resolved_at: at,
        resolution: "sold",
        sold_price_pence: pence
      })
      .select("id")
      .single();
    if (error) return { ok: false, id: line.id, sku: line.sku, title: line.title, pence, did, error: error.message };
    checkoutId = data?.id || null;
    did.push("checkout written already resolved");
    if (!stackCardId && line.sku) did.push("no stack card matched this SKU");
  }

  // ---- the card leaves the box --------------------------------------------
  if (stackCardId) {
    const { error } = await sb
      .from("stack_cards")
      .update({ pulled_at: at, checked_out_at: null })
      .eq("id", stackCardId);
    if (error) warning = `stack card not marked pulled: ${error.message}`;
    else did.push("stack card pulled");
  }

  // ---- the listing goes, once ---------------------------------------------
  if (line.itemId && line.hideMethod === "ended") {
    did.push("listing was already ended");
  } else if (line.itemId) {
    const r = await endListing(line.itemId);
    if (r && r.ok) {
      did.push("listing ended on eBay");
      if (checkoutId) {
        try { await sb.from("stock_checkouts").update({ hide_method: "ended" }).eq("id", checkoutId); } catch { /* cosmetic */ }
      }
    } else {
      warning = `listing not ended: ${(r && r.error) || "unknown error"}`;
      if (checkoutId) {
        try { await sb.from("stock_checkouts").update({ hide_error: warning }).eq("id", checkoutId); } catch { /* cosmetic */ }
      }
    }
  }

  return { ok: true, id: line.id, sku: line.sku, title: line.title, pence, checkoutId, itemId: line.itemId, did, warning };
}

/**
 * Sell the ticked lines. Refuses outright while any of them has no price —
 * see rule 4 at the top of this file.
 *
 * Returns { ok, results[], soldPence, failed[], unended[] } where `unended`
 * are the lines whose money is recorded but whose listing is still live, so
 * the screen can offer a retry rather than leaving it to be noticed.
 */
export async function sellDeal(sb, deal, { event = null, endListing = endListingViaApi } = {}) {
  const summary = dealSummary(deal);
  if (!summary.canSell) return { ok: false, error: summary.blockedReason || "Nothing ticked to sell.", results: [] };

  let userId = null;
  try {
    const { data } = await sb.auth.getUser();
    userId = data?.user?.id || null;
  } catch { /* the insert will refuse without it, and say so */ }

  const lines = activeLines(deal);
  const prices = dealPrices(deal);
  const results = [];
  for (const line of lines) {
    // Deliberately serial. Four cards is not worth a race, and eBay's end call
    // is the slowest thing here — firing them together on venue wifi is how
    // you get three timeouts instead of one.
    // eslint-disable-next-line no-await-in-loop
    results.push(await sellLine(sb, line, prices.get(line.id) ?? 0, { event: event ?? deal?.event ?? null, userId, endListing }));
  }

  return {
    ok: true,
    results,
    soldPence: results.filter((r) => r.ok).reduce((t, r) => t + (r.pence || 0), 0),
    failed: results.filter((r) => !r.ok),
    unended: results.filter((r) => r.ok && r.warning && r.warning.startsWith("listing not ended"))
  };
}

/**
 * Try the listings that didn't end again. The sale is already recorded, so
 * this only ever touches eBay and the row's own record of it.
 */
export async function retryEnds(sb, unended, { endListing = endListingViaApi } = {}) {
  const still = [];
  for (const r of unended || []) {
    if (!r.itemId) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await endListing(r.itemId);
    if (res && res.ok) {
      if (r.checkoutId) {
        // eslint-disable-next-line no-await-in-loop
        try { await sb.from("stock_checkouts").update({ hide_method: "ended", hide_error: null }).eq("id", r.checkoutId); } catch { /* cosmetic */ }
      }
    } else {
      still.push({ ...r, warning: `listing not ended: ${(res && res.error) || "unknown error"}` });
    }
  }
  return still;
}

export { poundsStr };

export default {
  MAX_LINES, FROM_BOX, FROM_LIVE, PRICE_SOURCES, priceSourceLabel,
  listingLine, checkoutLine, emptyDeal, inDeal, addLine, removeLine,
  setLineOn, setLinePrice, setDealTotal, parseDealPence, activeLines,
  dealSubtotal, splitDeal, dealPrices, dealBlockers, dealSummary,
  loadDeal, saveDeal, clearDeal, publishDeal, subscribeDeal,
  sellLine, sellDeal, retryEnds, poundsStr
};
