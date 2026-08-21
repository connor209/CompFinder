/**
 * @compfinder/core is a workspace package of plain, untranspiled source (its
 * files moved out of ./lib unchanged, so they are still a mix of ESM and the
 * two CommonJS modules). Next only compiles node_modules packages when told
 * to, so without this the pricing engine arrives at the bundler unprocessed.
 */
const nextConfig = {
  transpilePackages: ["@compfinder/core"]
};

module.exports = nextConfig;
