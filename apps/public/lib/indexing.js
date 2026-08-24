/**
 * Whether search engines may index this site yet.
 *
 * OFF BY DEFAULT, and that is the safe direction. The cost of being wrong this
 * way is a few weeks of indexing we didn't get. The cost the other way is
 * having the content indexed against whatever hostname happened to be serving
 * at the time — a preview URL, the vercel.app one — and then a domain
 * migration for pages that had only just started to rank, with the two hosts
 * competing in the meantime.
 *
 * There is a second reason it stays shut, and it is not an SEO one: SoldComps
 * have not confirmed in writing that we may display individual comp rows
 * publicly (see CLAUDE.md, "Open question blocking the public page"). Inviting
 * Googlebot to crawl every card page is a fairly emphatic way of doing the
 * thing we have not yet been told we may do.
 *
 * ONE DEFINITION, because robots.txt and the page metadata have to agree.
 * A robots.txt that says "don't crawl" while the pages carry no noindex leaves
 * a URL discovered elsewhere indexable anyway — crawling and indexing are
 * different permissions, and the two files answering differently is the kind of
 * thing nobody notices until the wrong one wins.
 *
 * Flip it by setting PUBLIC_ALLOW_INDEXING=1 on the deployment, on the day the
 * domain is live AND the SoldComps answer is in. Server-side only: no
 * NEXT_PUBLIC_ prefix, because nothing in the browser needs to know.
 */
export function indexingAllowed() {
  const flag = String(process.env.PUBLIC_ALLOW_INDEXING || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** The canonical host everything is addressed against. */
export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://lastcomp.co.uk").replace(/\/$/, "");
}

export default { indexingAllowed, siteUrl };
