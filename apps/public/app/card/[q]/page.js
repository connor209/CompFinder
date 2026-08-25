import { unstable_cache } from "next/cache";
import CardScreen from "./CardScreen";
import { windowFromParam } from "@/lib/windows";
import { serverCard, findPublished, siblingsOf } from "@/lib/card-page";

/**
 * The answer lives at its own URL so it can be shared, linked and cached —
 * "what's this worth" is a thing people send each other a link to.
 * The query is the slug: specific enough to price ("Magikarp 203 Paldea
 * Evolved"), loose enough that a half-typed one still resolves.
 */
/**
 * The two Supabase reads behind a server-rendered price, memoised.
 *
 * The obvious fix was to let the CDN hold the whole page, and it isn't
 * available: the route reads searchParams for the 30/90-day window, which
 * makes it dynamic, and Vercel overrides Cache-Control on dynamic responses
 * whatever next.config asks for. That override doesn't happen under
 * `next start`, which is how the first attempt reached production before being
 * found out. So the DATA is cached rather than the HTML — which is where the
 * time was going anyway: two round trips per view for an answer that only
 * moves when the warmer runs.
 *
 * It lives here rather than in lib/card-page.js on purpose. That module is
 * imported by the check scripts under bare node, where next/cache doesn't
 * resolve at all — and caching policy belongs to the route rather than the
 * data layer regardless.
 *
 * Two minutes: short enough that a warmer run shows on the page almost at
 * once, long enough that a burst on one card is a single read.
 */
const cachedServerCard = unstable_cache(
  (query, windowDays) => serverCard(query, windowDays),
  ["server-card"],
  { revalidate: 120, tags: ["soldcomps-cache"] }
);

export async function generateMetadata({ params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  const title = query ? `${query} — what's it worth?` : "What's it worth?";
  const description = `Real eBay UK sold prices for ${query}, and the cheapest one you could buy today.`;
  const og = ogImageFor(query);

  return {
    title,
    description,
    // Any string is a valid card URL, so the same card is reachable under
    // every spelling, ordering and typo someone searches. Without a canonical
    // those are all separate pages competing with each other; with one they
    // are the published spelling. Only claimed for a card we publish — a
    // canonical pointing at a URL we don't stand behind would be worse.
    alternates: canonicalFor(query),
    openGraph: { title, description, type: "website", ...(og ? { images: [og] } : {}) },
    twitter: { card: og ? "summary_large_image" : "summary", title, description,
               ...(og ? { images: [og.url] } : {}) }
  };
}

/**
 * The picture a link to this card unfurls as, in Discord, WhatsApp or a
 * Facebook post — the places people actually pass a price around.
 *
 * Published cards only, and the same reason as the canonical above: the image
 * route can only read the cache, and the cache only holds cards we publish.
 * Claiming an image we cannot draw would unfurl as a broken one, which is
 * worse than the plain link this replaces. `findPublished` is a manifest
 * lookup, so gating on it costs nothing on a page render.
 */
function ogImageFor(query) {
  const entry = findPublished(query);
  if (!entry) return undefined;
  return {
    url: `/card/${encodeURIComponent(entry.q)}/share.png`,
    width: 1200,
    height: 630,
    alt: `${entry.q} — recent eBay UK sold prices`
  };
}

function canonicalFor(query) {
  const entry = findPublished(query);
  return entry ? { canonical: `/card/${encodeURIComponent(entry.q)}` } : undefined;
}

export default async function CardPage({ params, searchParams }) {
  const { q } = await params;
  // The sold window lives in the URL rather than in component state, so the
  // workings link carries it and a shared link reproduces what the sender saw.
  const { days } = (await searchParams) || {};
  const query = decodeURIComponent(q || "");
  const window = windowFromParam(days);

  // For a card we publish, read the price out of the cache here so it is in
  // the HTML. Everything else — and any published card not currently warm —
  // gets null and the browser fetches exactly as it did before. Reading only;
  // a crawler never costs a SoldComps request. See lib/card-page.js.
  const initial = await cachedServerCard(query, window);

  // Manifest-only, so it costs nothing: the set this card belongs to and six
  // others from it, for the strip at the bottom. Unpublished cards get null
  // and the strip simply doesn't render.
  const { set, siblings } = siblingsOf(query);

  return <CardScreen query={query} days={window} initial={initial} set={set} siblings={siblings} />;
}
