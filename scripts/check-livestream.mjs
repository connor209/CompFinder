/**
 * The live stream — what goes on air, and what may not.
 *
 *   node scripts/check-livestream.mjs      (or: npm run check)
 *
 * We auction cards on eBay Live off the listing's own photographs, with a
 * human host talking through each lot. That saves pulling every card twice,
 * and it moves a whole class of mistake somewhere new: this is the first
 * screen in this repo whose output is BROADCAST, and a broadcast is recorded.
 * A price this app would hold back from a sticker — peeled off in front of one
 * person — is a price that must not be read out to a room.
 *
 * Six things earn their place here, and none of them fail loudly in OBS:
 *
 * - **A lot is an allow-list.** Case 1 stuffs a listing row and a checkout row
 *   with every private value the app knows and searches the serialised lot for
 *   each one. The leak worth designing against is the column added to
 *   `ebay_listings` a year from now, arriving on a stream nobody re-audited.
 * - **A held price is never a figure.** Case 3 runs every reason the Show Desk
 *   holds a sticker back and asserts the lot carries no number at all — and
 *   case 4 asserts the RELAY strips one that arrives anyway, because the two
 *   ends of this are written by different people on different days.
 * - **The figure is not the sticker's.** The first version of livestream.js
 *   read the price straight off stickerFor(), which rounds onto a cash ladder
 *   for a table, and put "£85 recent sold" on air for an £84 card. Case 2 pins
 *   the unrounded figure.
 * - **Four pictures, the listing's, in the listing's order.** Case 5.
 * - **The relay never builds a lot.** Case 6 is a grep: the day it starts
 *   filling in a missing field there are two answers to what may be said on
 *   air, and the quieter one is the one being broadcast.
 * - **The overlay never renders a held reason or anything the lot didn't
 *   carry.** Case 7 reads the page itself.
 *
 * Framework-free, offline, no relay running.
 */
import { readFileSync } from "node:fs";
import {
  lotFrom, lotBlockers, lotReady, sanitiseLot, streamImages, streamValue,
  cycleTiming, poundsText, relayUrl, LOT_IMAGES_MAX, LOT_MS, MIN_IMAGE_MS,
  VALUE_LABEL, LOT_FIELDS, RELAY_ORIGIN
} from "../apps/app/lib/livestream.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) fail(`${what}: got ${a}, expected ${b}`);
};
const ok = (what, cond) => { if (!cond) fail(what); };

const file = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** A recommendation the engine would be happy with. */
const goodRec = (pence = 8400) => ({
  finalPence: pence, confidence: "High", dataSource: "sold",
  included: [1, 2, 3, 4, 5, 6, 7, 8], excluded: []
});

const PIC = (n) => `https://i.ebayimg.com/images/g/${n}/s-l1600.jpg`;

/* ------------------------------------------------------------------ 1
 * A lot is an allow-list, not a tidy-up.
 *
 * The two sources are a listing row and a checkout row, and both carry things
 * that have no business on a broadcast: the SKU is a stack name plus a
 * position, so it says how deep the stock runs; what a card COST is nobody's
 * business; and a note written for us is written in our voice.
 */
console.log("1. what may be said on air");
{
  const dirty = {
    // the real shape, plus everything private the app hangs off these rows
    ebay_item_id: "1234567890",
    title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM",
    sku: "AB42",
    stack_name: "Stack A",
    cost_pence: 1200,
    note: "bought in the Glasgow job lot, undergraded",
    hide_error: "eBay refused the revise",
    event: "Glasgow Expo",
    sold_price_pence: 9000,
    sticker_pence: 8500,
    user_id: "0f2b8b2e-1111-2222-3333-444455556666",
    // and the column nobody has added yet
    supplier_invoice: "INV-7781"
  };
  const lot = lotFrom({ id: dirty.ebay_item_id, title: dirty.title, source: dirty, images: [PIC("a"), PIC("b")], rec: goodRec() });
  const wire = JSON.stringify(lot);
  for (const secret of ["AB42", "Stack A", "1200", "Glasgow", "undergraded", "INV-7781", "0f2b8b2e", "9000", "eBay refused"]) {
    if (wire.includes(secret)) fail(`the lot carries ${JSON.stringify(secret)} — that reaches a broadcast`);
  }
  // …and it is built key by key, so a field nobody allowed simply isn't there.
  eq("the lot's keys", Object.keys(lot).sort(), [...LOT_FIELDS].sort());
  eq("the name a viewer reads", lot.name, "Gengar VMAX 020/198");
  eq("the condition", lot.condition, "Near Mint");
}

