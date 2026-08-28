import CompFinderPricing from "@compfinder/core/pricing.js";

/**
 * Pricing settings tuned for the card being looked up.
 *
 * The engine excludes any listing whose title says "promo", which is right
 * when pricing a main-set card — a promo print of the same Pokémon is a
 * different card at a different price — and exactly wrong when the card you
 * searched for IS a promo. Measured on the movers list: Galarian Slowpoke
 * SWSH126, Rayquaza V SWSH147 and Pikachu SVP088 each fetched 40 clean,
 * correctly-matching comps and priced none of them, because every title
 * accurately described the card as a promo.
 */

// Promo sets number their cards with a set prefix rather than n/total:
// SWSH126, SVP088, MEP029, XY42, SM210.
const PROMO_NUMBER = /^(SWSH|SVP|SV|MEP|XY|SM|BW|HGSS|DP|POP)\s*\d{1,3}$/i;

export function isPromoCard(card) {
  if (!card) return false;
  if (/\bpromo/i.test(card.set || "")) return true;
  if (/\bpromo/i.test(card.rarity || "")) return true;
  return PROMO_NUMBER.test(String(card.number || "").trim());
}

/**
 * Foreign-language prints of an English card.
 *
 * A German Sylveon VMAX, an Italian Vaporeon ex and a Spanish Garchomp are
 * different products at different prices, and they were being pooled into
 * English comp sets: across 11,063 audited sold titles, 119 named a language
 * other than English — German 26, Italian 13, Spanish 11, Chinese 9, French 7
 * — and a Russian Machamp EX was the single top comp on its card at six times
 * the median.
 *
 * This lives here and NOT in packages/core on purpose. Core is shared with the
 * app, which has its own manual language toggle and is used to price stock
 * that may deliberately be a foreign print; silently excluding those from a
 * batch run would be a surprise. The public page has no toggle, so it has to
 * make an assumption, and English is the right one for a UK marketplace.
 *
 * "carte" is deliberately absent even though it is the strongest French
 * marker: it matched "Lotto Carte Pokemon Raichu ex 98/100 EX Sandstorm
 * inglese" — an Italian-language listing for an ENGLISH card, which is a sale
 * we want. Bare "japan" is out for the same reason, where "japanese" is safe.
 */
const FOREIGN_LANGUAGE = [
  "russian", "italian", "italiano", "french", "française", "francaise",
  "german", "deutsch", "spanish", "español", "espanol",
  "portuguese", "português", "portugues",
  "japanese", "korean", "chinese", "thai", "indonesian"
];

/**
 * True when we have no positive reason to think the card is foreign. A card
 * resolved from the catalogue carries its language; a free-text search with no
 * resolved card does not, and English is the right default there.
 */
function wantsEnglishComps(card) {
  const lang = card && card.language;
  return !lang || lang === "English";
}

const FOREIGN_RE = new RegExp(`\\b(${FOREIGN_LANGUAGE.join("|")})\\b`, "i");

/** How many of these comps name a language other than English. */
export function foreignCount(comps) {
  return (comps || []).filter((c) => FOREIGN_RE.test(c.title || "")).length;
}

/**
 * `includeForeign` stands the language rule down. The page defaults to
 * English-only and says so with a control, rather than silently applying an
 * assumption the visitor cannot see — someone holding a German card should be
 * able to price it, and someone who wants the whole market should be able to
 * ask for it.
 */
export function settingsForCard(card, { includeForeign = false } = {}) {
  const base = CompFinderPricing.DEFAULT_SETTINGS;
  const promo = isPromoCard(card);
  const english = wantsEnglishComps(card) && !includeForeign;
  // Read off what the visitor TYPED (`asked`), not off the catalogue row and
  // not off `q`: the catalogue knows about cards, and a grade is a fact about
  // one particular copy of one. `q` is no good either — once a card resolves
  // it holds the canonical "name number set" the cache is keyed on, with the
  // grade already stripped out of it, so reading the grade from there would
  // find one only on a search that failed to resolve.
  //
  // Someone who searches "PSA 10 Charizard 4/102" is asking what the slab is
  // worth, and answering with the raw card's price is answering a different
  // question — confidently, in the largest type on the page. A card page
  // rendered on the server has no visitor text at all, which is correct: a
  // published card page is about the raw card.
  const subjectGrade = CompFinderPricing.subjectGradeFrom((card && (card.asked || card.q)) || "");
  if (!promo && !english) return subjectGrade ? { ...base, subjectGrade } : base;

  const excludeKeywords = { ...base.excludeKeywords };
  if (promo) {
    // "league", "championship", "worlds" and "prerelease" stay: those are
    // genuinely different promos from an ordinary Black Star one, so they'd
    // still contaminate. Only the blanket "promo" is stood down.
    excludeKeywords.promoVariant = base.excludeKeywords.promoVariant.filter((w) => w !== "promo");
  }
  if (english) excludeKeywords.foreignPrint = FOREIGN_LANGUAGE;
  return { ...base, excludeKeywords, subjectGrade };
}

export default { isPromoCard, settingsForCard, foreignCount, FOREIGN_LANGUAGE };
