// Mask-based selections: a Uint8Array of width*height, 1 = selected. Pure, testable.
import { getPixel, setPixel, createBitmap, colorsEqual, TRANSPARENT } from './raster.js';

export function createMask(width, height, fill = 0) {
  const m = { width, height, data: new Uint8Array(width * height) };
  if (fill) m.data.fill(1);
  return m;
}
export const cloneMask = (m) => ({ width: m.width, height: m.height, data: new Uint8Array(m.data) });
export const maskGet = (m, x, y) => (x < 0 || y < 0 || x >= m.width || y >= m.height ? 0 : m.data[y * m.width + x]);
export function maskCount(m) { let n = 0; for (const v of m.data) n += v; return n; }
export function maskIsEmpty(m) { return !m || maskCount(m) === 0; }

export function maskFromRect(width, height, rect) {
  const m = createMask(width, height);
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(width - 1, Math.max(rect.x0, rect.x1));
  const y0 = Math.max(0, Math.min(rect.y0, rect.y1)), y1 = Math.min(height - 1, Math.max(rect.y0, rect.y1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.data[y * width + x] = 1;
  return m;
}

export function maskFromEllipse(width, height, rect) {
  const m = createMask(width, height);
  const l = Math.min(rect.x0, rect.x1), r = Math.max(rect.x0, rect.x1), t = Math.min(rect.y0, rect.y1), b = Math.max(rect.y0, rect.y1);
  const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l + 1) / 2, ry = (b - t + 1) / 2;
  for (let y = Math.max(0, t); y <= Math.min(height - 1, b); y++) for (let x = Math.max(0, l); x <= Math.min(width - 1, r); x++) {
    const dx = (x + 0.5 - cx - 0.5) / rx, dy = (y + 0.5 - cy - 0.5) / ry;
    if (dx * dx + dy * dy <= 1) m.data[y * width + x] = 1;
  }
  return m;
}

// Even-odd scanline fill of a closed polygon given as [[x,y],...] pixel centres.
export function maskFromPolygon(width, height, points) {
  const m = createMask(width, height);
  if (points.length < 3) return m;
  const n = points.length;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5, xs = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n];
      const ay = y0 + 0.5, by = y1 + 0.5;
      if ((ay <= py && by > py) || (by <= py && ay > py)) xs.push(x0 + 0.5 + ((py - ay) / (by - ay)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(width - 1, Math.floor(xs[i + 1] - 0.5)); x++) m.data[y * width + x] = 1;
    }
  }
  // make sure the outline itself is selected (thin shapes)
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % n];
    for (const [x, y] of bres(x0, y0, x1, y1)) if (x >= 0 && y >= 0 && x < width && y < height) m.data[y * width + x] = 1;
  }
  return m;
}
function bres(x0, y0, x1, y1) {
  const pts = []; let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (;;) { pts.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  return pts;
}

// Magic wand: pixels matching the colour at (x, y) within `tolerance` (0-255, max channel distance),
// contiguous (4-connected) or everywhere.
export function maskFromWand(bitmap, x, y, { contiguous = true, tolerance = 0 } = {}) {
  const { width, height } = bitmap;
  const m = createMask(width, height);
  const target = getPixel(bitmap, x, y);
  if (!target) return m;
  const match = (px, py) => {
    const p = getPixel(bitmap, px, py);
    if (!p) return false;
    if (target[3] === 0 || p[3] === 0) return target[3] === p[3] || (target[3] === 0 && p[3] <= tolerance) || (p[3] === 0 && target[3] <= tolerance);
    return Math.abs(p[0] - target[0]) <= tolerance && Math.abs(p[1] - target[1]) <= tolerance && Math.abs(p[2] - target[2]) <= tolerance && Math.abs(p[3] - target[3]) <= tolerance;
  };
  if (!contiguous) {
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) if (match(px, py)) m.data[py * width + px] = 1;
    return m;
  }
  const stack = [[x, y]];
  while (stack.length) {
    let [px, py] = stack.pop();
    if (!match(px, py) || m.data[py * width + px]) continue;
    let x0 = px, x1 = px;
    while (x0 > 0 && match(x0 - 1, py) && !m.data[py * width + x0 - 1]) x0--;
    while (x1 < width - 1 && match(x1 + 1, py) && !m.data[py * width + x1 + 1]) x1++;
    for (let i = x0; i <= x1; i++) m.data[py * width + i] = 1;
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= height) continue;
      let i = x0;
      while (i <= x1) { if (match(i, ny) && !m.data[ny * width + i]) { stack.push([i, ny]); while (i <= x1 && match(i, ny)) i++; } i++; }
    }
  }
  return m;
}

