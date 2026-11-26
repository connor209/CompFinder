/**
 * Moving between panel sections without asking the server.
 *
 * Every section change used to be a router.push: a round trip for a fresh
 * server render of /panel/<slug>, nothing on screen while it went, and then a
 * REMOUNT of the whole panel — every screen re-fetching everything. The panel
 * is one client component that already knows which section a path means, so a
 * section change is now `history.pushState` (which Next 15 folds into its own
 * router: usePathname follows, and Back restores without a fetch) plus a
 * state change.
 *
 * Some URLs still need the server, because the page reads them on the way in:
 * the wish query string the Show Desk's wish pickup opens with. `needsServer()`
 * is the one list of those; anything else under /panel is switched in place.
 * (A saved Bulk pricing run, ?pool, ?import and ?ids were on it until that
 * screen was removed, 2026-11-26.)
 *
 * Pure apart from `navigate`, so scripts/check-clientnav.mjs can pin it.
 */

/** Fired after a client navigation, so screens keyed on the URL remount. */
export const NAV_EVENT = "cf-nav";

/** Query keys the panel only reads at mount, from the server page's props. */
export const SERVER_QUERY_KEYS = ["wish"];

/** Does this URL need a real page load to mean what it says? */
export function needsServer(url) {
  const u = typeof url === "string" ? new URL(url, "http://x") : url;
  if (!/^\/panel(\/|$)/.test(u.pathname)) return true;
  return SERVER_QUERY_KEYS.some((k) => u.searchParams.has(k));
}

/** A click the browser should handle itself: modified, middle, or already handled. */
export function isPlainClick(e) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/**
 * The panel URL a click on this anchor goes to, if it should be switched in
 * place — or null for the browser to follow as usual (another origin, a new
 * tab, a download, a server-only URL).
 */
export function inPlaceTarget(anchor, origin) {
  if (!anchor || !anchor.getAttribute) return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) return null;
  let u;
  try { u = new URL(anchor.href || href, origin); } catch { return null; }
  if (u.origin !== origin || needsServer(u)) return null;
  return u.pathname + u.search + u.hash;
}

/** Go to a panel URL in place. Returns false if it is where we already are. */
export function navigate(url) {
  if (typeof window === "undefined") return false;
  const here = window.location.pathname + window.location.search;
  if (url === here) return false;
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAV_EVENT));
  return true;
}
