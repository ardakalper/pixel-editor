// Sprite sheet layouts and Aseprite-compatible JSON metadata. Pure.
import { createBitmap, blit, getPixel, setPixel } from './raster.js';
import { opaqueBounds } from './fx.js';

// frames: [{ bitmap, duration }] ; returns { bitmap, rects: [{x,y,w,h, trimmed?: {x,y,w,h} }] }
export function layoutSheet(frames, { layout = 'horizontal', padding = 0, border = 0, columns = 0, trim = false, scale = 1 } = {}) {
  const n = frames.length;
  const cells = frames.map((f) => {
    const src = f.bitmap;
    const tb = trim ? opaqueBounds(src) ?? { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: src.width, h: src.height };
    return { src, tb };
  });
  const cw = Math.max(...cells.map((c) => c.tb.w)), ch = Math.max(...cells.map((c) => c.tb.h));
  let cols, rows;
  if (layout === 'horizontal') { cols = n; rows = 1; }
  else if (layout === 'vertical') { cols = 1; rows = n; }
  else if (layout === 'columns') { rows = columns > 0 ? columns : Math.ceil(Math.sqrt(n)); cols = Math.ceil(n / rows); }
  else { cols = columns > 0 ? columns : Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); } // rows
  const W = border * 2 + cols * cw + (cols - 1) * padding, H = border * 2 + rows * ch + (rows - 1) * padding;
  const sheet = createBitmap(W * scale, H * scale);
  const rects = cells.map((c, i) => {
    const col = layout === 'columns' ? Math.floor(i / rows) : i % cols, row = layout === 'columns' ? i % rows : Math.floor(i / cols);
    const x = border + col * (cw + padding), y = border + row * (ch + padding);
    // copy trimmed region, scaled with nearest neighbour
    for (let yy = 0; yy < c.tb.h; yy++) for (let xx = 0; xx < c.tb.w; xx++) {
      const p = getPixel(c.src, c.tb.x + xx, c.tb.y + yy);
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) setPixel(sheet, (x + xx) * scale + sx, (y + yy) * scale + sy, p);
    }
    return { x: x * scale, y: y * scale, w: c.tb.w * scale, h: c.tb.h * scale, source: { x: c.tb.x * scale, y: c.tb.y * scale, w: c.tb.w * scale, h: c.tb.h * scale }, trimmed: trim && (c.tb.w !== c.src.width || c.tb.h !== c.src.height) };
  });
  return { bitmap: sheet, rects, cellW: cw * scale, cellH: ch * scale };
}

// Aseprite's JSON data format (hash or array), as game engines expect it.
export function sheetJson({ doc, rects, imageName, format = 'hash', scale = 1, app = 'pixel-editor', version = '1.0.0' }) {
  const w = doc.width * scale, h = doc.height * scale;
  const entries = rects.map((r, i) => [`${doc.name} ${i}.png`, {
    frame: { x: r.x, y: r.y, w: r.w, h: r.h },
    rotated: false,
    trimmed: Boolean(r.trimmed),
    spriteSourceSize: { x: r.source.x, y: r.source.y, w: r.source.w, h: r.source.h },
    sourceSize: { w, h },
    duration: Math.round(doc.frames[i]?.duration ?? 1000 / (doc.fps || 8)),
  }]);
  const frames = format === 'array' ? entries.map(([filename, f]) => ({ filename, ...f })) : Object.fromEntries(entries);
  return {
    frames,
    meta: {
      app, version, image: imageName, format: 'RGBA8888',
      size: { w: rects.length ? Math.max(...rects.map((r) => r.x + r.w)) : w, h: rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : h },
      scale: String(scale),
      frameTags: (doc.tags ?? []).map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.direction ?? 'forward', color: t.color ?? '#000000ff' })),
      layers: doc.layers.map((l) => ({ name: l.name, opacity: Math.round((l.opacity ?? 1) * 255), blendMode: 'normal' })),
      slices: [],
    },
  };
}

// Splits a sheet into cells of (cw, ch) reading rows left-to-right, top-to-bottom; drops fully empty trailing cells.
export function splitSheet(bitmap, cw, ch, { padding = 0, border = 0, skipEmpty = true } = {}) {
  const out = [];
  for (let y = border; y + ch <= bitmap.height - border + 0.0001; y += ch + padding) {
    for (let x = border; x + cw <= bitmap.width - border + 0.0001; x += cw + padding) {
      const cell = createBitmap(cw, ch);
      let any = false;
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { const p = getPixel(bitmap, x + i, y + j); if (p[3]) any = true; setPixel(cell, i, j, p); }
      if (any || !skipEmpty) out.push(cell);
    }
  }
  return out;
}
export { blit };
