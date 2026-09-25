/**
 * Comp Finder — stream stock: the pool of cards pulled for eBay Live.
 *
 * A stream runs off a box of ~200 cards pulled out of the stacks. A card
 * stays in that box until it SELLS on a stream or has been AIRED three times
 * without selling, and only then comes home. Before each stream the box is
 * topped back up to size from what is still in the stacks.
 *
 * The pool is `stock_checkouts` rows with `pool = 'stream'` (migration 031).
 * Checked out for the same reasons a show card is — the stack numbering closes
 * up behind it and its listing is hidden — and kept apart from show stock for
 * a reason that matters more: every screen that reads open checkouts reads
 * them as "at a show", and one of those screens is the QR storefront, on a
 * stranger's phone. `isShowCheckout()` is the one test they all use, and
 * check-streamstock.mjs greps that each of them does.
 *
 * Four rules this file owns, each pinned by the check:
 *
 * 1. **A row with no pool is a SHOW row.** Every checkout written before 031,
 *    and every read from a database that has not had it applied, carries no
 *    `pool`. Treating that as stream stock would empty the Show Desk the day
 *    this shipped.
 *
 * 2. **A card goes home on AIRINGS, not on streams attended.** Two hundred
 *    cards in a box is more than one stream gets through, and a card that sat
 *    unaired for three weeks has not been offered to anybody. `STREAMS_BACKSTOP`
 *    is the floor under that: a card nobody reaches in six streams goes home
 *    anyway, so the box cannot silt up with cards that are never picked.
 *
 * 3. **The recommender never offers a card that is already out**, at a show
 *    or on a stream (no crossover, decided 2026-09-25), a card whose listing
 *    has sold, a GRADED card (decided 2026-09-25: slabs stay off the stream),
 *    or a card that came home from the stream box inside the cooldown —
 *    without that, the top-up after a return re-picks the cards just filed
 *    back and the box never actually rotates.
 *
 * 3b. **A box is a MIX, not the dearest 200.** Picks are spread across the
 *    price range by default, and no more than `maxCopies` of one card go in —
 *    counting the copies already in the box. Both asked for 2026-09-25, after
 *    the first version filled the box from the top of the range down.
 *
 * 4. **The pull sheet numbers a card where it IS**, not where the app now
 *    thinks it is. Checking a card out closes the numbering up behind it
 *    straight away (stackpos.js), but the card is still physically in the
 *    stack until somebody pulls it. So the sheet ranks the pull set as if it
 *    were still present, and orders each stack BACK TO FRONT: pull the
 *    deepest card first and every number above it stays true.
 *
 * Framework-free, so scripts/check-streamstock.mjs can load it under bare node.
 */
import SoldCompsApi from "@compfinder/core/soldcomps.js";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { gameOf } from "./games.js";
import { normalise, compareSku } from "./showfilter.js";
import { liveRanks, stackDepths } from "./stackpos.js";
import { isListingAvailable, soldOutSkus, keyFromTitle, printingOf } from "./stockcheck.js";

/* ------------------------------------------------------------------ pools */

export const SHOW_POOL = "show";
export const STREAM_POOL = "stream";

/** Which pool a checkout is in. Anything but an explicit 'stream' is a show — rule 1. */
export function poolOf(co) {
  return co && co.pool === STREAM_POOL ? STREAM_POOL : SHOW_POOL;
}

export function isShowCheckout(co) {
  return poolOf(co) === SHOW_POOL;
}

export function isStreamCheckout(co) {
  return poolOf(co) === STREAM_POOL;
}

/** The rows a show screen may see. */
export function showOnly(rows) {
  return (rows || []).filter(isShowCheckout);
}

export function streamOnly(rows) {
  return (rows || []).filter(isStreamCheckout);
}

/**
 * Does this error mean `stock_checkouts.pool` is not there yet?
 *
 * Word-bounded so `pool_name` (migration 024, on price_batches) never reads as
 * this column.
 */
