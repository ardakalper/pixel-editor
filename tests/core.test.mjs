import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../app/js/raster.js';
import * as M from '../app/js/model.js';
import { History } from '../app/js/history.js';
import { encodeGif, lzwDecode } from '../app/js/gif.js';

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], T = [0, 0, 0, 0];

test('pixels, bounds and stamps', () => {
  const b = R.createBitmap(8, 8);
  assert.equal(R.setPixel(b, 9, 0, RED), false);
  assert.equal(R.getPixel(b, -1, 0), null);
  assert.equal(R.stamp(b, 3, 3, RED, 1), 1);
  assert.deepEqual(R.getPixel(b, 3, 3), RED);
  const b2 = R.createBitmap(8, 8);
  assert.equal(R.stamp(b2, 4, 4, RED, 3), 9);
  assert.deepEqual(R.getPixel(b2, 3, 3), RED);
  assert.deepEqual(R.getPixel(b2, 5, 5), RED);
  assert.deepEqual(R.getPixel(b2, 6, 6), T);
});

test('symmetry mirrors stamps across both axes', () => {
  const b = R.createBitmap(8, 8);
  R.stamp(b, 1, 2, RED, 1, { x: true, y: true });
  for (const [x, y] of [[1, 2], [6, 2], [1, 5], [6, 5]]) assert.deepEqual(R.getPixel(b, x, y), RED, `${x},${y}`);
  // even brush stays symmetric
  const c = R.createBitmap(8, 8);
  R.stamp(c, 1, 1, RED, 2, { x: true });
  const lit = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (R.getPixel(c, x, y)[3]) lit.push(`${x},${y}`);
  assert.deepEqual(lit.sort(), ['1,1', '2,1', '1,2', '2,2', '5,1', '6,1', '5,2', '6,2'].sort());
});

test('line, rect and ellipse rasterization', () => {
  assert.deepEqual(R.linePoints(0, 0, 3, 1), [[0, 0], [1, 0], [2, 1], [3, 1]]);
  assert.equal(R.linePoints(5, 5, 5, 5).length, 1);
  assert.equal(R.rectPoints(0, 0, 3, 3).length, 12);
  assert.equal(R.rectPoints(3, 3, 0, 0, true).length, 16);
  const e = R.ellipsePoints(0, 0, 9, 5, true);
  const set = new Set(e.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('4,2') && set.has('5,3'), 'centre is filled');
  assert.ok(!set.has('0,0') && !set.has('9,5'), 'corners are outside');
  assert.ok(set.has('0,2') || set.has('0,3'), 'touches the left edge');
  const outline = R.ellipsePoints(0, 0, 9, 5, false);
  assert.ok(outline.length < e.length);
});

test('flood fill: contiguous and global', () => {
  const b = R.createBitmap(6, 6);
  for (let y = 0; y < 6; y++) R.setPixel(b, 3, y, RED); // wall
  const n = R.floodFill(b, 0, 0, BLUE);
  assert.equal(n, 18, 'left side only');
  assert.deepEqual(R.getPixel(b, 5, 5), T);
  assert.deepEqual(R.getPixel(b, 2, 5), BLUE);
  assert.equal(R.floodFill(b, 0, 0, BLUE), 0, 'same colour is a no-op');
  const c = R.createBitmap(4, 4);
  R.setPixel(c, 0, 0, RED); R.setPixel(c, 3, 3, RED);
  assert.equal(R.floodFill(c, 0, 0, BLUE, { contiguous: false }), 2);
  assert.deepEqual(R.getPixel(c, 3, 3), BLUE);
});

test('composite blends layers with opacity', () => {
  const a = R.createBitmap(1, 1), b = R.createBitmap(1, 1);
  R.setPixel(a, 0, 0, RED); R.setPixel(b, 0, 0, BLUE);
  const out = R.composite([{ bitmap: a, visible: true, opacity: 1 }, { bitmap: b, visible: true, opacity: 0.5 }], 1, 1);
  assert.deepEqual([...out], [128, 0, 128, 255]);
  const hidden = R.composite([{ bitmap: a, visible: true, opacity: 1 }, { bitmap: b, visible: false, opacity: 1 }], 1, 1);
  assert.deepEqual([...hidden], [255, 0, 0, 255]);
});

test('extract, blit, flip, rotate, resize, scale', () => {
  const b = R.createBitmap(4, 4);
  R.setPixel(b, 1, 1, RED);
  const region = R.extractRegion(b, { x0: 1, y0: 1, x1: 2, y1: 2 }, { clear: true });
  assert.deepEqual(R.getPixel(region, 0, 0), RED);
  assert.deepEqual(R.getPixel(b, 1, 1), T);
  R.blit(b, region, 2, 2);
  assert.deepEqual(R.getPixel(b, 2, 2), RED);
  assert.deepEqual(R.getPixel(R.flip(b, 'x'), 1, 2), RED);
  assert.deepEqual(R.getPixel(R.rotate90(b, true), 1, 2), RED);
  const big = R.resizeBitmap(b, 6, 6, 'center');
  assert.deepEqual(R.getPixel(big, 3, 3), RED);
  const scaled = R.scaleBitmap(b, 3);
  assert.equal(scaled.width, 12);
  assert.deepEqual(R.getPixel(scaled, 8, 8), RED);
  assert.deepEqual(R.getPixel(scaled, 5, 5), T);
});

