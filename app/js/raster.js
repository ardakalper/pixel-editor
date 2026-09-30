// Pure pixel operations on bitmaps: { width, height, data: Uint8ClampedArray (RGBA) }.
// No DOM, no canvas: everything here runs in Node for the unit tests.

export function createBitmap(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBitmap(b) {
  return { width: b.width, height: b.height, data: new Uint8ClampedArray(b.data) };
}

export function inBounds(b, x, y) {
  return x >= 0 && y >= 0 && x < b.width && y < b.height;
}

export function getPixel(b, x, y) {
  if (!inBounds(b, x, y)) return null;
  const i = (y * b.width + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

export function setPixel(b, x, y, rgba) {
  if (!inBounds(b, x, y)) return false;
  const i = (y * b.width + x) * 4;
  b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  return true;
}

export function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export const TRANSPARENT = [0, 0, 0, 0];

// Square brush of `size` pixels, anchored so that odd sizes centre on (x, y).
// `sym` = { x: bool, y: bool } mirrors the stamp across the bitmap's centre axes.
export function stamp(b, x, y, rgba, size = 1, sym = null) {
  const off = Math.floor((size - 1) / 2);
  const targets = [[x, y]];
  if (sym?.x) targets.push([b.width - 1 - x, y]);
  if (sym?.y) targets.push([x, b.height - 1 - y]);
  if (sym?.x && sym?.y) targets.push([b.width - 1 - x, b.height - 1 - y]);
  let n = 0;
  for (const [tx, ty] of targets) {
    // mirrored stamps are anchored from the opposite corner so even sizes stay symmetric
    const mx = tx !== x, my = ty !== y;
    const sx = mx ? tx - (size - 1 - off) : tx - off;
    const sy = my ? ty - (size - 1 - off) : ty - off;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (setPixel(b, sx + i, sy + j, rgba)) n++;
  }
  return n;
}

// Bresenham line, inclusive of both ends.
export function linePoints(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

export function rectPoints(x0, y0, x1, y1, filled = false) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), btm = Math.max(y0, y1);
  const pts = [];
  for (let y = t; y <= btm; y++) {
    for (let x = l; x <= r; x++) {
      if (filled || y === t || y === btm || x === l || x === r) pts.push([x, y]);
    }
  }
  return pts;
}

// Midpoint ellipse inscribed in the bounding box (x0,y0)-(x1,y1), inclusive.
export function ellipsePoints(x0, y0, x1, y1, filled = false) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), btm = Math.max(y0, y1);
  const w = r - l + 1, h = btm - t + 1;
  if (w <= 2 || h <= 2) return rectPoints(l, t, r, btm, filled);
  // work in doubled coordinates so even sizes have an integer centre
  const cx2 = l + r, cy2 = t + btm; // centre * 2
  const a2 = w * w, b2 = h * h; // (2a)^2 / 4 ... using full-diameter maths below
  const set = new Set();
  const rows = new Map(); // y -> [minX, maxX]
  const add = (x, y) => {
    if (x < l || x > r || y < t || y > btm) return;
    set.add(y * 65536 + x);
    const row = rows.get(y);
    if (!row) rows.set(y, [x, x]); else { row[0] = Math.min(row[0], x); row[1] = Math.max(row[1], x); }
  };
  // sample the outline densely by angle; cheap for pixel-art sizes and free of quadrant seams
  const steps = Math.max(64, (w + h) * 4);
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2;
    const x = Math.round((cx2 + (w - 1) * Math.cos(ang)) / 2);
    const y = Math.round((cy2 + (h - 1) * Math.sin(ang)) / 2);
    add(x, y);
  }
  void a2; void b2;
  const pts = [];
  if (filled) {
    for (const [y, [x0r, x1r]] of rows) for (let x = x0r; x <= x1r; x++) pts.push([x, y]);
  } else {
    for (const k of set) pts.push([k % 65536, Math.floor(k / 65536)]);
  }
  return pts;
}