export function isMissingPool(err) {
  const msg = String(err?.message || err || "");
  return /\bpool\b/i.test(msg) && (err?.code === "42703" || /does not exist|schema cache|could not find/i.test(msg));
}

/**
 * Read checkouts with the pool column if the database has it, and without it
 * if not. `run(cols)` makes and awaits the query. Before 031 every row is a
 * show row anyway, so the fallback answers the same question.
 */
export async function withPool(run, cols) {
  const first = await run(`${cols},pool`);
  if (!first?.error || !isMissingPool(first.error)) return first;
  return run(cols);
}

/**
 * How a stream card's listing is hidden. The desk's own preference, except
 * that "don't touch the listing" is not on offer: a stream card left live on
 * eBay for three weeks is a card that sells online while it is in the box, and
 * the pull sheet then sends somebody to a stack it is not in. Decided
 * 2026-09-25: hide while out.
 */
export function streamHideMode(pref) {
  return pref === "quantity" || pref === "ended" ? pref : "auto";
}

/* ------------------------------------------------------------- the rules */

/** Aired this many times without selling, and it goes home. */
export const AIRINGS_BEFORE_RETURN = 3;
/** In the box for this many finished streams without enough airings, and it goes home anyway. */
export const STREAMS_BACKSTOP = 6;
/** The box size to top up to. A preference, remembered on the device. */
export const DEFAULT_TARGET = 200;
/** A card back from the box is not offered again for this long. */
export const COOLDOWN_DAYS = 28;
/** The top-up list is never longer than this, whatever the target. */
export const MAX_PICKS = 400;

/* ------------------------------------------------------------ conditions */

/**
 * The condition chips. The codes are `packages/core`'s own — `inferCondition`
 * is what the pricing engine splits its comps on, and a recommender that read
 * "NM" differently would pick cards the price disagrees about.
 */
export const CONDITIONS = [
  { key: "NM", label: "Near Mint" },
  { key: "LP", label: "Lightly Played" },
  { key: "MP", label: "Moderately Played" },
  { key: "HP", label: "Heavily Played" },
  { key: "DMG", label: "Damaged" },
  { key: "unknown", label: "Not stated" }
];

/**
 * One condition code for a title. A slab is a slab before it is anything else
 * — and a slab is never offered for the box (rule 3), so "graded" is not one
 * of the chips.
 */
export function conditionCode(title) {
  const t = String(title || "");
  if (CompFinderPricing.subjectGradeFrom(t) != null) return "graded";
  const code = SoldCompsApi.inferCondition(t);
  return CONDITIONS.some((c) => c.key === code) ? code : "unknown";
}

/* ------------------------------------------------------------- the names */

/**
 * Parse the character box: commas or new lines separate alternatives, words
 * inside one alternative are all required. "charizard, umbreon vmax" is any
 * Charizard or an Umbreon VMAX.
 */
export function nameTerms(text) {
  return String(text || "")
    .split(/[,\n;]+/)
    .map((t) => normalise(t).split(" ").filter(Boolean))
    .filter((words) => words.length > 0);
}

/**
 * Does a title name any of the terms?
 *
 * WHOLE words, unlike the desk's search box. That box finds a card you are
 * looking at, where a partial hit is harmless; this picks 100 cards to pull,
 * and "mew" pulling every Mewtwo in the stacks is 100 wrong cards in a box.
 */
export function matchesNames(title, terms) {
  if (!terms || terms.length === 0) return true;
  const words = new Set(normalise(title).split(" ").filter(Boolean));
  return terms.some((term) => term.every((w) => words.has(w)));
}

/* ------------------------------------------------------- the candidates */

function dayMs(days) {
  return Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
}

