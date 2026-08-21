export const metadata = {
  title: "Privacy Policy",
  description: "How CompFinder handles your data"
};

const UPDATED = "21 August 2026";

export default function PrivacyPage() {
  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CF</span>
          <h1>Privacy Policy</h1>
        </div>
        <div className="topbar-actions">
          <a href="/panel">Back to CompFinder</a>
        </div>
      </header>

      <section className="panel legal" style={{ maxWidth: 720 }}>
        <p className="hint hint-small">Last updated: {UPDATED}</p>

        <p>
          CompFinder is a tool for researching resale prices of trading cards and other collectibles using real sold
          listings. This policy explains what data CompFinder collects, how it is used, and the choices you have. If you
          have questions, contact the account owner who provided you access to this instance of CompFinder.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account details.</strong> The email address you sign up with, used only to authenticate your account.
            Authentication is handled by Supabase.
          </li>
          <li>
            <strong>Your settings and API keys.</strong> Your SoldComps API key and preferences, stored in your own
            account row and isolated from other users by database row-level security.
          </li>
          <li>
            <strong>Price-check history.</strong> A record of the items you price (title, query, recommended price,
            confidence) so you can review past checks. Visible only to you.
          </li>
          <li>
            <strong>eBay account data (only if you connect eBay).</strong> If you choose to connect your eBay account,
            CompFinder requests <strong>read-only</strong> access and retrieves your active listings (title, price,
            quantity, image, and item link) to display them and to flag items you already have listed. We store the
            OAuth tokens eBay issues so the connection can refresh without asking you to sign in again.
          </li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To authenticate you and keep your data separated from other users.</li>
          <li>To return pricing results and maintain your price-check history.</li>
          <li>
            To show your own eBay listings inside CompFinder and warn you when an item you are pricing is already listed
            on your account.
          </li>
        </ul>
        <p>
          CompFinder does <strong>not</strong> sell your data, use it for advertising, or share it with third parties
          except the service providers needed to run the app (see below). eBay data is used solely to provide the
          features you enabled and is never shared onward.
        </p>

        <h2>Where your data is stored</h2>
        <ul>
          <li>
            <strong>Supabase</strong> — account, settings, price-check history, and (if you connect eBay) your listing
            cache and OAuth tokens. eBay OAuth tokens are held in server-only storage that the browser can never read.
          </li>
          <li>
            <strong>eBay</strong> and <strong>SoldComps</strong> — queried to retrieve listing and sold-price data.
            Their handling of data is governed by their own privacy policies.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the application and processes requests.
          </li>
        </ul>

        <h2>eBay data and your choices</h2>
        <p>
          Connecting eBay is optional. CompFinder only ever requests read-only scopes — it cannot change your listings,
          prices, or account. You can disconnect at any time from <strong>Settings → eBay account → Disconnect</strong>,
          which deletes the stored tokens and your cached listings from CompFinder. You can also revoke CompFinder&apos;s
          access directly from your eBay account&apos;s connected-apps settings.
        </p>

        <h2>Affiliate links</h2>
        <p>
          Some links to eBay in CompFinder carry an eBay Partner Network tracking code. If you buy something on eBay
          after following one, we may receive a small commission from eBay at no extra cost to you. This never affects
          which listings we show you, the order they appear in, or the prices and recommendations CompFinder
          calculates — those come only from real sold data. Links to your own eBay listings are never tagged.
        </p>
        <p>
          Following a tagged link sets an eBay cookie on eBay&apos;s own domain, used by eBay to attribute the visit.
          That cookie is eBay&apos;s, governed by their privacy notice, and CompFinder does not read it or receive any
          information about what you browse or buy beyond aggregate commission totals.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Your data is kept for as long as your account exists. You can clear your price-check history from the History
          page and disconnect eBay at any time. To delete your account and all associated data, contact the account
          owner who provided your access.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          This policy may be updated as CompFinder evolves. Material changes will be reflected by the &ldquo;last
          updated&rdquo; date above.
        </p>
      </section>
    </div>
  );
}
