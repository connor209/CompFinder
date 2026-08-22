/**
 * Resolves a query to a catalogue card the way the page does, so a harness
 * prices what a visitor would price.
 *
 * The field that matters most here is `language`. settingsForCard applies the
 * English-only comp rule unless the card is KNOWN to be foreign, and a
 * hand-written reference list carries no language at all — so the harness was
 * stripping Japanese comps from Japanese cards. Three of the fifty PulseTCG
 * movers are Japanese-set cards, and all three sat in the six that moved most:
 * Snorunt 200/193 lost 19 comps down to 6, Mega Golurk ex 109/076 lost 35 down
 * to 4. On the live page the resolver supplies the language and the rule
 * stands down, so the harness was measuring something the page never does.
 *
 * Costs nothing at SoldComps — /api/resolve reads Supabase only.
 */
export async function resolveCard(base, card) {
  try {
    const res = await fetch(`${base}/api/resolve?q=${encodeURIComponent(card.q)}`).then((r) => r.json());
    const top = (res.candidates || [])[0];
    if (!top) return card;
    // Keep the reference list's own name/number/set — they are the ground
    // truth for the comparison — and take only what it cannot know.
    return { ...card, language: top.language || null };
  } catch {
    return card;
  }
}

export default { resolveCard };
