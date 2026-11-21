/**
 * Deleting a stack, and every card in it.
 *
 * Asked for 2026-11-21, to rebuild the MTG dividers from scratch. Deleting a
 * `card_stacks` row cascades to its `stack_cards` (migration 008), pulled
 * cards included; a `stock_checkouts` row pointing at one of those cards keeps
 * its history with `stack_card_id` set null (016).
 *
 * The one thing it must never do is delete a card that is AWAY — at a show,
 * in a Show Binder's open checkout, in the stream box. That card comes back
 * through ↩ Return / check-in, which files it into its stack; with the stack
 * gone, its checkout is left pointing at nothing, the listing stays hidden,
 * and nothing anywhere says the card exists. So a stack holding one is
 * refused, naming the cards, and the way out is to check them in first.
 *
 * "Away" is asked both ways, as everywhere else (`isCardAway()`): the card's
 * own flag, and any open checkout naming it, since the flag is one column and
 * can be cleared while a second checkout is still out.
 */

const lc = (s) => String(s || "").trim().toLowerCase();

/**
 * The cards that stop a delete. `cards` are the stacks' `stack_cards` rows,
 * `openCheckouts` the open `stock_checkouts` rows (any pool). Pulled cards
 * never block: they have already left.
 */
export function deleteBlockers(cards, openCheckouts = []) {
  const ids = new Set();
  const skus = new Set();
  for (const co of openCheckouts || []) {
    if (co.resolved_at) continue;
    if (co.stack_card_id) ids.add(String(co.stack_card_id));
    if (co.sku) skus.add(lc(co.sku));
  }
  return (cards || []).filter((c) => !c.pulled_at && (
    c.checked_out_at || ids.has(String(c.id)) || (c.sku && skus.has(lc(c.sku)))
  ));
}

/** "MTG-C37, MTG-C38 and 4 more" — what a refusal names. */
export function nameCards(cards, n = 5) {
  const skus = (cards || []).map((c) => c.sku || c.title || "a card with no SKU");
  if (skus.length <= n) return skus.join(", ");
  return `${skus.slice(0, n).join(", ")} and ${skus.length - n} more`;
}

/** The confirm text: what goes, in numbers. */
export function deleteSummary(stacks, cards) {
  const live = (cards || []).filter((c) => !c.pulled_at).length;
  const pulled = (cards || []).length - live;
  const what = stacks.length === 1 ? `stack ${stacks[0].name}` : `${stacks.length} stacks (${stacks.map((s) => s.name).join(", ")})`;
  return `Delete ${what} and the ${live} card${live === 1 ? "" : "s"} in ${stacks.length === 1 ? "it" : "them"}` +
    (pulled ? `, plus ${pulled} pulled card${pulled === 1 ? "" : "s"} kept for history` : "") +
    ". This can't be undone.";
}

/**
 * Read what a delete would remove. Every read names `user_id`.
 * Returns { cards, blockers, error }. A failed read is an ERROR, never "no
 * cards": deleting on a short read is how a card at a show gets lost.
 */
export async function planDelete(sb, userId, stackIds) {
  const ids = [...new Set(stackIds || [])];
  if (!ids.length) return { cards: [], blockers: [], error: null };
  const cards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("stack_cards")
      .select("*")
      .eq("user_id", userId)
      .in("stack_id", ids)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) return { cards: [], blockers: [], error: error.message };
    cards.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const live = cards.filter((c) => !c.pulled_at);
  let open = [];
  if (live.length) {
    const cardIds = live.map((c) => c.id);
    for (let i = 0; i < cardIds.length; i += 200) {
      const { data, error } = await sb
        .from("stock_checkouts")
        .select("id,stack_card_id,sku,resolved_at")
        .eq("user_id", userId)
        .is("resolved_at", null)
        .in("stack_card_id", cardIds.slice(i, i + 200));
      // A table that is not there (016 never run) has no open checkouts;
      // anything else is unknown, and unknown refuses.
      if (error && !/stock_checkouts|does not exist|schema cache/i.test(error.message || "")) {
        return { cards: [], blockers: [], error: error.message };
      }
      open.push(...(data || []));
    }
  }
  return { cards, blockers: deleteBlockers(cards, open), error: null };
}

/**
 * Delete the stacks, after `planDelete()` found nothing away. Plans again
 * itself rather than trusting the caller's read, since a confirm dialog can
 * sit open while a card is checked out on another screen.
 * Returns { deleted, cards, blockers, error }.
 */
export async function deleteStacks(sb, userId, stackIds) {
  const plan = await planDelete(sb, userId, stackIds);
  if (plan.error) return { deleted: 0, cards: 0, blockers: [], error: plan.error };
  if (plan.blockers.length) return { deleted: 0, cards: 0, blockers: plan.blockers, error: null };
  let deleted = 0;
  for (const id of new Set(stackIds)) {
    const { error } = await sb.from("card_stacks").delete().eq("id", id).eq("user_id", userId);
    if (error) return { deleted, cards: plan.cards.length, blockers: [], error: error.message };
    deleted += 1;
  }
  return { deleted, cards: plan.cards.length, blockers: [], error: null };
}
