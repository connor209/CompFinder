/**
 * Live streams and what aired on them — `live_streams` and `stream_airings`
 * (migration 031), named in THIS FILE ONLY, the same rule batch-store.js and
 * wants-store.js follow: one place to update, one place a pending migration is
 * recognised.
 *
 * **Every call degrades rather than throws.** Until 031 is run each function
 * returns `{ ok: false, missing: true }` and the Stream stock screen says what
 * to run, while every other screen carries on exactly as before.
 *
 * Framework-free apart from the Supabase client it is handed.
 */

/** Does this error mean "migration 031 hasn't been run"? */
export function isMissingStreams(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /live_streams|stream_airings|does not exist|schema cache/i.test(msg);
}

function fail(err, fallback) {
  if (isMissingStreams(err)) return { ok: false, missing: true, rows: [] };
  return { ok: false, error: err?.message || fallback, rows: [] };
}

async function userId(sb) {
  const { data } = await sb.auth.getUser();
  return data?.user?.id || null;
}

/** Every stream, newest first. */
export async function loadStreams(sb) {
  try {
    const { data, error } = await sb
      .from("live_streams")
      .select("id,name,streamed_on,closed_at,created_at")
      .order("streamed_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return fail(error, "Could not read the streams.");
    return { ok: true, rows: data || [] };
  } catch (err) {
    return fail(err, "Could not read the streams.");
  }
}

/** Every airing. A few hundred a month, so one read. */
export async function loadAirings(sb) {
  try {
    let from = 0;
    let rows = [];
    for (;;) {
      const { data, error } = await sb
        .from("stream_airings")
        .select("id,stream_id,checkout_id,aired_at,outcome,hammer_pence")
        .order("aired_at", { ascending: true })
        .range(from, from + 999);
      if (error) return fail(error, "Could not read what aired.");
      rows = rows.concat(data || []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    return { ok: true, rows };
  } catch (err) {
    return fail(err, "Could not read what aired.");
  }
}

export async function createStream(sb, { name, streamedOn = null } = {}) {
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, error: "Give the stream a name." };
  try {
    const uid = await userId(sb);
    if (!uid) return { ok: false, error: "Not signed in." };
    const row = { user_id: uid, name: clean };
    if (streamedOn) row.streamed_on = streamedOn;
    const { data, error } = await sb.from("live_streams").insert(row).select("id,name,streamed_on,closed_at,created_at").single();
    if (error) return fail(error, "Could not start the stream.");
    return { ok: true, row: data };
  } catch (err) {
    return fail(err, "Could not start the stream.");
  }
}

/**
 * Close a stream once it is packed. Every airing still without an outcome is
 * recorded as UNSOLD, which is what counts it toward the card going home — so
 * this is the step that has to be deliberate, and the screen confirms it.
 */
export async function closeStream(sb, streamId) {
  try {
    const { error: aErr } = await sb
      .from("stream_airings")
      .update({ outcome: "unsold" })
      .eq("stream_id", streamId)
      .is("outcome", null);
    if (aErr) return fail(aErr, "Could not record the unsold cards.");
    const { error } = await sb.from("live_streams").update({ closed_at: new Date().toISOString() }).eq("id", streamId);
    if (error) return fail(error, "Could not close the stream.");
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not close the stream.");
  }
}

/** Re-open a stream closed by mistake. Outcomes already written stay written. */
export async function reopenStream(sb, streamId) {
  try {
    const { error } = await sb.from("live_streams").update({ closed_at: null }).eq("id", streamId);
    if (error) return fail(error, "Could not re-open the stream.");
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not re-open the stream.");
  }
}

/**
 * Record that these checkouts went on air in this stream. Idempotent: a card
 * already recorded against the stream is skipped rather than counted twice,
 * because reading the relay a second time must not send a card home early.
 */
export async function recordAirings(sb, streamId, checkoutIds) {
  const ids = [...new Set((checkoutIds || []).map(String))];
  if (!streamId || ids.length === 0) return { ok: true, added: 0 };
  try {
    const uid = await userId(sb);
    if (!uid) return { ok: false, error: "Not signed in." };
    const { data: have, error: readErr } = await sb
      .from("stream_airings")
      .select("checkout_id")
      .eq("stream_id", streamId)
      .in("checkout_id", ids);
    if (readErr) return fail(readErr, "Could not record what aired.");
    const already = new Set((have || []).map((r) => String(r.checkout_id)));
    const rows = ids.filter((id) => !already.has(id)).map((id) => ({ user_id: uid, stream_id: streamId, checkout_id: id }));
    if (rows.length === 0) return { ok: true, added: 0 };
    const { error } = await sb.from("stream_airings").insert(rows);
    if (error) return fail(error, "Could not record what aired.");
    return { ok: true, added: rows.length };
  } catch (err) {
    return fail(err, "Could not record what aired.");
  }
}

/** Take an airing back off — a card ticked by mistake. */
export async function deleteAiring(sb, airingId) {
  try {
    const { error } = await sb.from("stream_airings").delete().eq("id", airingId);
    if (error) return fail(error, "Could not remove that airing.");
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not remove that airing.");
  }
}

/** Set what happened to a card on air: 'sold', 'unsold', or null (not yet packed). */
export async function setAiringOutcome(sb, airingId, outcome, hammerPence = null) {
  const o = outcome === "sold" || outcome === "unsold" ? outcome : null;
  try {
    const { error } = await sb
      .from("stream_airings")
      .update({ outcome: o, hammer_pence: o === "sold" ? hammerPence : null })
      .eq("id", airingId);
    if (error) return fail(error, "Could not save that.");
    return { ok: true };
  } catch (err) {
    return fail(err, "Could not save that.");
  }
}
