import PriceSearch from "./PriceSearch";

/**
 * The public one-pager. Server component: everything above the search box is
 * static HTML so a crawler (and a first-time visitor on a phone) gets the
 * pitch without waiting on JavaScript. Only the search itself is interactive.
 */
export default function Home() {
  return (
    <div className="wrap">
      <header className="site">
        <div className="brandmark">CF</div>
        <div>
          <div className="brandname">CompFinder</div>
          <div className="brandsub">Free UK card price checker</div>
        </div>
        <span className="spacer" />
        <a className="btn btn-sm" href={process.env.NEXT_PUBLIC_APP_URL || "#pro"}>Sign in</a>
      </header>

      <section className="lede">
        <h1>What&rsquo;s that card actually worth?</h1>
        <p>
          Real eBay UK sold prices from the last 90 days &mdash; filtered for junk comps, graded slabs and
          international sellers, then recency-weighted. Free, no account needed.
        </p>
      </section>

      <PriceSearch />

      <section className="upsell" id="pro">
        <div>
          <h3>Pricing more than one card?</h3>
          <p>CompFinder Pro prices a whole stack at once and syncs your live eBay listings.</p>
        </div>
        <span className="spacer" />
        <a className="btn btn-primary" href={process.env.NEXT_PUBLIC_APP_URL || "#pro"}>See Pro &rarr;</a>
      </section>

      <footer className="site-foot">
        <span>&copy; {new Date().getFullYear()} CompFinder</span>
        <a href="/privacy">Privacy</a>
        <a href="/privacy#affiliate">Affiliate disclosure</a>
        <span className="spacer" />
        <span>Prices from real eBay UK sold listings. Not affiliated with eBay.</span>
      </footer>
    </div>
  );
}
