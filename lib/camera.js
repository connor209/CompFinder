// Open a MediaStream on the REAR camera as reliably as iOS allows.
//
// facingMode (even { exact: "environment" }) is unreliable on iOS Safari and
// often returns the selfie camera. The dependable route:
//   1. Open ANY camera first — this both grants permission and UNLOCKS device
//      labels (enumerateDevices returns empty labels until a stream is live).
//   2. Enumerate, find the camera whose label says "back"/"rear", and reopen
//      that exact deviceId. Fall back to facingMode, then to whatever we have.
const BACK_RE = /\bback\b|\brear\b|environment/i;

export async function openRearCameraStream() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unsupported"), { name: "NotSupportedError" });
  }
  const gUM = (c) => navigator.mediaDevices.getUserMedia(c);

  // 1. Any camera — grants permission + unlocks labels. Throws if denied.
  let stream = await gUM({ video: true, audio: false });

  try {
    const currentLabel = stream.getVideoTracks()[0]?.label || "";
    if (BACK_RE.test(currentLabel)) return stream; // already the back camera

    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");

    // 2a. A camera explicitly labelled back/rear.
    const back = cams.find((d) => BACK_RE.test(d.label || ""));
    if (back?.deviceId) {
      const rear = await gUM({ video: { deviceId: { exact: back.deviceId } }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      return rear;
    }

    // 2b. Labels blocked/empty — try a hard environment request.
    try {
      const rear = await gUM({ video: { facingMode: { exact: "environment" } }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      return rear;
    } catch { /* fall through, keep the stream we already have */ }
  } catch { /* enumeration failed — keep the stream we already have */ }

  return stream;
}

export default { openRearCameraStream };
