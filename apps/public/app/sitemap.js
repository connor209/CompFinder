import { pricedCards } from "@/lib/card-page";

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
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://lastcomp.co.uk";
  const now = new Date();

  const staticPages = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 }
  ];

  let queries = [];
  try {
    queries = await pricedCards();
  } catch {
    return staticPages;
  }

  return [
    ...staticPages,
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
