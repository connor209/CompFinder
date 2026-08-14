// Outbound marketplace search links for a card. eBay stays the live pricing
// source (SoldComps); this just opens either marketplace's own search in a new
// tab so you can eyeball listings directly. Cardmarket's API is closed to new
// apps, so we can't pull their prices — linking out is the next best thing.

// Our catalogue game slug -> Cardmarket's URL path segment. Pokemon + Magic are
// confirmed; the rest are Cardmarket's documented category names.
const CM_SEGMENT = {
  pokemon: "Pokemon",
  magic: "Magic",
  onepiece: "OnePiece",
  lorcana: "Lorcana",
  fleshandblood: "FleshAndBlood",
  digimon: "Digimon",
  weissschwarz: "WeissSchwarz",
  dragonball: "DragonBallSuperCardGame",
  vanguard: "CardfightVanguard",
  riftbound: "Riftbound"
};

function q(text) {
  return encodeURIComponent((text || "").replace(/\s+/g, " ").trim());
}

/**
 * eBay search URL. Defaults to sold + completed listings (the reseller's comp
 * view); pass { sold: false } for active listings.
 */
export function ebaySearchUrl(query, { sold = true, site = "www.ebay.co.uk" } = {}) {
  const soldParams = sold ? "&LH_Sold=1&LH_Complete=1" : "";
  return `https://${site}/sch/i.html?_nkw=${q(query)}${soldParams}`;
}

/**
 * Cardmarket product-search URL for the given game (name-based, fuzzy). Returns
 * null when the game segment is unknown. Prefer cardmarketProductUrl when a
 * cardmarketId is available — this is the fallback.
 */
export function cardmarketSearchUrl(query, gameSlug) {
  const seg = CM_SEGMENT[gameSlug];
  if (!seg) return null;
  return `https://www.cardmarket.com/en/${seg}/Products/Search?searchString=${q(query)}`;
}

/**
 * Cardmarket EXACT product page via their public idProduct redirect
 * (cardmarket.com/en/{Game}/Products?idProduct=…). cardmarketId comes straight
 * from the catalogue, so this lands on the precise card, not a search list.
 * Returns null when the id or game segment is missing.
 */
export function cardmarketProductUrl(cardmarketId, gameSlug) {
  const seg = CM_SEGMENT[gameSlug];
  if (!seg || !cardmarketId) return null;
  return `https://www.cardmarket.com/en/${seg}/Products?idProduct=${encodeURIComponent(cardmarketId)}`;
}

/** Best Cardmarket link: exact by id when we have it, else a name search. */
export function cardmarketBestUrl({ cardmarketId, query, gameSlug }) {
  return cardmarketProductUrl(cardmarketId, gameSlug) || cardmarketSearchUrl(query, gameSlug);
}

export default { ebaySearchUrl, cardmarketSearchUrl, cardmarketProductUrl, cardmarketBestUrl };
