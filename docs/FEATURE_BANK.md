# CompFinder — Feature Bank

An open inbox for ideas, so nothing gets lost between sessions. Unlike
`IMPROVEMENTS.md` (a one-off research pass), this is a **living list** — add to
it whenever something occurs to you, pull from it whenever there's time.

**To add something:** just say *"add X to the feature bank"* and it gets filed
here with the context. No need to explain it fully — a sentence is enough; the
point is to capture the thought before it evaporates.

**Status key** — 🔵 idea · 🟡 ready to build · 🟢 in progress · ⛔ blocked · ✅ done (kept briefly, then pruned)

---

## ✅ Setup — all clear

**Verified 16 Aug 2026. Nothing is blocked.** Re-check any time with
`supabase/HEALTH_CHECK.sql` (read-only, one query).

- Migrations 012 – 018 → all applied
- Catalogue → **eleven** games. The original ten (308,707 rows) plus Yu-Gi-Oh!
  (86,484 rows / 1,174 sets), imported 18 Aug.
- Price sources → all eleven configured in `cm_price_sources`
- **Do not run the catalogue truncate.** The data is good.
- eBay → connected with every scope: `sell.fulfillment.readonly` proven by the
  pull sheet loading live orders, `sell.account.readonly` proven by business
  policies loading in Settings. No reconnect needed.

Optional: in **Settings → eBay listing policies**, the dropdowns only take
effect once **Save policies** is pressed. Unsaved, new listings fall back to
inline flat postage (`profiles.settings.ebayPolicies`).

---

## 🐞 Known rough edges

- 🔵 **Print layout not re-checked** since variation picks were regrouped by
  set. *Low priority — the print feature hasn't been used yet.* Worth a pass
  before the first time you rely on a printed sheet.

---

## 🅿️ Parked — raised, not built

- ⛔ **Cardmarket listings & sales inside CompFinder** — Cardmarket's API is
  closed to new applications, so there's no way to pull your listings or sales
  live. Two routes if you still want it: (a) revisit if they reopen
  applications, (b) import their sales CSV export on a schedule, the same way
  the catalogue was ingested. Product links already deep-link by `idProduct`.
- 🔵 **More themes** — a high-contrast / accessibility theme, and
  game-specific identities (a Magic look, a One Piece look). Now cheap to add:
  a theme is one palette block plus one row in `SKINS`.
  `app/globals.css`, `app/panel/SkinPicker.js`

---

## 💡 Follow-ons from recent work

Natural next steps from things just built — not committed to, just noted.

- 🔵 **Per-show takings report** — every checkout is tagged with an event name,
  but nothing reports on it. A "London Expo: 23 sold, £1,240" summary would
  make shows measurable, and could feed Accounts as its own income line.
- 🔵 **Bulk lot → itemised, guided** — you can already reopen a bulk lot and
  itemise it. A dedicated flow (scan/enter cards, auto-splitting the lot cost
  across them) would make sorting a big lot less manual.
  `app/panel/Buy.js`

---

## 🏦 The bank

Anything you think of goes here first. Newest at the top.

<!-- New items get added below this line -->

- 🟡 **Surface market prices — Browse done, two left** — Browse now shows
  market + premium columns, sortable. Still to do: prefill the sell-sheet and
  eBay-variation prices from `suggestPrice()`, and value stacks/inventory at
  market instead of ask.
  `lib/priceguide.js`, `cm_card_prices` view
- 🔵 **Price history charts** — `cm_price_history` is filling daily but nothing
  plots it. Worth revisiting once there are a couple of weeks of data.
- ✅ **Price pipeline live** — first pull confirmed working 18 Aug via
  Settings → Market prices. The 04:30 cron keeps every configured game current;
  that panel shows each game's last run and can trigger one by hand.
- 🔵 **Set image URLs** — eBay variation listings build each card's photo from a
  URL template per set (`{setcode}`/`{num3}` tokens), which works while a game
  has a predictable image host. Storing a real image URL per set (or per card)
  in the catalogue would cover the games that don't.
  `lib/ebayvariation.js` → `imageFromTemplate`
- 🔵 **Sell sheets — verify One Piece `setCode` on a real import** — every
  game's columns are matched to its sample, but two One Piece details were
  inferred from a single row: the set code is hyphenated (`OP01` → `OP-01`)
  and `cn` is recovered from the card name (`OP01-013`) since the catalogue
  holds only the digits. Both are cosmetic — the importer matches on the
  product id — but worth eyeballing the first real One Piece import.
  `lib/sellsheet.js`
- 🔵 **Sell sheets — per-row condition / flags** — condition, language, price
  and the flags currently apply to the whole export. Their Magic sample lists
  the same card twice at different conditions, so per-row values (and multiple
  listings per card) would be the natural next step.
  `app/panel/SellSheet.js`
- 🔵 **Per-stack capacity override** — capacity is currently one number for all
  stacks (`profiles.settings.stackCapacity`). Fine while storage is uniform;
  if some boxes hold more than others, add a per-stack column.
