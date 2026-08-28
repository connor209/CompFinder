import { pricedCards, publishedSets } from "@/lib/card-page";
import { siteUrl } from "@/lib/indexing";

/**
 * Only pages with something on them.
 *
 * Any string is a valid /card/<query> URL, so a sitemap could list anything.
 * It lists the published cards that currently have a cached price, and nothing
 * else: an unwarmed card page is honest but thin, and submitting hundreds of
 * thin pages demotes the good ones with them rather than just themselves. The
 * list grows as the warmer works through the set.
 *
 * If Supabase is unreachable this returns the static pages rather than
 * throwing — a sitemap that 500s is worse than a short one.
 */
export const revalidate = 21600; // six hours; the set moves in batches, not continuously

export default async function sitemap() {
  const base = siteUrl();
  const now = new Date();

  const staticPages = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    // Above privacy and the changelog on purpose: this is the page that leads
    // to every set page, which lead to every card page.
    { url: `${base}/sets`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/changelog`, lastModified: now, changeFrequency: "monthly", priority: 0.3 }
  ];

  let queries = [];
  try {
    queries = await pricedCards();
  } catch {
    return staticPages;
  }

  // Set pages carry the queries with volume that individual cards don't
  // ("most valuable cards in 151"), and they are how a crawler reaches the
  // cards. Every published set has a page, priced or not — unlike the cards,
  // a set page with some prices missing still lists real cards and reads as a
  // real page, so the thin-content reasoning doesn't apply the same way.
  const sets = publishedSets();

  return [
    ...staticPages,
    ...sets.map((set) => ({
      url: `${base}/set/${set.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      // Above the individual cards: a set page carries more of the volume and
      // is the route by which the cards get found.
      priority: 0.8
    })),
    ...queries.map((q) => ({
      url: `${base}/card/${encodeURIComponent(q)}`,
      lastModified: now,
      // Prices refresh in batches, so "daily" would be a claim we don't honour
      // and Google discounts a changefreq it can't corroborate.
      changeFrequency: "weekly",
      priority: 0.7
    }))
  ];
}
