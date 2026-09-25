/**
 * Show checkout — shared client-side helpers used by the Show desk and the
 * Stacks module. A checkout flags the stack card as away (live numbering
 * skips it), writes a ledger row in stock_checkouts, and (best-effort) hides
 * the eBay listing via /api/ebay/hide.
 */

/**
 * How to take the listing off sale at checkout. "auto" tries the out-of-stock
 * hide first (needs the seller preference on) and falls back to end & relist;
 * the explicit modes force one path for sellers who know their store setup.
 */
export const HIDE_MODES = [
  { key: "auto", label: "Auto — out-of-stock, else end & relist" },
  { key: "quantity", label: "Out-of-stock (qty 0) only" },
  { key: "ended", label: "End listing & relist on return" },
  { key: "none", label: "Don't touch the listing" }
];

const HIDE_MODE_KEY = "cf-show-hidemode";

export function getHideMode() {
  try {
    const v = localStorage.getItem(HIDE_MODE_KEY);
    return HIDE_MODES.some((m) => m.key === v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setHideMode(mode) {
  try { localStorage.setItem(HIDE_MODE_KEY, mode); } catch { /* best-effort */ }
}

/**
 * Which show we are at. Remembered so the desk opens on the same trip, and
 * read by the Current Deal so a sale made from My listings lands with the
 * event on it — the same trip the desk would have stamped.
 *
 * Here rather than in ShowDesk.js because it now has two readers, and a
 * second copy of a localStorage key is the sort of thing that agrees for a
 * year and then quietly doesn't.
 */
const EVENT_KEY = "cf-show-event";

export function getShowEvent() {
  try { return localStorage.getItem(EVENT_KEY) || ""; } catch { return ""; }
}

export function setShowEvent(name) {
  try { localStorage.setItem(EVENT_KEY, name == null ? "" : String(name)); } catch { /* best-effort */ }
}

/** Find the active eBay item id for a SKU from the synced listings cache. */
export async function findItemIdForSku(sb, sku) {
  if (!sku) return null;
  const { data } = await sb
    .from("ebay_listings")
    .select("ebay_item_id")
    .ilike("sku", sku)
    .limit(1)
    .maybeSingle();
  return data?.ebay_item_id ? String(data.ebay_item_id) : null;
}

const MIGRATION_MSG = "Run migration 016_show_checkouts.sql in the Supabase SQL editor first.";
const STREAM_MIGRATION_MSG = "Run migration 031_stream_stock.sql in the Supabase SQL editor first.";

/**
 * Check a single stack card out to a show — or, with `pool: "stream"`, into
 * the live-stream box (migration 031; see lib/streamstock.js).
 * `card` is a stack_cards row ({ id, stack_id, sku, title, ebay_item_id }).
 * `hideMode` is a HIDE_MODES key (defaults to the saved preference).
 * Returns { ok, checkoutId, itemId, hideMethod, hideError } or { ok:false, error }.
 *
 * A show checkout never NAMES the pool column: the column defaults to 'show',
 * and a show checkout that named it would stop working on a database that has
 * not had 031 applied — the Show Desk taken out by a feature it does not use.
 */
export async function checkoutStackCard(sb, { card, stackName, event, hideMode, pool = "show" }) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // 1) Flag the card as away — live positions re-flow immediately.
  const { error: flagErr } = await sb
    .from("stack_cards")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("id", card.id);
  if (flagErr) {
    const missing = /checked_out_at/i.test(flagErr.message || "");
    return { ok: false, error: missing ? MIGRATION_MSG : flagErr.message, needsMigration: missing };
  }

  // 2) Work out the live listing (card may predate the listing link).
  let itemId = card.ebay_item_id ? String(card.ebay_item_id) : null;
  if (!itemId) itemId = await findItemIdForSku(sb, card.sku);

  // 3) Ledger row.
  const stream = pool === "stream";
  const row = {
    user_id: user.id,
    stack_card_id: card.id,
    stack_id: card.stack_id,
    stack_name: stackName || null,
    sku: card.sku || null,
    title: card.title || null,
    ebay_item_id: itemId,
    event: event || null,
    hide_method: "none"
  };
  if (stream) row.pool = "stream";
  const { data: co, error: coErr } = await sb
    .from("stock_checkouts")
    .insert(row)
    .select("id")
    .single();
  if (coErr) {
    // Roll the flag back so the card isn't stuck half checked-out.
    await sb.from("stack_cards").update({ checked_out_at: null }).eq("id", card.id);
    const noPool = stream && /\bpool\b/i.test(coErr.message || "");
    const missing = noPool || /stock_checkouts/i.test(coErr.message || "");
    return {
      ok: false,
      error: noPool ? STREAM_MIGRATION_MSG : missing ? MIGRATION_MSG : coErr.message,
      needsMigration: missing
    };
  }

  // 4) Hide the listing (best-effort — the checkout stands either way).
  const mode = HIDE_MODES.some((m) => m.key === hideMode) ? hideMode : getHideMode();
  let hideMethod = "none";
  let hideError = null;
  if (mode !== "none" && itemId) {
    try {
      const res = await fetch("/api/ebay/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, mode })
      }).then((r) => r.json());
      if (res.ok) hideMethod = res.method;
      else hideError = res.error || "Couldn't hide the listing.";
    } catch {
      hideError = "Couldn't reach eBay to hide the listing.";
    }
    await sb.from("stock_checkouts").update({ hide_method: hideMethod, hide_error: hideError }).eq("id", co.id);
  }

  return { ok: true, checkoutId: co.id, itemId, hideMethod, hideError };
}

/**
 * Restore a hidden listing at check-in. Returns { restored, newItemId?, error? }.
 * Quantity-hidden items keep their id; ended items are relisted under a new one.
 */
export async function unhideListing(checkout) {
  const itemId = checkout.ebay_item_id;
  if (!itemId || (checkout.hide_method !== "quantity" && checkout.hide_method !== "ended")) {
    return { restored: false };
  }
  try {
    const res = await fetch("/api/ebay/unhide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, method: checkout.hide_method })
    }).then((r) => r.json());
    if (!res.ok) return { restored: false, error: res.error || "Couldn't restore the listing." };
    return { restored: true, newItemId: res.newItemId || null };
  } catch {
    return { restored: false, error: "Couldn't reach eBay to restore the listing." };
  }
}

