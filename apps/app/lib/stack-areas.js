/**
 * Which game's area a stack belongs to, read off its NAME.
 *
 * Stacks are named by convention already: a Magic divider is `MTG-C`
 * (cardmarket.js), a Yu-Gi-Oh stack is `YGO-A` (stackpos.js reads `YGO-A12`,
 * `YGO A12` and `YGO_A12` alike). Everything else, including the toploader
 * box and the Show Binders, is Pokémon, which is what those were built for.
 *
 * Decided 2026-11-21: by prefix, not by the cards inside. A stack must never
 * change area because of what was filed into it, and an empty stack still
 * needs an area.
 */

export const STACK_AREAS = [
  { key: "pokemon", label: "Pokémon", prefix: "" },
  { key: "ygo", label: "Yu-Gi-Oh", prefix: "YGO-" },
  { key: "mtg", label: "MTG", prefix: "MTG-" }
];

const name = (s) => String((s && typeof s === "object" ? s.name : s) || "").trim();

/** "pokemon" | "ygo" | "mtg" for a stack or a stack name. */
export function stackArea(stackOrName) {
  const n = name(stackOrName);
  if (/^MTG[-_\s]/i.test(n)) return "mtg";
  if (/^YGO[-_\s]/i.test(n)) return "ygo";
  return "pokemon";
}

export function areaOf(key) {
  return STACK_AREAS.find((a) => a.key === key) || STACK_AREAS[0];
}

/** The stacks in one area. */
export function stacksInArea(stacks, key) {
  return (stacks || []).filter((s) => stackArea(s) === key);
}

/**
 * A new stack's name, typed inside an area. The area's prefix is added when
 * it is missing, so "C" typed on the MTG tab makes MTG-C and never a Pokémon
 * stack called C. A name already carrying ANOTHER area's prefix is refused,
 * since it would be created and then vanish into a tab you are not on.
 * Returns { name } or { error }.
 */
export function newStackName(typed, key) {
  const raw = String(typed || "").trim();
  if (!raw) return { error: "Give the stack a name." };
  const area = areaOf(key);
  const own = stackArea(raw);
  if (own !== "pokemon" && own !== area.key) {
    return { error: `"${raw}" is a ${areaOf(own).label} name. Make it on the ${areaOf(own).label} tab.` };
  }
  const full = own === area.key ? raw : `${area.prefix}${raw}`;
  if (stackArea(full) !== area.key) {
    return { error: `Pokémon stacks can't start with MTG- or YGO-.` };
  }
  return { name: full };
}
