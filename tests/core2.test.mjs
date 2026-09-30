import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../app/js/raster.js';
import * as M from '../app/js/model.js';
import * as S from '../app/js/select.js';
import * as FX from '../app/js/fx.js';
import * as P from '../app/js/palette-io.js';
import * as SH from '../app/js/sheet.js';

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], T = [0, 0, 0, 0];
const lit = (m) => { const out = []; for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) out.push(`${x},${y}`); return out.sort(); };

test('masks: rect, ellipse, polygon, invert, bounds', () => {
  const r = S.maskFromRect(6, 6, { x0: 4, y0: 4, x1: 1, y1: 1 });
  assert.equal(S.maskCount(r), 16);
  assert.deepEqual(S.maskBounds(r), { x: 1, y: 1, w: 4, h: 4 });
  const inv = S.maskInvert(r);
  assert.equal(S.maskCount(inv), 20);
  const e = S.maskFromEllipse(10, 10, { x0: 0, y0: 0, x1: 9, y1: 9 });
  assert.ok(S.maskGet(e, 5, 5) && !S.maskGet(e, 0, 0) && S.maskGet(e, 0, 5));
  const tri = S.maskFromPolygon(8, 8, [[0, 0], [7, 0], [0, 7]]);
  assert.ok(S.maskGet(tri, 1, 1) && S.maskGet(tri, 0, 7) && !S.maskGet(tri, 7, 7));
  assert.equal(S.maskCount(S.maskFromPolygon(8, 8, [[0, 0], [1, 1]])), 0, 'degenerate polygon selects nothing');
});

test('magic wand: contiguous vs global with tolerance', () => {
  const b = R.createBitmap(6, 1);
  [RED, RED, BLUE, RED, [250, 5, 5, 255], BLUE].forEach((c, x) => R.setPixel(b, x, 0, c));
  assert.deepEqual(lit(S.maskFromWand(b, 0, 0)), ['0,0', '1,0']);
  assert.deepEqual(lit(S.maskFromWand(b, 0, 0, { contiguous: false })), ['0,0', '1,0', '3,0']);
  assert.deepEqual(lit(S.maskFromWand(b, 0, 0, { contiguous: false, tolerance: 8 })), ['0,0', '1,0', '3,0', '4,0']);
  const empty = R.createBitmap(3, 3); R.setPixel(empty, 1, 1, RED);
  assert.equal(S.maskCount(S.maskFromWand(empty, 0, 0)), 8, 'transparent region around a dot');
});

test('masks: expand, contract, border, shift, edges, extract and fill', () => {
  const m = S.maskFromRect(9, 9, { x0: 4, y0: 4, x1: 4, y1: 4 });
  assert.equal(S.maskCount(S.maskExpand(m, 1)), 5, 'circle expand adds 4-neighbours');
  assert.equal(S.maskCount(S.maskExpand(m, 1, 'square')), 9);
  const big = S.maskFromRect(9, 9, { x0: 2, y0: 2, x1: 6, y1: 6 });
  assert.equal(S.maskCount(S.maskContract(big, 1)), 9);
  assert.equal(S.maskCount(S.maskBorder(big, 1)), 16);
  assert.deepEqual(lit(S.maskShift(m, 3, -4)), ['7,0']);
  assert.equal(S.maskEdges(m).length, 4);
  assert.equal(S.maskEdges(big).length, 20);
  const b = R.createBitmap(9, 9); R.setPixel(b, 3, 3, RED); R.setPixel(b, 8, 8, BLUE);
  const f = S.extractMasked(b, big, { clear: true });
  assert.deepEqual([f.x, f.y, f.bitmap.width, f.bitmap.height], [2, 2, 5, 5]);
  assert.deepEqual(R.getPixel(f.bitmap, 1, 1), RED);
  assert.deepEqual(R.getPixel(b, 3, 3), T);
  assert.deepEqual(R.getPixel(b, 8, 8), BLUE, 'outside the mask untouched');
  assert.equal(S.fillMasked(b, m, BLUE), 1);
  assert.equal(S.extractMasked(b, S.createMask(9, 9)), null);
});