/* ------------------------------------------------------------------ 2
 * The figure is the engine's, unrounded.
 *
 * This is the bug the first version of this file shipped with: stickerFor()
 * is the right GATE and the wrong number. Its £1/£5/£10 ladder exists because
 * somebody is handing over notes at a table; run a broadcast figure through it
 * and an £84 card is announced at £85, which is a claim about value that is
 * simply not true.
 */
console.log("2. the figure is the engine's, not the sticker's");
{
  for (const [pence, want] of [[8400, "£84"], [24999, "£249.99"], [249, "£2.49"], [100000, "£1000"]]) {
    const lot = lotFrom({ id: "1", title: "Card 1/1", images: [PIC("a")], rec: goodRec(pence) });
    eq(`£${pence / 100} on air`, lot.valueText, want);
    eq(`£${pence / 100} unrounded`, lot.valuePence, pence);
  }
  const lot = lotFrom({ id: "1", title: "Card 1/1", images: [PIC("a")], rec: goodRec() });
  eq("the label says what the figure is", lot.valueLabel, VALUE_LABEL);
  ok("the label says these are sales, not asking prices", /sold/i.test(VALUE_LABEL));
}

/* ------------------------------------------------------------------ 3
 * A held price is not a hedged price — it is no figure at all.
 *
 * Every reason the Show Desk holds a sticker back is a stronger reason here.
 * The sharpest is `dataSource: "active"`: that is an asking price wearing a
 * sold price's clothes, and the entire public product exists because that
 * distinction is where people get hurt.
 */
console.log("3. a price we would not stand behind is not read out");
{
  const held = [
    ["priced from asking prices", { ...goodRec(), dataSource: "active" }],
    ["low confidence", { ...goodRec(), confidence: "Low", included: [1] }],
    ["no confidence", { ...goodRec(), confidence: "None", included: [] }],
    ["no price at all", { ...goodRec(), finalPence: null }]
  ];
  for (const [why, rec] of held) {
    const lot = lotFrom({ id: "1", title: "Card 1/1", images: [PIC("a")], rec });
    ok(`${why}: held`, lot.valueHeld === true);
    eq(`${why}: no figure`, lot.valuePence, null);
    eq(`${why}: no text`, lot.valueText, null);
    eq(`${why}: no label either`, lot.valueLabel, null);
    // …and the reason is available to the HOST, who has to talk over the lot.
    ok(`${why}: the host is told why`, !!streamValue(rec).reason);
  }
  // A card nobody has priced streams, and streams without a number.
  const unpriced = lotFrom({ id: "1", title: "Card 1/1", images: [PIC("a")], rec: null });
  ok("an unpriced card can still be a lot", lotReady(unpriced));
  eq("an unpriced card has no figure", unpriced.valueText, null);
  // A price somebody TYPED is theirs, and goes out: they were holding the card.
  const typed = lotFrom({ id: "1", title: "Card 1/1", images: [PIC("a")], rec: { finalPence: null, overridePence: 4000, confidence: "None", included: [], dataSource: "override" } });
  eq("a hand-typed price is broadcast", typed.valueText, "£40");
}

/* ------------------------------------------------------------------ 4
 * The relay is a bouncer, and it enforces the same rule.
 *
 * Two ends, written on different days. A producer that sets `valueHeld` and
 * leaves a stale figure beside it is not a hypothetical — it is what a
 * half-finished edit to lotFrom() looks like.
 */
