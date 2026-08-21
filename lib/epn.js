/**
 * eBay Partner Network (EPN) affiliate tagging.
 *
 * EPN needs no redirect service and no link-generator call: you append a fixed
 * set of query parameters to the ordinary eBay URL you were already linking to,
 * and eBay attributes anything that visitor buys in the next 24 hours (last
 * click wins; up to 10 days for auctions they win later). See
 * https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html
 *
 * Everything routes through epnLink() so there's exactly one place that knows
 * the parameter set, and so the two rules that keep the account alive are
 * enforced rather than remembered:
 *
 *   1. Only eBay hosts get tagged. lib/marketplace.js also builds Cardmarket
 *      URLs, and SoldComps hands back listing URLs we don't construct
 *      ourselves — a hostname check is cheaper than trusting every call site.
 *   2. NEVER tag a link the ACCOUNT HOLDER is the one expected to click. That
 *      covers their own listings (Inventory, the "you already have this listed"
 *      banner, the ListForm confirmation) and also the Arbitrage tab, whose
 *      whole purpose is surfacing listings for them to buy and flip. Earning
 *      commission on your own purchases is the quickest route to a terminated
 *      EPN account. Those call sites are deliberately left untagged.
 *
 * For the same reason, leave NEXT_PUBLIC_EPN_CAMPID unset while CompFinder is
 * still a single-operator tool: with one user, every click is the account
 * holder's. Set it when the public page ships and the clicks are strangers'.
 *
 * Until NEXT_PUBLIC_EPN_CAMPID is set this is a no-op returning the URL
 * unchanged, so the whole codebase can be wired up before the EPN application
 * is approved and nothing has to be revisited afterwards.
 */

// Rotation ID, per eBay marketplace — an EPN link only tracks against the
// rotation for the site it points at, so this is keyed by hostname and a host
// we have no verified rotation for is left UNTAGGED rather than tagged wrongly.
// We search ebay.co.uk exclusively today; add a row here (from EPN's own link
// generator) before pointing anything at another marketplace.
const MKRID = {
  "ebay.co.uk": "710-53481-19255-0"
};

/** Maps a listing hostname (www.ebay.co.uk, m.ebay.co.uk) to its MKRID key. */
function siteKey(hostname) {
  const h = hostname.toLowerCase();
  return Object.keys(MKRID).find((site) => h === site || h.endsWith("." + site)) || null;
}

const CAMPID = process.env.NEXT_PUBLIC_EPN_CAMPID || "";

/** A campaign ID is a 10-digit number; anything else is a mis-set env var. */
const CAMPID_OK = /^\d{10}$/.test(CAMPID);

export function epnEnabled() {
  return CAMPID_OK;
}

/**
 * Tags an eBay URL for EPN attribution. Returns the URL untouched when EPN
 * isn't configured, when the URL isn't an eBay one, or when it doesn't parse —
 * a broken link is far worse than an untracked one.
 *
 * `customId` is our own sub-ID (eBay allows up to 256 chars). It's what turns
 * "we earned £40" into "the card pages earned £38 and arbitrage earned £2", so
 * every call site should pass something.
 */
export function epnLink(url, { customId = "" } = {}) {
  if (!CAMPID_OK || !url) return url;
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  // The URL's own host is the only thing trusted here. SoldComps hands back
  // listing URLs we didn't build, so a caller-supplied "which site is this"
  // hint would just be a way to tag a Cardmarket link by accident.
  const key = siteKey(u.hostname);
  if (!key) return url;

  u.searchParams.set("mkevt", "1"); // 1 = click
  u.searchParams.set("mkcid", "1"); // 1 = EPN channel
  u.searchParams.set("mkrid", MKRID[key]);
  u.searchParams.set("campid", CAMPID);
  u.searchParams.set("toolid", "10001");
  if (customId) u.searchParams.set("customid", sanitizeCustomId(customId));
  return u.toString();
}

/** eBay documents customid as alphanumeric; keep it tame and within length. */
function sanitizeCustomId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 256);
}

/**
 * `rel` for an affiliate anchor. Google's link-spam policy expects
 * `sponsored` on affiliate links, and it matters more here than on most sites:
 * the plan is card pages carrying a dozen eBay links each, at catalogue scale.
 * Untagged, that reads to a crawler as a link scheme.
 */
export const EPN_REL = "sponsored noopener noreferrer";

/** `rel` that degrades to the plain value when EPN is off (nothing sponsored). */
export function relFor(url, original) {
  return CAMPID_OK && url && siteKey(safeHost(url)) ? EPN_REL : original;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export default { epnLink, epnEnabled, relFor, EPN_REL };