export function maskInvert(m) { const out = cloneMask(m); for (let i = 0; i < out.data.length; i++) out.data[i] = out.data[i] ? 0 : 1; return out; }
export function maskUnion(a, b) { const out = cloneMask(a); for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] | b.data[i]; return out; }
export function maskSubtract(a, b) { const out = cloneMask(a); for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] & (b.data[i] ? 0 : 1); return out; }
export function maskIntersect(a, b) { const out = cloneMask(a); for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] & b.data[i]; return out; }

// Morphology: grow / shrink by `n` pixels with a circle (Euclidean) or square (Chebyshev) brush.
export function maskExpand(m, n, shape = 'circle') { return morph(m, n, shape, true); }
export function maskContract(m, n, shape = 'circle') { return morph(m, n, shape, false); }
function morph(m, n, shape, grow) {
  let cur = m;
  for (let step = 0; step < n; step++) {
    const out = cloneMask(cur);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      const v = maskGet(cur, x, y);
      if (grow && v) continue;
      if (!grow && !v) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
        if (!dx && !dy) continue;
        if (shape === 'circle' && dx && dy) continue; // 4-neighbourhood per step approximates a circle
        const nv = x + dx < 0 || y + dy < 0 || x + dx >= m.width || y + dy >= m.height ? 0 : maskGet(cur, x + dx, y + dy);
        if (grow ? nv : !nv) hit = true;
      }
      if (hit) out.data[y * m.width + x] = grow ? 1 : 0;
    }
    cur = out;
  }
  return cur;
}
// Border: the ring of `n` pixels just inside the selection edge.
export function maskBorder(m, n) { return maskSubtract(m, maskContract(m, n)); }

export function maskBounds(m) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Lifts the selected pixels out of a bitmap into a floating bitmap (bounds-sized) and optionally clears them.
export function extractMasked(bitmap, m, { clear = false } = {}) {
  const b = maskBounds(m);
  if (!b) return null;
  const out = createBitmap(b.w, b.h);
  const mask = createMask(b.w, b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!maskGet(m, b.x + x, b.y + y)) continue;
    mask.data[y * b.w + x] = 1;
    setPixel(out, x, y, getPixel(bitmap, b.x + x, b.y + y));
    if (clear) setPixel(bitmap, b.x + x, b.y + y, TRANSPARENT);
  }
  return { bitmap: out, mask, x: b.x, y: b.y };
}

// Fills every selected pixel with a colour.
export function fillMasked(bitmap, m, rgba) {
  let n = 0;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x] && setPixel(bitmap, x, y, rgba)) n++;
  return n;
}

// Moves a mask by (dx, dy), clipping at the edges.
export function maskShift(m, dx, dy) {
  const out = createMask(m.width, m.height);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < m.width && ny < m.height) out.data[ny * m.width + nx] = 1;
  }
  return out;
}

// Edge segments for drawing marching ants: [[x0,y0,x1,y1], ...] in pixel units.
export function maskEdges(m) {
  const segs = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    if (!m.data[y * m.width + x]) continue;
    if (!maskGet(m, x, y - 1)) segs.push([x, y, x + 1, y]);
    if (!maskGet(m, x, y + 1)) segs.push([x, y + 1, x + 1, y + 1]);
    if (!maskGet(m, x - 1, y)) segs.push([x, y, x, y + 1]);
    if (!maskGet(m, x + 1, y)) segs.push([x + 1, y, x + 1, y + 1]);
  }
  return segs;
}

// Same-colour check helper used by "select by colour" on composites.
export const sameColor = colorsEqual;
