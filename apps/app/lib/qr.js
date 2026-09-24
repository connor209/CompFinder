/**
 * Comp Finder — a QR code as SVG, drawn here rather than fetched.
 *
 * The code encodes the storefront URL, and the URL is the key to it. A QR
 * image service would be handed every token we ever print, so the modules are
 * computed locally (qrcode-generator: zero dependencies, MIT) and drawn as one
 * SVG path — crisp at sticker size and at A4, and no network on venue wifi.
 *
 * Level M: survives a scuffed laminate or a thumb over a corner, and a URL
 * this short still fits a small version.
 */
import qrcode from "qrcode-generator";

/** The white border a scanner needs to find the code. Four modules is the spec. */
export const QR_QUIET = 4;

/** Dark modules as rows of booleans. */
export function qrMatrix(text, level = "M") {
  const qr = qrcode(0, level);
  qr.addData(String(text || ""));
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** One path covering every dark module, in a viewBox that includes the quiet zone. */
export function qrPath(text, level = "M") {
  const m = qrMatrix(text, level);
  const n = m.length;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) d += `M${c + QR_QUIET} ${r + QR_QUIET}h1v1h-1z`;
    }
  }
  return { size: n + QR_QUIET * 2, d };
}

/** A standalone SVG document, for the printed sign and the download. */
export function qrSvg(text, { level = "M" } = {}) {
  const { size, d } = qrPath(text, level);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
