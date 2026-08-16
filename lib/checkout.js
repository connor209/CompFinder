/**
 * Show checkout — shared client-side helpers used by the Show desk and the
 * Stacks module. A checkout flags the stack card as away (live numbering
 * skips it), writes a ledger row in stock_checkouts, and (best-effort) hides
 * the eBay listing via /api/ebay/hide.
 */

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

/**
 * Check a single stack card out to a show.
 * `card` is a stack_cards row ({ id, stack_id, sku, title, ebay_item_id }).
 * Returns { ok, checkoutId, itemId, hideMethod, hideError } or { ok:false, error }.
 */
export async function checkoutStackCard(sb, { card, stackName, event, hideOnEbay }) {
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
  const { data: co, error: coErr } = await sb
    .from("stock_checkouts")
    .insert({
      user_id: user.id,
      stack_card_id: card.id,
      stack_id: card.stack_id,
      stack_name: stackName || null,
      sku: card.sku || null,
      title: card.title || null,
      ebay_item_id: itemId,
      event: event || null,
      hide_method: "none"
    })
    .select("id")
    .single();
  if (coErr) {
    // Roll the flag back so the card isn't stuck half checked-out.
    await sb.from("stack_cards").update({ checked_out_at: null }).eq("id", card.id);
    const missing = /stock_checkouts/i.test(coErr.message || "");
    return { ok: false, error: missing ? MIGRATION_MSG : coErr.message, needsMigration: missing };
  }

  // 4) Hide the listing (best-effort — the checkout stands either way).
  let hideMethod = "none";
  let hideError = null;
  if (hideOnEbay && itemId) {
    try {
      const res = await fetch("/api/ebay/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId })
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