console.log("4. the relay refuses what it should not broadcast");
{
  const sneaky = sanitiseLot({
    id: "444", name: "Sneaky", condition: "NM",
    valueHeld: true, valuePence: 99900, valueText: "£999", valueLabel: "Recent sold",
    images: [PIC("q")]
  });
  eq("a held lot arriving with a figure loses it", [sneaky.valuePence, sneaky.valueText, sneaky.valueLabel], [null, null, null]);

  // A lot with nothing to show is refused outright: eBay reads an empty or
  // placeholder screen as an abandoned stream, and a card auctioned off a
  // blank rectangle is the version of this format nobody should defend.
  eq("no pictures, no lot", sanitiseLot({ id: "1", name: "X", images: [] }), null);
  eq("no name, no lot", sanitiseLot({ id: "1", name: "", images: [PIC("a")] }), null);
  eq("no id, no lot", sanitiseLot({ name: "X", images: [PIC("a")] }), null);
  eq("rubbish is refused", sanitiseLot("not a lot"), null);
  ok("the blocker says which", lotBlockers({ id: "1", name: "X", images: [] }).some((b) => /picture/i.test(b)));

  // A field nobody allowed does not survive the trip, even if a producer sends
  // it. This is the same discipline as case 1, at the other end of the wire.
  const extra = sanitiseLot({ id: "1", name: "X", images: [PIC("a")], sku: "AB42", cost_pence: 1200 });
  ok("an unknown field is dropped by the relay", !JSON.stringify(extra).includes("AB42"));
}

/* ------------------------------------------------------------------ 5
 * Four pictures, the listing's, in the listing's order.
 */
console.log("5. the pictures");
{
  const six = [PIC("a"), PIC("b"), PIC("c"), PIC("d"), PIC("e"), PIC("f")];
  eq("capped at four", streamImages(six).length, LOT_IMAGES_MAX);
  eq("in the listing's order", streamImages(six), six.slice(0, 4));

  // eBay's CDN puts the size in the filename, so the same photograph arrives
  // under several URLs. Two of them in one cycle reads on air as a picture
  // that failed to load.
  const sameTwice = ["https://i.ebayimg.com/images/g/aaa/s-l140.jpg", "https://i.ebayimg.com/images/g/aaa/s-l1600.jpg", PIC("b")];
  eq("one photograph, once", streamImages(sameTwice).length, 2);
  eq("and asked for at full size", streamImages(sameTwice)[0], "https://i.ebayimg.com/images/g/aaa/s-l1600.jpg");

  // An http picture on an https page does not load, and the failure is a
  // blank rectangle on a broadcast rather than an error anyone sees.
  eq("http is refused", streamImages(["http://example.com/card.jpg"]), []);
  eq("nonsense is refused", streamImages([null, "", 42, {}]), []);

  // Timing: ~30s a lot, split over however many pictures there are, with a
  // floor — below about two and a half seconds a cycle stops reading as
  // photographs and starts reading as a flicker.
  eq("four pictures in thirty seconds", cycleTiming(4).perImageMs, 7500);
  eq("one picture holds the lot", cycleTiming(1).perImageMs, LOT_MS);
  ok("a short lot never strobes", cycleTiming(4, 4000).perImageMs >= MIN_IMAGE_MS);
}

/* ------------------------------------------------------------------ 6
 * The relay never builds a lot, and never listens to the network.
 */