test('hex conversions', () => {
  assert.deepEqual(R.hexToRgba('#ff0000'), RED);
  assert.deepEqual(R.hexToRgba('#f00'), RED);
  assert.deepEqual(R.hexToRgba('#00ff0080'), [0, 255, 0, 128]);
  assert.equal(R.rgbaToHex([0, 255, 0, 255]), '#00ff00');
  assert.equal(R.rgbaToHex([0, 255, 0, 128]), '#00ff0080');
});

test('document: layers, frames, merge, serialize round-trip', () => {
  const doc = M.createDoc({ width: 4, height: 4, name: 'test' });
  const l2 = M.addLayer(doc);
  assert.equal(doc.layers.length, 2);
  R.setPixel(M.getCel(doc, 0, l2.id), 0, 0, RED);
  R.setPixel(M.getCel(doc, 0, doc.layers[0].id), 1, 1, BLUE);
  const fi = M.addFrame(doc, { duplicateOf: 0 });
  assert.equal(fi, 1);
  assert.deepEqual(R.getPixel(M.getCel(doc, 1, l2.id), 0, 0), RED);
  M.addFrame(doc);
  assert.deepEqual(R.getPixel(M.getCel(doc, 2, l2.id), 0, 0), T, 'blank frame');
  assert.equal(M.moveFrame(doc, 2, 0), true);
  assert.deepEqual(R.getPixel(M.getCel(doc, 1, l2.id), 0, 0), RED);
  assert.equal(M.removeFrame(doc, 0), true);
  assert.equal(doc.frames.length, 2);
  const comp = M.compositeFrame(doc, 0);
  assert.deepEqual([...comp.slice(0, 4)], RED);
  assert.deepEqual([...comp.slice(20, 24)], BLUE);
  const json = JSON.parse(JSON.stringify(M.serialize(doc)));
  const back = M.deserialize(json);
  assert.equal(back.layers.length, 2);
  assert.deepEqual(R.getPixel(M.getCel(back, 0, l2.id), 0, 0), RED);
  assert.throws(() => M.deserialize({ version: 2 }));
  M.duplicateLayer(doc, 1);
  assert.equal(doc.layers.length, 3);
  assert.equal(M.mergeDown(doc, 1), true);
  assert.equal(doc.layers.length, 2);
  assert.deepEqual(R.getPixel(M.getCel(doc, 0, doc.layers[0].id), 0, 0), RED, 'merged pixel moved down');
  assert.equal(M.removeLayer(doc, 0), true);
  assert.equal(M.removeLayer(doc, 0), false, 'last layer stays');
  M.resizeDoc(doc, 6, 6, 'top-left');
  assert.equal(M.getCel(doc, 0, doc.layers[0].id).width, 6);
});

test('history undo/redo', () => {
  const h = new History(3);
  const doc = M.createDoc({ width: 2, height: 2 });
  const cel = M.getCel(doc, 0, doc.layers[0].id);
  h.push(M.snapshot(doc));
  R.setPixel(cel, 0, 0, RED);
  const before = M.snapshot(doc);
  const prev = h.undo(before);
  assert.deepEqual(R.getPixel(M.getCel(prev, 0, prev.layers[0].id), 0, 0), T);
  const again = h.redo(prev);
  assert.deepEqual(R.getPixel(M.getCel(again, 0, again.layers[0].id), 0, 0), RED);
  for (let i = 0; i < 5; i++) h.push(M.snapshot(doc));
  assert.equal(h.undoStack.length, 3, 'limit respected');
  assert.equal(h.canRedo, false, 'push clears redo');
});

test('gif encoder writes a valid, decodable animation', () => {
  const w = 4, h = 3;
  const f1 = new Uint8ClampedArray(w * h * 4), f2 = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { f1.set([255, 0, 0, 255], i * 4); f2.set(i % 2 ? [0, 0, 255, 255] : [0, 0, 0, 0], i * 4); }
  const gif = encodeGif({ width: w, height: h, frames: [f1, f2], delaysMs: [100, 250] });
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
  assert.equal(gif[6] | (gif[7] << 8), w);
  assert.equal(gif[8] | (gif[9] << 8), h);
  assert.equal(gif[gif.length - 1], 0x3b);
  // walk to the first image data and decode it
  let p = 13 + 3 * 4; // header + LSD + GCT (2 bits -> 4 entries)
  assert.equal(gif[p], 0x21); p += 19; // netscape ext
  assert.equal(gif[p], 0x21); assert.equal(gif[p + 1], 0xf9); assert.equal(gif[p + 3] & 1, 1, 'transparency flag'); p += 8;
  assert.equal(gif[p], 0x2c); p += 10;
  const minCode = gif[p++];
  const data = [];
  while (gif[p] !== 0) { const n = gif[p++]; data.push(...gif.slice(p, p + n)); p += n; }
  const idx = lzwDecode(data, minCode, w * h);
  assert.equal(idx.length, w * h);
  assert.ok(idx.every((i) => i === idx[0] && i > 0), 'frame 1 is a single opaque colour');
});

test('gif lzw handles a long run and many colours', () => {
  const w = 64, h = 64;
  const f = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) f.set([(i * 7) & 255, (i * 13) & 255, (i * 3) & 255, 255], i * 4);
  const gif = encodeGif({ width: w, height: h, frames: [f] });
  assert.ok(gif.length > 100 && gif.length < w * h * 2);
  assert.equal(gif[gif.length - 1], 0x3b);
});

test('i18n dictionaries match', async () => {
  const i18n = await import('../app/js/i18n.js');
  assert.deepEqual(i18n.missingKeys(), []);
  i18n.setLang('tr');
  assert.equal(i18n.t('layers.new', { n: 3 }), 'Katman 3');
});
