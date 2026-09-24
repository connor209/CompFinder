import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicStorefront } from "@/lib/storefront-store.js";
import Storefront from "./Storefront";

/**
 * The storefront: the show stock, behind the QR on the table.
 *
 * The app's only anonymous page. Everything a visitor receives comes out of
 * loadPublicStorefront(), which reads with the service-role key, filters on
 * the link owner by hand and returns a projection — the rows themselves never
 * reach this file's output. See lib/storefront.js and docs/SHOW_STOREFRONT.md.
 *
 * Rendered per request: a sticker typed at the desk should be on a visitor's
 * phone the next time they pull to refresh, not the next time a cache expires.
 */
export const dynamic = "force-dynamic";

/**
 * Never in an index, and never in a Referer.
 *
 * `noindex` because this is ephemeral stock under a URL that dies with the
 * show — and because the URL IS the key. `no-referrer` for the same reason:
 * every card picture is fetched from eBay's CDN, and a default Referer would
 * hand the full URL, token and all, to a third party's logs on every image.
 */
export const metadata = {
  title: "Browse the stock",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer"
};

const ENDED = {
  "not-found": {
    title: "This link isn't live",
    body: "Check you scanned the right code — or just ask at the table."
  },
  ended: {
    title: "This show has finished",
    body: "The link on that sign has been switched off. Come and find us at the next one."
  },
  error: {
    title: "Couldn't load the stock",
    body: "Venue wifi, probably. Pull down to try again, or ask at the table."
  }
};

export default async function StorefrontPage({ params }) {
  const { token } = await params;
  let result;
  try {
    result = await loadPublicStorefront(createAdminClient(), token);
  } catch {
    // No service-role key on this deployment, or Supabase unreachable. A
    // visitor is owed a sentence rather than Next's 500 page.
    result = { ok: false, reason: "error" };
  }

  if (!result.ok) {
    const copy = ENDED[result.reason] || ENDED["not-found"];
    return (
      <main className="sf-shell">
        <div className="sf-ended">
          <h1 className="sf-title">{copy.title}</h1>
          <p className="hint">{copy.body}</p>
        </div>
      </main>
    );
  }

  return <Storefront storefront={result.storefront} stock={result.stock} />;
}
