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
 * Cardmarket product-search URL for the given game. Returns null when the game
 * segment is unknown (e.g. an "other" manual search with no game context), so
 * callers can hide the link rather than send the user to a 404.
 */
export function cardmarketSearchUrl(query, gameSlug) {
  const seg = CM_SEGMENT[gameSlug];
  if (!seg) return null;
  return `https://www.cardmarket.com/en/${seg}/Products/Search?searchString=${q(query)}`;
}

export default { ebaySearchUrl, cardmarketSearchUrl };
