# eBay write-back — updating prices & listings from CompFinder

Research on what it takes to push changes *to* eBay (revise prices, relist, end
listings) rather than just reading. Requested as a report before building.

## TL;DR

- **It's very doable, and cheaper/easier than expected** — because the OAuth
  token we already store carries the write scope (`sell.inventory`), so **no new
  eBay approval or re-consent is likely needed** to start.
- **eBay charges nothing for API calls.** The only cost is development effort and
  the operational care of writing to a live marketplace.
- **Difficulty: medium.** The API calls themselves are simple; the real work is
  the guardrails (confirmations, sanity checks, undo/audit) so we never mis-price
  a live listing.

## Which API

| Option | Can it revise *existing* listings? | Notes |
|---|---|---|
| **Trading API — `ReviseInventoryStatus`** | ✅ Yes | Best for price/quantity-only changes. Up to **4 items per call**, tiny payload → ideal for bulk repricing. |
| **Trading API — `ReviseFixedPriceItem` / `ReviseItem`** | ✅ Yes | Full revise (title, description, etc.). Heavier; needed only for non-price edits. |
| **Trading API — `RelistFixedPriceItem` / `EndFixedPriceItem`** | ✅ Yes | Relist ended items / end live ones. |
| **Sell Inventory API (REST) — `bulkUpdatePriceQuantity`** | ⚠️ Only Inventory-API-managed listings | Your existing listings weren't created via this API, so it **can't** touch them. Not the right tool here. |

So the same **Trading API** we already use for reading (`GetMyeBaySelling`) is the
one for writing — we'd just add `ReviseInventoryStatus` for the common case.

## The key finding: we probably already have write access

When we built the "Connect eBay" flow we requested the scope
`https://api.ebay.com/oauth/api_scope/sell.inventory` — the **read/write**
inventory scope (not the `.readonly` variant). `ReviseInventoryStatus`,
`ReviseFixedPriceItem`, `RelistFixedPriceItem` and `EndFixedPriceItem` all map to
that scope. **So the tokens already stored should permit price writes without you
re-approving anything.** (If a call ever returns an "insufficient scope" error,
the fix is a one-time reconnect — the flow already exists.)

## Costs

- **eBay API usage: free.** Trading API default is ~5,000 calls/day per app
  (raisable on request). Bulk repricing at 4 items/call means even a large
  inventory fits comfortably.
- **No per-change fee.** Revising a fixed-price listing's price is free.
- **Only real cost:** dev time + careful UX.

## Steps to build (recommended phasing)

**Phase 2a — single-listing price update (low blast radius)**
1. Add `POST /api/ebay/revise-price` → gets the user's access token (already
   handled, with refresh), calls `ReviseInventoryStatus` with `{ItemID, StartPrice}`.
2. On each inventory card, after "Check price", add **"Update to market £X"** →
   confirmation modal showing old → new → confirm.
3. On success, update the cached row (and re-sync).

**Phase 2b — bulk reprice**
4. "Reprice selected/visible": preview table of old → new for each, with a hard
   confirm and a per-item opt-out, then batch via `ReviseInventoryStatus`
   (4 per call, concurrency-limited).

**Phase 2c — relist / end tools**
5. Relist ended listings and end stale ones from the aged-listing view.

**Guardrails (built alongside 2a)**
- Confirmation on every write; nothing auto-applies.
- **Sanity limits** — refuse/deny-with-warning if a new price is >X% away from the
  old or from market (guards against a bad comp match nuking a price).
- **Audit + undo** — a new `ebay_price_changes` table storing old/new price +
  timestamp, so every change is logged and reversible. ⚠ small migration.
- **Rate limiting** and clear error surfacing.

## Risks / gotchas

- Writing to a live marketplace: a wrong comp match could set a silly price — the
  sanity limits + confirmations are non-negotiable.
- `ReviseItem` on auctions with bids is restricted; sticking to
  `ReviseInventoryStatus` on fixed-price listings avoids most edge cases.
- Multi-variation listings need per-variation handling (later).
- Keep the cache in sync after writes (re-sync or patch the row).

## Recommendation

Start with **Phase 2a** — a single, confirmed "update to market" per listing.
It's a small, safe build on top of what already exists (tokens, scope, cache),
proves the write path end-to-end, and immediately closes the loop from
"CompFinder says this is underpriced" → "fixed on eBay in one click." Bulk and
relist follow once you're comfortable it behaves.

**This does write to your real listings, so I'm holding implementation until you
give the go-ahead.**
