import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * Identifies a Pokémon card from a photo so the panel can pre-fill the search
 * box. Vision runs on Claude Haiku 4.5 — cheap and more than capable of reading
 * a card's printed name and collector number (the ~X/Y that nearly-uniquely
 * identifies it). Deliberately a *suggestion*: the model returns a search
 * title, the user confirms/edits it before anything is priced.
 *
 * Cost is the app's, not the user's SoldComps quota: it uses ANTHROPIC_API_KEY
 * (set in the deployment env). At Haiku rates a single card is a fraction of a
 * cent; the browser downsizes the image first, which keeps it that way.
 */
const CARD_SCHEMA = {
  type: "object",
  properties: {
    identified: { type: "boolean" },
    name: { type: "string" },
    number: { type: "string" },
    set: { type: "string" },
    variant: { type: "string" },
    suggested_query: { type: "string" },
    notes: { type: "string" }
  },
  required: ["identified", "name", "number", "set", "variant", "suggested_query", "notes"],
  additionalProperties: false
};

const SYSTEM_PROMPT = `You identify Pokémon trading cards from a photo for a reseller's pricing tool.
Read the text printed on the card and return:
- name: the Pokémon / card name exactly as printed.
- number: the collector number in "X/Y" form (e.g. "9/108"), read from the card. Leave blank if you cannot read it clearly — never guess it.
- set: the set / expansion name if you can determine it (from the set symbol, series text, or the number's denominator), else blank.
- variant: "Holo", "Reverse Holo", "Full Art", etc. if evident, else blank.
- suggested_query: a concise eBay-style search title built from the parts you could read, in the form "<name> <number> <set> Pokemon <variant>". Omit any part you couldn't read. This is what gets searched, so keep it clean and specific.
- notes: a short note if anything is uncertain or if identification failed.
If the image does not clearly show a single Pokémon card, set identified=false and explain briefly in notes.`;

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
  if (!image) {
    return NextResponse.json({ ok: false, error: "No image was provided." }, { status: 400 });
  }

  const client = new Anthropic();

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType || "image/jpeg", data: image }
            },
            { type: "text", text: "Identify this Pokémon card." }
          ]
        }
      ],
      output_config: { format: { type: "json_schema", schema: CARD_SCHEMA } }
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) {
      return NextResponse.json({ ok: false, error: "The vision model returned no result." }, { status: 502 });
    }

    let result;
    try {
      result = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json({ ok: false, error: "Could not parse the identification result." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Card identification failed." }, { status: 500 });
  }
}
