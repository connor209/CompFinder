import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clientIp } from "@/lib/client-ip";
import {
  turnstileEnabled,
  verifyTurnstileToken,
  issuePass,
  PASS_COOKIE,
  PASS_TTL_SECONDS
} from "@/lib/turnstile";

/**
 * Trade a solved Turnstile token for a pass cookie.
 *
 * Split out from /api/price because a token is single-use and a single search
 * makes two price requests in parallel (sold comps and active listings). Bolted
 * onto the price call, that is two challenges per search racing each other;
 * here it is one challenge, then thirty minutes of quiet.
 *
 * POST { token }  ->  { ok }  + Set-Cookie: cf_pass
 */

// Solving a challenge is cheap for a real visitor — one per half hour — and
// this endpoint calls out to Cloudflare, so it gets a bucket of its own rather
// than sharing the pricing allowance. Well clear of any honest use; tight
// enough that failed tokens can't be used to generate traffic.
const CHALLENGES_PER_HOUR = 60;

export async function POST(request) {
  // Nothing to issue if the mechanism is off: say so plainly rather than
  // handing out a pass that /api/price isn't checking anyway.
  if (!turnstileEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const ip = clientIp(request);

  // Rate limited before Cloudflare is called, not after — otherwise a loop of
  // junk tokens turns into a loop of siteverify requests made in our name.
  try {
    const supabase = createServiceClient();
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    const { data: count, error } = await supabase.rpc("bump_rate_limit", {
      // Namespaced so a burst of challenges can't exhaust the same visitor's
      // pricing allowance, and vice versa.
      p_ip: `challenge:${ip}`,
      p_window: windowStart.toISOString()
    });
    if (!error && count > CHALLENGES_PER_HOUR) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
  } catch (err) {
    // Same posture as /api/price: a limiter that can't be reached shouldn't
    // take the page down, but it shouldn't be a quiet way past either.
    console.error("challenge rate limit unavailable:", err.message);
  }

  const verdict = await verifyTurnstileToken(body && body.token, ip);
  if (!verdict.ok) {
    console.warn("Turnstile rejected a token:", verdict.reason);
    return NextResponse.json({ ok: false, error: "Couldn't verify that you're human. Try again." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true, enabled: true });
  response.cookies.set(PASS_COOKIE, issuePass(ip), {
    // Not readable from JavaScript: the client never needs to look inside it,
    // and a pass that scripts can read is a pass that a scraped page can lift.
    httpOnly: true,
    // Secure everywhere but local development: a Secure cookie is silently
    // dropped over plain http, so `npm run dev:public` with Turnstile keys set
    // would challenge, succeed, store nothing, and challenge again.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PASS_TTL_SECONDS
  });
  return response;
}
