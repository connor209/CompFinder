/** Same reason as apps/app: @compfinder/core ships untranspiled source. */
const nextConfig = {
  transpilePackages: ["@compfinder/core"],
  // The launch image and the share image read the Archivo file off disk at
  // request time. Nothing imports it, so tracing can't infer it and the route
  // 500s in production while building perfectly well locally.
  //
  // THESE KEYS ARE GLOBS, NOT ROUTE NAMES. "/card/[q]/share.png" reads like
  // the route and is not one: `[q]` is a character class, so it matches
  // /card/q/share.png and never the real page. Anything under a dynamic
  // segment needs a wildcard.
  //
  // Worth knowing what this did NOT cause, so nobody re-diagnoses it: the
  // share button's first production failure. Clean builds with the wrong key
  // and the right one both trace the font into the route, because the
  // `/launch-image` entry already pulls ./assets/** into the shared trace.
  // The key was wrong and is now right; it was never the outage.
  outputFileTracingIncludes: {
    "/launch-image": ["./assets/**"],
    "/card/**": ["./assets/**"],
    "/set/**": ["./assets/**"]
  }
};

module.exports = nextConfig;
