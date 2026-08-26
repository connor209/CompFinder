import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { identifyCard } from "@/lib/identify";

/**
 * Identifies a Pokémon card from a photo so the Scan panel can price it.
 *
 * The prompt, the schema and the model live in lib/identify.js, not here —
 * this route is auth, transport and status codes. That split is what lets
 * scripts/audit-identify.mjs score exactly what ships rather than a copy of
 * it; check-identify.mjs fails if the prompt reappears in this file.
 *
 * Cost is the app's, not the user's SoldComps quota: it uses ANTHROPIC_API_KEY
 * (set in the deployment env). At Haiku rates a single card is a fraction of a
 * cent; the browser downsizes the image first, which keeps it that way.
 */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: "Photo identification isn't switched on yet — ANTHROPIC_API_KEY isn't set on the server."
      },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { image, mediaType } = body;

  const outcome = await identifyCard(new Anthropic(), { image, mediaType: mediaType || "image/jpeg" });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true, result: outcome.result });
}
