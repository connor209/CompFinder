import "./globals.css";
import { Archivo, Martian_Mono, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

/**
 * Fonts are self-hosted, not linked. next/font downloads the files at build
 * time and serves them from our own origin, which is what the handoff asked
 * for — a <link> to Google on a page whose whole promise is speed is a round
 * trip to somebody else's CDN before any text can paint.
 *
 * Archivo carries a width axis, and the identity is built on the 125% width.
 * Asking for `wdth` here is what makes `font-variation-settings:"wdth" 125`
 * in globals.css mean anything; without the axis the browser gets the normal
 * width and every heading quietly reads too narrow.
 */
const display = Archivo({
  subsets: ["latin"],
  // The whole variable range, because next/font only allows extra axes when
  // the weight is variable too — and the width axis is the point here.
  weight: "variable",
  axes: ["wdth"],
  variable: "--font-display",
  display: "swap"
});

// Two figures a screen, one weight. Nothing else uses it.
const figure = Martian_Mono({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-figure",
  display: "swap"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap"
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sans",
  display: "swap"
});

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://lastcomp.co.uk"),
  title: {
    default: "Last Comp — found a card, what's it worth?",
    template: "%s · Last Comp"
  },
  description:
    "Real eBay UK sold prices for Pokémon cards, and the cheapest one you could buy today. Junk comps thrown out, and you see the workings.",
  applicationName: "Last Comp",
  openGraph: {
    title: "Last Comp — found a card, what's it worth?",
    description: "Real eBay UK sold prices, and the cheapest one you could buy today.",
    url: "/",
    siteName: "Last Comp",
    type: "website"
  },
  twitter: { card: "summary_large_image" }
};

export const viewport = {
  themeColor: "#0B1011",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en-GB"
      className={`${display.variable} ${figure.variable} ${mono.variable} ${sans.variable}`}
    >
      <body>
        <div className="app">{children}</div>
      </body>
    </html>
  );
}
