// Palette files (GPL, HEX, JASC-PAL, ACT), sorting and palette extraction from images. Pure.
import { hexToRgba, rgbaToHex } from './raster.js';
import { rgbToHsl } from './fx.js';

export function parsePalette(text, name = 'palette') {
  const t = text.replace(/\r/g, '');
  if (/^GIMP Palette/i.test(t)) {
    const colors = [];
    for (const line of t.split('\n').slice(1)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || /^(Name|Columns):/i.test(s)) continue;
      const m = s.match(/^(\d+)\s+(\d+)\s+(\d+)/);
      if (m) colors.push(rgbaToHex([+m[1], +m[2], +m[3], 255]));
    }
    return { name, colors };
  }
  if (/^JASC-PAL/i.test(t)) {
    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    const colors = [];
    for (const line of lines.slice(3)) { const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)/); if (m) colors.push(rgbaToHex([+m[1], +m[2], +m[3], 255])); }
    return { name, colors };
  }
  // .hex (one hex per line) or any text with hex colours
  const colors = [...t.matchAll(/(?:^|[^0-9a-f])#?([0-9a-f]{6})(?![0-9a-f])/gi)].map((m) => `#${m[1].toLowerCase()}`);
  return { name, colors: [...new Set(colors)] };
}

// ACT: 256 RGB triplets, optional 4 trailing bytes (count, transparent index).
export function parseAct(bytes) {
  const count = bytes.length >= 772 ? (bytes[768] << 8) | bytes[769] : 256;
  const colors = [];
  for (let i = 0; i < Math.min(count, 256); i++) colors.push(rgbaToHex([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2], 255]));
  return { name: 'palette', colors };
}

export function writePalette(colors, format = 'gpl', name = 'palette') {
  const rgb = colors.map((c) => hexToRgba(c));
  if (format === 'gpl') return `GIMP Palette\nName: ${name}\nColumns: 8\n#\n` + rgb.map((c, i) => `${String(c[0]).padStart(3)} ${String(c[1]).padStart(3)} ${String(c[2]).padStart(3)}\tcolor${i}`).join('\n') + '\n';
  if (format === 'pal') return `JASC-PAL\n0100\n${rgb.length}\n` + rgb.map((c) => `${c[0]} ${c[1]} ${c[2]}`).join('\n') + '\n';
  if (format === 'hex') return colors.map((c) => c.replace('#', '')).join('\n') + '\n';
  if (format === 'act') {
    const out = new Uint8Array(772);
    rgb.slice(0, 256).forEach((c, i) => { out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; });
    out[768] = Math.min(256, rgb.length) >> 8; out[769] = Math.min(256, rgb.length) & 255; out[770] = 255; out[771] = 255;
    return out;
  }
  throw new Error('unknown palette format');
}

export function sortPalette(colors, by = 'hue') {
  const key = (c) => {
    const [r, g, b] = hexToRgba(c), [h, s, l] = rgbToHsl(r, g, b);
    return by === 'hue' ? [s < 0.08 ? -1 : h, l] : by === 'saturation' ? [s, l] : by === 'value' ? [Math.max(r, g, b), h] : [l, h]; // luminance
  };
  return [...colors].sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
}

// Colours actually used across the given RGBA buffers, most frequent first; median-cut to `max` when there are more.
export function extractPalette(buffers, max = 256) {
  const counts = new Map();
  for (const f of buffers) for (let i = 0; i < f.length; i += 4) {
    if (f[i + 3] === 0) continue;
    const key = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length > max) entries = medianCut(entries, max);
  return entries.map(([k]) => rgbaToHex([(k >> 16) & 255, (k >> 8) & 255, k & 255, 255]));
}
function medianCut(entries, max) {
  let boxes = [entries];
  while (boxes.length < max) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (box.length < 2) { boxes.push(box); break; }
    const ch = [0, 1, 2].map((c) => { const vs = box.map(([k]) => (k >> (16 - 8 * c)) & 255); return Math.max(...vs) - Math.min(...vs); });
    const c = ch.indexOf(Math.max(...ch));
    box.sort((a, b) => ((a[0] >> (16 - 8 * c)) & 255) - ((b[0] >> (16 - 8 * c)) & 255));
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [k, w] of box) { r += ((k >> 16) & 255) * w; g += ((k >> 8) & 255) * w; b += (k & 255) * w; n += w; }
    return [(Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n), n];
  });
}
