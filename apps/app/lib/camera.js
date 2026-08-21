// Open a MediaStream on the REAR camera as reliably as iOS allows.
//
// facingMode (even { exact: "environment" }) is unreliable on iOS Safari and
// often returns the selfie camera. The dependable route:
//   1. Open ANY camera first — this grants permission and UNLOCKS device labels
//      (enumerateDevices returns empty labels until a stream is live).
//   2. Find the camera labelled "back"/"rear".
//   3. RELEASE the front camera, THEN open the back one. iOS only allows one
//      camera at a time, so opening the rear while the front is still live
//      silently fails and leaves you on the selfie cam — stopping first is the
//      key step.
const BACK_RE = /\bback\b|\brear\b|environment/i;

export async function openRearCameraStream() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unsupported"), { name: "NotSupportedError" });
  }
  const gUM = (c) => navigator.mediaDevices.getUserMedia(c);

  // 1. Any camera — grants permission + unlocks labels. Throws if denied.
  let stream = await gUM({ video: true, audio: false });
  if (BACK_RE.test(stream.getVideoTracks()[0]?.label || "")) return stream; // already rear

  // 2. Which enumerated camera is the back one?
  let backId = null;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    backId = cams.find((d) => BACK_RE.test(d.label || ""))?.deviceId || null;
  } catch { /* keep going with facingMode fallbacks */ }

  // 3. Release the front camera BEFORE opening another (iOS = one at a time).
  stream.getTracks().forEach((t) => t.stop());

  const attempts = [];
  if (backId) attempts.push({ video: { deviceId: { exact: backId } }, audio: false });
  attempts.push({ video: { facingMode: { exact: "environment" } }, audio: false });
  attempts.push({ video: { facingMode: "environment" }, audio: false });
  attempts.push({ video: true, audio: false }); // last resort: front is better than nothing

  let lastErr;
  for (const c of attempts) {
    try { return await gUM(c); } catch (e) { lastErr = e; if (e?.name === "NotAllowedError") throw e; }
  }
  throw lastErr || new Error("Couldn't open the camera.");
}

export default { openRearCameraStream };
