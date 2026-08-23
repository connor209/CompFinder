import CardScreen from "./CardScreen";
import { windowFromParam } from "@/lib/windows";

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
    description: `Real eBay UK sold prices for ${query}, and the cheapest one you could buy today.`
  };
}

export default async function CardPage({ params, searchParams }) {
  const { q } = await params;
  // The sold window lives in the URL rather than in component state, so the
  // workings link carries it and a shared link reproduces what the sender saw.
  const { days } = (await searchParams) || {};
  return <CardScreen query={decodeURIComponent(q || "")} days={windowFromParam(days)} />;
}
