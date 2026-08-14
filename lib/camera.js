// Open a MediaStream on the REAR camera as reliably as iOS allows.
//
// facingMode (even { exact: "environment" }) is unreliable on iOS Safari — it
// often hands back the selfie camera. The dependable route is: request camera
// access (which grants permission and populates device labels), then explicitly
// pick the back-facing videoinput by label/position and open THAT deviceId.
export async function openRearCameraStream() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unsupported"), { name: "NotSupportedError" });
  }
  const gUM = (c) => navigator.mediaDevices.getUserMedia(c);
  let lastErr;

  // 1. Ask for the rear camera directly. If this already gives us the back cam,
  //    great; either way permission is now granted so labels become readable.
  let stream = null;
  try {
    stream = await gUM({ video: { facingMode: { exact: "environment" } }, audio: false });
  } catch (e) {
    lastErr = e;
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") throw e;
  }

  // 2. Verify / correct the camera by enumerating devices (labels are available
  //    now that permission is granted). If the current stream isn't the back
  //    camera, switch to the one that is.
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const isBack = (d) => /back|rear|environment|wide|triple|dual/i.test(d.label || "");
    const back = cams.find(isBack) || (cams.length > 1 ? cams[cams.length - 1] : cams[0]);

    const current = stream?.getVideoTracks?.()[0];
    const currentIsBack = current && isBack({ label: current.label });

    if (back?.deviceId && !currentIsBack) {
      const better = await gUM({ video: { deviceId: { exact: back.deviceId } }, audio: false });
      if (stream) stream.getTracks().forEach((t) => t.stop()); // release the wrong (selfie) stream
      return better;
    }
  } catch (e) {
    lastErr = e;
    if (e?.name === "NotAllowedError") throw e;
  }
  if (stream) return stream;

  // 3. Last resorts.
  try { return await gUM({ video: { facingMode: "environment" }, audio: false }); }
  catch (e) { lastErr = e; if (e?.name === "NotAllowedError") throw e; }
  try { return await gUM({ video: true, audio: false }); }
  catch (e) { lastErr = e; }
  throw lastErr || new Error("Couldn't open the camera.");
}

export default { openRearCameraStream };
