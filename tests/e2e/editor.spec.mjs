import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function fresh(page) {
  await page.goto('/?nosw=1');
  // the app saves on pagehide, so clear storage again after that save runs
  await page.evaluate(() => { localStorage.clear(); window.addEventListener('pagehide', () => localStorage.clear()); });
  await page.reload();
  await page.waitForFunction(() => window.__px);
}
async function zoom(page) { return page.evaluate(() => window.__px.ui.zoom); }
// client coordinates of the centre of doc pixel (x, y)
async function at(page, x, y) {
  const box = await page.locator('#canvas').boundingBox();
  const z = await zoom(page);
  return { x: box.x + (x + 0.5) * z, y: box.y + (y + 0.5) * z };
}
async function clickPixel(page, x, y, opts = {}) { const p = await at(page, x, y); await page.mouse.click(p.x, p.y, opts); }
async function dragPixels(page, x0, y0, x1, y1, opts = {}) {
  const a = await at(page, x0, y0), b = await at(page, x1, y1);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y); await page.mouse.down({ button: opts.button }); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up({ button: opts.button });
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
}
const pixel = (page, x, y) => page.evaluate(([x, y]) => window.__px.pixel(x, y), [x, y]);
const comp = (page, x, y) => page.evaluate(([x, y]) => window.__px.composite(x, y), [x, y]);
const run = (page, cmd, ...args) => page.evaluate(([cmd, args]) => window.__px.run(cmd, ...args), [cmd, args]);
const selCount = (page) => page.evaluate(() => window.__px.selCount());
const selHas = (page, x, y) => page.evaluate(([x, y]) => window.__px.selHas(x, y), [x, y]);
const CREAM = [242, 237, 226, 255], INDIGO = [13, 10, 31, 255], RED = [255, 0, 77, 255], T = [0, 0, 0, 0];

test.beforeEach(async ({ page }) => { await fresh(page); });

test('loads a 32×32 document with menus, 20 tools and a palette', async ({ page }) => {
  await expect(page).toHaveTitle('Pixel Editor');
  await expect(page.locator('#status-size')).toHaveText('32 × 32');
  await expect(page.locator('#menubar button')).toHaveText(['File', 'Edit', 'Sprite', 'Layer', 'Frame', 'Select', 'View']);
  await expect(page.locator('.tool')).toHaveCount(20);
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
  expect(await pixel(page, 16, 16)).toEqual(RED);
  expect(await pixel(page, 0, 0)).toEqual(CREAM, 'top row is a different colour, untouched');
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 16, 16)).toEqual(T);
  await page.keyboard.press('Control+y');
  expect(await pixel(page, 16, 16)).toEqual(RED);
});

test('brush size, circle shape and pixel-perfect option', async ({ page }) => {
  await page.keyboard.press('+'); await page.keyboard.press('+'); // size 3
  await expect(page.locator('#brush-size-label')).toHaveText('3');
  await clickPixel(page, 10, 10);
  expect(await pixel(page, 9, 9)).toEqual(CREAM);
  expect(await pixel(page, 11, 11)).toEqual(CREAM);
  await page.locator('#brush-shape').selectOption('circle');
  await clickPixel(page, 20, 20);
  expect(await pixel(page, 20, 19)).toEqual(CREAM);
  expect(await pixel(page, 19, 19)).toEqual(T, 'circle brush of size 3 has no corners');
  await page.keyboard.press('-'); await page.keyboard.press('-');
  await expect(page.locator('#brush-size-label')).toHaveText('1');
  await page.locator('#opt-pp').check();
  await dragPixels(page, 0, 31, 3, 28); // a diagonal with pixel-perfect on
  expect(await pixel(page, 0, 31)).toEqual(CREAM);
  expect(await pixel(page, 3, 28)).toEqual(CREAM);
});

test('rectangle outline, filled ellipse and line tool', async ({ page }) => {
  await page.keyboard.press('u');
  await dragPixels(page, 2, 2, 9, 7);
  expect(await pixel(page, 2, 2)).toEqual(CREAM);
  expect(await pixel(page, 9, 7)).toEqual(CREAM);
  expect(await pixel(page, 5, 4)).toEqual(T, 'outline only');
  await page.locator('#opt-fill').check();
  await page.keyboard.press('Shift+u');
  await expect(page.locator('.tool[aria-pressed="true"]')).toHaveAttribute('data-tool', 'ellipse');
  await dragPixels(page, 12, 12, 27, 27);
  expect(await pixel(page, 19, 19)).toEqual(CREAM, 'centre filled');
  expect(await pixel(page, 12, 12)).toEqual(T, 'corner outside the ellipse');
  await page.keyboard.press('l');
  await dragPixels(page, 0, 31, 10, 31);
  for (let x = 0; x <= 10; x++) expect(await pixel(page, x, 31)).toEqual(CREAM);
});

