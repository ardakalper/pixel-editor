// README screenshots: draws a small sprite with the real tools, then captures the editor.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const exe = process.env.PW_CHROMIUM_PATH;
const OUT = process.env.OUT || 'docs/img';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function setup(page, theme = 'dark') {
  await page.goto('http://localhost:4174/?nosw=1');
  await page.evaluate((theme) => { localStorage.clear(); localStorage.setItem('px:ui', JSON.stringify({ theme, lang: 'en', zoom: 12, paletteId: 'sweetie16' })); }, theme);
  await page.reload();
  // paint a little character with the API-level tools (deterministic)
  await page.evaluate(() => {
    const { R, M, state } = window.__px;
    const doc = state.doc;
    const cel = M.getCel(doc, 0, doc.layers[0].id);
    const C = (h) => R.hexToRgba(h);
    const body = C('#38b764'), dark = C('#257179'), eye = C('#f4f4f4'), pupil = C('#1a1c2c'), belly = C('#a7f070'), cheek = C('#ef7d57');
    for (const [x, y] of R.ellipsePoints(6, 4, 25, 27, true)) R.setPixel(cel, x, y, body);
    for (const [x, y] of R.ellipsePoints(10, 14, 21, 26, true)) R.setPixel(cel, x, y, belly);
    for (const [x, y] of R.ellipsePoints(6, 4, 25, 27, false)) R.setPixel(cel, x, y, dark);
    for (const [x, y] of R.rectPoints(10, 9, 13, 12, true)) R.setPixel(cel, x, y, eye);
    for (const [x, y] of R.rectPoints(18, 9, 21, 12, true)) R.setPixel(cel, x, y, eye);
    R.stamp(cel, 12, 11, pupil, 2); R.stamp(cel, 20, 11, pupil, 2);
    R.stamp(cel, 8, 14, cheek, 2); R.stamp(cel, 23, 14, cheek, 2);
    for (const [x, y] of R.linePoints(13, 16, 18, 16)) R.setPixel(cel, x, y, dark);
    const l2 = M.addLayer(doc, { name: 'Hat' });
    const hat = M.getCel(doc, 0, l2.id);
    for (const [x, y] of R.rectPoints(9, 0, 22, 3, true)) R.setPixel(hat, x, y, C('#ef7d57'));
    for (const [x, y] of R.rectPoints(6, 4, 25, 5, true)) R.setPixel(hat, x, y, C('#b13e53'));
    M.addFrame(doc, { duplicateOf: 0 });
    const f2 = M.getCel(doc, 1, doc.layers[0].id);
    R.stamp(f2, 12, 11, body, 2); R.stamp(f2, 20, 11, body, 2); // blink
    state.layer = 1; state.sel = { x0: 9, y0: 0, x1: 22, y1: 5 };
    window.__px.ui.tool = 'select';
  });
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
}

for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await setup(page, theme);
  await page.screenshot({ path: `${OUT}/${theme}.png` });
  await page.close();
  console.log('wrote', theme);
}
await browser.close();
