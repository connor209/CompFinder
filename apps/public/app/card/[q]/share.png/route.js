import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { shareFields } from "@/lib/share-card";
import { windowFromParam } from "@/lib/windows";
import { serverCard } from "@/lib/card-page";
import { priceCard } from "@/lib/price";

/**
 * The answer, as a PNG you can paste into a thread.
 *
 * People give price guidance by screenshotting this site, and a snipped
 * rectangle carries no brand, no date and whatever happened to be on screen.
 * This draws the same figures deliberately, at a fixed size, with the mark and
 * the date on it.
 *
 * TWO METHODS, because there are two ways this gets shared, and they cannot be
 * served the same way.
 *
 * POST is the Save-image button, and it is a POST on purpose. The figures come
 * from the client, which already has them — so it works for EVERY card,
 * including the one someone actually needs to price for a customer, which
 * usually isn't one of the 455 we publish. It costs nothing upstream and there
 * is nothing here to scrape, because it renders what you hand it.
 *
 * GET is the OpenGraph image, and it can only be the published set, because a
 * crawler hands us nothing and the only other source is the cache. That is the
 * right limit rather than a sad one: the published cards are exactly the ones
 * whose links get posted, and an unpublished card has no cached price to draw.
 * It READS the cache and never fills it — a crawler must never cost a
 * SoldComps request. Same rule as lib/card-page.js.
 *
 * 1200x630, the size every platform unfurls at.
 */
export const runtime = "nodejs";

// Same file, same reason, and the same tracing caveat as /launch-image: the
// bundler cannot infer a readFile path, so next.config.js force-traces it.
let fontData;
async function archivo() {
  if (fontData === undefined) {
    try {
      fontData = await readFile(join(process.cwd(), "assets", "Archivo-Expanded-800.ttf"));
    } catch (err) {
      // Null, not a throw. A missing font is a tracing mistake — it has
      // happened once — and the right failure for it is an image in the wrong
      // face, not a dead button. Loud in the log so it doesn't stay unnoticed.
      console.error("share.png: Archivo not on disk, falling back to the default face", err);
      fontData = null;
    }
  }
  return fontData;
}

const W = 1200;
const H = 630;

const C = {
  ground: "#0B1011",
  panel: "#141B1D",
  line: "#232F2D",
  ink: "#E9F1EF",
  inkSoft: "#9BAEAD",
  inkFaint: "#6B7F80",
  accent: "#2BBAA6",
  accentLight: "#4BCBB8"
};

/**
 * Card art, inlined. Satori can fetch a remote src itself, but then a slow or
 * missing tcgdex is a 500 on the button rather than an image without a
 * picture on it — and the picture is the least important thing here.
 */
