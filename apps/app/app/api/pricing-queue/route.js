import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLabBatch } from "@/lib/lab-batches";
import { labCardFor } from "@/lib/lab-pricing";
import {
  enqueueJob, listJobs, batchJobs, cancelJob, claimLease, leaseState, queueEta, isOpen
} from "@/lib/pricing-queue";
import { runPricingQueue } from "@/lib/pricing-worker";

/**
 * /api/pricing-queue — queue Add copies batches for pricing, and read the log.
 *
 * GET  ?batch=<id>                 the queue (open jobs, then recent ones), each
 *                                  open job's place and finish time, whether a
 *                                  worker is on it; with `batch`, that batch's
 *                                  jobs and their answers too.
 * POST { action: "enqueue", batchId, rowIds }   queue those rows of a batch.
 * POST { action: "cancel", id }                 stop a job; its answers stay.
 * POST { action: "kick" }                       start a worker if none is on it.
 *
 * A worker runs in after() under the service-role key, for up to ~4 minutes,
 * then hands on to the next run itself (a POST carrying CRON_SECRET). Without
 * CRON_SECRET the hand-on can't be authenticated, so an open Add copies tab
 * restarts the queue instead — the tab polls and kicks while jobs are open.
 * Either way only ONE worker per account ever holds the queue (the lease), and
 * that is what keeps every batch together under SoldComps' limit.
 */
export const maxDuration = 300;

async function startWorker(userId, origin) {
  let admin;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, error: e.message }; }
  const holder = randomUUID();
  const claim = await claimLease(admin, userId, holder);
  if (!claim.ok) return { ok: false, missing: claim.missing, error: claim.error };
  if (!claim.claimed) return { ok: true, started: false, busy: true };
  const { data: profile } = await admin.from("profiles").select("soldcomps_api_key").eq("id", userId).maybeSingle();
  if (!profile?.soldcomps_api_key) {
    return { ok: false, error: "No SoldComps API key set — add one in Settings." };
  }
  after(async () => {
    let r;
    try {
      r = await runPricingQueue(admin, userId, holder, { apiKey: profile.soldcomps_api_key });
    } catch (e) {
      r = { more: true, error: e.message };
    }
    const secret = process.env.CRON_SECRET;
    if (r?.more && secret && origin) {
      try {
        await fetch(`${origin}/api/pricing-queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify({ action: "worker", userId })
        });
      } catch { /* an open tab will restart it */ }
    }
  });
  return { ok: true, started: true };
}

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const batchId = request.nextUrl.searchParams.get("batch");
  const list = await listJobs(supabase, user.id);
  if (!list.ok) return NextResponse.json(list);
  const lease = await leaseState(supabase, user.id);
  const out = { ok: true, jobs: list.jobs, eta: queueEta(list.jobs), busy: lease.ok ? lease.busy : null };
  if (batchId) {
    const b = await batchJobs(supabase, user.id, batchId);
    out.batchJobs = b.ok ? b.jobs : [];
  }
  return NextResponse.json(out);
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Request body wasn't valid JSON." }, { status: 400 }); }
  const origin = request.nextUrl.origin;

  // The worker handing on to the next run. Only with the secret: the user id
  // in the body is trusted on nothing else.
  if (body?.action === "worker") {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(body.userId || ""))) return NextResponse.json({ ok: false, error: "Bad user." }, { status: 400 });
    return NextResponse.json(await startWorker(body.userId, origin));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  if (body?.action === "enqueue") {
    const got = await loadLabBatch(supabase, body.batchId);
    if (!got.ok) return NextResponse.json({ ok: false, missing: got.missing, error: got.error || "That batch couldn't be read." });
    const want = new Set((body.rowIds || []).map(String));
    const cards = got.batch.rows.filter((r) => want.has(String(r.id))).map((r) => ({ rowId: String(r.id), card: labCardFor(r) }));
    const q = await enqueueJob(supabase, user.id, { batchId: got.batch.id, batchName: got.batch.name, cards });
    if (!q.ok) return NextResponse.json(q);
    const w = await startWorker(user.id, origin);
    return NextResponse.json({ ok: true, job: q.job, worker: w });
  }
  if (body?.action === "cancel") return NextResponse.json(await cancelJob(supabase, user.id, body.id));
  if (body?.action === "kick") {
    const list = await listJobs(supabase, user.id, { limit: 20 });
    if (!list.ok) return NextResponse.json(list);
    if (!list.jobs.some(isOpen)) return NextResponse.json({ ok: true, started: false, idle: true });
    return NextResponse.json(await startWorker(user.id, origin));
  }
  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