test('gradient tool blends between primary and secondary', async ({ page }) => {
  await page.keyboard.press('Shift+g');
  await expect(page.locator('.tool[aria-pressed="true"]')).toHaveAttribute('data-tool', 'gradient');
  await dragPixels(page, 0, 16, 31, 16);
  expect(await pixel(page, 0, 16)).toEqual(CREAM);
  expect(await pixel(page, 31, 16)).toEqual(INDIGO);
  const mid = await pixel(page, 16, 16);
  expect(mid[0]).toBeGreaterThan(INDIGO[0]); expect(mid[0]).toBeLessThan(CREAM[0]);
});

test('mirror X paints on both sides', async ({ page }) => {
  await page.locator('#tg-symx').click();
  await clickPixel(page, 4, 8);
  expect(await pixel(page, 4, 8)).toEqual(CREAM);
  expect(await pixel(page, 27, 8)).toEqual(CREAM);
});

test('layers: add, paint, hide, lock, merge, delete', async ({ page }) => {
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
  await page.locator('.layer[aria-selected="true"] .lock').click();
  await clickPixel(page, 5, 5);
  expect(await pixel(page, 5, 5)).toEqual(T, 'locked layer refuses paint');
  await expect(page.locator('#toast')).toHaveText('Layer is locked');
  await page.locator('.layer[aria-selected="true"] .lock').click();
  await page.locator('#btn-layer-merge').click();
  await expect(page.locator('.layer')).toHaveCount(1);
  expect(await comp(page, 1, 1)).toEqual([0, 228, 54, 255]);
  await expect(page.locator('#btn-layer-del')).toBeDisabled();
});

test('frames: add, duplicate, delete, play, tags', async ({ page }) => {
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
  // a tag over both frames via the tag dialog
  await page.locator('#btn-tag-add').click();
  await expect(page.locator('#dlg-form')).toBeVisible();
  await page.locator('#form-controls input[data-key="name"]').fill('walk');
  await page.locator('#form-controls input[data-key="from"]').fill('1');
  await page.locator('#form-controls input[data-key="to"]').fill('2');
  await page.locator('#form-ok').click();
  await expect(page.locator('#tags .tag')).toHaveCount(1);
  await expect(page.locator('#tags .tag')).toHaveText('walk');
});

test('marquee selection: move, commit, delete, add with Shift, wand and inverse', async ({ page }) => {
  await page.keyboard.press('u');
  await page.locator('#opt-fill').check();
  await dragPixels(page, 0, 0, 3, 3);
  await page.keyboard.press('m');
  await expect(page.locator('.tool[aria-pressed="true"]')).toHaveAttribute('data-tool', 'marquee');
  await dragPixels(page, 0, 0, 3, 3);
  expect(await selCount(page)).toBe(16);
  await dragPixels(page, 1, 1, 11, 11); // drag inside the selection moves it by +10,+10
  expect(await pixel(page, 0, 0)).toEqual(T, 'lifted from the layer while floating');
  await page.keyboard.press('Escape');
  expect(await pixel(page, 13, 13)).toEqual(CREAM, 'committed');
  await dragPixels(page, 10, 10, 13, 13);
  await dragPixels(page, 20, 20, 21, 21, { modifiers: ['Shift'] });
  expect(await selCount(page)).toBe(20);
  await page.keyboard.press('Delete');
  expect(await pixel(page, 13, 13)).toEqual(T);
  // wand on the empty background, then inverse leaves only the painted pixel
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await clickPixel(page, 5, 5);
  await page.keyboard.press('w');
  await clickPixel(page, 0, 0);
  expect(await selCount(page)).toBe(32 * 32 - 1);
  await page.keyboard.press('Control+Shift+i');
  expect(await selCount(page)).toBe(1);
  expect(await selHas(page, 5, 5)).toBe(true);
});

test('painting is clipped to the selection', async ({ page }) => {
  await page.keyboard.press('m');
  await dragPixels(page, 4, 4, 9, 9);
  await page.keyboard.press('b');
  await dragPixels(page, 0, 6, 31, 6); // pencil stroke across the whole row
  expect(await pixel(page, 4, 6)).toEqual(CREAM);
  expect(await pixel(page, 9, 6)).toEqual(CREAM);
  expect(await pixel(page, 3, 6)).toEqual(T, 'outside the selection stays empty');
  expect(await pixel(page, 20, 6)).toEqual(T);
  await page.keyboard.press('u');
  await page.locator('#opt-fill').check();
  await dragPixels(page, 0, 0, 31, 31);
  expect(await pixel(page, 0, 0)).toEqual(T, 'filled rectangle is clipped too');
  expect(await pixel(page, 5, 5)).toEqual(CREAM);
  await page.keyboard.press('e');
  await clickPixel(page, 5, 5);
  expect(await pixel(page, 5, 5)).toEqual(T, 'eraser works inside');
});

