/**
 * The EPN sub-ID a card page's outbound eBay links carry.
 *
 * `customid` is free reporting: it is the difference between "the site earned
 * £14 last month" and "Prismatic Evolutions earned £11 of it". The second is
 * an instruction about what to publish next; the first is trivia. Since there
 * is no analytics on this site — the privacy page promises there is none — the
 * EPN dashboard is the only per-page signal there will ever be, and it only
 * says as much as this function puts into it.
 *
 * Shape: <slot>-<set>-<number>, e.g. buy-hero-prismatic-evolutions-131.
 *
 * THE SLOT STAYS FIRST, and that is the one part not to rearrange. The three
 * slots have been reporting since the campaign ID went live, so a prefix-match
 * on `buy-hero` still selects the same rows it always did and the card is
 * purely additive. Putting the set first would read better for the question
 * being added and would silently break continuity on the question already
 * being answered.
 *
 * Missing parts are dropped rather than filled with a placeholder: an
 * unpublished card reached by a typed URL may have no set, and `buy-row` on
 * its own is what that link reported before this existed.
 */
import { setSlug, slugify } from "./slug.js";

/**
 * Every slot that tags a link, and what reading it tells you. Passing anything
 * else throws — a typo'd slot doesn't fail, it just quietly reports into a
 * bucket nobody looks at, which is the whole failure mode this file exists to
 * prevent.
 */
export const SLOTS = {
  "buy-hero": "the cheapest-listing CTA — the money module",
  "buy-row": "a row in the listings table under it",
  "buy-see-all": "the standing eBay search, when our six rows aren't enough"
};

/** Set slugs are short in practice; the cap is against a catalogue surprise. */
const MAX_SET = 64;

export function cardCustomId(slot, card = {}) {
  if (!Object.hasOwn(SLOTS, slot)) {
    throw new Error(`unknown EPN slot ${JSON.stringify(slot)} — add it to SLOTS first`);
  }
  const set = setSlug(card).slice(0, MAX_SET);
  const number = slugify(card.number);
  return [slot, set, number].filter(Boolean).join("-");
}

export default { SLOTS, cardCustomId };
