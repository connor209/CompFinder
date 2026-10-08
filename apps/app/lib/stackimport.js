/**
 * Which listings become stack cards, and where.
 *
 * Stacks were seeded from eBay SKUs where `A50` means "Stack A, position 50",
 * and that reading is the only one in this file: Stacks → Auto-import, the
 * listings sync and the pull sheet's "add to their stacks" all go through
 * `stackOfSku()`. Three readings would disagree about a SKU like `FY-18`
 * eventually, and the disagreement is a card in two stacks or in none.
 *
 * Why the SYNC does it now. Auto-import reads the synced active listings, and
 * the sync replaces those with eBay's ActiveList — so a single card that sold
 * before anybody pressed Auto-import has an ended listing, its SKU exists only
 * on the order, and the pull sheet could only file it as a loose pick. Run on
 * every sync, a card is in its stack from the first sync after it is listed,
 * which is long before it sells.
 */
import { isListingAvailable } from "./stockcheck.js";

/**
 * `A50` → { stack: "A", pos: 50 }. Letters then a number, an optional `-`,
 * `_` or space between. Anything else — a dated batch SKU like
 * `26.08.06-010-029` — names no stack, and gets null.
 */
export function stackOfSku(sku) {
  const m = String(sku ?? "").trim().match(/^([A-Za-z]+)[-_ ]?(\d{1,4})$/);
  return m ? { stack: m[1].toUpperCase(), pos: parseInt(m[2], 10) } : null;
}

/**
 * What to add. Pure: the caller reads, this decides, the caller writes.
 *
 *   listings      ebay_listings rows ({ sku, title, ebay_item_id, quantity })
 *   existingSkus  every SKU already on a stack card — PULLED ONES INCLUDED, so
 *                 a card pulled and later relisted is not added a second time
 *   stacks        card_stacks rows ({ id, name })
 *
 * A listing at quantity zero is skipped: that is a sold card eBay left in the
 * ActiveList (or one we zeroed for a show, which already has its stack card),
 * and adding it would put a card that has GONE into a stack as present —
 * every card behind it would then count one too far. A missing quantity is
 * unknown, not zero, the same rule as everywhere else.
 *
 * One card per SKU, as Auto-import always did.
 *
 * Returns { rows: [{ stack, position, sku, title, ebay_item_id }],
 *           newStacks: [name], unparseable, already, soldOut }.
 */
export function planStackImport({ listings, existingSkus, stacks }) {
  const have = new Set();
  for (const s of existingSkus || []) if (s) have.add(String(s).trim().toLowerCase());
  const known = new Set((stacks || []).map((s) => String(s.name ?? "").trim().toUpperCase()));

  const rows = [];
  const newStacks = new Set();
  let unparseable = 0;
  let already = 0;
  let soldOut = 0;
  for (const l of listings || []) {
    const sku = String(l?.sku ?? "").trim();
    if (!sku) continue;
    const at = stackOfSku(sku);
    if (!at) { unparseable += 1; continue; }
    const k = sku.toLowerCase();
    if (have.has(k)) { already += 1; continue; }
    if (!isListingAvailable(l)) { soldOut += 1; continue; }
    have.add(k); // a SKU on two listings is still one card
    if (!known.has(at.stack)) newStacks.add(at.stack);
    rows.push({ stack: at.stack, position: at.pos, sku, title: l.title || "", ebay_item_id: l.ebay_item_id ?? null });
  }
  return { rows, newStacks: [...newStacks], unparseable, already, soldOut };
}

/**
 * Do it, with any Supabase client. The service-role client the sync holds is
 * not filtered by RLS, so every read here is filtered on `userId` by hand.
 *
 * `onlyIfStacks`: the sync passes true, so somebody who has never made a stack
 * is not handed fifty of them by a background job. Auto-import is the button
 * that asks for them, and passes false.
 *
 * Returns { added, created, ...plan counts } or { skipped: "no-stacks" }.
 */
export async function importStackCards(sb, userId, listings, { onlyIfStacks = false } = {}) {
  const { data: stacks, error: se } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (se) throw new Error(se.message);
  if (onlyIfStacks && !(stacks || []).length) return { skipped: "no-stacks", added: 0, created: 0 };

  const existing = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("stack_cards").select("sku").eq("user_id", userId)
      .not("sku", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    existing.push(...(data || []).map((r) => r.sku));
    if (!data || data.length < 1000) break;
  }

  const plan = planStackImport({ listings, existingSkus: existing, stacks });
  const idByName = new Map((stacks || []).map((s) => [String(s.name ?? "").trim().toUpperCase(), s.id]));
  let created = 0;
  for (const name of plan.newStacks) {
    const { data, error } = await sb.from("card_stacks").insert({ user_id: userId, name }).select("id").single();
    if (error || !data) throw new Error(error?.message || `Couldn't create stack ${name}.`);
    idByName.set(name, data.id);
    created += 1;
  }
  const rows = plan.rows.map((r) => ({
    user_id: userId, stack_id: idByName.get(r.stack), position: r.position,
    sku: r.sku, title: r.title, ebay_item_id: r.ebay_item_id
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("stack_cards").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { added: rows.length, created, unparseable: plan.unparseable, already: plan.already, soldOut: plan.soldOut };
}

/**
 * One line for a sync message. Silent when nothing happened, so an ordinary
 * sync reads as it always has — but never silent about a failure, because a
 * card that missed its stack is exactly the one the pull sheet later can't
 * place.
 */
export function stackedNote(stacked) {
  if (!stacked || stacked.skipped) return "";
  if (stacked.error) return ` Couldn't add new SKUs to stacks: ${stacked.error}`;
  if (!stacked.added) return "";
  const made = stacked.created ? `, ${stacked.created} new stack${stacked.created === 1 ? "" : "s"}` : "";
  return ` Added ${stacked.added} new card${stacked.added === 1 ? "" : "s"} to stacks${made}.`;
}