test('brushes, pixel-perfect and inks', () => {
  assert.equal(R.brushOffsets(3, 'square').length, 9);
  assert.equal(R.brushOffsets(3, 'circle').length, 5);
  assert.ok(R.brushOffsets(5, 'circle').length > 9 && R.brushOffsets(5, 'circle').length < 25);
  assert.deepEqual(R.pixelPerfect([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]), [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(R.pixelPerfect([[0, 0], [1, 0], [2, 0]]), [[0, 0], [1, 0], [2, 0]], 'straight lines untouched');
  const b = R.createBitmap(3, 1);
  R.paintPixel(b, 0, 0, RED, { ink: 'alpha', opacity: 128 });
  assert.deepEqual(R.getPixel(b, 0, 0), [255, 0, 0, 128]);
  R.paintPixel(b, 0, 0, BLUE, { ink: 'alpha', opacity: 255 });
  assert.deepEqual(R.getPixel(b, 0, 0), BLUE);
  assert.equal(R.paintPixel(b, 1, 0, RED, { ink: 'lockalpha' }), false, 'lock alpha skips transparent pixels');
  R.setPixel(b, 1, 0, [0, 0, 0, 100]);
  R.paintPixel(b, 1, 0, RED, { ink: 'lockalpha' });
  assert.deepEqual(R.getPixel(b, 1, 0), [255, 0, 0, 100]);
  const ramp = ['#000000', '#555555', '#aaaaaa', '#ffffff'];
  R.setPixel(b, 2, 0, R.hexToRgba('#555555'));
  R.paintPixel(b, 2, 0, RED, { ink: 'shading', shading: ramp, direction: 1 });
  assert.equal(R.rgbaToHex(R.getPixel(b, 2, 0)), '#aaaaaa');
  R.paintPixel(b, 2, 0, RED, { ink: 'shading', shading: ramp, direction: -1 });
  R.paintPixel(b, 2, 0, RED, { ink: 'shading', shading: ramp, direction: -1 });
  assert.equal(R.rgbaToHex(R.getPixel(b, 2, 0)), '#000000');
  assert.equal(R.paintPixel(b, 2, 0, RED, { ink: 'shading', shading: ramp, direction: -1 }), true, 'clamps at the ends');
  const c = R.createBitmap(8, 8);
  assert.equal(R.stampInk(c, 1, 1, RED, { size: 2, shape: 'square', sym: { x: true } }), 8);
});

test('spray and gradients', () => {
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = R.sprayPoints(10, 10, 3, 20, rnd);
  assert.equal(pts.length, 20);
  assert.ok(pts.every(([x, y]) => Math.hypot(x - 10, y - 10) <= 3.5));
  const g = R.createBitmap(4, 1);
  R.gradient(g, 0, 0, 3, 0, [0, 0, 0, 255], [255, 255, 255, 255]);
  assert.deepEqual([...g.data].filter((_, i) => i % 4 === 0), [0, 85, 170, 255]);
  const d = R.createBitmap(8, 4);
  R.gradient(d, 0, 0, 7, 0, RED, BLUE, { dither: 'bayer' });
  const reds = [...d.data].filter((_, i) => i % 4 === 0).filter((v) => v === 255).length;
  assert.ok(reds > 8 && reds < 24, `dithered mix, got ${reds} red pixels`);
  const masked = R.createBitmap(4, 1); const m = S.maskFromRect(4, 1, { x0: 2, y0: 0, x1: 3, y1: 0 });
  R.gradient(masked, 0, 0, 3, 0, RED, RED, { mask: m });
  assert.deepEqual(R.getPixel(masked, 0, 0), T);
  assert.deepEqual(R.getPixel(masked, 3, 0), RED);
});

test('fx: invert, brightness/contrast, hue, replace, outline, blur, despeckle, trim', () => {
  const b = R.createBitmap(3, 3); R.setPixel(b, 1, 1, RED);
  assert.deepEqual(R.getPixel(FX.invert(b), 1, 1), [0, 255, 255, 255]);
  assert.deepEqual(R.getPixel(FX.invert(b), 0, 0), T, 'transparent stays');
  const bc = FX.brightnessContrast(b, { brightness: 20 });
  assert.equal(R.getPixel(bc, 1, 1)[1], 51);
  const hs = FX.hueSaturation(b, { hue: 120 });
  assert.deepEqual(R.getPixel(hs, 1, 1), [0, 255, 0, 255]);
  assert.deepEqual(FX.rgbToHsv(0, 0, 255).map(Math.round), [240, 1, 1]);
  assert.deepEqual(FX.hsvToRgb(240, 1, 1), [0, 0, 255]);
  const rep = FX.replaceColor(b, RED, BLUE);
  assert.equal(rep.count, 1); assert.deepEqual(R.getPixel(rep.bitmap, 1, 1), BLUE);
  const ol = FX.outline(b, BLUE, { place: 'outside', matrix: 'circle' });
  assert.deepEqual(R.getPixel(ol, 1, 0), BLUE); assert.deepEqual(R.getPixel(ol, 0, 0), T);
  const ol2 = FX.outline(b, BLUE, { place: 'outside', matrix: 'square' });
  assert.deepEqual(R.getPixel(ol2, 0, 0), BLUE);
  const bl = FX.blur(b);
  assert.ok(R.getPixel(bl, 1, 1)[3] < 255 && R.getPixel(bl, 0, 0)[3] > 0);
  const noisy = R.createBitmap(5, 5); for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) R.setPixel(noisy, x, y, RED); R.setPixel(noisy, 2, 2, BLUE);
  assert.deepEqual(R.getPixel(FX.despeckle(noisy), 2, 2), RED, 'lone pixel removed');
  assert.deepEqual(FX.opaqueBounds(b), { x: 1, y: 1, w: 1, h: 1 });
  assert.equal(FX.opaqueBounds(R.createBitmap(2, 2)), null);
  assert.deepEqual(R.getPixel(FX.crop(b, { x: 1, y: 1, w: 2, h: 2 }), 0, 0), RED);
});

test('palette files round-trip, sorting and extraction', () => {
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  for (const fmt of ['gpl', 'pal', 'hex']) assert.deepEqual(P.parsePalette(P.writePalette(colors, fmt)).colors, colors, fmt);
  assert.deepEqual(P.parseAct(P.writePalette(colors, 'act')).colors, colors);
  assert.deepEqual(P.parsePalette('body { color: #ABCDEF; background: #123456 }').colors, ['#abcdef', '#123456']);
  assert.deepEqual(P.sortPalette(['#0000ff', '#ff0000', '#00ff00'], 'hue'), ['#ff0000', '#00ff00', '#0000ff']);
  const buf = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
  assert.deepEqual(P.extractPalette([buf]), ['#ff0000', '#0000ff']);
  const many = new Uint8ClampedArray(300 * 4); for (let i = 0; i < 300; i++) many.set([i % 256, (i * 3) % 256, (i * 7) % 256, 255], i * 4);
  assert.equal(P.extractPalette([many], 16).length, 16);
});

test('sprite sheet layouts and Aseprite JSON', () => {
  const doc = M.createDoc({ width: 4, height: 2, name: 'hero', fps: 10 });
  R.setPixel(M.getCel(doc, 0, doc.layers[0].id), 3, 1, RED);
  M.addFrame(doc, { duplicateOf: 0 }); M.addFrame(doc);
  M.addTag(doc, { name: 'walk', from: 0, to: 1, direction: 'pingpong' });
  const frames = doc.frames.map((_, i) => ({ bitmap: { width: 4, height: 2, data: M.compositeFrame(doc, i) }, duration: doc.frames[i].duration }));
  const h = SH.layoutSheet(frames, { layout: 'horizontal', padding: 1, border: 2 });
  assert.deepEqual([h.bitmap.width, h.bitmap.height], [2 * 2 + 3 * 4 + 2, 2 * 2 + 2]);
  assert.deepEqual(h.rects[1], { x: 2 + 5, y: 2, w: 4, h: 2, source: { x: 0, y: 0, w: 4, h: 2 }, trimmed: false });
  assert.deepEqual(R.getPixel(h.bitmap, 2 + 5 + 3, 3), RED);
  const v = SH.layoutSheet(frames, { layout: 'vertical' });
  assert.deepEqual([v.bitmap.width, v.bitmap.height], [4, 6]);
  const rows = SH.layoutSheet(frames, { layout: 'rows', columns: 2 });
  assert.deepEqual([rows.bitmap.width, rows.bitmap.height], [8, 4]);
  assert.deepEqual([rows.rects[2].x, rows.rects[2].y], [0, 2]);
  const trimmed = SH.layoutSheet(frames, { layout: 'horizontal', trim: true, scale: 2 });
  assert.equal(trimmed.rects[0].w, 2, 'trimmed to the single red pixel, scaled 2x');
  assert.equal(trimmed.rects[0].trimmed, true);
  assert.equal(trimmed.rects[2].w, 2, 'empty frame keeps a 1px cell');
  const json = SH.sheetJson({ doc, rects: h.rects, imageName: 'hero.png' });
  assert.equal(json.frames['hero 1.png'].frame.x, 7);
  assert.equal(json.frames['hero 0.png'].duration, 100);
  assert.deepEqual(json.meta.frameTags[0], { name: 'walk', from: 0, to: 1, direction: 'pingpong', color: '#43d9e8' });
  assert.equal(json.meta.layers[0].opacity, 255);
  const arr = SH.sheetJson({ doc, rects: h.rects, imageName: 'hero.png', format: 'array' });
  assert.equal(arr.frames[2].filename, 'hero 2.png');
  const cells = SH.splitSheet(h.bitmap, 4, 2, { padding: 1, border: 2, skipEmpty: false });
  assert.equal(cells.length, 3);
  assert.deepEqual(R.getPixel(cells[1], 3, 1), RED);
});

test('model: tags follow frame edits, playback order, canvas ops, serialization', () => {
  const doc = M.createDoc({ width: 2, height: 3, fps: 4 });
  assert.equal(doc.frames[0].duration, 250);
  M.addFrame(doc); M.addFrame(doc); M.addFrame(doc);
  const tag = M.addTag(doc, { name: 'a', from: 1, to: 2 });
  M.addFrame(doc, { at: 0 });
  assert.deepEqual([tag.from, tag.to], [2, 3], 'insert before shifts the tag');
  M.removeFrame(doc, 2);
  assert.deepEqual([doc.tags[0].from, doc.tags[0].to], [2, 2]);
  M.removeFrame(doc, 2);
  assert.equal(doc.tags.length, 0, 'tag vanishes with its last frame');
  const d2 = M.createDoc({ width: 1, height: 1 }); M.addFrame(d2); M.addFrame(d2); M.addFrame(d2);
  const pp = M.addTag(d2, { name: 'p', from: 0, to: 2, direction: 'pingpong' });
  const st = { dir: 1 }; const seq = []; let f = 0;
  for (let i = 0; i < 6; i++) { f = M.nextPlayFrame(d2, f, pp, st); seq.push(f); }
  assert.deepEqual(seq, [1, 2, 1, 0, 1, 2]);
  assert.equal(M.nextPlayFrame(d2, 3, null), 0, 'wraps');
  assert.equal(M.nextPlayFrame(d2, 0, { from: 0, to: 2, direction: 'reverse' }), 2);
  R.setPixel(M.getCel(doc, 0, doc.layers[0].id), 0, 0, RED);
  M.rotateDoc(doc, true);
  assert.deepEqual([doc.width, doc.height], [3, 2]);
  assert.deepEqual(R.getPixel(M.getCel(doc, 0, doc.layers[0].id), 2, 0), RED);
  M.scaleDoc(doc, 2);
  assert.deepEqual([doc.width, doc.height], [6, 4]);
  assert.deepEqual(M.contentBounds(doc), { x: 4, y: 0, w: 2, h: 2 });
  M.cropDoc(doc, M.contentBounds(doc));
  assert.deepEqual([doc.width, doc.height], [2, 2]);
  M.flipDoc(doc, 'x');
  assert.deepEqual(R.getPixel(M.getCel(doc, 0, doc.layers[0].id), 0, 0), RED);
  doc.layers[0].locked = true; doc.frames[0].duration = 80;
  const back = M.deserialize(JSON.parse(JSON.stringify(M.serialize(doc))));
  assert.equal(back.layers[0].locked, true); assert.equal(back.frames[0].duration, 80); assert.equal(back.tags.length, 0);
  M.reverseFrames(d2); assert.equal(d2.frames.length, 4);
});
