/**
 * Reading a card off a photo — the one definition of it.
 *
 * The model is handed a picture and asked for the text printed on the card:
 * name, collector number, set, variant. That is deliberately OCR rather than
 * image recognition. The whole pricing engine is anchored on the collector
 * number — it is what separates one printing of a card from another — so a
 * model that recognised the ARTWORK and nothing else would still hand back a
 * card we could not price. See docs/CARD_IMAGE_RECOGNITION.md.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ROUTE. The prompt, the schema and
 * the model id used to live inside app/api/identify/route.js, which imports
 * Next and Supabase and therefore cannot be loaded by a script. Nothing could
 * measure what shipped without writing a second copy of the prompt, and two
 * prompts disagree the moment one is tuned — with the disagreement invisible,
 * because both still return well-formed JSON. scripts/audit-identify.mjs
 * imports this, and check-identify.mjs greps the route to keep it that way.
 *
 * No imports on purpose: the caller supplies its own Anthropic client, so this
 * loads under bare node as well as through the bundler.
 */

/**
 * Haiku, not something larger, because this is reading printed text off a
 * photo the browser has already downsized — and at Haiku rates a scan costs a
 * fraction of a penny against the app's own key rather than the user's
 * SoldComps quota. Whether a bigger model is worth the difference is a
 * question for the harness: audit-identify.mjs takes --model.
 */
export const IDENTIFY_MODEL = "claude-haiku-4-5";

/** Enough for the schema and a short note; the answer is a handful of fields. */
export const IDENTIFY_MAX_TOKENS = 400;

export const CARD_SCHEMA = {
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

/**
 * "Never guess it" is load-bearing rather than politeness. A blank number
 * costs a name-only search, which pools every printing of the card and returns
 * a confident-looking number built on the wrong ones — bad, and visible in the
 * caveats. A GUESSED number costs a price for a different card, with nothing
 * anywhere saying so. The second failure is much worse and the prompt is
 * written to prefer the first.
 */
export const SYSTEM_PROMPT = `You identify Pokémon trading cards from a photo for a reseller's pricing tool.
Read the text printed on the card and return:
- name: the Pokémon / card name exactly as printed.
- number: the collector number in "X/Y" form (e.g. "9/108"), read from the card. Leave blank if you cannot read it clearly — never guess it.
- set: the set / expansion name if you can determine it (from the set symbol, series text, or the number's denominator), else blank.
- variant: "Holo", "Reverse Holo", "Full Art", etc. if evident, else blank.
- suggested_query: a concise eBay-style search title built from the parts you could read, in the form "<name> <number> <set> Pokemon <variant>". Omit any part you couldn't read. This is what gets searched, so keep it clean and specific.
- notes: a short note if anything is uncertain or if identification failed.
If the image does not clearly show a single Pokémon card, set identified=false and explain briefly in notes.`;

/**
 * One read. Returns a plain object rather than throwing, so the route can map
 * it to a status and the harness can score a failure as a failure instead of
 * losing the run to one unreadable photo.
 *
 *   { ok: true,  result, usage, model }
 *   { ok: false, error, status }
 */
export async function identifyCard(client, { image, mediaType = "image/jpeg", model = IDENTIFY_MODEL } = {}) {
  if (!image) return { ok: false, error: "No image was provided.", status: 400 };

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: IDENTIFY_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Identify this Pokémon card." }
          ]
        }
      ],
      output_config: { format: { type: "json_schema", schema: CARD_SCHEMA } }
    });
  } catch (err) {
    return { ok: false, error: err?.message || "Card identification failed.", status: err?.status || 500 };
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) return { ok: false, error: "The vision model returned no result.", status: 502 };

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch {
    return { ok: false, error: "Could not parse the identification result.", status: 502 };
  }

  return { ok: true, result, usage: message.usage || null, model: message.model || model };
}

export default { IDENTIFY_MODEL, IDENTIFY_MAX_TOKENS, CARD_SCHEMA, SYSTEM_PROMPT, identifyCard };
