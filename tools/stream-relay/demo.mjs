#!/usr/bin/env node
/**
 * Comp Finder — fill the stream queue with something to look at.
 *
 *   node tools/stream-relay/demo.mjs            (relay must already be running)
 *   node tools/stream-relay/demo.mjs --lot 8    (8-second lots, so it moves)
 *
 * This exists to get an OBS scene laid out without a dev server, an eBay
 * account or a Supabase connection in the way. It posts to the same /queue
 * endpoint the app posts to, so what you see is what the real thing does —
 * sanitiseLot() refuses these exactly as it would refuse a real lot.
 *
 * **The pictures are catalogue art, not our scans**, and they are four
 * different cards standing in for one card's four photographs. That is the one
 * thing about this demo that is a lie: on a real lot the four pictures are
 * front, back, edges and corners of the SAME card, taken off its own listing.
 * Here they are stand-ins, so you can see the cycle turn.
 *
 * The last lot is deliberately one we would hold the price on — that is the
 * case worth looking at, because the overlay must show no value line at all
 * rather than an empty box where the last lot had a number.
 */
const ORIGIN = process.env.STREAM_ORIGIN || "http://127.0.0.1:4455";
const args = process.argv.slice(2);
const lotArg = args.indexOf("--lot");
const lotSeconds = lotArg >= 0 ? Number(args[lotArg + 1]) : null;

const art = (path) => `https://assets.tcgdex.net/en/${path}/high.png`;
const FOUR = [art("swsh/swsh7/215"), art("swsh/swsh6/20"), art("sv/sv03.5/151"), art("swsh/swsh12.5/160")];

const lots = [
  {
    id: "demo-1", name: "Umbreon VMAX 215/203", condition: "Near Mint",
    valuePence: 83748, valueText: "£837.48", valueLabel: "Recent sold", valueHeld: false,
    images: FOUR
  },
  {
    id: "demo-2", name: "Gengar VMAX 020/198", condition: "Lightly Played",
    valuePence: 8400, valueText: "£84", valueLabel: "Recent sold", valueHeld: false,
    images: FOUR.slice(0, 3)
  },
  {
    id: "demo-3", name: "Charizard ex 199/165", condition: "Near Mint",
    valuePence: 24999, valueText: "£249.99", valueLabel: "Recent sold", valueHeld: false,
    images: FOUR.slice(0, 2)
  },
  {
    // The one worth watching: a price we would not stand behind. The overlay
    // must render NO value line — not a blank, not a hedge — and the desk must
    // say why, so the host talks about the card instead of reading a number.
    id: "demo-4", name: "Iron Hands ex 070/162 Special Illustration Rare", condition: "Near Mint",
    valueHeld: true,
    images: [art("sv/sv08.5/161"), art("base/base1/4")]
  }
];

async function post(path, body) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    // No Origin header: this is a terminal, not a page. The relay's allow-list
    // is there to keep another TAB out of your queue, and a request with no
    // origin at all was never the thing it is guarding against.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

try {
  if (Number.isFinite(lotSeconds) && lotSeconds >= 3) {
    await post("/control", { action: "lotMs", ms: Math.round(lotSeconds * 1000) });
  }
  const out = await post("/queue", { lots });
  console.log(`\n  queued ${out.accepted?.length ?? 0} lot(s)${out.refused?.length ? `, refused ${out.refused.length}` : ""}`);
  (out.accepted || []).forEach((n) => console.log(`    · ${n}`));
  (out.refused || []).forEach((n) => console.log(`    ✕ ${n}`));
  console.log(`\n  OBS browser source   ${ORIGIN}/overlay`);
  console.log(`  the host's desk      ${ORIGIN}/`);
  console.log(`\n  Clear it again from the desk, or:`);
  console.log(`    curl -X POST ${ORIGIN}/control -H 'content-type: application/json' -d '{"action":"clear"}'\n`);
} catch (err) {
  console.error(`\n  Couldn't reach the relay at ${ORIGIN}.`);
  console.error(`  Start it first, in another terminal:  npm run stream\n`);
  process.exit(1);
}
