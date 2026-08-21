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

export function settingsForCard(card) {
  if (!isPromoCard(card)) return CompFinderPricing.DEFAULT_SETTINGS;
  const base = CompFinderPricing.DEFAULT_SETTINGS;
  return {
    ...base,
    excludeKeywords: {
      ...base.excludeKeywords,
      // "league", "championship", "worlds" and "prerelease" stay: those are
      // genuinely different promos from an ordinary Black Star one, so they'd
      // still contaminate. Only the blanket "promo" is stood down.
      promoVariant: base.excludeKeywords.promoVariant.filter((w) => w !== "promo")
    }
  };
}

export default { isPromoCard, settingsForCard };
