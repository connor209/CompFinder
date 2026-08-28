"use client";

import { normaliseQuery } from "./card-query.js";
import { carryGrade, stripAsk } from "./grade-ask.js";

/**
 * The cards this visitor has actually looked at, on their own device.
 *
 * WHY IT IS NOT A HANDOFF. card-handoff.js carries one card across one
 * navigation and deletes it on read, precisely so it can never answer for a
 * card somebody didn't ask for. This is the opposite: a list, kept, and the
 * visitor's to come back to. Different lifetime, different guarantees, so a
 * different module rather than a second mode on that one.
 *
 * localStorage, and it never leaves the device. There are no accounts here and
 * the privacy page promises no analytics; a history that phoned home would
 * make a liar of both. Every access is wrapped — private browsing throws
 * rather than returning null, and a broken history must cost the list, never
 * the page.
 *
 * DEDUPED BY THE QUERY, NOT THE NAME. "Charizard ex 223 Obsidian Flames" and
 * "Charizard ex 223" are two searches and one card; normaliseQuery is what the
 * cache key and the handoff already agree on, so it is what this agrees with
 * too. Re-looking at a card moves it to the front rather than adding a second
 * row of it.
 */

const KEY = "lc-recent";

/**
 * Eight. Long enough to cover an afternoon of looking things up, short enough
 * that the panel never needs its own scrollbar on a phone — the point is the
 * card you had a minute ago, not an archive.
 */
export const RECENT_LIMIT = 8;

/** Only what a row needs to draw itself and to hand the next screen a head start. */
function trim(card, q) {
  return {
    q,
    name: card.name || q,
    number: card.number || null,
    set: card.set || null,
    image: card.image || null,
    id: card.id || null
  };
}

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    // Anything that isn't a usable row is dropped rather than rendered: this
    // is data from an older build of the site as much as from this one.
    return Array.isArray(list) ? list.filter((r) => r && typeof r.q === "string" && r.q) : [];
  } catch {
    return [];
  }
}

export function readRecent() {
  return load().slice(0, RECENT_LIMIT);
}

/**
 * Record a card the visitor reached. Returns the new list so a caller can
 * render it without a second read.
 */
export function rememberSearch(card, query) {
  const canonical = ((card && card.q) || query || "").trim();
  if (!canonical || !card || !card.name) return readRecent();
  // The row replays the visitor's QUESTION, so a grade they typed rides along
  // — coming back to "PSA 10 Umbreon VMAX" must ask about the slab again, not
  // quietly swap to the raw card. Deduped on the CARD (the ask stripped):
  // the graded and the raw search of one card are one row, and the latest way
  // it was asked is the way the row asks it. Old rows carry no ask and strip
  // to themselves, so a list written by an earlier build dedupes the same.
  const q = carryGrade(query || canonical, canonical);
  const key = normaliseQuery(stripAsk(q));
  const next = [trim(card, q), ...load().filter((r) => normaliseQuery(stripAsk(r.q)) !== key)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode, or storage full — the list is a convenience, not the site */
  }
  return next;
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do: there is no state of ours left to be wrong */
  }
  return [];
}

export default { readRecent, rememberSearch, clearRecent, RECENT_LIMIT };
