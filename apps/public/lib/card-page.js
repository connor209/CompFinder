/**
 * Server-side reads for a card page: enough to put a price in the HTML
 * without the browser having run anything, and without spending an API call.
 *
 * WHY THIS EXISTS. The card screen is a client component that fetches on
 * mount, so a crawler sees a spinner where the answer should be — and every
 * uncached view costs a SoldComps request against a URL space where any string
 * is a valid page. Card pages are supposed to be the acquisition surface; a
 * page whose content only exists after JavaScript runs isn't one.
 *
 * The trade this makes: only PUBLISHED cards are server-rendered. Matching an
 * arbitrary /card/<anything> would mean resolving it server-side, which is 200
 * lines of candidate-ranking living in /api/resolve, and a URL space anyone
 * can walk. A published card is one we already chose to stand behind, so its
 * id is known from the manifest without resolving anything, and everything
 * else falls back to the existing client path unchanged.
 *
 * IT ONLY EVER READS THE CACHE. Filling it is the warmer's job. A published
 * card with nothing cached renders exactly as it does today — the browser
 * fetches — rather than a crawler triggering an upstream call.
 */
import { createServiceClient, createPublicClient } from "./supabase.js";
import { selectCatalog } from "./catalog-select.js";
import { cardFromRow, queryForCard, normaliseQuery } from "./card-query.js";
import { stripAsk } from "./grade-ask.js";
import { cacheKeyFor } from "./cache-key.js";
import { DEFAULT_SOLD_WINDOW, deriveWindow } from "./windows.js";
import { priceCard } from "./price.js";
import PUBLISHED from "./published-cards.js";

/**
 * How stale a cached price may be before the server stops rendering it.
 *
 * Far longer than /api/price's 24h TTL because they answer different
 * questions: that TTL decides when to SPEND a request refreshing, this decides
 * whether an answer already paid for is worth showing. On a 2,000-request
 * month the honest warm cadence for 455 cards is monthly, so 35 days is one
 * cycle plus slack for a run that slipped. Beyond it the page falls back to
 * fetching live, which is what it does today anyway.
 */
export const MAX_SERVER_PRICE_AGE_DAYS = 35;

const BY_QUERY = new Map(PUBLISHED.map((e) => [normaliseQuery(e.q), e]));

export function publishedCards() {
  return PUBLISHED;
}

/** Is this URL one of the cards we stand behind? Anything else is left to the client. */
export function findPublished(query) {
  return BY_QUERY.get(normaliseQuery(query || "")) || null;
}

/**
 * The catalogue row, through the same mapping /api/resolve uses — so the query
 * built from it is byte-identical to the one a visitor's click would build,
 * and hits the same cache entry. Anon client: card_catalog is public-readable
 * by policy, and a page render has no reason to hold the service key.
 */
export async function loadCard(cardmarketId) {
  const supabase = createPublicClient();
  const { data, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).eq("cardmarket_id", cardmarketId).maybeSingle()
  );
  // A failed query and a missing row are different answers. This one is only
  // ever an optimisation — the client still fetches — so both degrade to null
  // rather than throwing a render away over a transient fault.
  if (error || !data) return null;
  return cardFromRow(data);
}


/** Cached sold comps for a card, or null. Never fetches. */
export async function loadCachedSold(card, { windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS } = {}) {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    // No service key (a local checkout, a preview without the env var). The
    // page renders and the browser fetches, exactly as before this existed.
    return null;
  }
  const key = cacheKeyFor(queryForCard(card), true, windowDays);
  const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from("soldcomps_cache")
    .select("payload, fetched_at")
    .eq("cache_key", key)
    .gte("fetched_at", notBefore)
    .maybeSingle();
  if (error || !data) return null;
  return {
    comps: data.payload?.comps || [],
    // null rather than false when the entry predates the field: "we don't
    // know" and "there is no next page" lead to opposite conclusions about
    // whether the set was capped, and a fast card reads as slow if you coerce.
    hasNextPage: data.payload?.hasNextPage ?? null,
    rawItemCount: data.payload?.rawItemCount ?? (data.payload?.comps || []).length,
    fetchedAt: data.fetched_at
  };
}