/** The highest stored position in a stack, so a card filed "to the back" goes behind it. */
export async function maxPosition(sb, stackId) {
  const { data } = await sb
    .from("stack_cards")
    .select("position")
    .eq("stack_id", stackId)
    .not("position", "is", null)
    .order("position", { ascending: false })
    .limit(1);
  return data && data.length ? data[0].position : 0;
}

/**
 * Return one checked-out card to stock: clear the away flag (optionally moving
 * it with `patch`), un-hide its listing, and close the checkout row. Shared by
 * the Show Desk and Stream stock, because two copies of "a card comes home"
 * would disagree about the listing first. Returns any warnings.
 */
export async function restoreCheckout(sb, co, patch, returnMode, returnStackId) {
  const warnings = [];
  if (co.stack_card_id) {
    await sb.from("stack_cards").update({ checked_out_at: null, ...patch }).eq("id", co.stack_card_id);
  } else {
    warnings.push(`${co.sku || "?"}: its stack card no longer exists — add it back by hand.`);
  }
  const u = await unhideListing(co);
  if (u.error) warnings.push(`${co.sku || "?"}: ${u.error}`);
  if (u.newItemId && co.stack_card_id) {
    await sb.from("stack_cards").update({ ebay_item_id: u.newItemId }).eq("id", co.stack_card_id);
  }
  await sb.from("stock_checkouts").update({
    resolved_at: new Date().toISOString(),
    resolution: "returned",
    return_mode: returnMode,
    return_stack_id: returnStackId,
    relisted_item_id: u.newItemId || null
  }).eq("id", co.id);
  return warnings;
}

/** Default cards per stack when the user hasn't set their own. */
export const DEFAULT_STACK_CAPACITY = 100;

/**
 * Work out where a batch of returning cards should go.
 *
 * Coming back from a show you don't care which stack a card started in — you
 * want it filed with the least walking. So: if one stack can swallow the whole
 * batch, use it, choosing the TIGHTEST fit so roomier stacks stay free for the
 * next return. Otherwise fill the roomiest stacks first (fewest stacks touched)
 * and open new ones for whatever is left over.
 *
 * `stacks` is [{ id, name, used }]; returns
 * { groups: [{ stackId, name, count, freeBefore, isNew }], newStacks, capacity }.
 */
export function planReallocation(count, stacks, capacity = DEFAULT_STACK_CAPACITY) {
  const cap = Math.max(1, Number(capacity) || DEFAULT_STACK_CAPACITY);
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) return { groups: [], newStacks: 0, capacity: cap };

  const withSpace = (stacks || [])
    .map((s) => ({ ...s, free: Math.max(0, cap - (s.used || 0)) }))
    .filter((s) => s.free > 0);

  // Best fit: the tightest single stack that still takes the lot.
  const fitsAll = withSpace.filter((s) => s.free >= n).sort((a, b) => a.free - b.free);
  if (fitsAll.length) {
    const s = fitsAll[0];
    return { groups: [{ stackId: s.id, name: s.name, count: n, freeBefore: s.free, isNew: false }], newStacks: 0, capacity: cap };
  }

  // Otherwise spread across the roomiest stacks, then open new ones.
  const groups = [];
  let left = n;
  for (const s of [...withSpace].sort((a, b) => b.free - a.free)) {
    if (left <= 0) break;
    const take = Math.min(s.free, left);
    groups.push({ stackId: s.id, name: s.name, count: take, freeBefore: s.free, isNew: false });
    left -= take;
  }
  const used = (stacks || []).map((s) => s.name);
  let newStacks = 0;
  while (left > 0) {
    const name = nextStackName(used);
    used.push(name);
    const take = Math.min(cap, left);
    groups.push({ stackId: null, name, count: take, freeBefore: cap, isNew: true });
    left -= take;
    newStacks += 1;
  }
  return { groups, newStacks, capacity: cap };
}

/**
 * Next free stack name in warehouse letter order: A…Z, then AA, AB… — skipping
 * names already in use (case-insensitive).
 */
export function nextStackName(existingNames) {
  const used = new Set((existingNames || []).map((n) => String(n).trim().toUpperCase()));
  const A = "A".charCodeAt(0);
  for (let len = 1; len <= 3; len++) {
    const total = 26 ** len;
    for (let i = 0; i < total; i++) {
      let n = i;
      let name = "";
      for (let p = 0; p < len; p++) {
        name = String.fromCharCode(A + (n % 26)) + name;
        n = Math.floor(n / 26);
      }
      if (!used.has(name)) return name;
    }
  }
  return `Stack ${used.size + 1}`;
}