test('copy, paste and fill / stroke on a selection', async ({ page }) => {
  await page.keyboard.press('u');
  await page.locator('#opt-fill').check();
  await dragPixels(page, 0, 0, 3, 3);
  await page.keyboard.press('m');
  await dragPixels(page, 0, 0, 3, 3);
  await page.keyboard.press('Control+c');
  await expect(page.locator('#toast')).toHaveText('Copied');
  await page.keyboard.press('Control+d');
  expect(await selCount(page)).toBe(0);
  await page.keyboard.press('Control+v');
  expect(await page.evaluate(() => Boolean(window.__px.state.floating))).toBe(true);
  await dragPixels(page, 1, 1, 21, 21);
  await page.keyboard.press('Escape');
  expect(await pixel(page, 20, 20)).toEqual(CREAM);
  expect(await pixel(page, 0, 0)).toEqual(CREAM, 'original stays');
  await page.locator('#palette button').nth(8).click(); // red
  await dragPixels(page, 8, 8, 12, 12);
  await page.keyboard.press('s'); // stroke
  expect(await pixel(page, 8, 8)).toEqual(RED);
  expect(await pixel(page, 10, 10)).toEqual(T);
  await page.keyboard.press('f'); // fill
  expect(await pixel(page, 10, 10)).toEqual(RED);
});

test('menus run commands: Edit → Invert, flip with Shift+H', async ({ page }) => {
  await clickPixel(page, 2, 2);
  await page.locator('#menubar button[data-menu="edit"]').click();
  await expect(page.locator('#menu-popup')).toBeVisible();
  await page.locator('#menu-popup .mi[data-cmd="invert"]').click();
  expect(await pixel(page, 2, 2)).toEqual([13, 18, 29, 255]);
  await page.keyboard.press('Shift+h');
  expect(await pixel(page, 29, 2)).toEqual([13, 18, 29, 255]);
  expect(await pixel(page, 2, 2)).toEqual(T);
});

test('outline effect dialog previews and applies', async ({ page }) => {
  await clickPixel(page, 10, 10);
  await page.keyboard.press('Shift+o');
  await expect(page.locator('#dlg-fx')).toBeVisible();
  await page.locator('#fx-controls input[data-key="color"]').fill('#ff004d');
  await page.locator('#fx-ok').click();
  expect(await pixel(page, 10, 10)).toEqual(CREAM);
  expect(await pixel(page, 9, 10)).toEqual(RED);
  expect(await pixel(page, 10, 11)).toEqual(RED);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 9, 10)).toEqual(T);
});

