/**
 * Comp Finder — Show Binders.
 *
 * A Show Binder is a physical binder the cards LIVE in between shows. They
 * stay listed on eBay while it sits at home; before a show the whole binder is
 * checked out at once, so nothing in it can sell online while it is on a
 * table; coming back, the binder is checked IN — every card still in a pocket
 * goes back on sale, and the ones that aren't there were sold.
 *
 * Like the toploader box (lib/toploader.js) a binder is a stack with a
 * reserved name, not a table of its own. That is what makes every screen that
 * already finds a card — the pull sheet, Stacks, the counter's ⌖ locate — find
 * it in a binder with no new code, and why it needs no migration. There can be
 * several: every stack whose name starts "Show Binder" is one.
 *
 * And like the box it has NO POSITIONS (decided 2026-10-19): pockets are not
 * addresses, and a card is found in a binder by flicking through it by name.
 * So it never shows a number, and no filing plan ever chooses it — a card
 * meant for a stack landing in a binder is a card nobody finds.
 *
 * Not the same thing as lib/binder.js, which is the DIGITAL binder — the 3x3
 * pages the Show Desk turns round to a customer. That one is a way of showing
 * stock; this one is somewhere stock is kept.
 *
 * Framework-free and app-import-free, so check-showbinder.mjs can load it
 * under bare node.
 */

/** The one spelling of the prefix. Never written out anywhere else. */
export const SHOW_BINDER_PREFIX = "Show Binder";

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const PREFIX_RE = new RegExp(`^${SHOW_BINDER_PREFIX.toLowerCase()}(?:$|[^a-z])`);

/**
 * Is this a Show Binder? Takes a stack row ({ name }) or a bare name.
 * "Show Binder 2" and "show binder — Pokémon" are; "Binder" and "Show
 * Binders" are not, because a stack someone happened to call that is not one
 * we should stop numbering.
 */
export function isShowBinder(stackOrName) {
  const name = stackOrName && typeof stackOrName === "object" ? stackOrName.name : stackOrName;
  return PREFIX_RE.test(norm(name));
}

/** Every Show Binder among a list of stacks, in name order. */
export function showBindersOf(stacks) {
  return (stacks || [])
    .filter((s) => isShowBinder(s))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
}

/** "Show Binder 3" — one past the highest number already used. */
export function nextBinderName(existingNames) {
  let max = 0;
  for (const n of existingNames || []) {
    if (!isShowBinder(n)) continue;
    const m = /(\d+)\s*$/.exec(String(n).trim());
    max = Math.max(max, m ? Number(m[1]) : 1);
  }
  return `${SHOW_BINDER_PREFIX} ${max + 1}`;
}

/**
 * The part of a binder's name after the prefix — "Pokémon" out of "Show
 * Binder Pokémon" — which is what a rename edits. The prefix itself is not
 * offered for editing: it is what makes the stack a binder, and a rename that
 * dropped it would quietly turn a binder back into a numbered stack.
 */
export function binderSuffix(name) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  return isShowBinder(n) ? n.slice(SHOW_BINDER_PREFIX.length).replace(/^[\s\-—:·]+/, "").trim() : n;
}

/**
 * The full stack name for a rename: the prefix, then what was typed. Typing
 * the prefix as well is forgiven rather than doubled. Returns null for a name
 * that is blank, too long, or already used by ANOTHER stack (case-blind) —
 * two stacks of one name would make every screen that finds a card by its
 * stack name point at the wrong one.
 */
export function renamedBinder(typed, existingNames = [], currentName = "") {
  const rest = binderSuffix(typed);
  if (!rest || rest.length > 40) return null;
  const name = `${SHOW_BINDER_PREFIX} ${rest}`;
  const key = norm(name);
  if (key === norm(currentName)) return name;
  if ((existingNames || []).some((n) => norm(n) === key)) return null;
  return name;
}

/**
 * How full each binder is, and how much of it is away. `cards` is stack_cards
 * rows; `isAway(card)` is the desk's own reading (isCardAway in showfilter.js)
 * so a lost flag cannot make an away card look like it is at home.
 *
 * Returns Map(binderId → { home, away }). A pulled card is gone and counts as
 * neither.
 */
export function binderCounts(binders, cards, isAway = (c) => !!c.checked_out_at) {
  const out = new Map((binders || []).map((b) => [b.id, { home: 0, away: 0 }]));
  for (const c of cards || []) {
    const n = out.get(c.stack_id);
    if (!n || c.pulled_at) continue;
    if (isAway(c)) n.away += 1;
    else n.home += 1;
  }
  return out;
}

/**
 * The binder's checkouts still to check in: open, SHOW pool, out of this
 * binder. The stream box never takes a binder card out, but a checkout row is
 * the one place that can say so, so it is asked.
 */
export function openFromBinder(checkouts, binderId) {
  return (checkouts || []).filter((co) =>
    co && co.stack_id === binderId && !co.resolved_at && (co.pool == null || co.pool === "show")
  );
}

/**
 * Checking a binder back in. `open` is openFromBinder(); `missing` is the set
 * of checkout ids the person holding the binder said are NOT in it.
 *
 * Every open card lands in exactly one list: `back` goes back on sale in the
 * binder, `sold` is recorded as sold at the show. Nothing is left open, which
 * is the point — a card neither relisted nor sold is a listing hidden for
 * ever. An id in `missing` that is not one of the open cards is ignored: it
 * was sold or returned from the desk since the list was drawn.
 */
export function binderCheckIn(open, missing) {
  const gone = missing instanceof Set ? missing : new Set(missing || []);
  const back = [];
  const sold = [];
  for (const co of open || []) (gone.has(co.id) ? sold : back).push(co);
  return { back, sold };
}

export default {
  SHOW_BINDER_PREFIX, isShowBinder, showBindersOf, nextBinderName,
  binderSuffix, renamedBinder, binderCounts, openFromBinder, binderCheckIn
};
