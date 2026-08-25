/** Same reason as apps/app: @compfinder/core ships untranspiled source. */
const nextConfig = {
  transpilePackages: ["@compfinder/core"],
  // The launch image reads the Archivo file off disk at request time. Nothing
  // imports it, so tracing can't infer it and the route 500s in production
  // while building perfectly well locally.
  outputFileTracingIncludes: {
    "/launch-image": ["./assets/**"],
    "/card/[q]/share.png": ["./assets/**"]
  }
};

module.exports = nextConfig;
