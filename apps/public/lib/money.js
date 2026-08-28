/**
 * Money, formatted — and deliberately NOT in app/ui.js.
 *
 * ui.js is "use client", and a `"use client"` module's exports are client
 * references: a server component may RENDER them as components but may not
 * CALL them. `gbp` is a plain function, so a server page importing it from
 * there compiles, builds, and then throws at request time —
 *
 *   "Attempted to call gbp() from the server but gbp is on the client."
 *
 * — which is what took /set/<slug> and /sets down. It hid for days because the
 * server pages only reach the call when a card HAS a price: with a cold cache
 * the ternary renders a dash and never invokes it, so an unwarmed set page and
 * an unwarmed hub both render perfectly. The page breaks when the data
 * arrives, which is the opposite of the order anyone tests in.
 *
 * So the formatter lives here, where both sides can have it. ui.js re-exports
 * it for the client screens; anything rendering on the server imports it from
 * this file.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

/** A card price: pence, with the pence shown, because there a penny is an answer. */
export function gbp(pence) {
  return pence == null ? "—" : CompFinderPricing.toPoundsStr(pence);
}

export default { gbp };