test('view: zoom keys, tiled mode, hide UI, swap colours', async ({ page }) => {
  await page.keyboard.press('5');
  expect(await zoom(page)).toBe(16);
  await page.keyboard.press('3');
  expect(await zoom(page)).toBe(4);
  await run(page, 'tiledBoth');
  expect(await page.evaluate(() => window.__px.ui.tiled)).toBe('both');
  await clickPixel(page, 1, 1); // still paints at the same doc pixel in tiled mode
  expect(await pixel(page, 1, 1)).toEqual(CREAM);
  await run(page, 'tiledNone');
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveAttribute('data-hideui', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveAttribute('data-hideui', 'false');
  await page.keyboard.press('x');
  await clickPixel(page, 4, 4);
  expect(await pixel(page, 4, 4)).toEqual(INDIGO);
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

test('new document dialog, canvas size and trim', async ({ page }) => {
  await page.keyboard.press('Control+n');
  await page.locator('#new-w').fill('16');
  await page.locator('#new-h').fill('8');
  await page.locator('#new-ok').click();
  await expect(page.locator('#status-size')).toHaveText('16 × 8');
  await clickPixel(page, 15, 7);
  await page.keyboard.press('c');
  await page.locator('#resize-w').fill('20');
  await page.locator('#resize-h').fill('10');
  await page.locator('#resize-anchor').selectOption('bottom-right');
  await page.locator('#resize-ok').click();
  await expect(page.locator('#status-size')).toHaveText('20 × 10');
  expect(await pixel(page, 19, 9)).toEqual(CREAM, 'anchored bottom-right');
  await run(page, 'trim');
  await expect(page.locator('#status-size')).toHaveText('1 × 1');
});

test('exports PNG, GIF and project files', async ({ page }) => {
  await clickPixel(page, 0, 0);
  await page.locator('#btn-frame-dup').click();
  for (const [type, ext, magic] of [['png', '.png', '\x89PNG'], ['gif', '.gif', 'GIF89a'], ['json', '.json', '{"version":']]) {
    await page.keyboard.press('Control+Shift+e');
    await page.locator(`input[name="export-type"][value="${type}"]`).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-ok').click()]);
    expect(download.suggestedFilename().endsWith(ext)).toBe(true);
    const head = fs.readFileSync(await download.path()).subarray(0, magic.length).toString('latin1');
    expect(head).toBe(magic);
  }
});

test('sprite sheet round trip: export with JSON, import back as frames', async ({ page }) => {
  await clickPixel(page, 0, 0);
  await page.locator('#btn-frame-add').click();
  await clickPixel(page, 31, 31);
  await page.locator('#btn-frame-add').click();
  await clickPixel(page, 16, 16);
  await page.keyboard.press('Control+e');
  await expect(page.locator('#dlg-sheet')).toBeVisible();
  await page.locator('#sheet-layout').selectOption('horizontal');
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.locator('#sheet-ok').click();
  await expect.poll(() => downloads.length).toBe(2);
  const png = downloads.find((d) => d.suggestedFilename().endsWith('-sheet.png'));
  const json = JSON.parse(fs.readFileSync(await downloads.find((d) => d.suggestedFilename().endsWith('-sheet.json')).path(), 'utf8'));
  expect(Object.keys(json.frames)).toHaveLength(3);
  expect(json.meta.size).toEqual({ w: 96, h: 32 });
  await fresh(page);
  await page.locator('#file-sheet').setInputFiles({ name: 'hero-sheet.png', mimeType: 'image/png', buffer: fs.readFileSync(await png.path()) });
  await expect(page.locator('#dlg-import')).toBeVisible();
  await page.locator('#import-w').fill('32');
  await page.locator('#import-h').fill('32');
  await page.locator('#import-ok').click();
  await expect(page.locator('.frame')).toHaveCount(3);
  expect(await pixel(page, 0, 0)).toEqual(CREAM);
  await page.locator('.frame').nth(1).click();
  expect(await pixel(page, 31, 31)).toEqual(CREAM);
});

test('opening an exported project restores it', async ({ page }) => {
  await clickPixel(page, 4, 4);
  await page.keyboard.press('Control+Shift+e');
  await page.locator('input[name="export-type"][value="json"]').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-ok').click()]);
  const path = await download.path();
  await fresh(page);
  expect(await pixel(page, 4, 4)).toEqual(T);
  await page.locator('#file-open').setInputFiles({ name: 'hero.json', mimeType: 'application/json', buffer: fs.readFileSync(path) });
  await expect(page.locator('#toast')).toBeVisible();
  expect(await pixel(page, 4, 4)).toEqual(CREAM);
});

test('palette: hex input and GPL import', async ({ page }) => {
  await page.locator('#color-hex').fill('#ff8800');
  await page.locator('#color-hex').press('Enter');
  await clickPixel(page, 1, 1);
  expect(await pixel(page, 1, 1)).toEqual([255, 136, 0, 255]);
  const gpl = 'GIMP Palette\nName: test\n#\n  0   0   0\t black\n255 255 255\t white\n 12  34  56\t blue\n';
  await page.locator('#file-palette').setInputFiles({ name: 'test.gpl', mimeType: 'text/plain', buffer: Buffer.from(gpl) });
  await expect(page.locator('#palette button')).toHaveCount(3);
  await page.locator('#palette button').nth(2).click();
  await clickPixel(page, 2, 2);
  expect(await pixel(page, 2, 2)).toEqual([12, 34, 56, 255]);
});

test('language switch, every tool shortcut, and no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.locator('#btn-settings').click();
  await page.locator('#set-lang').selectOption('tr');
  await expect(page.locator('#menubar button').first()).toHaveText('Dosya');
  await expect(page.locator('.panel h3').first()).toHaveText('Renkler');
  await page.locator('#dlg-settings button[value="ok"]').click();
  await clickPixel(page, 2, 2);
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  for (const k of ['m', 'Shift+m', 'q', 'Shift+q', 'w', 'b', 'Shift+b', 'e', 'i', 'h', 'v', 'z', 'g', 'Shift+g', 'l', 'u', 'Shift+u', 'd', 'Shift+d', 'r']) await page.keyboard.press(k);
  await expect(page.locator('.tool[aria-pressed="true"]')).toHaveAttribute('data-tool', 'blur');
  expect(errors).toEqual([]);
});
