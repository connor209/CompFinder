import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { loadSetCards, publishedSets } from "@/lib/card-page";
import { Crumb, CardArt, gbp } from "../../ui";

/**
 * Every card in one set, dearest first.
 *
 * Two jobs. "Most valuable cards in Prismatic Evolutions" is a query with real
 * volume and the kind of page someone links to, which an individual card page
 * is not. And it is the internal linking: before this, each card page's only
 * outbound link was back to the home page, so 450 URLs sat at the end of dead
 * ends with the sitemap as their sole route in — a poor way to get a site
 * understood, since Google leans on internal links to judge what matters.
 *
 * Costs no SoldComps requests. Every price here is already in the cache.
 */
export const revalidate = 600;

const KNOWN = new Set(publishedSets().map((s) => s.slug));

// One catalogue read and one cache read per set, memoised for ten minutes —
// the underlying prices only move when the warmer runs, which is weekly.
const cachedSet = unstable_cache((slug) => loadSetCards(slug), ["set-cards"], {
  revalidate: 600,
  tags: ["soldcomps-cache"]
});
// generateMetadata and the component are separate calls into this module.
const getSet = cache((slug) => cachedSet(slug));

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (!KNOWN.has(slug)) return { title: "Set not found" };
  const set = await getSet(slug);
  if (!set) return { title: "Set not found" };
  const top = set.cards.find((c) => c.pence != null);
  return {
    title: `${set.name} card values`,
    description: top
      ? `What the ${set.name} chase cards are worth on eBay UK. ${top.name} leads at about ${gbp(top.pence)}, from real sold listings — junk comps thrown out, and you can see the workings.`
      : `What the ${set.name} cards are worth on eBay UK, from real sold listings.`,
    alternates: { canonical: `/set/${slug}` }
  };
}

export default async function SetPage({ params }) {
  const { slug } = await params;
  if (!KNOWN.has(slug)) notFound();
  const set = await getSet(slug);
  if (!set || !set.cards.length) notFound();

  const priced = set.cards.filter((c) => c.pence != null);

  return (
    <main>
      <Crumb label={set.name} scope={`${set.cards.length} cards`} />

      <div className="screen tight">
        <h1 className="hero-h" style={{ fontSize: 30, margin: "6px 0 8px" }}>
          {set.name} card values
        </h1>
        <p className="body" style={{ margin: "0 0 4px", maxWidth: "46ch" }}>
          Priced from real eBay UK sold listings, dearest first.
          {priced.length < set.cards.length
            ? ` ${priced.length} of ${set.cards.length} have a current price — the rest are waiting on their next refresh.`
            : ""}
        </p>

        <div className="setgrid">
          {set.cards.map((c) => (
            <a className="setcard" href={`/card/${encodeURIComponent(c.q)}`} key={c.q}>
              <CardArt src={c.image} alt={c.name} className="setart" />
              <span className="setmeta">
                <span className="setname">{c.name}</span>
                <span className="setnum">{[c.number, c.rarity].filter(Boolean).join(" · ")}</span>
                <span className="setprice">{c.pence == null ? "—" : gbp(c.pence)}</span>
                <span className="setnum">
                  {c.used ? `${c.used} sold ${c.used === 1 ? "listing" : "listings"}` : "not priced yet"}
                </span>
              </span>
            </a>
          ))}
        </div>

        <p className="body soft" style={{ marginTop: 22 }}>
          Every price comes from real {set.name} sales on eBay UK, with the listings that would distort the
          answer taken out first — bundles and job lots, &ldquo;choose your card&rdquo; pick-lists, proxies and
          customs, damaged copies, and graded slabs, which trade as a different product. Click any card for the
          sales behind its number, including the ones we didn&rsquo;t count.
        </p>
        <p className="body"><a className="link" href="/">Price a card that isn&rsquo;t listed here &rarr;</a></p>
      </div>
    </main>
  );
}