// Scanline flood fill. `contiguous=false` replaces the colour everywhere.
export function floodFill(b, x, y, rgba, { contiguous = true } = {}) {
  if (!inBounds(b, x, y)) return 0;
  const target = getPixel(b, x, y);
  if (colorsEqual(target, rgba)) return 0;
  let n = 0;
  if (!contiguous) {
    for (let py = 0; py < b.height; py++) for (let px = 0; px < b.width; px++) {
      if (colorsEqual(getPixel(b, px, py), target)) { setPixel(b, px, py, rgba); n++; }
    }
    return n;
  }
  const stack = [[x, y]];
  const isTarget = (px, py) => inBounds(b, px, py) && colorsEqual(getPixel(b, px, py), target);
  while (stack.length) {
    let [px, py] = stack.pop();
    if (!isTarget(px, py)) continue;
    let x0 = px, x1 = px;
    while (isTarget(x0 - 1, py)) x0--;
    while (isTarget(x1 + 1, py)) x1++;
    for (let i = x0; i <= x1; i++) setPixel(b, i, py, rgba), n++;
    for (const ny of [py - 1, py + 1]) {
      let i = x0;
      while (i <= x1) {
        if (isTarget(i, ny)) { stack.push([i, ny]); while (i <= x1 && isTarget(i, ny)) i++; }
        i++;
      }
    }
  }
  return n;
}

// Normal alpha compositing of layers (bottom first) into a fresh RGBA buffer.
export function composite(layers, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const src = layer.bitmap.data, op = Math.min(1, Math.max(0, layer.opacity ?? 1));
    for (let i = 0; i < out.length; i += 4) {
      const sa = (src[i + 3] / 255) * op;
      if (sa === 0) continue;
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round((src[i + c] * sa + out[i + c] * da * (1 - sa)) / oa);
      out[i + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

// Copies a rectangle out of a bitmap (as a bitmap) and optionally clears it.
export function extractRegion(b, rect, { clear = false } = {}) {
  const { x, y, w, h } = normRect(rect);
  const out = createBitmap(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = getPixel(b, x + i, y + j);
    if (p) { setPixel(out, i, j, p); if (clear) setPixel(b, x + i, y + j, TRANSPARENT); }
  }
  return out;
}

// Pastes `src` at (x, y), skipping fully transparent source pixels unless `replace`.
export function blit(b, src, x, y, { replace = false } = {}) {
  for (let j = 0; j < src.height; j++) for (let i = 0; i < src.width; i++) {
    const p = getPixel(src, i, j);
    if (replace || p[3] > 0) setPixel(b, x + i, y + j, p);
  }
}

export function normRect(r) {
  const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1);
  return { x, y, w: Math.abs(r.x1 - r.x0) + 1, h: Math.abs(r.y1 - r.y0) + 1 };
}

export function flip(b, axis) {
  const out = createBitmap(b.width, b.height);
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    const tx = axis === 'x' ? b.width - 1 - x : x, ty = axis === 'y' ? b.height - 1 - y : y;
    setPixel(out, tx, ty, getPixel(b, x, y));
  }
  return out;
}

export function rotate90(b, clockwise = true) {
  const out = createBitmap(b.height, b.width);
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    const tx = clockwise ? b.height - 1 - y : y, ty = clockwise ? x : b.width - 1 - x;
    setPixel(out, tx, ty, getPixel(b, x, y));
  }
  return out;
}

// Resize the canvas (not the pixels): keeps content anchored at the top-left by default.
export function resizeBitmap(b, width, height, anchor = 'top-left') {
  const out = createBitmap(width, height);
  const dx = anchor.includes('right') ? width - b.width : anchor.includes('center') || anchor === 'center' ? Math.floor((width - b.width) / 2) : 0;
  const dy = anchor.includes('bottom') ? height - b.height : anchor.includes('middle') || anchor === 'center' ? Math.floor((height - b.height) / 2) : 0;
  blit(out, b, dx, dy, { replace: true });
  return out;
}

