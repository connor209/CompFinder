import { cachedAllSets } from "./cached-sets";
import { setsFromManifest } from "@/lib/card-page";
import { Crumb, CardArt, gbp } from "../ui";
import { totalGbp } from "@/lib/set-share";

/**
 * Every set we price, dearest first.
 *
 * THE HUB THAT WASN'T THERE. Set pages have carried the internal linking since
 * they shipped — a card page links up to its set and across to six siblings —
 * but the linking only ever ran one way. Nothing pointed DOWN: no page listed
 * the sets, the home page linked to none of them, and the only routes in were
 * a card page or the sitemap. So a visitor who arrived at the front door could
 * not browse at all; they had to search a card, land on a published one, and
 * click up. 92 sets nobody could reach without knowing a card in them first.
 *
 * It is also the page with the broadest query behind it. "Most valuable
 * Pokémon cards" is a search; "most valuable cards in Prismatic Evolutions" is
 * a search; this page is the one that can answer the first and route to the
 * second, which is exactly the shape Google wants a site to have.
 *
 * ON THE HOUR, not per request — see ./cached-sets. The DATA is what is
 * cached, not the page: rendering 92 rows is nothing, and the read behind them
 * is everything.
 *
 * Rendered on demand rather than prerendered, which is deliberate and was
 * caught by the build. `export const revalidate` on a page with no dynamic
 * segment makes Next generate it AT BUILD TIME, so `npm run build:public`
 * started demanding Supabase credentials — and CLAUDE.md tells anyone working
 * here to run that build before merging. A deploy that needs a live database
 * to compile is a deploy that breaks when the database blinks.
 */
export const dynamic = "force-dynamic";
// Headroom over loadAllSets' own 7s budget: the budget is what keeps a slow
// read from reaching this limit, and this is what keeps the budget from being
// the thing that decides the page.
export const maxDuration = 30;

export async function generateMetadata() {
  return {
    title: "Pokémon set values — every set we price",
    description:
      "What the chase cards in each Pokémon set are worth on eBay UK, from real sold listings. 455 cards across 92 sets, with the workings behind every price.",
    alternates: { canonical: "/sets" },
    openGraph: {
      title: "Pokémon set values — every set we price",
      description: "What the chase cards in each Pokémon set are worth, from real eBay UK sold listings.",
      type: "website",
      images: [{ url: "/sets/share.png", width: 1200, height: 630,
                 alt: "The most valuable Pokémon sets, priced from eBay UK sold listings" }]
    },
    twitter: {
      card: "summary_large_image",
      title: "Pokémon set values — every set we price",
      description: "What the chase cards in each Pokémon set are worth, from real eBay UK sold listings.",
      images: ["/sets/share.png"]
    }
  };
}

export default async function SetsPage() {
  // A failed read throws rather than rendering an empty hub: "we price nothing"
  // is a worse answer than an error page, and this one is regenerated hourly
  // so a transient fault corrects itself without a deploy.
  const sets = await cachedAllSets();
  const priced = sets.filter((s) => s.totalPence != null);
  const cards = sets.reduce((n, s) => n + s.cards, 0);

  return (
    <main>
      <Crumb label="All sets" scope={`${sets.length} sets`} />

      <div className="screen tight">
        <h1 className="hero-h" style={{ fontSize: 30, margin: "6px 0 8px" }}>
          Pok&eacute;mon set values
        </h1>
        <p className="body" style={{ margin: "0 0 4px", maxWidth: "46ch" }}>
          The chase cards from {sets.length} sets — {cards} of them — priced from real eBay UK sold
          listings, {priced.length ? "dearest set first" : "with prices refreshing right now"}. Tap a
          set for every card in it.
        </p>

        <div className="setgrid">
          {sets.map((s) => (
            <a className="setcard" href={`/set/${s.slug}`} key={s.slug}>
              {/* The set's dearest card stands for it. Free: the image URL is
                  already on the catalogue row loadAllSets read. */}
              <CardArt src={s.top ? s.top.image : null} alt={s.top ? s.top.name : s.name} className="setart" />
              <span className="setmeta">
                <span className="setname">{s.name}</span>
                <span className="setnum">
                  {s.cards} {s.cards === 1 ? "card" : "cards"}
                  {s.priced < s.cards ? ` · ${s.priced} priced` : ""}
                </span>
                <span className="setprice">{totalGbp(s.totalPence)}</span>
                {/* What the figure IS, on every row. A total with no label is
                    the kind of number people quote back at you as the price of
                    one card. */}
                <span className="setnum">
                  {s.top ? `together · top ${s.top.name} ${gbp(s.top.pence)}` : "prices coming"}
                </span>
              </span>
            </a>
          ))}
        </div>

        <p className="body soft" style={{ marginTop: 22 }}>
          Each figure is what that set&rsquo;s cards come to together, added up from what each one
          actually sold for on eBay UK — not a catalogue value, and not what a sealed box costs.
          Bundles, &ldquo;choose your card&rdquo; pick-lists, proxies, damaged copies and graded slabs are
          taken out before anything is counted. {priced.length < sets.length
            ? `${sets.length - priced.length} ${sets.length - priced.length === 1 ? "set is" : "sets are"} waiting on their next refresh${complete ? "" : " — check back shortly"}.`
            : ""}
        </p>
        <p className="body"><a className="link" href="/">Price a single card &rarr;</a></p>
      </div>
    </main>
  );
}
