import CardScreen from "./CardScreen";
import { windowFromParam } from "@/lib/windows";
import { serverCard, findPublished } from "@/lib/card-page";

/**
 * The answer lives at its own URL so it can be shared, linked and cached —
 * "what's this worth" is a thing people send each other a link to.
 * The query is the slug: specific enough to price ("Magikarp 203 Paldea
 * Evolved"), loose enough that a half-typed one still resolves.
 */
export async function generateMetadata({ params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  return {
    title: query ? `${query} — what's it worth?` : "What's it worth?",
    description: `Real eBay UK sold prices for ${query}, and the cheapest one you could buy today.`,
    // Any string is a valid card URL, so the same card is reachable under
    // every spelling, ordering and typo someone searches. Without a canonical
    // those are all separate pages competing with each other; with one they
    // are the published spelling. Only claimed for a card we publish — a
    // canonical pointing at a URL we don't stand behind would be worse.
    alternates: canonicalFor(query)
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
  const initial = await serverCard(query, window);

  return <CardScreen query={query} days={window} initial={initial} />;
}
