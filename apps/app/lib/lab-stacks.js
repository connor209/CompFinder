/**
 * Lab cards in the stacks (docs/LAB_FOLD.md). Pure: what a lab stack is
 * called, whether a stack card is a lab card, and how a lab_copies row
 * becomes a stack_cards row. lab-store.js does the reading and writing.
 */

/**
 * A lab pile is a stack named LAB-<pile>: TEST2-14 lives in LAB-TEST2. The
 * prefix keeps lab stacks together on Stacks, and is how filing plans know
 * to leave them alone — a returned show card filed into a lab stack would sit
 * among copies of a listing it isn't on.
 */
export const LAB_STACK_PREFIX = "LAB-";

export function isLabStack(stackOrName) {
  const name = typeof stackOrName === "string" ? stackOrName : stackOrName?.name;
  return String(name || "").toUpperCase().startsWith(LAB_STACK_PREFIX);
}

/** The stack a lab SKU belongs in: "TEST2-14" → "LAB-TEST2". */
export function labStackNameFor(sku) {
  const s = String(sku || "").trim();
  const m = s.match(/^(.*?)[-_ ]?(\d+)$/);
  const pile = (m && m[1] ? m[1] : s).toUpperCase();
  return `${LAB_STACK_PREFIX}${pile}`;
}

/** The SKU's trailing number — its place in the scan, used to order the move. */
export function skuNumber(sku) {
  const m = String(sku || "").trim().match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Is this stack card a lab card? The one test; never a name or SKU pattern. */
export const isLabCard = (card) => Boolean(card?.lab_listing_id);

/**
 * The plan for moving lab_copies into stack_cards, worked out before anything
 * is written. For each unmoved copy:
 *   - "adopt"  an unpulled stack card with the same SKU and no lab listing
 *              already exists: it IS this card, so it becomes the lab card
 *              where it already sits;
 *   - "insert" a new stack card in LAB-<pile>, after what's already there;
 *   - "refuse" the SKU is on a stack card that is pulled or already a lab
 *              card — named, never overwritten.
 * Copies are placed in scan order (SKU number, then file order), so the
 * stack's order is the pile's order.
 */
export function movePlan(labCopies, stackCards, stacks) {
  const bySku = new Map();
  for (const c of stackCards || []) if (c?.sku) {
    const k = String(c.sku).trim().toLowerCase();
    if (!bySku.has(k)) bySku.set(k, []);
    bySku.get(k).push(c);
  }
  const stackByName = new Map((stacks || []).map((s) => [String(s.name).toUpperCase(), s]));
  const nextPos = new Map(); // stack name → next position
  for (const s of stacks || []) {
    const top = (stackCards || []).filter((c) => c.stack_id === s.id).reduce((m, c) => Math.max(m, Number(c.position) || 0), 0);
    nextPos.set(String(s.name).toUpperCase(), top + 1);
  }
  const todo = (labCopies || []).filter((c) => !c.stack_card_id)
    .slice().sort((a, b) => labStackNameFor(a.sku).localeCompare(labStackNameFor(b.sku)) || skuNumber(a.sku) - skuNumber(b.sku) || (a.pile_seq - b.pile_seq) || String(a.id).localeCompare(String(b.id)));
  const steps = [];
  const newStacks = new Set();
  for (const c of todo) {
    const same = bySku.get(String(c.sku).trim().toLowerCase()) || [];
    const live = same.filter((s) => !s.pulled_at && !s.lab_listing_id);
    if (same.some((s) => s.lab_listing_id) || (same.length && !live.length)) {
      steps.push({ kind: "refuse", copy: c, why: same.some((s) => s.lab_listing_id) ? "already a lab card on a stack" : "on a stack, but pulled" });
      continue;
    }
    if (live.length === 1) { steps.push({ kind: "adopt", copy: c, stackCard: live[0] }); continue; }
    if (live.length > 1) { steps.push({ kind: "refuse", copy: c, why: `${live.length} stack cards share this SKU` }); continue; }
    const name = labStackNameFor(c.sku);
    if (!stackByName.has(name)) newStacks.add(name);
    const pos = nextPos.get(name) || 1;
    nextPos.set(name, pos + 1);
    steps.push({ kind: "insert", copy: c, stackName: name, position: pos });
  }
  return { steps, newStacks: [...newStacks] };
}

/** The stack card a lab copy becomes (the fields the move writes). */
export function stackRowFrom(copy, listing) {
  return {
    sku: copy.sku,
    title: listing?.title || null,
    lab_listing_id: copy.listing_id,
    scan_urls: copy.scan_urls || [],
    copy_seq: copy.copy_seq ?? null,
    reserved_line: copy.reserved_line || null,
    reserved_order: copy.reserved_order || null,
    reserved_at: copy.reserved_at || null,
    reserved_mismatch: Boolean(copy.reserved_mismatch),
    pulled_at: copy.pulled_at || null,
    added_at: copy.added_at || new Date().toISOString()
  };
}

/**
 * A stack card in the shape the lab's rules read (lab-copies.js was written
 * over lab_copies rows). `ranks` is stackpos.liveRanks over every card in the
 * card's stack, and `names` maps stack id to name, so a lab card's position
 * is the same number Stacks and the pull sheet show.
 */
export function asLabCopy(card, { ranks, names } = {}) {
  return {
    id: card.id,
    listing_id: card.lab_listing_id,
    sku: card.sku,
    pile_seq: Number(card.position) || 0,
    copy_seq: card.copy_seq,
    scan_urls: card.scan_urls || [],
    added_at: card.added_at,
    reserved_line: card.reserved_line || null,
    reserved_order: card.reserved_order || null,
    reserved_at: card.reserved_at || null,
    reserved_mismatch: Boolean(card.reserved_mismatch),
    pulled_at: card.pulled_at || null,
    checked_out_at: card.checked_out_at || null,
    stack_id: card.stack_id,
    pile: names?.get(card.stack_id) || null,
    live_position: ranks?.get(card.id) || null
  };
}

/**
 * What the LAB badge says, everywhere. One wording, so every screen explains
 * the same thing the same way.
 */
export const LAB_BADGE_TITLE =
  "Listed by the lab: one eBay listing for every copy of this card, showing the photos of the copy that goes next. " +
  "Being tested — not part of shows, the stream box or deals yet. Managed from the lab page.";

/** Why a lab card can't be checked out, dealt or pulled by hand. */
export const LAB_CARD_REFUSAL = "This is a lab card — its copies are managed by the lab, not checked out or pulled by hand yet.";