/**
 * Everything the server can hand the card screen for a published card, or null
 * when it can't help and the client should do what it always did.
 */
export async function serverCard(query, windowDays = DEFAULT_SOLD_WINDOW) {
  const entry = findPublished(query);
  if (!entry) return null;
  const card = await loadCard(entry.id);
  if (!card) return null;

  // ALWAYS read the ninety-day entry, whatever window was asked for. It is the
  // only one the warmer fills, and a shorter window is a subset of it — so
  // reading it and narrowing gives ?days=30 a server-rendered price too, where
  // before it found nothing under its own key and fell through to the client
  // every single time.
  const wide = await loadCachedSold(card, { windowDays: DEFAULT_SOLD_WINDOW });
  if (!wide || !wide.comps.length) return null;

  // Null when the wide set was capped, and then the client fetches the real
  // narrow window — see deriveWindow for why a capped set can't be filtered.
  const sold = deriveWindow(wide, windowDays);
  if (!sold || !sold.comps.length) return null;

  return { card: { ...card, q: queryForCard(card) }, sold };
}

/**
 * What a card URL tells search engines about itself.
 *
 * ONE LOOKUP, TWO MUTUALLY EXCLUSIVE ANSWERS, and the exclusivity is the
 * point. Either we can name the published page this URL is a spelling of — and
 * we say so with a canonical, and it is a page for the index — or we cannot,
 * and then it is not a page for the index at all.
 *
 * Never both, by construction. A URL carrying `noindex` AND a canonical
 * pointing elsewhere is the one combination Google names as conflicting: the
 * noindex can carry across to the canonical target, which here would be a card
 * page we DO stand behind. Branching on a single lookup makes that
 * unrepresentable rather than merely avoided.
 *
 * WHY THE UNPUBLISHED SIDE IS NOINDEX. Any string is a valid /card/ URL, so
 * this is an unbounded space — every typo, every long-tail card, and since the
 * grade started riding in the URL, every "PSA 10 …" variant of all 455 as
 * well. None of them server-renders anything: serverCard only answers for the
 * published set, so what a crawler gets is the spinner. The sitemap has always
 * refused to submit those ("a thin page submitted in bulk demotes the good
 * ones with it") while the pages themselves stayed indexable if discovered any
 * other way, which left the sitemap and the pages giving different answers
 * about the same URL — the same shape of split that robots.txt and the page
 * metadata are kept in step to avoid.
 *
 * A published card that is not currently warm stays INDEXABLE. It is one of
 * the 455 we chose to stand behind and the warmer is coming back to it;
 * noindex is a slow signal to undo, and spending it on a cache gap would be
 * trading a thin page for a lost one. This is also why the test is the
 * manifest and not the cache: a manifest lookup cannot fail transiently, and
 * a Supabase blip must never be able to noindex the site.
 *
 * `follow` stays true: the long-tail page still carries a set strip and links
 * up to pages that ARE published, and that is the one useful thing about it.
 * When the site-wide flag is shut, layout.js is stricter and robots.txt has
 * already said don't crawl; this only ever ADDS a noindex, never removes one.
 */
export const NOT_FOR_INDEX = { index: false, follow: true };

export function cardPageDirectives(query) {
  const entry = findPublished(query);
  return entry
    ? { canonical: `/card/${encodeURIComponent(entry.q)}`, robots: null }
    : { canonical: null, robots: NOT_FOR_INDEX };
}

/**
 * The published cards that currently have a price, for the sitemap.
 *
 * Only priced ones, deliberately: a card page with nothing cached is honest
 * but thin, and submitting hundreds of thin pages demotes the good ones with
 * them. The list grows as the warmer works through the set.
 *
 * One catalogue read for the whole set, then cache lookups in chunks —
 * PostgREST puts the filter in the URL, so 455 sixty-four-character keys in
 * one `in()` would be a ~29KB query string.
 */
