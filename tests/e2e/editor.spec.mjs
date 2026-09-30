import { test, expect } from '@playwright/test';

async function fresh(page) {
  await page.goto('/?nosw=1');
  // the app saves on pagehide, so clear storage again after that save runs
  await page.evaluate(() => { localStorage.clear(); window.addEventListener('pagehide', () => localStorage.clear()); });
  await page.reload();
  await page.waitForFunction(() => window.__px);
}
async function px(page) { return page.evaluate(() => window.__px.ui.zoom); }
// client coordinates of the centre of doc pixel (x, y)
async function at(page, x, y) {
  const box = await page.locator('#canvas').boundingBox();
  const z = await px(page);
  return { x: box.x + (x + 0.5) * z, y: box.y + (y + 0.5) * z };
}
async function clickPixel(page, x, y, opts = {}) { const p = await at(page, x, y); await page.mouse.click(p.x, p.y, opts); }
async function dragPixels(page, x0, y0, x1, y1, opts = {}) {
  const a = await at(page, x0, y0), b = await at(page, x1, y1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(opts); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(opts);
}
const pixel = (page, x, y) => page.evaluate(([x, y]) => window.__px.pixel(x, y), [x, y]);
const comp = (page, x, y) => page.evaluate(([x, y]) => window.__px.composite(x, y), [x, y]);
const CREAM = [242, 237, 226, 255], INDIGO = [13, 10, 31, 255], T = [0, 0, 0, 0];

test.beforeEach(async ({ page }) => { await fresh(page); });

test('loads a 32×32 document with tools and a palette', async ({ page }) => {
  await expect(page).toHaveTitle('Pixel Editor');
  await expect(page.locator('#status-size')).toHaveText('32 × 32');
  await expect(page.locator('.tool')).toHaveCount(9);
  await expect(page.locator('.tool[aria-pressed="true"]')).toHaveAttribute('data-tool', 'pencil');
  await expect(page.locator('#palette button')).toHaveCount(16);
});

test('pencil paints primary on left click, secondary on right click, lines while dragging', async ({ page }) => {
  await clickPixel(page, 3, 3);
  expect(await pixel(page, 3, 3)).toEqual(CREAM);
  await clickPixel(page, 5, 5, { button: 'right' });
  expect(await pixel(page, 5, 5)).toEqual(INDIGO);
  await dragPixels(page, 10, 10, 20, 10);
  for (let x = 10; x <= 20; x++) expect(await pixel(page, x, 10)).toEqual(CREAM);
  expect(await pixel(page, 21, 10)).toEqual(T);
  await expect(page.locator('#btn-undo')).toBeEnabled();
});

test('eraser, fill, undo and redo', async ({ page }) => {
  await dragPixels(page, 0, 0, 31, 0); // top row
  await page.keyboard.press('e');
  await clickPixel(page, 5, 0);
  expect(await pixel(page, 5, 0)).toEqual(T);
  await page.keyboard.press('g');
  await page.locator('#palette button').nth(8).click(); // pico-8 red
  await clickPixel(page, 16, 16);
  expect(await pixel(page, 16, 16)).toEqual([255, 0, 77, 255]);
  expect(await pixel(page, 0, 0)).toEqual(CREAM, 'top row is a different colour, untouched');
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 16, 16)).toEqual(T);
  await page.keyboard.press('Control+y');
  expect(await pixel(page, 16, 16)).toEqual([255, 0, 77, 255]);
});

test('rectangle outline and filled ellipse', async ({ page }) => {
  await page.keyboard.press('r');
  await dragPixels(page, 2, 2, 9, 7);
  expect(await pixel(page, 2, 2)).toEqual(CREAM);
  expect(await pixel(page, 9, 7)).toEqual(CREAM);
  expect(await pixel(page, 5, 4)).toEqual(T, 'outline only');
  await page.locator('#opt-fill').check();
  await page.keyboard.press('o');
  await dragPixels(page, 12, 12, 27, 27);
  expect(await pixel(page, 19, 19)).toEqual(CREAM, 'centre filled');
  expect(await pixel(page, 12, 12)).toEqual(T, 'corner outside the ellipse');
});

test('mirror X paints on both sides', async ({ page }) => {
  await page.locator('#tg-symx').click();
  await clickPixel(page, 4, 8);
  expect(await pixel(page, 4, 8)).toEqual(CREAM);
  expect(await pixel(page, 27, 8)).toEqual(CREAM);
});

test('layers: add, paint, hide, merge, delete', async ({ page }) => {
  await clickPixel(page, 1, 1);
  await page.locator('#btn-layer-add').click();
  await expect(page.locator('.layer')).toHaveCount(2);
  await expect(page.locator('.layer[aria-selected="true"] .name')).toHaveText('Layer 2');
  await page.locator('#palette button').nth(11).click(); // green
  await clickPixel(page, 1, 1);
  expect(await comp(page, 1, 1)).toEqual([0, 228, 54, 255]);
  await page.locator('.layer[aria-selected="true"] .eye').click();
  expect(await comp(page, 1, 1)).toEqual(CREAM, 'hidden layer no longer shows');
  await page.locator('.layer[aria-selected="true"] .eye').click();
  await page.locator('#btn-layer-merge').click();
  await expect(page.locator('.layer')).toHaveCount(1);
  expect(await comp(page, 1, 1)).toEqual([0, 228, 54, 255]);
  await expect(page.locator('#btn-layer-del')).toBeDisabled();
});

