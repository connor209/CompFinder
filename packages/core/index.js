/**
 * Barrel for @compfinder/core.
 *
 * These modules were lifted verbatim out of apps/app/lib when the repo became
 * a workspace, because both the CompFinder app and the public price page need
 * them and a second copy of pricing.js would drift the moment either was
 * touched. Nothing here imports React, Next, Supabase, or any app code — that
 * is the rule that keeps the package shareable, and the reason the extraction
 * was a file move rather than a rewrite.
 *
 * Most callers import the specific module (@compfinder/core/pricing.js) rather
 * than this barrel, so a page pulling in one helper doesn't drag the rest.
 */
export { default as CompFinderPricing } from "./pricing.js";
export { default as SoldCompsApi } from "./soldcomps.js";
export * from "./cardname.js";
export * from "./marketplace.js";
export * from "./epn.js";
export * from "./catalog.js";
export * from "./setmatch.js";