export async function pricedCards({ windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS } = {}) {
  const supabase = createPublicClient();
  const { data: rows, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).in("cardmarket_id", PUBLISHED.map((e) => e.id))
  );
  if (error || !rows) return [];

  const byId = new Map(rows.map((row) => [row.cardmarket_id, cardFromRow(row)]));
  const wanted = [];
  for (const entry of PUBLISHED) {
    const card = byId.get(entry.id);
    if (!card) continue;
    const q = queryForCard(card);
    wanted.push({ q, key: cacheKeyFor(q, true, windowDays) });
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    // Without the key we can't tell which are priced. An empty sitemap is
    // recoverable; one full of blank pages is not.
    return [];
  }

  const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const present = new Set();
  for (let i = 0; i < wanted.length; i += 40) {
    const keys = wanted.slice(i, i + 40).map((w) => w.key);
    const { data, error: cacheError } = await service
      .from("soldcomps_cache").select("cache_key").in("cache_key", keys).gte("fetched_at", notBefore);
    if (cacheError) continue;
    for (const row of data || []) present.add(row.cache_key);
  }
  return wanted.filter((w) => present.has(w.key)).map((w) => w.q);
}


/**
 * Every published set with its card count and no prices, from the manifest
 * alone — no database, so it cannot fail.
 *
 * The hub's floor. A page that 500s because a price lookup had a bad minute is
 * a worse answer than the same page with the numbers missing: the list, the
 * counts and every link still do their job, which is to make 92 sets
 * reachable. Shaped exactly like loadAllSets' rows so the page renders one
 * thing either way.
 */
export function setsFromManifest() {
  const bySlug = new Map();
  for (const entry of PUBLISHED) {
    if (!bySlug.has(entry.slug)) {
      bySlug.set(entry.slug, { slug: entry.slug, name: entry.set, cards: 0, priced: 0, totalPence: null, top: null });
    }
    bySlug.get(entry.slug).cards += 1;
  }
  return [...bySlug.values()].sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name));
}

/**
 * Every published set with what it is worth, for the /sets hub.
 *
 * ONE catalogue read and one chunked cache read for all 455 cards, not 92
 * calls to loadSetCards. That matters: this page is the only one that touches
 * the whole published set at once, and doing it per-set would be 92 round
 * trips to render a list.
 *
 * It is still the heaviest read on the site — every card's comps come back so
 * they can be priced, because prices are not stored, only the comps they are
 * derived from. That is why it is cached for an hour rather than run per
 * request: the numbers only move when the warmer runs, which is weekly. It
 * costs NO SoldComps requests at any point.
 *
 * TWO THINGS THE FIRST VERSION GOT WRONG, both only visible in production.
 * It collected all 455 payloads into one Map before pricing any of them —
 * megabytes resident at once, where loadSetCards holds at most 48 and
 * pricedCards holds none, selecting only the key. And it had no time budget,
 * so a slow read hit the function limit, which left the hourly cache unfilled
 * so the next visitor paid the same cost and died the same way. Now each chunk
 * is priced and dropped as it arrives, and running long stops the loop with
 * `complete: false` rather than the whole page.
 *
 * Returns { sets, complete }. Every published set is in `sets` whether or not
 * it got a price — straight from the manifest — so a cache failure costs the
 * numbers and never the list.
 */
