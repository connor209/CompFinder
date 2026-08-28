/**
 * One host serves this site; anything else bounces to it.
 *
 * The case that earned this file: an iOS Home Screen icon keeps the origin it
 * was installed from, forever. An icon added before the domain went live opens
 * every page on an old vercel.app hostname — where Turnstile refuses the human
 * check with 110200, so every uncached search dies on "domain not allowed" and
 * nothing on the phone says why. That failed silently for two months (see
 * CLAUDE.md). `start_url` can't fix it: a relative one resolves against the
 * installed origin, and an absolute one outside the manifest's origin is out
 * of scope and ignored. A redirect at the door is the remedy that heals a
 * stale icon on its next launch.
 *
 * Three rules keep the redirect from being its own outage:
 *
 * PRODUCTION ONLY. `VERCEL_ENV` must literally be "production" — a preview
 * deploy exists to be looked at on its own hostname, and bouncing it to the
 * live site makes every preview unreviewable. Locally the variable is unset,
 * so dev never redirects either. A production deployment reached via its
 * vercel.app alias IS production — that is exactly the stale-icon case.
 *
 * NO REDIRECT WITHOUT AN EXPLICIT NEXT_PUBLIC_SITE_URL. This deliberately does
 * NOT reuse siteUrl() from indexing.js, because siteUrl() falls back to the
 * apex — and Vercel 308s the apex to www. A redirect built from that fallback
 * would send www to the apex, Vercel would send it straight back, and the
 * site would be an infinite loop precisely when a config var went missing.
 * A canonical for a <link> tag can afford a default; a redirect cannot.
 *
 * FAIL OPEN. An unparsable URL, a missing host header — serve the page. The
 * degraded state is the site working on the wrong hostname, which is where it
 * lived for months; the failure mode to avoid is the site serving nothing.
 */

/** The host requests must arrive on, or null when redirecting isn't safe. */
export function canonicalHost() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Where this request should go instead, or null to serve it here.
 * Path and query ride along untouched; the caller issues a 308 so the method
 * survives too (a POST to /api on the old host must not become a GET).
 */
export function canonicalRedirect(host, pathname = "/", search = "") {
  if (process.env.VERCEL_ENV !== "production") return null;
  const canonical = canonicalHost();
  if (!canonical) return null;
  const from = String(host || "").trim().toLowerCase();
  if (!from || from === canonical) return null;
  return `https://${canonical}${pathname}${search}`;
}

export default { canonicalHost, canonicalRedirect };