console.log("6. one definition of what may be said, and one interface listened on");
{
  const relay = file("tools/stream-relay/server.mjs");

  // It may sanitise; it may not construct. lotFrom() in the relay would be a
  // second answer to the question this whole file exists to have one answer to.
  ok("the relay imports the bouncer", /sanitiseLot/.test(relay));
  if (/lotFrom\s*\(/.test(relay)) {
    fail("the relay calls lotFrom() — it must accept or refuse a lot, never build one");
  }
  for (const derived of ["counterName", "conditionOf", "stickerFor", "effectivePence", "inferCondition"]) {
    if (relay.includes(derived)) {
      fail(`the relay calls ${derived}() — deciding anything about a lot's content is the producer's job`);
    }
  }

  // The machine running OBS is on hall wifi. Bound to every interface this
  // serves the queue, the stock and the prices to the rest of the venue.
  // Scoped to the bind itself rather than the file: the reason this matters
  // is written out in that file's header, and a grep that reads its own
  // explanation as the violation is a check nobody can document around.
  ok('the relay binds 127.0.0.1', /const HOST = "127\.0\.0\.1"/.test(relay));
  ok("and listens on it", /server\.listen\(PORT, HOST\b/.test(relay));
  if (/const HOST = "(?!127\.0\.0\.1")|listen\([^)]*["'](?:0\.0\.0\.0|::)["']/.test(relay)) {
    fail("the relay binds a public interface — that is the venue's wifi");
  }
  // …and `*` would let any page you have open read the queue.
  if (/Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*/.test(relay)) {
    fail("the relay allows any origin — the allow-list is what keeps another tab out of your stock list");
  }
  // Chrome preflights a loopback request from a public page and blocks it
  // silently without this. It is the difference between a working button and
  // a button with nothing in the console.
  ok("private network access is answered", /Access-Control-Allow-Private-Network/.test(relay));
}

/* ------------------------------------------------------------------ 7
 * The overlay renders the lot and nothing else.
 */
console.log("7. the screen the audience sees");
{
  const overlay = file("tools/stream-relay/public/overlay.html");

  // The held REASON is prose written for us ("low confidence — 1 comp"). It
  // goes to the host's desk, never to the broadcast.
  for (const banned of ["reason", "sku", "cost", "stack"]) {
    if (new RegExp(`snap\\.lot\\.${banned}|lot\\.${banned}\\b`, "i").test(overlay)) {
      fail(`the overlay reads lot.${banned} — that is not a thing to put on a broadcast`);
    }
  }
  // A held lot must render no value line, not an empty box where the last lot
  // had a number.
  ok("the value line is conditional on there being a figure", /if \(lot\.valueText\)/.test(overlay));
  // Which picture is showing comes from the relay's clock, so a browser source
  // that reconnects mid-lot lands where the desk says it is rather than
  // starting the cycle again under a host who has already done the front.
  ok("the picture is derived from the lot's elapsed time", /elapsed\(snap\)/.test(overlay));
  if (/new Date\(\)\.getTime\(\)\s*-\s*start|Date\.now\(\)\s*-\s*pageStart/.test(overlay)) {
    fail("the overlay runs its own lot clock — a reconnect then restarts the cycle mid-lot");
  }
  // Standby renders nothing at all. eBay reads a placeholder screen as an
  // abandoned stream, and between lots the honest picture is the host on
  // camera.
  ok("the overlay is transparent for OBS", /background:\s*transparent/.test(overlay));
}

/* ------------------------------------------------------------------ 8
 * The producer's end: the button, and what it tells the host.
 */
console.log("8. queueing a card");
{
  const bar = file("apps/app/app/panel/StreamBar.js");
  const inv = file("apps/app/app/panel/Inventory.js");

  // Rule 3 — nothing is held quietly. The host hears why a lot is going out
  // with no number, at the moment they queue it.
  ok("the button reports a held price to the host", /streamValue\(/.test(bar) && /no figure/i.test(bar));
  // The lot is built by the one definition, here.
  ok("the button builds the lot with lotFrom()", /lotFrom\(/.test(bar));
  ok("and refuses one that cannot go on air", /lotBlockers\(/.test(bar));
  // Off by default: the relay is not running most days, and a screen polling a
  // dead port is a console full of failures on the busiest list in the app.
  ok("stream mode is off until it is turned on", /readStored\(ENABLED_KEY, ""\) === "1"/.test(bar));
  // One hook per SCREEN. This list was already fixed once for doing work per
  // row; a relay poll per row would put it straight back.
  eq("useRelay is called once on My listings", (inv.match(/useRelay\(\)/g) || []).length, 1);
  // The whole rec crosses, not its figure — see streamItemFor().
  ok("the row hands over the recommendation", /rec: p && !p\.error/.test(inv));
}

/* ------------------------------------------------------------------ 9
 * The URL the app posts to, and the one OBS is pointed at.
 */
console.log("9. addresses");
{
  eq("the relay's default origin", RELAY_ORIGIN, "http://127.0.0.1:4455");
  eq("a path joins cleanly", relayUrl("/queue"), "http://127.0.0.1:4455/queue");
  eq("a trailing slash does not double up", relayUrl("/queue", "http://127.0.0.1:9999/"), "http://127.0.0.1:9999/queue");
  eq("pounds", [poundsText(8400), poundsText(24999), poundsText(0), poundsText(null)], ["£84", "£249.99", null, null]);
}

if (failures) {
  console.error(`\ncheck-livestream: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-livestream: OK — a lot carries only what may be broadcast, and a price we can't stand behind is never read out.");