export function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return h.length === 8 ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbaToHex(rgba) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}` + (rgba[3] < 255 ? h(rgba[3]) : '');
}

// Nearest-neighbour upscale, used for exports.
export function scaleBitmap(b, factor) {
  const out = createBitmap(b.width * factor, b.height * factor);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    setPixel(out, x, y, getPixel(b, Math.floor(x / factor), Math.floor(y / factor)));
  }
  return out;
}

// ---------- brushes, strokes, inks (Aseprite-style) ----------

// Offsets of a brush of `size` with the given shape, anchored like stamp(): odd sizes centre on the origin.
export function brushOffsets(size = 1, shape = 'square') {
  const off = Math.floor((size - 1) / 2), out = [];
  if (shape === 'circle' && size > 2) {
    // classic pixel-art circles: 3 -> plus (5 px), 4 -> 12 px, 5 -> 21 px, 7 -> 37 px
    const c = (size - 1) / 2, R = size / 2, thr = size % 2 ? (R - 0.5) ** 2 + (R - 0.5) * 0.5 : R * R - 0.5;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const dx = i - c, dy = j - c;
      if (dx * dx + dy * dy <= thr) out.push([i - off, j - off]);
    }
    return out;
  }
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push([i - off, j - off]);
  return out;
}

// Pixel-perfect: drops the middle pixel of L-shaped corners so freehand lines are 1px wide with no doubled corners.
export function pixelPerfect(points) {
  const out = [];
  for (const p of points) {
    if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  }
  let i = 1;
  while (i < out.length - 1) {
    const [ax, ay] = out[i - 1], [bx, by] = out[i], [cx, cy] = out[i + 1];
    const ab = Math.abs(ax - bx) + Math.abs(ay - by), bc = Math.abs(bx - cx) + Math.abs(by - cy);
    const diag = Math.abs(ax - cx) === 1 && Math.abs(ay - cy) === 1;
    if (ab === 1 && bc === 1 && diag) out.splice(i, 1); else i++;
  }
  return out;
}

// Paints a pixel through an "ink". opacity 0..255.
//  simple: replace; alpha: source-over blend; lockalpha: blend colour but keep the existing alpha (paints only where alpha > 0)
//  shading: with `shading` = list of hex colours, a hit on colour i becomes i+1 (left button) or i-1 (right), no change otherwise.
export function paintPixel(b, x, y, rgba, { ink = 'simple', opacity = 255, shading = null, direction = 1 } = {}) {
  if (!inBounds(b, x, y)) return false;
  const i = (y * b.width + x) * 4, d = b.data;
  if (ink === 'shading') {
    if (!shading?.length) return false;
    const cur = rgbaToHex([d[i], d[i + 1], d[i + 2], 255]);
    const idx = d[i + 3] === 0 ? -1 : shading.findIndex((h) => h.toLowerCase() === cur);
    if (idx < 0) return false;
    const next = shading[Math.max(0, Math.min(shading.length - 1, idx + direction))];
    const c = hexToRgba(next); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    return true;
  }
  const sa = (rgba[3] / 255) * (opacity / 255);
  if (ink === 'simple' && opacity >= 255) { d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3]; return true; }
  if (ink === 'lockalpha') { if (d[i + 3] === 0) return false; const t = sa; for (let c = 0; c < 3; c++) d[i + c] = Math.round(rgba[c] * t + d[i + c] * (1 - t)); return true; }
  if (rgba[3] === 0 && ink === 'simple') { d[i + 3] = 0; return true; } // eraser through simple ink
  const da = d[i + 3] / 255, oa = sa + da * (1 - sa);
  if (oa === 0) { d[i + 3] = 0; return true; }
  for (let c = 0; c < 3; c++) d[i + c] = Math.round((rgba[c] * sa + d[i + c] * da * (1 - sa)) / oa);
  d[i + 3] = Math.round(oa * 255);
  return true;
}

// Stamps a brush through an ink, mirrored by `sym`. Returns the number of pixels touched.
export function stampInk(b, x, y, rgba, { size = 1, shape = 'square', sym = null, ...inkOpts } = {}) {
  const offs = brushOffsets(size, shape);
  const targets = [[x, y]];
  if (sym?.x) targets.push([b.width - 1 - x, y]);
  if (sym?.y) targets.push([x, b.height - 1 - y]);
  if (sym?.x && sym?.y) targets.push([b.width - 1 - x, b.height - 1 - y]);
  let n = 0;
  for (const [tx, ty] of targets) {
    const mx = tx !== x, my = ty !== y, shift = size % 2 === 0 ? 1 : 0;
    for (const [dx, dy] of offs) if (paintPixel(b, tx + (mx ? -dx - shift : dx), ty + (my ? -dy - shift : dy), rgba, inkOpts)) n++;
  }
  return n;
}

// Spray: `count` random pixels within `radius`, deterministic with a seed for tests.
export function sprayPoints(x, y, radius, count, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    pts.push([Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r)]);
  }
  return pts;
}

// Linear gradient between two colours over the segment (x0,y0)-(x1,y1), applied to every pixel of `mask`
// (or the whole bitmap). dither: 'none' | 'bayer' (4x4 ordered) for a pixel-art look.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function gradient(b, x0, y0, x1, y1, c0, c1, { dither = 'none', mask = null } = {}) {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    if (mask && !mask.data[y * b.width + x]) continue;
    let t = ((x - x0) * dx + (y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    let rgba;
    if (dither === 'bayer') { const th = (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16; rgba = t > th ? c1 : c0; }
    else rgba = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
    setPixel(b, x, y, rgba);
  }
}
