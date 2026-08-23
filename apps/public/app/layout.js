import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://compfinder.co.uk"),
  title: {
    default: "CompFinder — what's that Pokémon card worth?",
    template: "%s · CompFinder"
  },
  description:
    "Free UK Pokémon card price checker. Real eBay sold prices from the last 90 days, filtered for junk comps and graded slabs, then recency-weighted.",
  openGraph: {
    title: "CompFinder — what's that Pokémon card worth?",
    description: "Free UK Pokémon card price checker built on real eBay sold data.",
    url: "/",
    siteName: "CompFinder",
    type: "website"
  },
  twitter: { card: "summary_large_image" }
};

export const viewport = { themeColor: "#0C7B6E" };

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
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
