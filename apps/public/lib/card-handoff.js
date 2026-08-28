"use client";

import { normaliseQuery } from "./card-query.js";
import { stripAsk } from "./grade-ask.js";

/**
 * Carries the card a visitor CLICKED across the navigation to its page.
 *
 * /api/suggest already returns the whole card — id, name, number, set, image —
 * and the dropdown throws all of it away, navigating with just the text. The
 * card screen then calls /api/resolve to work out the card it was just handed,
 * which measured at half a second on the critical path of every search.
 *
 * So: stash it on the way out, take it on the way in. Not a cache — a handoff.
 * It is deliberately SINGLE USE, deleted on read, because the moment it
 * outlives the navigation it becomes a way to show someone a card they didn't
 * ask for: a stale entry under a query someone types later is worse than the
 * resolve it saved.
 *
 * sessionStorage rather than localStorage: per tab, and gone when the tab is.
 * Every access is wrapped — private browsing throws rather than returning null,
 * and a handoff failing must cost a resolve, never the page.
 *
 * Published cards never get here: the server has already seeded them from
 * cache, so this is the long tail — everything outside the 455.
 */
const KEY = "lc-handoff";

export function remember(card) {
  if (!card || !card.name) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(card));
  } catch {
    /* private mode, or storage full — the resolve still works */
  }
}

/**
 * The stashed card, if it is the one this page is for. Removed either way:
 * a handoff that doesn't match is a handoff for a journey that didn't happen.
 */
export function take(query) {
  let raw;
  try {
    raw = sessionStorage.getItem(KEY);
    if (raw) sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const card = JSON.parse(raw);
    // The guard that matters. Matching on the query the card produces — not on
    // whatever was stored last — is what stops a stale entry answering for a
    // different card. stripAsk on the incoming side only: a grade in the URL
    // ("PSA 10 Umbreon VMAX 215/203…") is the visitor's question about their
    // copy, not a different card, and without the strip every graded pick
    // paid the resolve this handoff exists to save.
    const want = normaliseQuery([card.name, card.number || "", card.set || ""].join(" "));
    return want && want === normaliseQuery(stripAsk(query)) ? card : null;
  } catch {
    return null;
  }
}

export default { remember, take };
