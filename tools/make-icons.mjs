// PNG app icons without dependencies: a 3x3 pixel-art tile with a cream cursor square, on indigo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(size, paint) {
  const SS = 4, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const [pr, pg, pb, pa] = paint(x + (sx + .5) / SS, y + (sy + .5) / SS, size); r += pr * pa; g += pg * pa; b += pb * pa; a += pa; }
    const i = y * (size * 4 + 1) + 1 + x * 4; raw[i] = a ? Math.round(r / a) : 0; raw[i + 1] = a ? Math.round(g / a) : 0; raw[i + 2] = a ? Math.round(b / a) : 0; raw[i + 3] = Math.round(a / (SS * SS));
  } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const BG = [13, 10, 31];
const TILES = [[67, 217, 232], [67, 201, 79], [242, 195, 39], [240, 115, 28], [242, 237, 226], [220, 43, 31], [79, 141, 245], [106, 43, 217], [255, 122, 217]];
function paint(x, y, s, bleed = false) {
  const c = s / 2, rad = s * .22;
  if (!bleed) { const dx = Math.max(Math.abs(x - c) - (c - rad), 0), dy = Math.max(Math.abs(y - c) - (c - rad), 0); if (Math.hypot(dx, dy) > rad) return [0, 0, 0, 0]; }
  const m = s * .2, cell = (s - 2 * m) / 3, gap = s * .018;
  const gx = (x - m) / cell, gy = (y - m) / cell;
  if (gx >= 0 && gx < 3 && gy >= 0 && gy < 3) {
    const fx = gx % 1, fy = gy % 1, g = gap / cell;
    if (fx > g && fx < 1 - g && fy > g && fy < 1 - g) return [...TILES[Math.floor(gy) * 3 + Math.floor(gx)], 255];
  }
  return [...BG, 255];
}
mkdirSync(new URL('../app/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) writeFileSync(new URL(`../app/icons/icon-${size}.png`, import.meta.url), png(size, paint));
writeFileSync(new URL('../app/icons/maskable-512.png', import.meta.url), png(512, (x, y, s) => paint((x - s * .1) / .8, (y - s * .1) / .8, s, true)));
console.log('icons written');
