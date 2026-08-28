/**
 * Builds the Last Comp show-poster artboards.
 *
 * One generator rather than three hand-written files: the three directions
 * share the mark, the QR and the type ramp, and a poster where the wordmark
 * is set two different ways in two files is the kind of drift nobody sees
 * until it is printed a hundred times.
 *
 * Fonts are embedded as woff2 data URIs (fonts.css, generated) rather than
 * linked. The canvas can pull Google Fonts, but its PNG/PDF export cannot
 * embed them — an exported poster would silently fall back to Arial, which
 * for a piece whose whole identity is Archivo at width 125% is the failure
 * mode that matters. Archivo is subset from the same file the launch image
 * uses (apps/public/assets/Archivo-Expanded-800.ttf).
 *
 *   node design/show-poster/build.mjs
 *
 * Writes <Name>.dc.html artboards (seeded onto the canvas) and preview/<Name>.html
 * (plain HTML, for looking at locally).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = readFileSync(join(HERE, "fonts.css"), "utf8");
const QR = JSON.parse(readFileSync(join(HERE, "qr.json"), "utf8"));

/* A4 at 96 css px to the inch, which is what the canvas exports at. */
const W = 794, H = 1123;

/* Straight from apps/public/app/globals.css — no eyeballed near-misses. */
const T = {
  ground: "#0B1011", panel: "#141B1D", line: "#232F2D",
  ink: "#E9F1EF", inkSoft: "#9BAEAD", inkFaint: "#6B7F80",
  accent: "#2BBAA6", accentLight: "#4BCBB8",
  // Print-only. The site has no light palette; these are chosen in the same
  // hue so the paper poster reads as the same brand, and dark enough that the
  // teal survives a grayscale photocopy.
  paper: "#F6F4EF", paperInk: "#111819", paperSoft: "#4A5654", paperFaint: "#7C8785",
  paperLine: "#DCD6C9", teal: "#0C7466", tealInk: "#04302A",
  // The mark on a teal ground. #04302A is the accent-ink from the app and is
  // right on a teal BUTTON at 13px; across a whole wordmark at 50px it reads
  // as a hole rather than as the second colour, so the two-tone goes lighter
  // than the ground instead of darker.
  mint: "#8FE0D0"
};

const DISPLAY = "'Archivo Expanded','Archivo',Impact,'Arial Black',sans-serif";
const FIGURE = "'Martian Mono',ui-monospace,'Courier New',monospace";
const MONO = "'IBM Plex Mono',ui-monospace,'Courier New',monospace";
const SANS = "'IBM Plex Sans',system-ui,-apple-system,sans-serif";

/** Archivo Expanded 800, uppercase — the one rule the brand never bends. */
const dsp = (size, { lh = 1, ls = "0.01em", color = T.ink } = {}) =>
  `font-family:${DISPLAY};font-weight:800;font-size:${size}px;line-height:${lh};` +
  `letter-spacing:${ls};text-transform:uppercase;color:${color}`;

const eyebrow = (color) =>
  `font-family:${SANS};font-weight:600;font-size:11px;letter-spacing:0.13em;` +
  `text-transform:uppercase;color:${color}`;

/** The stacked lockup: LAST in ink, COMP in the accent. Two lines at .96. */
const wordmark = (size, { ink = T.ink, accent = T.accent } = {}) =>
  `<div style="${dsp(size, { lh: 0.96, color: ink })}">Last` +
  `<span style="display:block;color:${accent}">Comp</span></div>`;

/** The same mark on one line, for a header row where stacking would dominate. */
const wordmarkInline = (size, { ink = T.ink, accent = T.accent } = {}) =>
  `<div style="${dsp(size, { lh: 1, color: ink })}">Last` +
  `<span style="color:${accent}">Comp</span></div>`;

/**
 * The code is the whole point of the poster, so it is drawn as vector paths
 * rather than a raster: it stays sharp at any print size, and crispEdges stops
 * a half-pixel seam appearing between neighbouring modules on screen.
 * Three modules of quiet zone — below four a phone camera starts to struggle.
 */
