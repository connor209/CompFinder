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
    date: "2026-08-25",
    changes: [
      "There's a Save image button on every answer now. It gives you a tidy PNG of the price, how many sales it's based on, the last one, and the date — for pasting into a thread when someone asks what their card is worth. On a phone it offers to share it straight to wherever you're sending it.",
      "The site's name is now on the answer screen, so a screenshot of a price says where the price came from.",
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
