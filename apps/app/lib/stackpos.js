/**
 * Comp Finder — where a card actually is in its stack.
 *
 * A card's `position` column is a stable SORT KEY, not the number you count to
 * when you walk to the shelf. The number that matters is its live rank: how
 * many cards are physically in front of it right now. Those differ the moment
 * anything is pulled or taken to a show, and they never converge again.
 *
 * The SKU diverges too, and that is the confusion this file exists to end.
 * Stacks were seeded from eBay SKUs where `A50` meant "Stack A, position 50"
 * (see the auto-create flow in Stacks.js), so for a brand-new stack the SKU and
 * the position agree — which makes it very easy to believe the SKU IS the
 * position. Pull a sold card and everything behind it moves up one; the SKUs
 * stay where they are, because a SKU is a name, not an address.
 *
 * This rule was already written out three times — the finder and the stack
 * list in Stacks.js, and the pick order in PullSheet.js — and a fourth copy on
 * the Show Desk is how they start to disagree. That failure is not subtle in
 * effect but it is invisible on screen: you count to card 12 and pick up the
 * wrong card.
 *
 * Framework-free and app-import-free, so check-stackpos.mjs can load it under
 * bare node.
 */

/**
 * Live 1-based position of every card that is physically in its stack.
 *
 * Two kinds of card are absent and both close the numbering up behind them:
 *
 * - PULLED cards have gone for good (sold, listed elsewhere).
 * - CHECKED-OUT cards are away at a show. They come back — possibly to this
 *   exact spot — but while they are away the stack really has closed up, so
 *   counting to a position must skip them or every card behind one is off by
 *   one for the whole weekend.
 *
 * Returns Map<cardId, rank>. A card that is pulled or away is simply absent
 * from the map: there is no honest number to give it.
 */
export function liveRanks(cards) {
  const byStack = new Map();
  for (const c of cards || []) {
    if (!c || c.pulled_at || c.checked_out_at || !c.stack_id) continue;
    if (!byStack.has(c.stack_id)) byStack.set(c.stack_id, []);
    byStack.get(c.stack_id).push(c);
  }
  const ranks = new Map();
  for (const list of byStack.values()) {
    // Sort by the stored key, with the row id as the tie-break. Two cards can
    // share a position (a hand-filed row, an import), and without a stable
    // second key their order — and so their numbers — would change between
    // renders on the same data.
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)));
    list.forEach((c, i) => ranks.set(c.id, i + 1));
  }
  return ranks;
}

/** How many cards are actually in each stack right now. Map<stackId, count>. */
export function stackDepths(cards) {
  const depths = new Map();
  for (const c of cards || []) {
    if (!c || c.pulled_at || c.checked_out_at || !c.stack_id) continue;
    depths.set(c.stack_id, (depths.get(c.stack_id) || 0) + 1);
  }
  return depths;
}

/**
 * Stack labels in shelf order: A, B, C … Z, then AA, AB — shorter labels
 * first, then alphabetically.
 *
 * A plain string sort puts "AE" straight after "A" and before "B", which is
 * not how the boxes are stacked or how anybody reads them. Anything that isn't
 * a simple letter label falls through to a natural compare, so "Box 2" sorts
 * before "Box 10".
 */
export function compareStackNames(a, b) {
  const na = String(a || "").trim();
  const nb = String(b || "").trim();
  const letterA = /^[A-Za-z]+$/.test(na);
  const letterB = /^[A-Za-z]+$/.test(nb);
  if (letterA && letterB && na.length !== nb.length) return na.length - nb.length;
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Walking order: stack by stack, front to back within each.
 *
 * This is the order you physically pick in — one pass along the shelf, one
 * pass down each box — as opposed to the order you CHOOSE in, which is by
 * value. Takes `{ stackName, rank }`.
 *
 * A card with no rank sorts last rather than first: an unknown position is
 * something to go and look for once the certain ones are in hand.
 */
export function comparePullOrder(a, b) {
  const byStack = compareStackNames(a?.stackName, b?.stackName);
  if (byStack !== 0) return byStack;
  return (a?.rank ?? Number.MAX_SAFE_INTEGER) - (b?.rank ?? Number.MAX_SAFE_INTEGER);
}

/**
 * "A · 12 of 40" — where to walk and how far to count.
 *
 * The depth is worth the extra characters: "12" alone tells you nothing about
 * whether to start counting from the front or the back of the box, and "12 of
 * 40" tells you it is near the front.
 */
export function positionLabel(stackName, rank, depth = null) {
  const stack = String(stackName || "").trim() || "—";
  if (rank == null) return stack;
  return depth ? `${stack} · ${rank} of ${depth}` : `${stack} · ${rank}`;
}