export async function loadAllSets({ windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS, budgetMs = 7000 } = {}) {
  const supabase = createPublicClient();
  // One read for the catalogue: 455 short ids in the URL, which is the same
  // filter pricedCards has used for the sitemap since it shipped.
  const { data: rows, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).in("cardmarket_id", PUBLISHED.map((e) => e.id))
  );
  if (error) throw new Error(`card_catalog read failed for the set index: ${error.message}`);

  const byId = new Map((rows || []).map((row) => [row.cardmarket_id, cardFromRow(row)]));

  // Every set exists on the board whether or not it gets a price, straight
  // from the manifest — so a slow or failed cache read costs the numbers and
  // never the list.
  const bySlug = new Map();
  for (const entry of PUBLISHED) {
    if (!bySlug.has(entry.slug)) {
      bySlug.set(entry.slug, { slug: entry.slug, name: entry.set, cards: 0, priced: 0, totalPence: 0, top: null });
    }
    bySlug.get(entry.slug).cards += 1;
  }

  const wanted = PUBLISHED
    .map((entry) => {
      const card = byId.get(entry.id);
      return card ? { entry, card, key: cacheKeyFor(queryForCard(card), true, windowDays) } : null;
    })
    .filter(Boolean);

  let complete = true;
  try {
    const service = createServiceClient();
    const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const started = Date.now();

    for (let i = 0; i < wanted.length; i += 40) {
      // A TIME BUDGET, because this is the one read that touches all 455
      // cards. A function that dies at its limit leaves the hourly cache
      // unfilled, so the NEXT visitor pays the same cost and dies the same
      // way — the page would be broken for everyone, forever. Stopping early
      // with some sets unpriced caches a usable answer instead.
      if (Date.now() - started > budgetMs) {
        complete = false;
        console.error(`loadAllSets: stopped after ${i} of ${wanted.length} cards, over the ${budgetMs}ms budget`);
        break;
      }

      const slice = wanted.slice(i, i + 40);
      const { data, error: cacheError } = await service
        .from("soldcomps_cache")
        .select("cache_key, payload")
        .in("cache_key", slice.map((w) => w.key))
        .gte("fetched_at", notBefore);
      if (cacheError) { complete = false; continue; }

      // PRICED HERE, PER CHUNK, and the payloads are dropped as we go. Holding
      // all 455 at once is what took the first version of this page down: the
      // comps behind one card are a few dozen listings with their titles, and
      // 455 of those resident together is megabytes on a function that also
      // has to render. Only the pence survive the loop.
      const payloads = new Map((data || []).map((row) => [row.cache_key, row.payload]));
      for (const { entry, card, key } of slice) {
        const payload = payloads.get(key);
        if (!payload) continue;
        const priced = priceCard(
          { name: card.name, number: card.number, set: card.set, q: queryForCard(card) },
          payload.comps || []
        );
        if (priced?.pence == null) continue;
        const set = bySlug.get(entry.slug);
        set.priced += 1;
        set.totalPence += priced.pence;
        // The leader carries the set's art on the hub, so it is the dearest
        // card rather than the first one that happened to have a price.
        if (!set.top || priced.pence > set.top.pence) {
          set.top = { name: card.name, number: card.number, image: card.image, pence: priced.pence, q: entry.q };
        }
      }
    }
  } catch (err) {
    // No service key, or the cache is unreachable. The hub still lists every
    // set and its card count, which is most of the page.
    complete = false;
    console.error("loadAllSets: pricing unavailable, listing sets without prices", err);
  }

  // Dearest first. A set with nothing priced yet sorts last rather than
  // reading as a worthless one — same rule as the cards on a set page.
  const sets = [...bySlug.values()]
    .map((s) => ({ ...s, totalPence: s.priced ? s.totalPence : null }))
    .sort((a, b) => (b.totalPence ?? -1) - (a.totalPence ?? -1));
  return { sets, complete };
}

/**
 * The sets we publish, each with its cards. Straight off the manifest — no
 * database, no API — because a card page's sibling strip renders on every view
 * and must not add a round trip to the hot path.
 */
