/**
 * What the SERVER puts in a card page's HTML.
 *
 *   node scripts/check-cardpage.mjs      (or: npm run check)
 *
 * The card screen is a client component that fetches on mount, so for most of
 * its life the HTML leaving the server was a spinner: a crawler got no price
 * on the one surface built to be crawled, and every uncached view cost a
 * SoldComps request against a URL space where any string is a valid page.
 *
 * seeded() is the fix, and it is easy to break without noticing — move the
 * seeding into an effect, or let it return "loading" for a card we did have
 * cached, and the page still WORKS in a browser while going silent for
 * everything that doesn't run JavaScript. Nothing visible would tell you.
 *
 * So: a published card with a cache entry must come back ready, with a price.
 * Anything else must come back loading, so the existing client path runs
 * unchanged rather than a half-rendered page being served.
 */
import { findPublished, publishedCards, publishedSets, siblingsOf } from "../apps/public/lib/card-page.js";
import { seeded } from "../apps/public/lib/use-card.js";

// card-handoff.js talks to sessionStorage, which doesn't exist under node.
// Stubbed rather than skipped: the guard it implements is the whole reason the
// handoff is safe, so it has to be exercised somewhere.
globalThis.sessionStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
})();
const { remember, take } = await import("../apps/public/lib/card-handoff.js");

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };

// --- 1. which URLs we stand behind ------------------------------------------
const CARDS = publishedCards();
if (CARDS.length < 400) fail(`only ${CARDS.length} published cards — expected the 455-card chase set`);
if (!CARDS.every((e) => e.id && e.q)) fail("a manifest entry is missing an id or a query");

// The exact URL the live page used on 24 Aug, and the spellings a link or a
// share can arrive in. Missing these means the server silently declines to
// render and the page quietly reverts to a spinner.
const HIT = "Umbreon VMAX 215 Evolving Skies";
if (!findPublished(HIT)) fail(`the published set doesn't contain "${HIT}"`);
if (!findPublished("  umbreon  VMAX 215   evolving skies ")) fail("matching is sensitive to case or spacing");
eq("an unpublished query is left to the client", findPublished("something nobody published"), null);
eq("an empty query matches nothing", findPublished(""), null);

// Two cards must never share a URL: whichever the resolver picked would own
// the other's page and price it under the other's name.
const seen = new Set();
for (const e of CARDS) {
  const key = e.q.toLowerCase().replace(/\s+/g, " ").trim();
  if (seen.has(key)) fail(`two published cards share the URL "${e.q}"`);
  seen.add(key);
}

// --- 2. a cached price reaches the HTML -------------------------------------
const DAY = 86400000;
const now = Date.now();
const comp = (pence, ageDays, title = "Umbreon VMAX 215/203 Evolving Skies Alt Art") => ({
  title,
  itemPricePence: pence,
  postagePence: 0,
  totalPence: pence,
  itemLocation: null,
  _source: { itemId: `${pence}-${ageDays}`, url: `https://www.ebay.co.uk/itm/${pence}`, endedAt: new Date(now - ageDays * DAY).toISOString(), currency: "GBP" }
});
const CARD = { id: 574273, name: "Umbreon VMAX", number: "215", set: "Evolving Skies", q: HIT };
const SOLD = {
  comps: [comp(80000, 2), comp(84000, 7), comp(79000, 13), comp(88000, 20), comp(83000, 29), comp(94995, 1)],
  hasNextPage: false,
  rawItemCount: 6,
  fetchedAt: new Date(now - 3 * DAY).toISOString()
};

const state = seeded({ card: CARD, sold: SOLD }, HIT, 90);
eq("a cached card renders ready, not loading", state.status, "ready");
if (state.status === "ready") {
  if (state.derived?.marketPence == null) fail("ready state carries no price — the HTML would show a dash");
  if (!state.derived.used) fail("no comps counted, so nothing to show");
  if (!state.derived.sales?.length) fail("no sales list in the server-rendered state");
  // The buy module is deliberately NOT server-rendered: asking prices are two
  // hours fresh at best and a cache entry can be a month old, so a rendered
  // "buy it today for" would tag a listing that may have sold days ago.
  eq("listings are left for the browser", state.listingsPending, true);
  eq("no listings in the seeded state", state.derived.listings.length, 0);
  eq("and therefore no hero listing to link", state.derived.cheapest, null);
  if (!state.fromCache) fail("the state doesn't carry when it was priced");
}

