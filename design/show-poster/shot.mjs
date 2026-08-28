import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
for (const n of process.argv.slice(2)) {
  await p.goto("file://" + process.cwd() + `/preview/${n}.html`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const el = await p.$("body > div");
  await el.screenshot({ path: `preview/${n}.png` });
  const ov = await p.evaluate(() => {
    const r = document.querySelector("body > div");
    return { sh: r.scrollHeight, ch: r.clientHeight, sw: r.scrollWidth, cw: r.clientWidth };
  });
  console.log(n, JSON.stringify(ov));
}
await b.close();
