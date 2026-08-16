# CompFinder — Feature Bank

An open inbox for ideas, so nothing gets lost between sessions. Unlike
`IMPROVEMENTS.md` (a one-off research pass), this is a **living list** — add to
it whenever something occurs to you, pull from it whenever there's time.

**To add something:** just say *"add X to the feature bank"* and it gets filed
here with the context. No need to explain it fully — a sentence is enough; the
point is to capture the thought before it evaporates.

**Status key** — 🔵 idea · 🟡 ready to build · 🟢 in progress · ⛔ blocked · ✅ done (kept briefly, then pruned)

---

## ⛔ Blocked on you

Nothing here needs code — these are actions only you can take. Everything below
is built and waiting.

| | Item | What to do |
|---|---|---|
| ⛔ | **Migrations 012 / 013 / 014** | Run in the Supabase SQL editor: `012_listing_photos`, `013_deals`, `014_purchase_receipts`. Re-running an already-applied one is harmless (the `create policy` lines throw, nothing else happens). |
| ⛔ | **Migration 016 — Show desk** | `016_show_checkouts.sql`. Until it runs, the Show desk shows a setup notice; everything else works. |
| ⛔ | **Catalogue import** | `015_catalog_multigame.sql`, then `truncate table public.card_catalog;`, then import the 10 per-game CSVs. Unlocks Browse for all games **and** the set names/codes on the pull sheet. |
| ⛔ | **Reconnect eBay** | Picks up the newer scopes (fulfilment + account read) used by orders, sales and business policies. |

---

## 🐞 Known rough edges

- ⛔ **Rear camera only exposes the front lens** — your device reported
  `1 cam(s): Front Camera`, which is why the in-app camera stays on selfie.
  Suspected device state (screen recording / call active). *Next step:* retest
  with recording and calls off. If it's still front-only, fall back to the
  native camera in Safari for card scanning.
  `lib/camera.js`, `app/panel/CameraCapture.js`
- 🔵 **Stack sort assumes letter labels** — piles order A, B, C … Z, AA, AE
  (spreadsheet-style). A word-named stack ("ACE", "GRADED") sorts by length
  first, so it lands among the multi-letter piles rather than where you'd
  expect. Worth refining if you start naming stacks.
  `app/panel/PullSheet.js` → `pileCompare`
- 🔵 **Print layout not re-checked** since variation picks were regrouped by
  set. The printed pull sheet may need its own pass.

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

- 🔵 **Recommend show stock by *market* value, not list price** — it currently
  ranks by your eBay asking price. Ranking by sold-comp value, or by "listed
  longest without selling", might pick better show stock.
  `app/panel/ShowDesk.js` → `buildRecs`
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

_Empty — first idea goes here._
