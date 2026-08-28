import "./globals.css";
import { Archivo, Martian_Mono, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { indexingAllowed } from "@/lib/indexing";

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

const STARTUP = [
  [1179, 2556], [1284, 2778], [1170, 2532], [1125, 2436],
  [1242, 2688], [1242, 2208], [828, 1792], [750, 1334],
  [1206, 2622], [1320, 2868]
];

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
  twitter: { card: "summary_large_image" },
  // noindex until the flag is set. robots.txt stops a crawler ASKING; this
  // stops a URL that reached Google some other way from being INDEXED, and
  // both have to say the same thing or the wrong one wins. One source for the
  // answer — see lib/indexing.js.
  robots: indexingAllowed() ? undefined : { index: false, follow: false },
  // iOS draws one of these before any code runs, and the splash continues from
  // exactly that state — every entry points at the same generator as the DOM
  // frame (lib/splash-frame.js), so the two cannot drift. A device size not
  // listed simply gets no launch image rather than a mismatched one.
  //
  // Written through the Metadata API rather than a <head> in this file: the
  // App Router hoists metadata, and a hand-authored <head> here rendered
  // nothing at all.
  appleWebApp: {
    title: "Last Comp",
    statusBarStyle: "black-translucent",
    startupImage: STARTUP.map(([w, h]) => ({
      url: `/launch-image?w=${w}&h=${h}`,
      media: `(device-width: ${w / 3}px) and (device-height: ${h / 3}px) and (-webkit-device-pixel-ratio: 3)`
    }))
  }
};

export const viewport = {
  themeColor: "#0B1011",
  width: "device-width",
  initialScale: 1
};


/**
 * Decides whether the splash shows BEFORE the first paint.
 *
 * It used to be decided in an effect, and an effect runs after the browser has
 * painted — so the page appeared, then the splash dropped on top of it. On a
 * fast connection the gap is invisible; on a slow one it is a splash screen
 * arriving after the site has loaded, which is the one thing a splash must
 * never do. (Same lesson as seeding the card price into useState rather than
 * setting it in an effect: an effect is too late for anything the first paint
 * depends on.)
 *
 * The decision needs matchMedia and sessionStorage, so it cannot be made on
 * the server. A blocking inline script is the only thing that runs earlier
 * than paint. It sets an attribute; CSS does the rest.
 *
 * ONCE A SESSION, AND AN INSTALLED APP IS NOT AN EXCEPTION. It used to skip
 * that check when the page was running standalone, on the reasoning that a
 * home-screen LAUNCH should always splash — which is right, and which this
 * still does, because a launch starts a new session. What it also did was
 * splash on every full page load inside the app: the back arrow is an <a>, so
 * returning from a card reloaded the document and played the whole animation
 * again on the way out of a search. iOS draws its launch PNG on a launch and
 * not on a navigation, so that one had nothing behind it to continue from —
 * it was the obstacle this file's own comment warns against.
 *
 * sessionStorage is the right proxy for a launch: an in-app navigation keeps
 * it, swiping the app away and reopening does not.
 *
 * Fails safe: the splash is display:none until this says otherwise, so a
 * broken script means no splash rather than a late one.
 */
const SPLASH_DECIDER = `(function(){try{
var m=window.matchMedia;
if(m&&m("(prefers-reduced-motion: reduce)").matches)return;
var seen=false;try{seen=sessionStorage.getItem("lc-splash")==="1"}catch(e){}
if(seen)return;
try{sessionStorage.setItem("lc-splash","1")}catch(e){}
document.documentElement.setAttribute("data-splash","show");
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en-GB"
      className={`${display.variable} ${figure.variable} ${mono.variable} ${sans.variable}`}
    >
      <body>
        {/* First thing in the body so it runs before anything below it is
            painted. Not in a hand-written <head>: the App Router hoists
            metadata and a <head> here renders nothing. */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_DECIDER }} />
        <div className="app">{children}</div>
      </body>
    </html>
  );
}
