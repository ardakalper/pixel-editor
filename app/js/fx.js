// Image adjustments and filters on bitmaps (pure). An optional mask limits the effect to selected pixels.
import { createBitmap, getPixel, setPixel, cloneBitmap } from './raster.js';

const each = (b, mask, fn) => {
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    if (mask && !mask.data[y * b.width + x]) continue;
    const i = (y * b.width + x) * 4;
    fn(i, x, y);
  }
};
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

export function invert(b, mask) {
  const out = cloneBitmap(b);
  each(out, mask, (i) => { if (out.data[i + 3]) { out.data[i] = 255 - out.data[i]; out.data[i + 1] = 255 - out.data[i + 1]; out.data[i + 2] = 255 - out.data[i + 2]; } });
  return out;
}

export function brightnessContrast(b, { brightness = 0, contrast = 0 } = {}, mask) {
  // brightness -100..100 (added), contrast -100..100 (scaled around 128)
  const out = cloneBitmap(b);
  const f = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  each(out, mask, (i) => { if (!out.data[i + 3]) return; for (let c = 0; c < 3; c++) out.data[i + c] = clamp(f * (out.data[i + c] - 128) + 128 + brightness * 2.55); });
  return out;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// hue in degrees (-180..180), saturation and lightness as -100..100 percent
export function hueSaturation(b, { hue = 0, saturation = 0, lightness = 0 } = {}, mask) {
  const out = cloneBitmap(b);
  each(out, mask, (i) => {
    if (!out.data[i + 3]) return;
    let [h, s, l] = rgbToHsl(out.data[i], out.data[i + 1], out.data[i + 2]);
    h += hue; s = Math.max(0, Math.min(1, s + saturation / 100)); l = Math.max(0, Math.min(1, l + lightness / 100));
    const [r, g, bb] = hslToRgb(h, s, l);
    out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = bb;
  });
  return out;
}

export function replaceColor(b, from, to, { tolerance = 0 } = {}, mask) {
  const out = cloneBitmap(b);
  let n = 0;
  each(out, mask, (i) => {
    const d = Math.max(Math.abs(out.data[i] - from[0]), Math.abs(out.data[i + 1] - from[1]), Math.abs(out.data[i + 2] - from[2]), Math.abs(out.data[i + 3] - from[3]));
    if (d <= tolerance) { out.data.set(to, i); n++; }
  });
  return { bitmap: out, count: n };
}

// Outline: adds `color` around (outside) or inside the opaque pixels. matrix: 'circle' (4-neighbour) or 'square' (8).
export function outline(b, color, { place = 'outside', matrix = 'circle' } = {}, mask) {
  const out = cloneBitmap(b);
  const opaque = (x, y) => { const p = getPixel(b, x, y); return p && p[3] > 0; };
  const nbrs = matrix === 'square' ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  each(out, mask, (i, x, y) => {
    const isOpaque = opaque(x, y);
    if (place === 'outside' && !isOpaque && nbrs.some(([dx, dy]) => opaque(x + dx, y + dy))) out.data.set(color, i);
    if (place === 'inside' && isOpaque && nbrs.some(([dx, dy]) => !opaque(x + dx, y + dy))) out.data.set(color, i);
  });
  return out;
}

// Generic convolution (kernel is a square odd-sized array), divisor and bias like Aseprite's matrix filter.
export function convolve(b, kernel, { divisor = null, bias = 0 } = {}, mask) {
  const out = cloneBitmap(b), k = Math.sqrt(kernel.length) | 0, r = (k - 1) / 2;
  const div = divisor ?? (kernel.reduce((a, v) => a + v, 0) || 1);
  each(out, mask, (i, x, y) => {
    const acc = [0, 0, 0, 0];
    for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
      const p = getPixel(b, Math.max(0, Math.min(b.width - 1, x + kx - r)), Math.max(0, Math.min(b.height - 1, y + ky - r)));
      const w = kernel[ky * k + kx];
      for (let c = 0; c < 4; c++) acc[c] += p[c] * w;
    }
    for (let c = 0; c < 4; c++) out.data[i + c] = clamp(acc[c] / div + (c < 3 ? bias : 0));
  });
  return out;
}
export const blur = (b, mask) => convolve(b, [1, 1, 1, 1, 1, 1, 1, 1, 1], {}, mask);

// Despeckle: 3x3 median per channel.
export function despeckle(b, mask) {
  const out = cloneBitmap(b);
  each(out, mask, (i, x, y) => {
    const vals = [[], [], [], []];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = getPixel(b, Math.max(0, Math.min(b.width - 1, x + dx)), Math.max(0, Math.min(b.height - 1, y + dy)));
      for (let c = 0; c < 4; c++) vals[c].push(p[c]);
    }
    for (let c = 0; c < 4; c++) { vals[c].sort((a, v) => a - v); out.data[i + c] = vals[c][4]; }
  });
  return out;
}

// Trim: bounds of non-transparent pixels, or null when empty.
export function opaqueBounds(b) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.data[(y * b.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function crop(b, rect) {
  const out = createBitmap(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) setPixel(out, x, y, getPixel(b, rect.x + x, rect.y + y) ?? [0, 0, 0, 0]);
  return out;
}
