/** Same reason as apps/app: @compfinder/core ships untranspiled source. */
const nextConfig = {
  transpilePackages: ["@compfinder/core"],
  // The launch image reads the Archivo file off disk at request time. Nothing
  // imports it, so tracing can't infer it and the route 500s in production
  // while building perfectly well locally.
  outputFileTracingIncludes: {
    "/launch-image": ["./assets/**"]
  },

  /**
   * Let the CDN hold card pages.
   *
   * The route reads searchParams (the 30/90-day window), which opts it out of
   * Next's static caching entirely — so every hit was re-running the render
   * and both Supabase reads to produce HTML identical to the last one's.
   * x-vercel-cache said MISS every single time.
   *
   * The page is the same for everybody: the price is read from a shared cache,
   * and the only per-visitor part (the buy module) is fetched in the browser.
   * So it is public, not private — which is what makes this safe rather than a
   * way to serve one visitor another's page.
   *
   * Five minutes, because the underlying price only moves when the warmer runs
   * and that is weekly. stale-while-revalidate a day: after five minutes the
   * CDN serves the old copy instantly and refreshes behind it, so nobody ever
   * waits for a render. Vercel keys the cache on the full URL, so ?days=30 and
   * ?days=90 are separate entries rather than one answering for the other.
   */
  async headers() {
    return [
      {
        source: "/card/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=86400" }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
