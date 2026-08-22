/**
 * Re-export of the page's pricing pipeline, so a harness and the page cannot
 * answer differently. The definition lives in apps/public/lib/price.js —
 * scripts depend on the app, never the reverse.
 */
export { priceCard } from "../../apps/public/lib/price.js";
export { default } from "../../apps/public/lib/price.js";