/**
 * Every card that COULD go in the box, and a count of every card that could
 * not and why. Nothing is dropped quietly: the counts are on screen.
 *
 * - `cards`     unpulled stack_cards rows (checked out or not)
 * - `listings`  ebay_listings rows
 * - `recentStream` stream checkouts resolved as 'returned', for the cooldown
 * - `gameIndex` from games.js buildSetGameIndex, or null
 *
 * Price is our own eBay ask on an AVAILABLE listing — the same reading
 * "★ Recommend show stock" makes, and for the same reason: a sold listing
 * sits in the ActiveList at quantity 0 and is the most expensive thing there.
 */
export function streamCandidates({
  cards = [], listings = [], recentStream = [], gameIndex = null,
  now = Date.now(), cooldownDays = COOLDOWN_DAYS
} = {}) {
  const gone = soldOutSkus(listings);
  const bySku = new Map();
  for (const l of listings || []) {
    if (!l?.sku || !isListingAvailable(l) || l.price_value == null) continue;
    const k = String(l.sku).toLowerCase();
    if (!bySku.has(k)) bySku.set(k, l);
  }
  const cutoff = now - dayMs(cooldownDays);
  const cooling = new Set();
  for (const co of recentStream || []) {
    if (!co?.stack_card_id || co.resolution !== "returned") continue;
    const t = Date.parse(co.resolved_at || "");
    if (Number.isFinite(t) && t >= cutoff) cooling.add(String(co.stack_card_id));
  }

  const skipped = { away: 0, soldOut: 0, unpriced: 0, cooldown: 0, graded: 0, noSku: 0 };
  const rows = [];
  for (const c of cards || []) {
    if (!c || c.pulled_at) continue;
    if (c.checked_out_at) { skipped.away += 1; continue; }
    if (!c.sku) { skipped.noSku += 1; continue; }
    const k = String(c.sku).toLowerCase();
    const listing = bySku.get(k);
    if (!listing) {
      if (gone.has(k)) skipped.soldOut += 1;
      else skipped.unpriced += 1;
      continue;
    }
    const title = c.title || listing.title || "";
    const condition = conditionCode(title);
    if (condition === "graded") { skipped.graded += 1; continue; }
    if (cooling.has(String(c.id))) { skipped.cooldown += 1; continue; }
    rows.push({
      card: c,
      sku: c.sku,
      title,
      itemId: listing.ebay_item_id != null ? String(listing.ebay_item_id) : null,
      pricePence: Math.round(Number(listing.price_value) * 100),
      quantity: listing.quantity == null ? null : Number(listing.quantity),
      game: gameOf({ category: listing.extra?.category, title }, gameIndex),
      condition
    });
  }
  return { rows, skipped };
}

/* -------------------------------------------------------- the mix */

/** How the top-up list is chosen. */
export const PICK_MODES = [
  { key: "spread", label: "Spread across the price range" },
  { key: "top", label: "Highest value first" }
];
export const DEFAULT_PICK_MODE = "spread";

/** How many price bands a spread is taken across. */
export const PRICE_BANDS = 5;

/** No more than this many copies of one card in the box, unless changed. */
export const DEFAULT_MAX_COPIES = 1;

/**
 * What makes two cards "the same card" for the duplicate limit: the card key
 * (collector number + first name word, stockcheck.js's) plus the printing. A
 * reverse holo and a plain copy are two cards — the engine prices them apart,
 * and so does a buyer. A title with no number falls back to the whole title,
 * so two identical listings still count as two copies.
 */
export function duplicateKey(title) {
  const p = printingOf(title);
  const base = keyFromTitle(title) || `t:${normalise(title)}`;
  return `${base}|${p.reverse ? "r" : ""}${p.stamped ? "s" : ""}`;
}

/**
 * Price bands for a spread: equal steps on a LOG scale between the cheapest
 * and dearest card that fit. Equal-width pound bands would put £2 to £160 in
 * one band beside a card at £800; log steps give £2–£6, £6–£20, £20–£60 and so
 * on, which is how a box of cards is actually priced.
 *
 * Returns [{ loPence, hiPence }] cheapest first; the last band's top is
 * inclusive. One band when everything costs the same.
 */