function qr(size, { dark = "#0B1011", light = "#FFFFFF", quiet = 3 } = {}) {
  const span = QR.modules + quiet * 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="lastcomp.co.uk">` +
    `<rect width="${span}" height="${span}" fill="${light}"></rect>` +
    `<g transform="translate(${quiet} ${quiet})" fill="${dark}">` +
    `<path d="${QR.path}"></path></g></svg>`;
}

const icon = (paths, color) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
  `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICON_TAG = '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z"></path><circle cx="7.5" cy="7.5" r="1.4"></circle>';
const ICON_LIST = '<path d="M4 6h10M4 12h13M4 18h7"></path><path d="M18 16.5 19.6 18 22 15"></path>';
const ICON_SLAB = '<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M9 8h6M9 12h6"></path>';

/**
 * The three claims. Each is something the site actually does — the poster is
 * for a product whose proposition is that it shows its working, so a claim on
 * it that the site cannot back is worse here than on any other poster.
 */
const CLAIMS = [
  [ICON_TAG, "Sold, not asked", "Completed eBay UK sales. What somebody paid, not what somebody hoped for."],
  [ICON_LIST, "Shows its working", "Every sale counted, every sale thrown out and why, and what is left after fees."],
  [ICON_SLAB, "Graded too", "A slab is priced against its own grade, never off the raw market."]
];

const LEGAL = "Pokémon cards, for now. Prices from completed eBay UK sales. " +
  "Not affiliated with eBay or The Pokémon Company.";

/**
 * The answer screen, reduced to the one row that carries the proposition: a
 * real card, a figure in Martian Mono, and the comps it came from. One
 * definition rather than one per poster — the figures are quoted from the same
 * card everywhere, and a poster wall where two of them disagree is worse than
 * a poster wall with no example on it at all.
 */
function examplePanel(c) {
  return `<div style="flex:none;border:1px solid ${c.border};border-radius:14px;background:${c.bg};padding:18px 20px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px">
          <div style="font-family:${MONO};font-size:15px;color:${c.name}">Umbreon VMAX 215/203</div>
          <div style="font-family:${MONO};font-size:13px;color:${c.faint}">Evolving Skies</div>
        </div>
        <div style="height:1px;background:${c.border}"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px">
          <div style="display:flex;flex-direction:column;gap:7px">
            <span style="${eyebrow(c.faint)}">Sells for</span>
            <span style="font-family:${FIGURE};font-weight:600;font-size:${c.figureSize}px;line-height:1;letter-spacing:-0.05em;color:${c.figure}">£837.48</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;font-family:${MONO};font-size:13px;color:${c.soft}">
            <span>8 sold comps &middot; 90 days</span>
            <span>Last sold £949.95 &middot; 24 Aug</span>
          </div>
        </div>
      </div>`;
}

const PANEL_DARK = { bg: T.panel, border: T.line, name: T.ink, faint: T.inkFaint, soft: T.inkSoft, figure: T.accentLight, figureSize: 40 };
const PANEL_LIGHT = { bg: "#FFFFFF", border: T.paperLine, name: T.paperInk, faint: T.paperFaint, soft: T.paperSoft, figure: T.teal, figureSize: 34 };

const EXAMPLE_NOTE = "An example — every card is priced from its own recent sales.";

/* ------------------------------------------------------------------ Main */
/* The brand as it exists: dark, and it explains itself. For the poster people
   read after the headline has already stopped them. */
function main() {
  const claims = CLAIMS.map(([ic, title, body]) => `
        <div style="display:flex;flex-direction:column;gap:9px">
          ${icon(ic, T.accent)}
          <div style="${dsp(13, { ls: "0.045em" })}">${title}</div>
          <div style="font-family:${SANS};font-size:13.5px;line-height:1.45;color:${T.inkSoft};text-wrap:pretty">${body}</div>
        </div>`).join("");

  return `<div style="width:${W}px;height:${H}px;box-sizing:border-box;background:${T.ground};color:${T.ink};padding:54px 56px 40px;display:flex;flex-direction:column">

      <div style="display:flex;flex:none;align-items:flex-start;justify-content:space-between;gap:24px">
        ${wordmark(56)}
        <div style="${eyebrow(T.inkFaint)};text-align:right;padding-top:8px">Real eBay UK<br>sold prices</div>
      </div>

      <div style="display:flex;flex:none;height:4px;margin-top:22px">
        <div style="flex:2;background:${T.line}"></div>
        <div style="flex:1;background:${T.accent}"></div>
      </div>

      <h1 style="${dsp(86, { lh: 0.9, ls: "-0.015em" })};margin:26px 0 0">What&#39;s it<span style="display:block">worth?</span></h1>

      <p style="font-family:${SANS};font-size:20px;line-height:1.45;color:${T.inkSoft};margin:16px 0 0;max-width:600px;text-wrap:pretty">Type any Pokémon card and get what it <strong style="color:${T.ink};font-weight:600">actually sold for</strong> on eBay UK over the last 90 days.</p>

      <div style="margin-top:22px">${examplePanel(PANEL_DARK)}</div>
      <div style="font-family:${SANS};font-size:12px;color:${T.inkFaint};margin-top:8px">${EXAMPLE_NOTE}</div>

      <div style="display:flex;flex:none;align-items:center;gap:26px;margin-top:20px">
        <div style="background:#FFFFFF;border-radius:12px;padding:9px;line-height:0">${qr(182)}</div>
        <div style="display:flex;flex-direction:column;gap:11px">
          <div style="${eyebrow(T.inkFaint)}">Point your camera at the code</div>
          <div style="${dsp(36, { lh: 1, color: T.accent })}">lastcomp<span style="color:${T.ink}">.co.uk</span></div>
          <div style="font-family:${SANS};font-size:17px;line-height:1.45;color:${T.inkSoft}">Free. No account, nothing to install.</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:22px;padding-top:20px;border-top:1px solid ${T.line}">${claims}
      </div>

      <div style="margin-top:auto;padding-top:18px;font-family:${SANS};font-size:11.5px;line-height:1.5;color:${T.inkFaint}">${LEGAL}</div>
    </div>`;
}

/* ----------------------------------------------------------------- Paper */
/* Same argument, built for a printer. One flat teal block instead of a
   full-bleed dark ground: an A4 of #0B1011 drinks ink, and a desktop printer
   lays a flat that size down streaky. */
function paper() {
  const claims = CLAIMS.map(([, title, body], i) => `
            <div style="display:flex;gap:13px;align-items:flex-start">
              <div style="flex:none;width:25px;height:25px;border-radius:999px;background:${T.teal};color:${T.paper};display:flex;align-items:center;justify-content:center;font-family:${DISPLAY};font-weight:800;font-size:12.5px;line-height:1">${i + 1}</div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <div style="${dsp(14, { ls: "0.04em", color: T.paperInk })}">${title}</div>
                <div style="font-family:${SANS};font-size:13.5px;line-height:1.45;color:${T.paperSoft};text-wrap:pretty">${body}</div>
              </div>
            </div>`).join("");

  return `<div style="width:${W}px;height:${H}px;box-sizing:border-box;background:${T.paper};color:${T.paperInk};display:flex;flex-direction:column">

      <div style="flex:none;background:${T.teal};color:${T.paper};padding:46px 56px 48px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px">
          ${wordmark(50, { ink: T.paper, accent: T.mint })}
          <div style="${eyebrow("rgba(246,244,239,0.75)")};text-align:right;padding-top:6px">Real eBay UK<br>sold prices</div>
        </div>
        <h1 style="${dsp(88, { lh: 0.9, ls: "-0.015em", color: T.paper })};margin:32px 0 0">What&#39;s it<span style="display:block">worth?</span></h1>
      </div>

      <div style="flex:none;padding:42px 56px 0;display:flex;gap:32px;align-items:flex-start">
        <div style="display:flex;flex-direction:column;gap:20px;flex:1;min-width:0">
          <p style="font-family:${SANS};font-size:19px;line-height:1.45;color:${T.paperSoft};margin:0;text-wrap:pretty">Type any Pokémon card and get what it <strong style="color:${T.paperInk};font-weight:600">actually sold for</strong> on eBay UK over the last 90 days.</p>
          <div style="display:flex;flex-direction:column;gap:19px">${claims}
          </div>
        </div>
        <div style="flex:none;display:flex;flex-direction:column;align-items:center;gap:11px">
          <div style="border:1px solid ${T.paperLine};border-radius:12px;padding:10px;line-height:0;background:#FFFFFF">${qr(212, { dark: T.paperInk })}</div>
          <div style="${eyebrow(T.paperFaint)};text-align:center">Point your camera<br>at the code</div>
        </div>
      </div>

      <div style="flex:none;padding:36px 56px 0">
        ${examplePanel(PANEL_LIGHT)}
        <div style="font-family:${SANS};font-size:12px;color:${T.paperFaint};margin-top:8px">${EXAMPLE_NOTE}</div>
      </div>

      <div style="margin-top:auto;padding:0 56px 46px">
        <div style="height:1px;background:${T.paperLine};margin-bottom:20px"></div>
        <div style="${dsp(40, { lh: 1, color: T.teal })}">lastcomp<span style="color:${T.paperInk}">.co.uk</span></div>
        <div style="font-family:${SANS};font-size:16px;color:${T.paperSoft};margin-top:9px">Free. No account, nothing to install.</div>
        <div style="font-family:${SANS};font-size:11px;line-height:1.5;color:${T.paperFaint};margin-top:14px">${LEGAL}</div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------- ScanFirst */
/* For a busy aisle. One flat colour, one instruction, one code — sized to be
   read and acted on from across a hall rather than from at the table. */
function scanFirst() {
  return `<div style="width:${W}px;height:${H}px;box-sizing:border-box;background:${T.teal};color:${T.paper};padding:52px 56px 42px;display:flex;flex-direction:column;align-items:center;text-align:center">

      <div style="width:100%;flex:none;display:flex;align-items:center;justify-content:space-between;gap:20px">
        ${wordmarkInline(24, { ink: T.paper, accent: T.mint })}
        <div style="${eyebrow("rgba(246,244,239,0.75)")}">Real eBay UK sold prices</div>
      </div>

      <h1 style="${dsp(104, { lh: 0.88, ls: "-0.02em", color: T.paper })};margin:72px 0 0">What&#39;s it<span style="display:block">worth?</span></h1>

      <div style="font-family:${SANS};font-size:23px;line-height:1.4;color:rgba(246,244,239,0.88);margin-top:26px;max-width:520px;text-wrap:pretty">Scan the code. Type any Pokémon card. See what it sold for on eBay UK.</div>

      <div style="flex:none;background:#FFFFFF;border-radius:16px;padding:14px;line-height:0;margin-top:48px">${qr(356, { dark: T.tealInk })}</div>

      <div style="${dsp(46, { lh: 1, color: T.paper })};margin-top:38px">lastcomp.co.uk</div>

      <div style="${eyebrow("rgba(246,244,239,0.75)")};margin-top:16px">Free &middot; No account &middot; Nothing to install</div>

      <div style="margin-top:auto;padding-top:26px;font-family:${SANS};font-size:11.5px;line-height:1.5;color:rgba(246,244,239,0.62);max-width:560px">${LEGAL}</div>
    </div>`;
}

/* ------------------------------------------------------------------ emit */
const HELMET = `
    ${FONTS.trim()}
    body { margin: 0; }
    a { color: ${T.accent}; text-decoration: none; }
    a:hover { color: ${T.accentLight}; }
    h1 { font-weight: 800; }`;

const dc = (root) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${HELMET}
  </style>
</helmet>
${root}
</x-dc>
</body>
</html>
`;

const preview = (root) => `<!doctype html>
<html>
<head><meta charset="utf-8"><style>${HELMET}
body{background:#3A4142;display:flex;gap:40px;padding:40px;align-items:flex-start}</style></head>
<body>${root}</body>
</html>
`;

const BOARDS = { Main: main(), Paper: paper(), ScanFirst: scanFirst() };
mkdirSync(join(HERE, "preview"), { recursive: true });
for (const [name, root] of Object.entries(BOARDS)) {
  writeFileSync(join(HERE, `${name}.dc.html`), dc(root));
  writeFileSync(join(HERE, "preview", `${name}.html`), preview(root));
}
writeFileSync(join(HERE, "preview", "all.html"), preview(Object.values(BOARDS).join("")));
console.log(`built ${Object.keys(BOARDS).join(", ")} — ${W}x${H} (A4 at 96dpi)`);
