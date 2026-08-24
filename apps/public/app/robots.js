/**
 * Crawling is the acquisition plan, so this opens the door — with one
 * exception that costs money.
 *
 * /api/ is disallowed because those routes spend a real SoldComps request per
 * cache miss. Nothing there is useful to a crawler, and a bot walking
 * /api/price is exactly the traffic the rate limit and Turnstile exist to
 * stop; saying so up front means the well-behaved crawlers never get counted
 * against it in the first place.
 */
export default function robots() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://lastcomp.co.uk";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${base}/sitemap.xml`
  };
}
