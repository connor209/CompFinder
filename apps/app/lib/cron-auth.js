/**
 * Who may run a nightly job. Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`; anything else is refused — and so is everything when the
 * secret is not set.
 *
 * The three nightly routes used to skip the check entirely when CRON_SECRET
 * was unset, which made the listings sync, the price pull and the lab's sale
 * sweep callable by anyone with the URL, across every account, while the
 * pricing queue's hand-on refused in the same situation. One rule now, the
 * pricing queue's: an unset secret is a misconfiguration, and the answer to a
 * misconfiguration is a job that says so in the Vercel log rather than one
 * that runs for strangers.
 *
 * Pure apart from reading the environment, so scripts/check-cronauth.mjs can
 * pin it.
 */

/** null when the request may run the job, otherwise the refusal to send. */
export function cronRefusal(request, secret = process.env.CRON_SECRET) {
  if (!secret) return { status: 503, error: "CRON_SECRET is not set on this deployment, so nightly jobs refuse to run. Set it in Vercel (Settings → Environment Variables)." };
  const got = request?.headers?.get?.("authorization");
  if (got !== `Bearer ${secret}`) return { status: 401, error: "Unauthorized." };
  return null;
}
