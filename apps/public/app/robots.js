import { indexingAllowed, siteUrl } from "@/lib/indexing";

/**
 * Crawling is the acquisition plan — but only once we are ready to be found.
 * Until PUBLIC_ALLOW_INDEXING is set this closes the door entirely, and
 * doesn't advertise a sitemap there is no permission to read. See
 * lib/indexing.js for why the default is shut.
 *
 * When it opens, /api/ stays disallowed regardless: those routes spend a real
 * SoldComps request per cache miss, nothing there is useful to a crawler, and
 * a bot walking /api/price is exactly the traffic the rate limit and Turnstile
 * exist to stop.
 */
export default function robots() {
  if (!indexingAllowed()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`
  };
}
