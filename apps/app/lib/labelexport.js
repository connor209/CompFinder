/**
 * Comp Finder — the label file the Nimbot printer imports.
 *
 * Two columns, `Price` then `Name`, one row per card, and the printer's app
 * generates a label per row. That is the whole format: it was specified by
 * what the printer actually accepts, not designed here, so the column names
 * and their ORDER are load-bearing and pinned by scripts/check-labels.mjs.
 *
 * Why a real .xlsx rather than a CSV: the label app imports the workbook
 * directly. A CSV would need opening and re-saving in Excel first, which is
 * the step this file exists to remove — and re-saving is exactly where a card
 * number like "4/99" gets silently rewritten to "Apr-99" (see
 * repairExcelDateMangling in lib/carduploader.js). Writing the workbook means
 * Excel never touches the file, so that whole class of damage can't happen.
 *
 * Why no library: this needs two columns of text. SheetJS's npm package is
 * deprecated and exceljs is over a megabyte in a client bundle. A workbook is
 * a ZIP of five small XML parts, and stored (uncompressed) entries need no
 * deflate — so the writer below is about a hundred lines and no dependency.
 *
 * Everything here is framework-free and app-import-free, so the check script
 * can build a real file under bare node and read its bytes back.
 */
import { stickerRows } from "./showstock.js";

/** The printer's columns, in the printer's order. Do not reorder. */
export const LABEL_COLUMNS = ["Price", "Name"];

/**
 * Sticker pence as the label prints it.
 *
 * Always whole pounds, because the cash ladder in showstock.js only ever
 * lands on multiples of 100 — so "£3", never "£3.00". On a small label the
 * three characters that saves are worth having, and a trailing ".00" reads
 * like a listing price rather than a cash price.
 */
export function labelPrice(pence) {
  if (pence == null || !Number.isFinite(Number(pence))) return "";
  return `£${Math.round(Number(pence) / 100)}`;
}

/**
 * The rows that become labels: priced cards only, in run order.
 *
 * Held rows are absent rather than blank. A label with no price on it is worse
 * than no label — it goes on a card, travels to a table, and has to be priced
 * from memory in front of a customer.
 */
export function labelRows(results, opts = {}) {
  return stickerRows(results, opts)
    .filter((r) => !r.held && r.stickerPence != null)
    .map((r) => ({ Price: labelPrice(r.stickerPence), Name: r.label }));
}

// ---------------------------------------------------------------------------
// A minimal .xlsx writer. Five XML parts in a ZIP, stored uncompressed.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * ZIP the parts. Entries are STORED, not deflated: these files are a few KB,
 * and storing them means no compressor — and means the check script can find
 * the sheet XML verbatim in the bytes it wrote.
 *
 * Timestamps are pinned to the epoch the format starts at (1980-01-01) rather
 * than read off the clock, so the same rows always produce the same bytes and
 * a test can assert them.
 */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(12, 0x0021, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, f.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true); // stored
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + f.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...central, end];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** XML text escaping, plus the control characters XML forbids outright. */
export function xmlText(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const XL = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Column letter for a zero-based index — only A..Z is ever needed here. */
const colLetter = (i) => String.fromCharCode(65 + i);

function sheetXml(rows, columns) {
  const cell = (colIndex, rowNumber, value) =>
    `<c r="${colLetter(colIndex)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;

  const body = [columns, ...rows.map((r) => columns.map((c) => r[c]))]
    .map((cells, i) => `<row r="${i + 1}">${cells.map((v, c) => cell(c, i + 1, v)).join("")}</row>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${XL}"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Build the workbook. Returns a Uint8Array — the caller wraps it in a Blob in
 * the browser, or writes it to disk in a test.
 *
 * Every cell is an INLINE string, including the price. A numeric price cell
 * would need a currency format to print as "£3", and a label app reading the
 * raw value would put a bare "3" on the sticker; text says exactly what gets
 * printed, which is the only thing that matters here.
 */
export function labelWorkbook(rows, columns = LABEL_COLUMNS) {
  const part = (name, xml) => ({ name, data: enc.encode(xml) });
  return zip([
    part("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    part("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${XL}" xmlns:r="${DOC}"><sheets><sheet name="Labels" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${DOC}/styles" Target="styles.xml"/></Relationships>`),
    part("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${XL}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>`),
    part("xl/worksheets/sheet1.xml", sheetXml(rows, columns))
  ]);
}

/**
 * A priced run straight to workbook bytes — the one call the screen makes.
 *
 * Nothing priced hands back nothing, rather than a workbook of headers with no
 * cards under them: an empty file that imports cleanly and prints zero labels
 * looks like the printer failed, and sends you looking in the wrong place.
 */
export function labelFile(results, opts = {}) {
  const rows = labelRows(results, opts);
  return rows.length === 0 ? new Uint8Array(0) : labelWorkbook(rows);
}
