/**
 * Comp Finder — what the Show Desk still needs from Supabase, said BEFORE you
 * need it.
 *
 * Every migration here is applied by hand and the code always ships first, so
 * there is always a window where a feature is deployed and its column is not.
 * The desk already degrades correctly in that window — that part is right and
 * is not what this file changes. What it changes is WHEN you find out.
 *
 * Migration 024 was discovered by typing a sticker price at a table and being
 * told, after pressing save, that it could not be saved. That is the worst
 * possible moment: the card is in your hand, a customer is waiting, and the
 * answer is a database migration you cannot run from the venue. Asking three
 * cheap questions when the desk opens turns that into something you find out
 * in the car park, where you can still do something about it — or at least
 * pack a pen.
 *
 * ## Three rules
 *
 * **UNKNOWN IS NOT ABSENT.** A probe that fails for any reason other than the
 * schema — venue wifi, a dropped connection, Supabase having a moment — must
 * never be reported as a missing migration. Telling someone at a show to go
 * and run SQL because their phone lost signal is worse than saying nothing:
 * they cannot check, so they have to believe it. Only an explicit "no such
 * column" counts.
 *
 * **It is scoped to the desk.** `scripts/check-migrations.mjs` probes all
 * fifteen schema migrations, which is right for a terminal and wrong here —
 * twenty round trips on venue wifi to report on the price guide, which nobody
 * at a table has ever wanted. Three questions, about the three things this
 * screen actually does.
 *
 * **It never blocks and never throws.** The desk renders first and the answer
 * arrives afterwards. A desk that white-screens at a show because a migration
 * is pending is a worse outcome than no warning at all, and that goes double
 * for a warning ABOUT a pending migration.
 *
 * Framework-free, so scripts/check-desksetup.mjs can load it under bare node.
 */

export const PRESENT = "present";
export const ABSENT = "absent";
export const UNKNOWN = "unknown";

/**
 * What a probe's error means. `null` — the query succeeded — is the column
 * being there.
 *
 * Only Postgres and PostgREST saying the object does not exist counts as
 * absent. Everything else, including no error code at all, is UNKNOWN.
 */
export function probeState(error) {
  if (!error) return PRESENT;
  const code = error.code || "";
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") return ABSENT;
  if (/does not exist|schema cache|Could not find the/i.test(msg)) return ABSENT;
  return UNKNOWN;
}

/**
 * What is missing, and what it costs you today.
 *
 * Each entry names the migration, its file, and — the part that matters at a
 * show — what will not work, in the words of the thing you were about to do.
 * "Migration 024 is pending" is a fact about a database; "sticker prices will
 * not save" is a fact about your afternoon.
 *
 * 024 is one entry however many of its columns are missing, because it is one
 * file to run. Its two halves fail differently, so the entry says which.
 */
export function deskSetup({ stickers = UNKNOWN, poolName = UNKNOWN, wants = UNKNOWN } = {}) {
  const out = [];

  const stickersGone = stickers === ABSENT;
  const poolGone = poolName === ABSENT;
  if (stickersGone || poolGone) {
    out.push({
      migration: "024",
      file: "024_show_stickers.sql",
      effect: stickersGone && poolGone
        ? "Sticker prices won't save, and a priced pool won't remember which show it was for."
        : stickersGone
          ? "Sticker prices won't save — not from a run, and not typed at the desk."
          : "A priced pool won't remember which show it was for. Stickers themselves are fine."
    });
  }

  if (wants === ABSENT) {
    out.push({
      migration: "026",
      file: "026_show_wants.sql",
      effect: "What people ask for won't be recorded — including the ones we couldn't answer, which is the half worth having."
    });
  }

  return out;
}

/**
 * One line for the banner's heading. Kept here rather than in the component so
 * the wording is pinned by the check alongside everything else it says.
 */
export function setupSummary(entries) {
  const list = (entries || []).map((e) => e.migration);
  if (!list.length) return "";
  return list.length === 1
    ? `Migration ${list[0]} hasn't been run yet`
    : `Migrations ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]} haven't been run yet`;
}