// --- 3. everything else falls through ---------------------------------------
// These must all return loading so the client path runs exactly as before.
for (const [label, initial] of [
  ["nothing from the server", null],
  ["a card but no cache entry", { card: CARD, sold: null }],
  ["a cache entry but no card", { card: null, sold: SOLD }],
  ["an empty object", {}]
]) {
  eq(`falls back to the client: ${label}`, seeded(initial, HIT, 90).status, "loading");
}

// --- 4. the dropdown handoff can only answer for its own card --------------
// The dropdown hands the clicked card forward so the next screen doesn't have
// to re-resolve it. That saves half a second and introduces one risk worth
// testing: a handoff that outlives its journey would show someone a card they
// never asked for — silently, and with a confident price on it.
const PICKED = { id: 574273, name: "Umbreon VMAX", number: "215", set: "Evolving Skies" };

remember(PICKED);
const wrongCard = take("Charizard ex 199 151");
eq("a handoff never answers for a different card", wrongCard, null);
// ...and taking it for the wrong card clears it, so it can't lie in wait.
remember(PICKED);
eq("the right query gets the card", take(HIT)?.id, PICKED.id);
eq("and it is single use", take(HIT), null);

// Spacing and case are how the same card arrives from a link versus a click.
remember(PICKED);
eq("matching survives spacing and case", take("  umbreon  VMAX 215   evolving skies ")?.id, PICKED.id);

// Nothing stored, nothing claimed.
eq("no handoff, no card", take(HIT), null);
// Junk in storage must not throw on the way to a page.
sessionStorage.setItem("lc-handoff", "{not json");
eq("unparseable handoff is ignored", take(HIT), null);
remember(null);
eq("remembering nothing stores nothing", take(HIT), null);

// --- 5. internal linking actually spreads ----------------------------------
// The sibling strip exists so 450 card pages stop being dead ends. Taking the
// first six of each set would defeat it: six pages would collect every
// internal link in the set and the rest none, which is the opposite of the
// point. The window starts at each card's own position and wraps, so this
// asserts the property rather than the implementation.
const SETS = publishedSets();
if (SETS.length < 50) fail(`only ${SETS.length} sets — expected ~92`);

const multi = SETS.filter((s2) => s2.cards.length > 8).slice(0, 5);
if (!multi.length) fail("no set big enough to test link spread");
for (const set of multi) {
  const linked = new Set();
  for (const c of set.cards) for (const s2 of siblingsOf(c.q).siblings) linked.add(s2.id);
  if (linked.size !== set.cards.length) {
    fail(`${set.name}: only ${linked.size} of ${set.cards.length} cards receive an internal link`);
  }
  // A card must never link to itself — a self-link is a dead end wearing a
  // different hat, and it wastes one of only six slots.
  for (const c of set.cards) {
    if (siblingsOf(c.q).siblings.some((s2) => s2.id === c.id)) fail(`${c.name} links to itself`);
  }
}

// Every sibling has to carry its collector number, or three different
// Duraludon VMAX in one set render as three identical links.
const sample = siblingsOf(multi[0].cards[0].q).siblings;
if (sample.some((c) => !c.number)) fail("a sibling has no collector number to distinguish it");
if (sample.some((c) => !c.q)) fail("a sibling has no query, so its link would go nowhere");

// An unpublished card has no set and no strip — it must not throw.
const orphan = siblingsOf("something nobody published");
eq("an unpublished card has no set", orphan.set, null);
eq("and no siblings", orphan.siblings.length, 0);

if (failures) {
  console.error(`\ncard page: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`card page: ${CARDS.length} published, collision-free; a cached card server-renders a price, everything else falls through; the dropdown handoff only answers for its own card; internal links reach every card in a set.`);
