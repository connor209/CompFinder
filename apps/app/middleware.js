import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

const PROTECTED_PATHS = ["/panel", "/settings", "/history"];

export async function middleware(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  // Required even though the value isn't used directly here — this call is
  // what actually refreshes an expiring session token via the cookies
  // above. Skipping it is a common way to end up with users randomly
  // logged out mid-session.
  //
  // getClaims(), not getUser(): getUser() asks Supabase's auth server who you
  // are on EVERY request — every page and every API call paid that round trip
  // before doing anything. getClaims() checks the token's signature here
  // against the project's published keys (cached), and only falls back to the
  // network when the project still signs with the legacy shared secret. It
  // refreshes an expiring session exactly as before. Every route that acts on
  // a user still asks getUser() itself.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  const isProtected = PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    // The query too: a visitor's wish-list QR opens /panel/shows?wish=…, and a
    // phone that has to sign in first would otherwise land on an empty desk.
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image optimization,
     * so the session-refresh logic above runs on every real page/API hit.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
