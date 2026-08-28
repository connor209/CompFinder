/**
 * What has changed on Last Comp, in the visitor's words.
 *
 * WRITTEN BY HAND, not generated from commits. The commit messages in this
 * repo are internal reasoning — "Cache the reads, not the page" — and a
 * visitor should not have to decode them. Generating this would produce a feed
 * of refactors nobody outside the project can act on, which is worse than no
 * changelog at all.
 *
 * WHAT BELONGS HERE: anything someone using the site would notice. A price
 * that was wrong. A screen that got faster. A thing that now exists. What does
 * not belong: refactors, cache keys, test suites, config. If you cannot write
 * the entry without naming a file, it isn't an entry.
 *
 * THE FIXES MATTER MORE THAN THE FEATURES. This site's whole proposition is
 * that it shows its working and admits when it isn't sure; a changelog that
 * only lists new things reads like marketing and earns nothing. The £44.75
 * entry below is the most valuable one here precisely because it is
 * embarrassing.
 *
 * ONE RISK, worth naming: a changelog that stops being updated says the
 * project is abandoned, louder than having none ever did. Keep entries cheap
 * to add — one object, a date and a few lines — and only add one when
 * something a visitor would notice actually ships.
 */
export const CHANGELOG = [
  {
    date: "2026-08-28",
    changes: [
      "Search for a graded card and you now get a graded price. Put a grade in your search — \"PSA 10 Umbreon VMAX 215/203\" — and until now we quietly threw away every sale of a slab, priced the raw card underneath it instead, and showed you that number as if it were the answer. On a card whose slabs sell for hundreds that could come back as a couple of pounds. Slab sales at the grade you asked for are now what the price is built from, raw copies are excluded, and the page says which. If there aren't enough sales at that grade we say so rather than falling back to the raw card — a wrong price is worse than none.",
      "There's a Recent button on the search screen now, listing the last few cards you've looked at so you can get back to one without typing it again. It's kept in your own browser and never sent to us — there's a Clear on it, and clearing your browser data removes it too.",
      "The opening animation no longer replays every time you come back from a card. It was meant to run once when you open the site; if you'd added Last Comp to your home screen it was running on every trip back to the search screen, which is the opposite of what a splash screen is for. Going back is also instant now, rather than reloading the whole page.",
      "If you added Last Comp to your home screen before it moved to lastcomp.co.uk, the icon kept opening the old address — where the person-check refused everyone, so any card we hadn't already priced failed with no explanation. The site now moves you to the right address the moment it opens, so an old icon fixes itself the next time you use it."
    ]
  },
  {
    date: "2026-08-27",
    changes: [
      "Before we price a card we haven't seen before, there's a quick check that you're a person. It could fail in ways that left you stuck: when it wanted a tap it put the box in the bottom corner of the screen, where on a phone nobody saw it, on a page that still looked like it was loading — and thirty seconds later the search gave up. It now asks in the middle of the screen with a line saying what it wants.",
      "It also used to be tied to the exact connection you were on, so a phone moving between networks mid-search — which phones do by themselves — could be asked twice and then refused. That's fixed.",
      "And when a search does fail, there's now a Try again on the page. Before, the only way to have another go was to start over from the home page, which landed you back on the same wall."
    ]
  },
  {
    date: "2026-08-26",
    changes: [
      "A lot of cards were showing no picture, and they weren't a random selection — they were the expensive ones. Trainer Gallery, Galarian Gallery and Shiny Vault cards, Shining Legends, Dragon Majesty, and the older e-Card sets had no art at all, because the index we get pictures from doesn't hold any for them. We now fall back to a second index for anything the first one is missing, which covers around 1,700 cards. The Gold Star cards from the Holon sets are back too — those were being refused because the two indexes spell the name differently.",
      "Where a picture still isn't there, it's genuinely not available anywhere we can get it: World Championship decks, Play! Prize Pack reprints and a handful of one-off promos. We'd rather show no picture than one of a different card."
    ]
  },
  {
    date: "2026-08-25",
    changes: [
      "There's a Save image button on every answer now. It gives you a tidy PNG of the price, how many sales it's based on, the last one, and the date — for pasting into a thread when someone asks what their card is worth. On a computer you can copy it straight to the clipboard and paste it into a reply; on a phone it offers to share it wherever you're sending it.",
      "The site's name is now on the answer screen, so a screenshot of a price says where the price came from.",
      "Links to a card now unfurl as the price itself when you paste them into a chat or a group, instead of a bare address.",
      "Looking up a card we haven't priced before takes a few seconds, and the page now says what it's doing while it works rather than showing a bare spinner. It isn't a percentage, because we'd have to make the percentage up.",
      "Every card in a set now has its own page, sorted by what it's worth — and each card links to others from the same set, so there's somewhere to go next.",
      "The whole site is quicker. It was running from a server in Washington while its data sat in the UK; moving it to London cut the wait on a price from about eight tenths of a second to a third.",
      "Fixed a splash screen that could appear after the page had already loaded, which rather defeated the point of it."
    ]
  },
  {
    date: "2026-08-24",
    changes: [
      "“Buy it today for” was sometimes showing a listing that wasn't the card. On an Umbreon VMAX selling for around £837, we were pointing at one listed at £44.75 — which was not that card. A listing now has to carry the right collector number and sit within a third of what the card actually sells for. Where we hide one, the page says how many and why: fakes and wrong printings collect at the cheap end, and an asking price is not evidence of anything.",
      "Prices appear straight away on the cards we keep updated, instead of loading in after the page.",
      "Added a privacy page and a plain affiliate disclosure. Some links to eBay earn us a commission; it never changes the prices shown, or which listing comes first."
    ]
  },
  {
    date: "2026-08-23",
    changes: [
      "The answer screen now shows the last sale, graded prices if yours were slabbed, and how the price has moved — all of it worked out before, and thrown away.",
      "You can switch between the last 30 and 90 days of sales. Ninety finds more; thirty is more current on a card that's moving.",
      "The price no longer waits for live listings before it appears. Sold data is the answer; what's listed right now fills in behind it."
    ]
  }
];

export default CHANGELOG;