export function priceBands(rows, n = PRICE_BANDS) {
  const prices = (rows || []).map((r) => r.pricePence).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return [];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const k = lo === hi ? 1 : Math.max(1, Math.round(n));
  const ratio = hi / lo;
  const edges = [];
  for (let i = 0; i <= k; i++) edges.push(i === k ? hi : Math.round(lo * Math.pow(ratio, i / k)));
  const bands = [];
  for (let i = 0; i < k; i++) bands.push({ loPence: edges[i], hiPence: edges[i + 1] });
  return bands;
}

function bandIndex(bands, pence) {
  for (let i = 0; i < bands.length - 1; i++) if (pence < bands[i + 1].loPence) return i;
  return bands.length - 1;
}

/**
 * A band's cards in the order a spread takes them: evenly spaced through the
 * band first, so a band asked for five of forty gets the dearest, the
 * cheapest and three between rather than its top five; the rest after, in
 * case the duplicate limit refuses some of the first pass.
 */
function spreadOrder(list, want) {
  const n = list.length;
  if (n === 0) return [];
  const q = Math.max(1, Math.min(n, want));
  const first = new Set();
  for (let i = 0; i < q; i++) first.add(q === 1 ? 0 : Math.round((i * (n - 1)) / (q - 1)));
  return [...first].sort((a, b) => a - b).map((i) => list[i]).concat(list.filter((_, i) => !first.has(i)));
}

/**
 * The top-up list. Filters first — the chosen games, the price range in
 * pence, the character terms and the chosen conditions; an empty choice is
 * everything — then the MIX:
 *
 * - `mode: "spread"` (the default) takes cards from every price band in turn,
 *   dearest band first, so the box is a spread of the range rather than its
 *   top. A band with fewer cards than its share gives the rest to the others,
 *   because the rotation just carries on without it.
 * - `mode: "top"` is dearest first, which is what the first version did.
 * - `maxCopies` caps copies of one card (`duplicateKey`), counting the ones
 *   already in the box (`held`, their titles). 0 or blank is no limit.
 *
 * Returns { picks, matched, bands, capped } — picks dearest first for
 * reading; `matched` is how many passed the filters, so "100 of 340" is on
 * screen; `bands` says how many each band had and gave; `capped` is how many
 * were passed over for the duplicate limit. Nothing is dropped quietly.
 */
