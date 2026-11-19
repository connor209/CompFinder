# /api/batch-comps — pricing a batch in one call

For Claude driving Comp Finder (the **app**) from a signed-in Chrome tab. The
session cookie authenticates; nothing to paste, no key exposed.

## Call it

From the console of any Comp Finder tab (same origin):

```js
const res = await fetch("/api/batch-comps", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    cards: [
      { sku: "JZ10", name: "Riolu (Cosmos Holo)", number: "BW33", set: "Black and White Promos",
        variant: "Holofoil", condition: "NM", current_price: 2.49 }
    ]
    // or: csv: "<raw CardUploader CSV text>"
  })
}).then((r) => r.json());
```

`GET /api/batch-comps` returns this contract as JSON, including the variant keys.

- **Up to 100 cards per request; send ~50, one request at a time.** Requests
  are paced to SoldComps' 60/minute inside one call; parallel calls share that
  limit and will hit 429s.
- **Speed:** a cold 50-card batch is roughly a minute (one search a card, a
  second without the set when the first finds under four). Anything searched
  in the last 24 hours comes from the cache — a same-day re-run is seconds.
  `summary.soldcomps_requests` and `summary.cache_hits` say which happened.

## Body

| field | |
|---|---|
| `cards` | `[{ sku, name, number, set, variant, condition, language, current_price }]` |
| `csv` | a raw CardUploader export instead of `cards` (finish/speciality columns read for the variant) |
| `variant_keys` (per card) | force the printing: `["cosmos"]`, `[]` for the base card. Otherwise read off name, variant, set and title |
| `mode` | `"price"` (default) or `"check"` — only cards whose suggestion differs from `current_price` by more than `check.abs_pounds` (1) or `check.pct` (30). Unpriced cards are always returned |
| `rules` | override any house rule: `postageCapPence`, `percentile`, `minCompsForPercentile`, `floorPence`, `ladderStepPence`, `conditionMultipliers`, `mpMinLpPence` |
| `fresh` | `true` skips the cache read (costs a request per card) |
| `depth` | `1` for one search a card; `2` (default) adds the no-set retry |
| `format` | `"csv"` returns `sku,suggested_price` as text |

## Each result

`sku`, `query` (and `queries_sent`), `matched` (name, number, set, promo,
variant), `n_comps` (UK, 90 days), `worldwide_comps`, `last_sold`,
`fetched_at` / `from_cache`, `sales[]` (price, postage, total, date, title,
item_id, url), `excluded[]` (same fields + `reason`, `reason_text`), `p40`,
`pricing` (method, basis, lp_price, condition, multiplier), `suggested_price`,
`engine_price`, `confidence`, `flags` and `notes`.

Flags: `few_comps` (<4), `variant_uncertain` (variant text not recognised, or a
base card whose search was mostly a variant), `wide_spread`, `no_uk_comps`
(see `worldwide_comps`), `price_held` (a stamped or graded card with too few
of its own sales — no price, never a fall back to the ordinary copies).

`csv` on the response is `sku,suggested_price` for every card. **An unpriced
card is `0.00`, not blank** — eBay refuses it, which is the point; type a price
before uploading. `summary.unpriced_skus` names them.

## Auditing

Every number can be redone by hand from the row: `sales[].total` is price +
postage capped, `p40` is the 40th percentile of those totals (the lowest under
four), `pricing.lp_price` is that rounded up onto .49/.99, and the condition
multiplier is applied to `lp_price` and rounded up again. Read `excluded[]`
before trusting a thin row — the reason is on every sale.
