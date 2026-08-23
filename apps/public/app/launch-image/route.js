import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SPLASH, frame } from "@/lib/splash-frame";

/**
 * Frame one of the splash, as a PNG.
 *
 * iOS draws a static image on a home-screen launch before any code runs, and
 * the splash then continues from exactly that state — so this and the DOM have
 * to be the same picture. Both are generated from lib/splash-frame.js rather
 * than matched by hand, because "they looked the same when I checked" is not a
 * property that survives a padding change.
 *
 * /launch-image?w=390&h=844
 */
export const runtime = "nodejs";

// Read from disk rather than fetched through import.meta.url: the bundler
// rewrites that to a static asset PATH, which fetch() cannot parse at build
// time. next.config.js force-traces this file into the deployment.
//
// The static instance at width 125 / weight 800 — the same cut the wordmark
// uses everywhere else, so the handoff can't show a different letterform.
let fontData;
async function archivo() {
  if (!fontData) {
    fontData = await readFile(join(process.cwd(), "assets", "Archivo-Expanded-800.ttf"));
  }
  return fontData;
}

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback;
};

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const width = clamp(params.get("w"), 120, 2048, 390);
  const height = clamp(params.get("h"), 120, 2732, 844);
  const f = frame(width, height);

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", position: "relative",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: SPLASH.ground
      }}>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-start",
          fontFamily: "Archivo", fontWeight: 800, textTransform: "uppercase",
          fontSize: f.fontSize, lineHeight: f.lineHeight, letterSpacing: "-0.005em",
          // Both words white, no holo: frame one has to look finished on its
          // own, because a slow network leaves the visitor sitting on it.
          color: SPLASH.ink
        }}>
          <div style={{ display: "flex" }}>Last</div>
          <div style={{ display: "flex" }}>Comp</div>
          <div style={{
            display: "flex", width: f.ruleWidth, height: f.ruleHeight,
            borderRadius: 2, background: SPLASH.rule, marginTop: f.fontSize * 0.34
          }} />
        </div>
      </div>
    ),
    { width, height, fonts: [{ name: "Archivo", data: await archivo(), weight: 800, style: "normal" }] }
  );
}
