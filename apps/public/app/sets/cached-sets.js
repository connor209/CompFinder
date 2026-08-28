import { unstable_cache } from "next/cache";
import { loadAllSets } from "@/lib/card-page";

/**
 * The hourly read behind /sets and its share image, shared by both.
 *
 * loadAllSets prices all 455 published cards from cache — the heaviest read on
 * the site — and the numbers only move when the warmer runs, weekly. So it
 * happens once an hour and the page, the unfurl image and every visitor in
 * between are served from that one read. Costs no SoldComps requests.
 *
 * In app/ rather than lib/ for the same reason the card page's cachedServerCard
 * is: lib/card-page.js is imported by the check scripts under bare node, where
 * next/cache does not resolve at all.
 *
 * ONE definition rather than an unstable_cache in each caller. Two would share
 * a cache entry only by both happening to pass the same key parts, and the
 * failure if they drifted is invisible — just twice the reads, quietly.
 */
export const cachedAllSets = unstable_cache(() => loadAllSets(), ["all-sets"], {
  revalidate: 3600,
  tags: ["soldcomps-cache"]
});

export default cachedAllSets;
