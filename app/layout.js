import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://comp-finder-alpha.vercel.app"),
  title: {
    default: "CAASI",
    template: "%s · CAASI"
  },
  description:
    "Turn real eBay sold data into instant, recency-weighted prices, sync your live listings, spot repricing opportunities, and never undersell again.",
  keywords: ["eBay sold comps", "trading card pricing", "Pokemon card prices", "reseller tools", "inventory pricing"],
  openGraph: {
    title: "CompFinder — Real eBay sold-comp pricing",
    description:
      "Instant, recency-weighted prices from real eBay sold data — with your live listings synced in. Price faster, list smarter.",
    url: "/",
    siteName: "CompFinder",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "CompFinder — Real eBay sold-comp pricing",
    description: "Instant, recency-weighted prices from real eBay sold data, with your live listings synced in."
  },
  appleWebApp: {
    capable: true,
    title: "CAASI",
    statusBarStyle: "black-translucent"
  }
};

export const viewport = {
  themeColor: "#0C7B6E"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('cf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var s=localStorage.getItem('cf-skin');if(s&&/^(holo|tabletop|vintage|glacier|cotton|moss)$/.test(s))document.documentElement.setAttribute('data-skin',s);}catch(e){}})();"
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