export function recommendStream(candidates, {
  count = DEFAULT_TARGET, games = null, minPence = null, maxPence = null,
  names = "", conditions = null, mode = DEFAULT_PICK_MODE,
  maxCopies = DEFAULT_MAX_COPIES, held = []
} = {}) {
  const terms = nameTerms(names);
  const lo = minPence == null || minPence === "" ? null : Number(minPence);
  const hi = maxPence == null || maxPence === "" ? null : Number(maxPence);
  const fit = (candidates || []).filter((r) => {
    if (games && games.size && !games.has(r.game)) return false;
    if (conditions && conditions.size && !conditions.has(r.condition)) return false;
    if (lo != null && Number.isFinite(lo) && r.pricePence < lo) return false;
    if (hi != null && Number.isFinite(hi) && r.pricePence > hi) return false;
    return matchesNames(r.title, terms);
  });
  const dearest = (a, b) => b.pricePence - a.pricePence || compareSku(a.sku, b.sku);
  fit.sort(dearest);
  const n = Math.max(0, Math.min(MAX_PICKS, Math.round(Number(count) || 0)));

  const cap = Math.max(0, Math.round(Number(maxCopies) || 0));
  const copies = new Map();
  for (const t of held || []) {
    const k = duplicateKey(t);
    copies.set(k, (copies.get(k) || 0) + 1);
  }
  const cappedKeys = new Set();
  let capped = 0;
  const take = (r) => {
    if (cap > 0) {
      const k = duplicateKey(r.title);
      if ((copies.get(k) || 0) >= cap) {
        capped += 1;
        cappedKeys.add(k);
        return false;
      }
      copies.set(k, (copies.get(k) || 0) + 1);
    }
    return true;
  };

  const picks = [];
  let bands = [];
  if (mode === "top") {
    for (const r of fit) {
      if (picks.length >= n) break;
      if (take(r)) picks.push(r);
    }
  } else {
    bands = priceBands(fit).map((b) => ({ ...b, available: 0, picked: 0, rows: [] }));
    for (const r of fit) {
      const b = bands[bandIndex(bands, r.pricePence)];
      b.rows.push(r);
      b.available += 1;
    }
    const share = bands.length ? Math.ceil(n / bands.length) : 0;
    const queues = bands.map((b) => spreadOrder(b.rows, share));
    const at = queues.map(() => 0);
    // Round-robin, dearest band first, until the count is met or every band
    // has run dry.
    let moved = true;
    while (picks.length < n && moved) {
      moved = false;
      for (let i = bands.length - 1; i >= 0 && picks.length < n; i--) {
        while (at[i] < queues[i].length) {
          const r = queues[i][at[i]++];
          if (take(r)) { picks.push(r); bands[i].picked += 1; moved = true; break; }
        }
      }
    }
    bands = bands.map(({ rows, ...b }) => b);
  }
  picks.sort(dearest);
  return { picks, matched: fit.length, bands, capped, cappedCards: cappedKeys.size };
}

/* ------------------------------------------------------------- the box */

/** Map<checkoutId, { unsold, sold, pending }> from stream_airings rows. */
export function airingCounts(airings) {
  const m = new Map();
  for (const a of airings || []) {
    if (!a?.checkout_id) continue;
    const k = String(a.checkout_id);
    if (!m.has(k)) m.set(k, { unsold: 0, sold: 0, pending: 0 });
    const e = m.get(k);
    if (a.outcome === "sold") e.sold += 1;
    else if (a.outcome === "unsold") e.unsold += 1;
    else e.pending += 1;
  }
  return m;
}

const dateOf = (iso) => String(iso || "").slice(0, 10);

/**
 * Where every card in the box stands. `checkouts` are OPEN stream checkouts,
 * `streams` are live_streams rows. A stream counts toward the backstop only
 * once it is CLOSED — packed — and only if it was on or after the day the card
 * went in the box.
 *
 * Returns rows of { checkout, aired, pending, streams, due, reason } where
 * `reason` is "aired" (the rule) or "backstop" (nobody reached it).
 */
export function boxStatus(checkouts, airings, streams, {
  airingsBeforeReturn = AIRINGS_BEFORE_RETURN, backstop = STREAMS_BACKSTOP
} = {}) {
  const counts = airingCounts(airings);
  const closedDays = (streams || []).filter((s) => s?.closed_at).map((s) => dateOf(s.streamed_on));
  return (checkouts || []).map((co) => {
    const c = counts.get(String(co.id)) || { unsold: 0, sold: 0, pending: 0 };
    const since = dateOf(co.checked_out_at);
    const attended = closedDays.filter((d) => d && d >= since).length;
    const byAirings = c.unsold >= airingsBeforeReturn;
    const byBackstop = !byAirings && attended >= backstop;
    return {
      checkout: co,
      aired: c.unsold,
      pending: c.pending,
      streams: attended,
      due: byAirings || byBackstop,
      reason: byAirings ? "aired" : byBackstop ? "backstop" : null
    };
  });
}

/**
 * How many cards to add to bring the box back to `target`. Cards due home are
 * already on their way out, so they do not count toward the box.
 */
export function topUpCount(target, status) {
  const staying = (status || []).filter((s) => !s.due).length;
  return Math.max(0, Math.round(Number(target) || 0) - staying);
}