export function publishedSets() {
  const bySlug = new Map();
  for (const entry of PUBLISHED) {
    if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, { slug: entry.slug, name: entry.set, cards: [] });
    bySlug.get(entry.slug).cards.push(entry);
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One set, or null. Manifest only. */
export function findSet(slug) {
  return publishedSets().find((s) => s.slug === slug) || null;
}

/**
 * The other cards in a card's set, for the strip at the bottom of its page.
 * Manifest only, so it is free — no prices, deliberately. The prices live on
 * the set page, which is one click away and does the database work once for
 * the whole set rather than on every card view.
 *
 * THE WINDOW WRAPS, and that is the point rather than a detail. Taking the
 * first six of the set would have all 48 Prismatic Evolutions cards linking to
 * the same six pages: six cards get every internal link in the set and the
 * other forty-two get none, which is the opposite of what internal linking is
 * for. Starting from each card's own position and wrapping spreads the links
 * evenly across the set, so every page is reachable from several others.
 */
export function siblingsOf(query, limit = 6) {
  // stripAsk, because "PSA 10 Umbreon VMAX 215/203 …" is a question about a
  // published card, not a different one. Without it a graded search landed on
  // a page with no set line and no way onward — the dead end the sibling strip
  // exists to remove. Safe here in a way it is NOT in findPublished itself:
  // this hands back links, where that hands back a card to price.
  const entry = findPublished(query) || findPublished(stripAsk(query));
  if (!entry) return { set: null, siblings: [] };
  const set = findSet(entry.slug);
  if (!set) return { set: null, siblings: [] };

  const cards = set.cards;
  const at = cards.findIndex((c) => c.id === entry.id);
  const out = [];
  for (let step = 1; step < cards.length && out.length < limit; step++) {
    out.push(cards[(at + step) % cards.length]);
  }
  return { set: { slug: set.slug, name: set.name, total: cards.length }, siblings: out };
}

/**
 * Every card in one set, priced from cache, dearest first.
 *
 * "Most valuable cards in Prismatic Evolutions" is a query with real volume and
 * the kind of page other people link to, which an individual card page is not.
 * It is also the internal linking: before this, every card page was a dead end
 * whose only route in was the sitemap, which is a poor way to get 450 URLs
 * understood — Google leans on internal links to judge what matters.
 *
 * One catalogue read and one cache read for the WHOLE set, not one per card.
 * Costs no SoldComps requests at all: everything here is already paid for.
 */
export async function loadSetCards(slug, { windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS } = {}) {
  const set = findSet(slug);
  if (!set) return null;

  const supabase = createPublicClient();
  const { data: rows, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).in("cardmarket_id", set.cards.map((c) => c.id))
  );
  // A failed query is a fault, not an empty set — returning [] would render a
  // page claiming the set has no cards in it.
  if (error) throw new Error(`card_catalog read failed for set ${slug}: ${error.message}`);

  const byId = new Map((rows || []).map((row) => [row.cardmarket_id, cardFromRow(row)]));
  const wanted = set.cards
    .map((entry) => {
      const card = byId.get(entry.id);
      return card ? { entry, card, key: cacheKeyFor(queryForCard(card), true, windowDays) } : null;
    })
    .filter(Boolean);

  const cached = new Map();
  try {
    const service = createServiceClient();
    const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    for (let i = 0; i < wanted.length; i += 40) {
      const { data } = await service
        .from("soldcomps_cache")
        .select("cache_key, payload, fetched_at")
        .in("cache_key", wanted.slice(i, i + 40).map((w) => w.key))
        .gte("fetched_at", notBefore);
      for (const row of data || []) cached.set(row.cache_key, row);
    }
  } catch {
    // No service key — the set still lists its cards, just without prices.
  }

  const cards = wanted.map(({ entry, card, key }) => {
    const row = cached.get(key);
    const priced = row
      ? priceCard(
          { name: card.name, number: card.number, set: card.set, q: queryForCard(card) },
          row.payload?.comps || []
        )
      : null;
    return {
      q: entry.q,
      name: card.name,
      number: card.number,
      rarity: card.rarity,
      image: card.image,
      pence: priced?.pence ?? null,
      used: priced?.used ?? 0
    };
  });

  // Dearest first: on a "what is this set worth" page the chase cards are the
  // answer. Unpriced cards sort last rather than reading as worthless.
  cards.sort((a, b) => (b.pence ?? -1) - (a.pence ?? -1));
  return { slug: set.slug, name: set.name, cards };
}

export default { publishedCards, findPublished, cardPageDirectives, NOT_FOR_INDEX, publishedSets, loadAllSets, setsFromManifest, findSet, siblingsOf, loadSetCards, loadCard, loadCachedSold, serverCard, pricedCards, MAX_SERVER_PRICE_AGE_DAYS };