async function artDataUri(src) {
  if (!src || !/^https:\/\//.test(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 3_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The picture. Both methods reach the same one, from different data. */
async function render(fields, artSrc) {
  const [art, font] = await Promise.all([artDataUri(artSrc), archivo()]);
  return { fields, art, font };
}

/**
 * The OpenGraph image: what a link to this card unfurls as in Discord,
 * WhatsApp, Slack or a Facebook post.
 *
 * A published card with nothing cached still renders — without a figure. A
 * broken image on a shared link is worse than one that says only which card
 * it is, and the warmer usually fills these within the week anyway.
 */
export async function GET(request, { params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  const windowDays = windowFromParam(new URL(request.url).searchParams.get("days"));

  // Cache read only, published cards only. Null for everything else, and the
  // page doesn't advertise an image it can't draw — see canonicalFor's twin
  // reasoning in page.js.
  // Caught rather than allowed to throw: an unfurler that gets a 500 caches
  // the failure and the link stays plain long after Supabase recovers, where
  // a 404 is simply retried.
  let found = null;
  try {
    found = await serverCard(query, windowDays);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!found) return new Response("Not found", { status: 404 });

  const { card, sold } = found;
  // The SAME function the answer screen's headline comes from, so the unfurl
  // and the page cannot disagree about the number.
  const priced = priceCard(card, sold.comps || []);
  const included = (priced.rec && priced.rec.included) || [];
  const last = included
    .map((c) => ({
      pence: c.totalPence ?? c.itemPricePence,
      endedAt: c._source && c._source.endedAt,
      t: c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : 0
    }))
    .sort((a, b) => b.t - a.t)[0] || null;

  const { fields, art, font } = await render(
    shareFields({
      card,
      marketPence: priced.pence,
      used: priced.used,
      windowDays,
      lastSale: last,
      now: new Date()
    }),
    card.image
  );

  return image(fields, art, font, {
    // Unfurlers re-fetch, and the underlying price only moves when the warmer
    // runs. An hour at the edge keeps a popular link off the function.
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const card = body && typeof body.card === "object" && body.card ? body.card : {};
  const pence = (v) => (Number.isFinite(v) && v >= 0 && v < 100_000_000 ? Math.round(v) : null);

  const f = shareFields({
    card: {
      name: typeof card.name === "string" ? card.name : "",
      set: typeof card.set === "string" ? card.set : "",
      number: typeof card.number === "string" ? card.number : ""
    },
    marketPence: pence(body.marketPence),
    used: Number.isFinite(body.used) ? Math.max(0, Math.min(9999, Math.round(body.used))) : 0,
    // Through the same allow-list the page and /api/price use, so the image
    // can't caption itself with a window the site doesn't offer.
    windowDays: windowFromParam(body.windowDays == null ? undefined : String(body.windowDays)),
    lastSale: body.lastSale && typeof body.lastSale === "object"
      ? { pence: pence(body.lastSale.pence), endedAt: body.lastSale.endedAt }
      : null,
    now: new Date()
  });

  const { fields, art, font } = await render(f, typeof card.image === "string" ? card.image : null);
  // Drawn from the body, so there is nothing for a shared cache to key on.
  return image(fields, art, font, { "Cache-Control": "no-store" });
}

/**
 * The picture itself, drawn once. GET and POST differ only in where the
 * numbers came from; if they drew different pictures they would eventually
 * disagree about which one is the shareable card.
 */
function image(fields, art, font, headers) {
  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: "flex", flexDirection: "column",
        background: C.ground, color: C.ink,
        fontFamily: "Archivo", padding: 56
      }}>
        {/* Brand first, because the crop that loses it is the reason this exists. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 1, textTransform: "uppercase" }}>
            <span style={{ color: C.ink }}>Last</span>
            <span style={{ color: C.accent }}>Comp</span>
          </div>
          <div style={{ display: "flex", whiteSpace: "nowrap", fontSize: 19, color: C.inkFaint, letterSpacing: 2, textTransform: "uppercase" }}>
            {fields.domain}
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 44, marginTop: 8 }}>
          {art ? (
            <img src={art} width={278} height={388}
                 style={{ borderRadius: 14, objectFit: "cover" }} />
          ) : (
            <div style={{
              display: "flex", width: 278, height: 388, borderRadius: 14,
              background: C.panel, border: `1px solid ${C.line}`
            }} />
          )}

          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 22, color: C.inkFaint, letterSpacing: 3, textTransform: "uppercase" }}>
              {fields.setLine}
            </div>
            <div style={{ display: "flex", fontSize: 52, marginTop: 10, color: C.ink, lineHeight: 1.1 }}>
              {fields.name}
            </div>

            <div style={{ display: "flex", fontSize: 20, color: C.inkFaint, letterSpacing: 3, textTransform: "uppercase", marginTop: 34 }}>
              {fields.figureLabel}
            </div>
            <div style={{ display: "flex", fontSize: 104, color: C.accentLight, lineHeight: 1, marginTop: 4 }}>
              {fields.figure}
            </div>

            <div style={{ display: "flex", fontSize: 23, color: C.inkSoft, marginTop: 22, textTransform: "uppercase", letterSpacing: 1 }}>
              {fields.basis}
            </div>
            {fields.lastSale ? (
              <div style={{ display: "flex", fontSize: 23, color: C.inkSoft, marginTop: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                {fields.lastSale}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderTop: `1px solid ${C.line}`, paddingTop: 20,
          fontSize: 18, color: C.inkFaint, letterSpacing: 2, textTransform: "uppercase"
        }}>
          {/* display:flex + nowrap on BOTH children, or Satori wraps them into
              each other instead of pushing them apart — it lays a bare text
              node out differently from a flex child. */}
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>{fields.stamp}</span>
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>We show our working</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      // Omitted entirely when the file is missing: next/og falls back to its
      // own bundled face rather than refusing to draw.
      ...(font ? { fonts: [{ name: "Archivo", data: font, style: "normal", weight: 800 }] } : {}),
      headers
    }
  );
}
