import { Crumb } from "../ui";

/**
 * Privacy and affiliate disclosure.
 *
 * Its own page rather than a share of the business app's: that one describes
 * accounts, an eBay OAuth connection and per-user history, none of which exist
 * here. A policy listing things the visitor doesn't have reads as boilerplate
 * and buries the parts that are true. The two are separate Vercel projects
 * anyway, so the app's /privacy never served this domain — the footer link
 * simply 404'd.
 *
 * This blocks the EPN application rather than being tidy-up: they review the
 * live site, and a dead affiliate-disclosure link is what a reviewer clicks.
 *
 * Everything below is written off what the code does. If a claim stops
 * matching a route, the claim is the bug.
 */

export const metadata = {
  title: "Privacy & affiliate disclosure",
  description:
    "What Last Comp stores, what it doesn't, and how the eBay affiliate links work. No accounts, no analytics, no ad tracking.",
  alternates: { canonical: "/privacy" }
};

const UPDATED = "24 August 2026";

export default function PrivacyPage() {
  return (
    <main>
      <Crumb label="Privacy &amp; affiliate disclosure" />

      <div className="screen tight">
        <p className="body soft" style={{ marginTop: 0 }}>Last updated: {UPDATED}</p>

        <p className="body">
          The short version: there are no accounts here, nothing you type is tied to you, and there is no analytics
          or advertising. Some links to eBay earn us a commission, and that never changes the prices shown or which
          listing appears first.
        </p>

        <h2 className="section-title" style={{ marginTop: 26 }}>What we collect</h2>
        <ul className="body">
          <li>
            <b>Your IP address, briefly.</b> For two things only: counting searches per hour so nobody can run up
            our data bill by scraping the site, and tying an anti-bot check to the visitor who passed it. Those
            hourly counters are deleted after two days. It is never linked to what you searched for.
          </li>
          <li>
            <b>An anti-bot cookie, if a check is shown.</b> Passing a Cloudflare Turnstile check sets one cookie
            (<code>cf_pass</code>) lasting 30 minutes. It is signed, readable only by the server, and holds no
            identifier for you — only a fingerprint tying it to the network address that solved the check, so a pass
            can&rsquo;t be handed around. You are asked only when a search isn&rsquo;t already cached.
          </li>
          <li>
            <b>The card searches themselves.</b> Results are cached in our database so a repeat lookup costs nothing
            and comes back faster. What&rsquo;s stored is the search text and the sold listings that came back — not
            who searched it. The cache is shared by everyone and kept for up to 180 days.
          </li>
        </ul>

        <h2 className="section-title" style={{ marginTop: 26 }}>What we don&rsquo;t collect</h2>
        <ul className="body">
          <li>No accounts, names, email addresses or payment details. There is nothing to sign up for.</li>
          <li>No analytics or measurement scripts. We don&rsquo;t know how many pages you viewed or where you came from.</li>
          <li>
            No advertising, ad cookies or ad networks. If that changes, this page changes first and you will be asked
            for consent before anything is set.
          </li>
          <li>No selling or sharing of data. There is no data about you here to sell.</li>
        </ul>

        <h2 className="section-title" style={{ marginTop: 26 }}>Who else sees a request</h2>
        <ul className="body">
          <li><b>Vercel</b> hosts the site and handles requests.</li>
          <li><b>Supabase</b> holds the card catalogue and the shared search cache.</li>
          <li><b>SoldComps</b> is queried for eBay sold-listing data when a search isn&rsquo;t cached.</li>
          <li><b>Cloudflare</b> provides the Turnstile check, where one is shown.</li>
          <li>
            <b>TCGdex</b> serves the card artwork straight to your browser, so those requests reach them with your IP
            address, as any image on any website does. Typefaces are served from our own domain rather than a font CDN.
          </li>
        </ul>

        <h2 className="section-title" id="affiliate" style={{ marginTop: 26 }}>Affiliate links</h2>
        <p className="body">
          Some links from this site to eBay carry an eBay Partner Network tracking code. If you buy something on eBay
          after following one, eBay may pay us a small commission. <b>It costs you nothing extra</b> — the price on
          eBay is exactly what it would be without the link.
        </p>
        <p className="body">
          More importantly: <b>it never affects what this site tells you.</b> The price, the sold comps behind it and
          the order listings appear in all come from real sold data and the same rules for every card. Nothing is
          ranked, promoted or hidden because of what it might earn, and we have no influence over what a card sells
          for. Where a listing is hidden it is because it is too far below the market to plausibly be the same card —
          and the page says so, and says how many.
        </p>
        <p className="body">
          Following a tagged link sets a cookie on <i>eBay&rsquo;s</i> domain so they can attribute the visit. That
          cookie is theirs and is governed by their privacy notice. We can&rsquo;t read it and never learn what you
          browsed or bought — eBay reports commission as totals, not purchases.
        </p>
        <p className="body">
          Affiliate links are marked <code>rel=&quot;sponsored&quot;</code> in the page source, and the buying
          section says so on the page itself.
        </p>

        <h2 className="section-title" style={{ marginTop: 26 }}>Your rights</h2>
        <p className="body">
          Under UK GDPR you can ask to access, correct or erase personal data we hold about you. In practice there is
          almost nothing to act on: no account, and an IP address appears only in an hourly counter that deletes
          itself within two days. Ask anyway if you&rsquo;d like — say roughly when you visited.
        </p>

        <h2 className="section-title" style={{ marginTop: 26 }}>Contact</h2>
        <p className="body">
          <a className="link" href="mailto:privacy@lastcomp.co.uk">privacy@lastcomp.co.uk</a>
        </p>

        <h2 className="section-title" style={{ marginTop: 26 }}>Changes</h2>
        <p className="body">
          This page is updated as the site changes — in particular before any advertising is introduced. The date at
          the top is the one to check.
        </p>
      </div>
    </main>
  );
}
