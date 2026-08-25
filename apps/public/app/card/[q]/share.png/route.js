import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { shareFields } from "@/lib/share-card";
import { windowFromParam } from "@/lib/windows";

/**
 * The answer, as a PNG you can paste into a thread.
 *
 * People give price guidance by screenshotting this site, and a snipped
 * rectangle carries no brand, no date and whatever happened to be on screen.
 * This draws the same figures deliberately, at a fixed size, with the mark and
 * the date on it.
 *
 * POST, not GET, and that is the whole design. The figures come from the
 * client, which already has them: the alternative is reading the cache here,
 * and the cache only holds the 455 published cards — while the card someone
 * actually needs to price for a customer is usually not one of them. A GET
 * that worked on a twentieth of the site would be worse than no button.
 *
 * It costs NOTHING upstream. No SoldComps request, no Supabase read: every
 * number arrives in the body, already paid for by the search that drew the
 * screen. That is also why it can't be scraped for prices — it renders what
 * you hand it, so there is nothing here to take that you didn't bring.
 *
 * 1200x630, which is the OpenGraph size. Nothing links to it that way yet, but
 * an image built for sharing may as well be the shape every platform expects.
 */
export const runtime = "nodejs";

// Same file, same reason, and the same tracing caveat as /launch-image: the
// bundler cannot infer a readFile path, so next.config.js force-traces it.
let fontData;
async function archivo() {
  if (!fontData) fontData = await readFile(join(process.cwd(), "assets", "Archivo-Expanded-800.ttf"));
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

  const art = await artDataUri(typeof card.image === "string" ? card.image : null);
  const font = await archivo();

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
            {f.domain}
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
              {f.setLine}
            </div>
            <div style={{ display: "flex", fontSize: 52, marginTop: 10, color: C.ink, lineHeight: 1.1 }}>
              {f.name}
            </div>

            <div style={{ display: "flex", fontSize: 20, color: C.inkFaint, letterSpacing: 3, textTransform: "uppercase", marginTop: 34 }}>
              {f.figureLabel}
            </div>
            <div style={{ display: "flex", fontSize: 104, color: C.accentLight, lineHeight: 1, marginTop: 4 }}>
              {f.figure}
            </div>

            <div style={{ display: "flex", fontSize: 23, color: C.inkSoft, marginTop: 22, textTransform: "uppercase", letterSpacing: 1 }}>
              {f.basis}
            </div>
            {f.lastSale ? (
              <div style={{ display: "flex", fontSize: 23, color: C.inkSoft, marginTop: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                {f.lastSale}
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
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>{f.stamp}</span>
          <span style={{ display: "flex", whiteSpace: "nowrap" }}>We show our working</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [{ name: "Archivo", data: font, style: "normal", weight: 800 }],
      headers: {
        // Built from the body, so there is nothing for a shared cache to key on.
        "Cache-Control": "no-store"
      }
    }
  );
}
