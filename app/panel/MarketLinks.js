"use client";

import { ebaySearchUrl, cardmarketBestUrl } from "@/lib/marketplace.js";

/**
 * A compact pair of outbound marketplace links for a card — 🔍 eBay sold
 * listings and 🛒 Cardmarket. Cardmarket links exactly by cardmarketId when we
 * have one, else a name search; it's hidden when the game segment is unknown.
 * Used on Browse cards, Batch results and My Listings rows.
 */
export default function MarketLinks({ query, gameSlug = "pokemon", cardmarketId = null, sold = true, label = "" }) {
  const q = (query || "").trim();
  if (!q && !cardmarketId) return null;
  const ebayUrl = ebaySearchUrl(q, { sold });
  const cmUrl = cardmarketBestUrl({ cardmarketId, query: q, gameSlug });
  const suffix = label ? ` — ${label}` : "";
  return (
    <span className="mkt-links" onClick={(e) => e.stopPropagation()}>
      <a className="mkt-link" href={ebayUrl} target="_blank" rel="noopener noreferrer" title="eBay sold listings ↗" aria-label={`eBay sold listings${suffix}`}>🔍</a>
      {cmUrl ? <a className="mkt-link" href={cmUrl} target="_blank" rel="noopener noreferrer" title="Cardmarket ↗" aria-label={`Cardmarket page${suffix}`}>🛒</a> : null}
    </span>
  );
}
