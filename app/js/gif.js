// Minimal GIF89a encoder (global palette, LZW, transparency, looping). Pure JS, no deps.
// Input frames are RGBA buffers of the same size. Pixels with alpha < 128 are transparent.

function buildPalette(frames) {
  const counts = new Map();
  for (const f of frames) for (let i = 0; i < f.length; i += 4) {
    if (f[i + 3] < 128) continue;
    const key = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  if (colors.length > 255) colors = colors.slice(0, 255); // index 0 is reserved for transparency
  return colors;
}

function nearest(colors, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const dr = r - (c >> 16), dg = g - ((c >> 8) & 255), db = b - (c & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = i; if (d === 0) break; }
  }
  return best;
}

function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize, eoi = clearCode + 1;
  let codeSize = minCodeSize + 1, nextCode = eoi + 1;
  let table = new Map();
  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode === 4096) { emit(clearCode); table = new Map(); nextCode = eoi + 1; codeSize = minCodeSize + 1; }
    else { if (nextCode >= 1 << codeSize) codeSize++; table.set(key, nextCode++); }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

export function encodeGif({ width, height, frames, delaysMs, loop = 0 }) {
  const colors = buildPalette(frames);
  const paletteSize = colors.length + 1; // + transparent index 0
  let bits = 1;
  while (1 << bits < paletteSize) bits++;
  bits = Math.max(2, bits);
  const tableSize = 1 << bits;
  const bytes = [];
  const u8 = (v) => bytes.push(v & 255);
  const u16 = (v) => { u8(v); u8(v >> 8); };
  const str = (s) => { for (const ch of s) u8(ch.charCodeAt(0)); };

  str('GIF89a');
  u16(width); u16(height);
  u8(0x80 | ((bits - 1) << 4) | (bits - 1)); // GCT flag, colour resolution, GCT size
  u8(0); u8(0); // background index, aspect
  // global colour table: index 0 transparent placeholder (black), then colours, then padding
  u8(0); u8(0); u8(0);
  for (const c of colors) { u8(c >> 16); u8(c >> 8); u8(c); }
  for (let i = paletteSize; i < tableSize; i++) { u8(0); u8(0); u8(0); }
  // Netscape looping extension
  u8(0x21); u8(0xff); u8(11); str('NETSCAPE2.0'); u8(3); u8(1); u16(loop); u8(0);

  frames.forEach((f, fi) => {
    const delay = Math.max(2, Math.round((delaysMs?.[fi] ?? 100) / 10));
    // graphic control extension: disposal 2 (restore to background), transparency on
    u8(0x21); u8(0xf9); u8(4); u8((2 << 2) | 1); u16(delay); u8(0); u8(0);
    // image descriptor
    u8(0x2c); u16(0); u16(0); u16(width); u16(height); u8(0);
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < f.length; i += 4, p++) idx[p] = f[i + 3] < 128 ? 0 : 1 + nearest(colors, f[i], f[i + 1], f[i + 2]);
    u8(bits);
    const data = lzwEncode(idx, bits);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      u8(chunk.length);
      for (const b of chunk) u8(b);
    }
    u8(0);
  });
  u8(0x3b);
  return new Uint8Array(bytes);
}

// Tiny LZW decoder used by the tests to round-trip frames.
export function lzwDecode(data, minCodeSize, pixelCount) {
  const clearCode = 1 << minCodeSize, eoi = clearCode + 1;
  let codeSize = minCodeSize + 1, dict = [], prev = null;
  const reset = () => { dict = []; for (let i = 0; i < clearCode; i++) dict.push([i]); dict.push(null, null); codeSize = minCodeSize + 1; prev = null; };
  reset();
  const out = [];
  let bitPos = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++) { const byte = data[(bitPos + i) >> 3]; v |= ((byte >> ((bitPos + i) & 7)) & 1) << i; }
    bitPos += codeSize; return v;
  };
  while (out.length < pixelCount) {
    const code = read();
    if (code === clearCode) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad lzw stream');
    out.push(...entry);
    if (prev && dict.length < 4096) { dict.push([...prev, entry[0]]); if (dict.length === 1 << codeSize && codeSize < 12) codeSize++; }
    prev = entry;
  }
  return out;
}