test('frames: add, duplicate, delete, play', async ({ page }) => {
  await clickPixel(page, 2, 2);
  await page.locator('#btn-frame-dup').click();
  await expect(page.locator('.frame')).toHaveCount(2);
  await expect(page.locator('.frame[aria-selected="true"] .n')).toHaveText('2');
  expect(await pixel(page, 2, 2)).toEqual(CREAM, 'duplicate keeps pixels');
  await page.locator('#btn-frame-add').click();
  expect(await pixel(page, 2, 2)).toEqual(T, 'blank frame');
  await expect(page.locator('.frame')).toHaveCount(3);
  await page.locator('#btn-play').click();
  await expect(page.locator('#btn-play')).toHaveText('■');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(page.locator('#btn-play')).toHaveText('▶');
  await page.locator('#btn-frame-del').click();
  await expect(page.locator('.frame')).toHaveCount(2);
});

test('selection: delete clears, dragging moves pixels', async ({ page }) => {
  await page.locator('#opt-fill').check();
  await page.keyboard.press('r');
  await dragPixels(page, 0, 0, 3, 3);
  await page.keyboard.press('m');
  await dragPixels(page, 0, 0, 3, 3);
  await dragPixels(page, 1, 1, 11, 11); // drag inside the selection moves it by +10,+10
  expect(await pixel(page, 0, 0)).toEqual(T, 'lifted from the layer while floating');
  await page.keyboard.press('Escape');
  expect(await pixel(page, 13, 13)).toEqual(CREAM, 'committed');
  await dragPixels(page, 10, 10, 13, 13);
  await page.keyboard.press('Delete');
  expect(await pixel(page, 13, 13)).toEqual(T);
});

test('document survives a reload', async ({ page }) => {
  await clickPixel(page, 7, 9);
  await page.locator('#doc-name').fill('hero');
  await page.locator('#doc-name').press('Enter');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.__px);
  expect(await pixel(page, 7, 9)).toEqual(CREAM);
  await expect(page.locator('#doc-name')).toHaveValue('hero');
});

test('new document dialog and canvas resize', async ({ page }) => {
  await page.locator('#btn-new').click();
  await page.locator('#new-w').fill('16');
  await page.locator('#new-h').fill('8');
  await page.locator('#new-ok').click();
  await expect(page.locator('#status-size')).toHaveText('16 × 8');
  await clickPixel(page, 15, 7);
  await page.locator('#btn-resize').click();
  await page.locator('#resize-w').fill('20');
  await page.locator('#resize-h').fill('10');
  await page.locator('#resize-anchor').selectOption('bottom-right');
  await page.locator('#resize-ok').click();
  await expect(page.locator('#status-size')).toHaveText('20 × 10');
  expect(await pixel(page, 19, 9)).toEqual(CREAM, 'anchored bottom-right');
});

test('exports PNG, sprite sheet, GIF and project files', async ({ page }) => {
  await clickPixel(page, 0, 0);
  await page.locator('#btn-frame-dup').click();
  for (const [type, ext, magic] of [['png', '.png', '\x89PNG'], ['sheet', '-sheet.png', '\x89PNG'], ['gif', '.gif', 'GIF89a'], ['json', '.json', '{"version":1']]) {
    await page.locator('#btn-export').click();
    await page.locator(`input[name="export-type"][value="${type}"]`).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-ok').click()]);
    expect(download.suggestedFilename().endsWith(ext)).toBe(true);
    const path = await download.path();
    const head = (await import('node:fs')).readFileSync(path).subarray(0, magic.length).toString('latin1');
    expect(head).toBe(magic);
  }
});

test('opening an exported project restores it', async ({ page }) => {
  await clickPixel(page, 4, 4);
  await page.locator('#btn-export').click();
  await page.locator('input[name="export-type"][value="json"]').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-ok').click()]);
  const path = await download.path();
  await fresh(page);
  expect(await pixel(page, 4, 4)).toEqual(T);
  const fs = await import('node:fs');
  await page.locator('#file-open').setInputFiles({ name: 'hero.json', mimeType: 'application/json', buffer: fs.readFileSync(path) });
  await expect(page.locator('#toast')).toBeVisible();
  expect(await pixel(page, 4, 4)).toEqual(CREAM);
});

test('language switch and no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.locator('#btn-settings').click();
  await page.locator('#set-lang').selectOption('tr');
  await expect(page.locator('#btn-new')).toHaveText('Yeni');
  await expect(page.locator('.panel h3').first()).toHaveText('Renkler');
  await page.locator('#dlg-settings button[value="ok"]').click();
  await clickPixel(page, 2, 2);
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  expect(errors).toEqual([]);
});
