import { cachedAllSets } from "./cached-sets";
import { hubView } from "@/lib/card-page";
import { Crumb, CardArt } from "../ui";
// gbp from lib/money, NOT from ui: ui.js is "use client", so calling one of
// its exports on the server throws at request time. This page did exactly
// that, and only once the cards had prices to format.
import { gbp } from "@/lib/money";
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
  // THIS PAGE MUST NOT 500, and it did — twice. It is linked from the front
  // page, so a failure here removes the only route into 92 sets and hands the
  // visitor an error with nowhere to go.
  //
  // Two guards, and neither is optional. The catch covers a database that is
  // down or unreachable. hubView covers the answer coming back in a shape this
  // page did not expect — which is not hypothetical: it is exactly what took
  // the page down, and Next's data cache outlives a deploy, so the first
  // requests after any change to that shape are served the OLD one.
  let result = null;
  try {
    result = await cachedAllSets();
  } catch (err) {
    // Logged, because there is no analytics here: a silent fallback looks
    // exactly like a warmer that has not run, and they need opposite fixes.
    console.error("/sets: could not price the sets, falling back to the manifest", err);
  }
  const { sets, complete, priced: hasPrices } = hubView(result);

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
          listings, {hasPrices ? "dearest set first" : "with prices refreshing right now"}. Tap a
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
