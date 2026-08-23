/**
 * Client IP, as seen through Vercel's proxy.
 *
 * Shared rather than defined per route on purpose: the rate limit buckets by
 * it and the Turnstile pass is bound to it, so two routes disagreeing about
 * what "this visitor" means would silently invalidate every pass the moment
 * one of them was edited.
 *
 * x-forwarded-for is a chain; the left-most entry is the client and the rest
 * are proxies. Falls back to a constant so a missing header buckets everyone
 * together rather than handing out an unlimited allowance each.
 */
export function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
