/**
 * Every request through one door: if it arrived on the wrong hostname in
 * production, send it to the right one. The decision — and the reasoning, and
 * the two ways this could loop or eat previews — lives in
 * lib/canonical-host.js; this file only wires it to the edge.
 *
 * 308, not 307: permanent, so browsers stop asking, and method-preserving, so
 * a POST from a page still open on the old host doesn't arrive as a GET.
 */
import { NextResponse } from "next/server";
import { canonicalRedirect } from "./lib/canonical-host.js";

export function middleware(request) {
  const target = canonicalRedirect(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search
  );
  if (target) return NextResponse.redirect(target, 308);
  return NextResponse.next();
}

// Static chunks are only ever requested by a page already on some host; once
// the document redirects, so does everything after it. Skipping them keeps
// the middleware off the one path that is pure volume.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
