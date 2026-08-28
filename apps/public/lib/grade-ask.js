/**
 * The grade a visitor asked about, carried across every route into a card page.
 *
 * The whole graded feature keys off `card.asked` — what the visitor TYPED —
 * because `card.q` is the canonical string the cache hashes, with the grade
 * already gone. That worked for exactly one of the six ways into a card page:
 * typing free text and pressing Enter, where the typed text IS the URL. Every
 * assisted route navigated to the canonical string instead — the dropdown via
 * queryForCard, the which-one picker the same — so tapping the card you meant
 * silently swapped your question from "what's the slab worth" to "what's the
 * raw card worth". The £875-as-£2.49 fault, reintroduced by the search box.
 *
 * So the ask rides IN THE URL, as a normalised prefix on the canonical query:
 * "/card/PSA 10 Umbreon VMAX 215/203 Evolving Skies". The URL rather than the
 * handoff because the URL is the thing that survives — a reload, a share, the
 * Back button — and a handoff is deleted on read. It costs nothing upstream:
 * stripAsk() recovers the canonical string, so the cache entry, the resolve
 * and the comps are all the same ones the raw search uses.
 *
 * Isomorphic and tiny: SearchField, the picker, the handoff guard and the
 * recents store all need the same two operations, and two copies of "what
 * counts as a grade prefix" would drift the way every duplicated rule here
 * has.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

/**
 * The normalised ask in `text`, as words to put in front of a query —
 * "PSA 10", "CGC 9.5", or "graded" for a slab with no readable tier.
 * Null for a raw card, which is every card unless the visitor said otherwise.
 */
export function gradeAskFrom(text) {
  const g = CompFinderPricing.subjectGradeFrom(text);
  if (!g) return null;
  return g.company != null && g.grade != null ? `${g.company} ${g.grade}` : "graded";
}

/**
 * The canonical query for a card, still carrying the grade the visitor typed.
 * `fromText` is whatever they said (the search box, the current URL); `q` is
 * queryForCard's canonical string. A raw ask returns `q` unchanged, so every
 * existing link and URL is exactly what it always was.
 */
export function carryGrade(fromText, q) {
  const ask = gradeAskFrom(fromText);
  if (!ask) return q;
  // Idempotent: a string that already says its grade keeps saying it once.
  // The unresolved path stores the typed text as its own canonical, so
  // without this a graded free-text search would stack "PSA 10 PSA 10 …".
  return gradeAskFrom(q) ? q : `${ask} ${q}`;
}

/**
 * The same string with the ask removed — what the resolver, the handoff guard
 * and the recents dedupe compare on, so a graded and a raw search of one card
 * agree about which card they are. Collapses the space the cut leaves behind.
 */
export function stripAsk(query) {
  return CompFinderPricing.stripGradeMarkers(query).replace(/\s+/g, " ").trim();
}

export default { gradeAskFrom, carryGrade, stripAsk };