/* ---------------------------------------------------------- the pull sheet */

/**
 * The cards to walk to, stack by stack, numbered where they physically are.
 *
 * `pull` are the checkouts to pull (each with `stack_card_id`), `cards` every
 * unpulled stack card, `stackNames` Map<stackId, name>. Rule 4 at the top:
 * ranked as if the pull set were still in the stacks, and each stack listed
 * deepest first.
 *
 * Returns { stacks: [{ stackId, name, depth, rows: [{ checkout, rank }] }], unplaced: [checkout] }.
 */
export function pullSheet(pull, cards, stackNames = new Map()) {
  const pulling = new Set((pull || []).map((co) => co?.stack_card_id).filter(Boolean).map(String));
  const asFound = (cards || []).map((c) => (pulling.has(String(c.id)) ? { ...c, checked_out_at: null } : c));
  const ranks = liveRanks(asFound);
  const depths = stackDepths(asFound);
  const byId = new Map(asFound.map((c) => [String(c.id), c]));

  const groups = new Map();
  const unplaced = [];
  for (const co of pull || []) {
    const card = co?.stack_card_id ? byId.get(String(co.stack_card_id)) : null;
    const rank = card ? ranks.get(card.id) : undefined;
    if (!card || rank == null) { unplaced.push(co); continue; }
    if (!groups.has(card.stack_id)) {
      groups.set(card.stack_id, {
        stackId: card.stack_id,
        name: stackNames.get(card.stack_id) || co.stack_name || "Stack",
        depth: depths.get(card.stack_id) ?? null,
        rows: []
      });
    }
    groups.get(card.stack_id).rows.push({ checkout: co, rank });
  }
  const stacks = [...groups.values()];
  for (const g of stacks) g.rows.sort((a, b) => b.rank - a.rank);
  stacks.sort((a, b) => compareSku(a.name, b.name));
  return { stacks, unplaced };
}

/**
 * The most recent top-up: the open stream checkouts made on the latest day
 * anything went in the box. That is the set still to be walked to, and it is
 * derived rather than stored so the sheet can be reprinted.
 */
export function latestBatch(checkouts) {
  const open = (checkouts || []).filter((co) => co && !co.resolved_at);
  const last = open.reduce((d, co) => (dateOf(co.checked_out_at) > d ? dateOf(co.checked_out_at) : d), "");
  return last ? open.filter((co) => dateOf(co.checked_out_at) === last) : [];
}

/* ------------------------------------------------------------ the stream */

/**
 * Match the relay's aired lot ids to cards in the box. A lot's id is the
 * listing's eBay item id (StreamButton sends that), so the match is on
 * `ebay_item_id`. An id that matches nothing is counted and never dropped —
 * a card streamed from My listings that was never in the box, or a demo lot.
 */
export function matchAired(ids, openStream) {
  const byItem = new Map();
  for (const co of openStream || []) if (co?.ebay_item_id) byItem.set(String(co.ebay_item_id), co);
  const matched = [];
  const unknown = [];
  const seen = new Set();
  for (const id of ids || []) {
    const k = String(id);
    if (seen.has(k)) continue;
    seen.add(k);
    const co = byItem.get(k);
    if (co) matched.push(co);
    else unknown.push(k);
  }
  return { matched, unknown };
}

/** One stream's figures, from its airings. */
export function streamTally(airings) {
  const t = { aired: 0, sold: 0, unsold: 0, pending: 0, hammerPence: 0 };
  for (const a of airings || []) {
    t.aired += 1;
    if (a.outcome === "sold") {
      t.sold += 1;
      if (a.hammer_pence != null) t.hammerPence += Number(a.hammer_pence) || 0;
    } else if (a.outcome === "unsold") t.unsold += 1;
    else t.pending += 1;
  }
  return t;
}

/** "Stream 25 Sep" — the default name, so starting one is a single tap. */
export function defaultStreamName(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `Stream ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}
