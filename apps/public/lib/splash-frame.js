/**
 * Frame one of the splash — the state the launch image and the first painted
 * DOM frame must BOTH be in.
 *
 * On iOS the launch image is a static PNG the system draws before any of our
 * code runs, so the animation cannot start there; it starts from it. That only
 * works if the two are pixel-identical, which is why the geometry lives here
 * as numbers rather than in two stylesheets that agree today. Hand-matching
 * them is how the handoff becomes a visible jump.
 *
 * Frame one is deliberately complete-looking on its own: wordmark all in
 * white, rule flat grey, no holo, no tagline. If the network is slow the
 * visitor sits on it, and it still has to read as the brand rather than as a
 * half-loaded page.
 */
export const SPLASH = {
  ground: "#0B1011",
  ink: "#E9F1EF",
  accent: "#2BBAA6",
  rule: "#232F2D",
  tagline: "Real eBay UK sold prices",
  taglineInk: "#6B7F80",
  // NO GLOW, on purpose. The mock has a soft teal bloom behind the mark, and
  // Satori — which renders the launch PNG — draws no radial gradient at any
  // syntax tried (shorthand, longhand, `circle at`, explicit dimensions). A
  // bloom in the DOM and a flat ground in the PNG is exactly the visible jump
  // this whole file exists to prevent, so both sides are flat until the PNG
  // can carry it. Matching matters more than the bloom does.
  glow: null
};

/**
 * Layout for one viewport. Everything is proportional so a 390×844 phone and a
 * 1024×1024 launch icon are the same picture at different sizes.
 */
export function frame(width, height) {
  const size = Math.round(width * 0.16);
  return {
    width,
    height,
    // Two lines at .96 leading, as the wordmark is set everywhere else.
    fontSize: size,
    lineHeight: 0.96,
    // Slightly above true centre: optically centred once the rule and the
    // tagline are counted, and it leaves the mark where the header will be.
    centreY: Math.round(height * 0.47),
    ruleWidth: Math.round(width * 0.52),
    ruleHeight: 3,
    ruleGap: Math.round(size * 0.55),
    taglineSize: Math.max(11, Math.round(width * 0.031)),
    taglineY: Math.round(height * 0.87)
  };
}

/** The timeline in 5c, in one place so the CSS and the comments can't drift. */
export const TIMELINE = {
  compWarms: 350,     // "Comp" white -> teal, holo begins fading up
  ruleFills: 500,     // teal fills the last third of the rule, left to right
  taglineIn: 800,     // tagline fades in at the foot
  handoff: 1600,      // cross-fade to the search screen
  handoffMs: 220
};

export default { SPLASH, frame, TIMELINE };
