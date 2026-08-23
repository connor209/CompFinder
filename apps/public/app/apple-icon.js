import { ImageResponse } from "next/og";

/**
 * Home-screen icon: the LC tile on the page ground, generated rather than
 * committed as a binary so it can't drift from the palette in globals.css.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex",
        alignItems: "center", justifyContent: "center", background: "#0B1011"
      }}>
        <div style={{
          width: 132, height: 132, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "#141B1D", border: "6px solid #2BBAA6", borderRadius: 33,
          color: "#2BBAA6", fontSize: 52, fontWeight: 800, letterSpacing: 1
        }}>LC</div>
      </div>
    ),
    { ...size }
  );
}
