import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { setsShareFields } from "@/lib/set-share";
import { cachedAllSets } from "../cached-sets";

/**
 * What a link to /sets unfurls as — the board of boards.
 *
 * This is the link worth posting: "most valuable Pokémon cards" is a far
 * broader thing to say in a group than any single set, and the hub is the page
 * that answers it. Same ground, same faces and the same standing rules as the
 * card and set images — sold figures only, always dated.
 *
 * GET ONLY, and that is the difference from the card image. That one answers
 * to a POST as well, because the Save-image button hands it figures for a card
 * nobody publishes. A set is always one of ours, its prices are always already
 * in the cache, and there is no client here holding numbers we don't. So there
 * is nothing to accept from a caller, and nothing accepted.
 *
 * IT READS THE CACHE AND NEVER FILLS IT. The standing rule: a crawler must
 * never cost a SoldComps request, and an unfurler is a crawler. loadSetCards
 * is one catalogue read and one cache read for the whole set — the same two
 * the page itself does, so an unfurl costs no more than a visit.
 *
 * 404 RATHER THAN THROW, for the reason the card route learned: an unfurler
 * caches a 500 and the link then stays plain long after Supabase has
 * recovered, where a 404 is simply asked again next time.
 */
export const runtime = "nodejs";
// Same reason as the page: a route handler with no dynamic segment is a
// static candidate, and this one reads a database at request time.
export const dynamic = "force-dynamic";

// Force-traced by next.config.js, same as the card image and the launch image:
// the bundler cannot infer a readFile path, and the route builds perfectly
// well without the file and then draws in the wrong face in production.
let fontData;
async function archivo() {
  if (fontData === undefined) {
    try {
      fontData = await readFile(join(process.cwd(), "assets", "Archivo-Expanded-800.ttf"));
    } catch (err) {
      console.error("sets share.png: Archivo not on disk, falling back to the default face", err);
      fontData = null;
    }
  }
  return fontData;
}

const W = 1200;
const H = 630;

const C = {
  ground: "#0B1011",
  line: "#232F2D",
  ink: "#E9F1EF",
  inkSoft: "#9BAEAD",
  inkFaint: "#6B7F80",
  accent: "#2BBAA6",
  accentLight: "#4BCBB8"
};

export async function GET() {
  let sets;
  try {
    sets = await cachedAllSets();
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!sets || !sets.length) return new Response("Not found", { status: 404 });

  const fields = setsShareFields({ sets, now: new Date() });
  // Nothing priced anywhere is a real state and not a picture. The page falls
  // back to the plain link, which is what it had before this existed.
  if (!fields.rows.length) return new Response("Not found", { status: 404 });

  return await settled(await image(fields), {
    // An hour at the edge — and the read behind it is the heaviest on the
    // site, so this one matters more than the per-set image's.
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
  });
}

/**
 * Read the ImageResponse to completion so a failure is catchable.
 *
 * Satori raises while the body is being PIPED rather than when ImageResponse
 * is constructed, so a try/catch around the constructor sees nothing and the
 * connection dies mid-response. The card route learned this the expensive way;
 * there is no art on this image to blame, which makes it less likely rather
 * than impossible — a long name in an unexpected script would do it.
 */
async function settled(response, headers) {
  try {
    const buf = Buffer.from(await response.arrayBuffer());
    return new Response(buf, { status: 200, headers: { "Content-Type": "image/png", ...headers } });
  } catch (err) {
    console.error("sets share.png: could not draw the set image", err);
    return new Response("Not found", { status: 404 });
  }
}

/**
 * NO CARD ART, deliberately.
 *
 * Five cards means five remote fetches on a route an unfurler will hit hard,
 * each one a chance to time out or hand back a WEBP that Satori cannot draw —
 * for pictures rendered at postage-stamp size next to the thing anyone
 * actually came for, which is the numbers. The card image fetches one picture
 * because the card IS the subject there. Here the leaderboard is.
 */
async function image(fields) {
  const font = await archivo();
  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: "flex", flexDirection: "column",
        background: C.ground, color: C.ink, fontFamily: "Archivo", padding: 56
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 1, textTransform: "uppercase" }}>
            <span style={{ color: C.ink }}>Last</span>
            <span style={{ color: C.accent }}>Comp</span>
          </div>
          <div style={{ display: "flex", whiteSpace: "nowrap", fontSize: 19, color: C.inkFaint, letterSpacing: 2, textTransform: "uppercase" }}>
            {fields.domain}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 20, color: C.inkFaint, letterSpacing: 3, textTransform: "uppercase", marginTop: 26 }}>
          {fields.eyebrow}
        </div>
        <div style={{ display: "flex", fontSize: 58, color: C.ink, lineHeight: 1.05, marginTop: 6 }}>
          {fields.name}
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, marginTop: 22 }}>
          {fields.rows.map((row) => (
            <div key={row.rank} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderTop: `1px solid ${C.line}`, paddingTop: 11, paddingBottom: 11
            }}>
              {/* Every one of these is a flex child with nowrap: Satori lays a
                  bare text node out differently and wraps them into each other
                  instead of pushing them apart. */}
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <span style={{ display: "flex", whiteSpace: "nowrap", fontSize: 22, color: C.inkFaint, width: 42 }}>
                  {row.rank}
                </span>
                <span style={{ display: "flex", whiteSpace: "nowrap", fontSize: 31, color: C.ink }}>
                  {row.name}
                </span>
                <span style={{ display: "flex", whiteSpace: "nowrap", fontSize: 21, color: C.inkFaint, marginLeft: 12 }}>
                  {row.number}
                </span>
              </div>
              <span style={{ display: "flex", whiteSpace: "nowrap", fontSize: 34, color: C.accentLight }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderTop: `1px solid ${C.line}`, paddingTop: 18,
          fontSize: 18, color: C.inkFaint, letterSpacing: 2, textTransform: "uppercase"
        }}>
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>{fields.basis}</span>
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>{fields.stamp}</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      ...(font ? { fonts: [{ name: "Archivo", data: font, style: "normal", weight: 800 }] } : {})
    }
  );
}
