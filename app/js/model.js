// Document model: global layers x frames, one cel (bitmap) per (frame, layer).
import { createBitmap, cloneBitmap, composite, resizeBitmap, flip, rotate90, scaleBitmap, getPixel, setPixel } from './raster.js';

let nextId = 1;
export const uid = (p = 'l') => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function createDoc({ width = 32, height = 32, name = 'untitled', palette = [], fps = 8 } = {}) {
  const layer = { id: uid('l'), name: 'Layer 1', visible: true, opacity: 1, locked: false };
  return {
    version: 1, name, width, height, fps, palette: [...palette], tags: [],
    layers: [layer],
    frames: [{ cels: { [layer.id]: createBitmap(width, height) }, duration: Math.round(1000 / fps) }],
  };
}

export function getCel(doc, frameIndex, layerId) {
  const frame = doc.frames[frameIndex];
  if (!frame.cels[layerId]) frame.cels[layerId] = createBitmap(doc.width, doc.height);
  return frame.cels[layerId];
}

export function addLayer(doc, { name, at } = {}) {
  const layer = { id: uid('l'), name: name ?? `Layer ${doc.layers.length + 1}`, visible: true, opacity: 1, locked: false };
  const index = at ?? doc.layers.length;
  doc.layers.splice(index, 0, layer);
  for (const f of doc.frames) f.cels[layer.id] = createBitmap(doc.width, doc.height);
  return layer;
}

export function duplicateLayer(doc, index) {
  const src = doc.layers[index];
  const layer = { ...src, id: uid('l'), name: `${src.name} copy` };
  doc.layers.splice(index + 1, 0, layer);
  for (const f of doc.frames) f.cels[layer.id] = cloneBitmap(getCelOf(f, src.id, doc));
  return layer;
}

function getCelOf(frame, layerId, doc) {
  return frame.cels[layerId] ?? (frame.cels[layerId] = createBitmap(doc.width, doc.height));
}

export function removeLayer(doc, index) {
  if (doc.layers.length <= 1) return false;
  const [layer] = doc.layers.splice(index, 1);
  for (const f of doc.frames) delete f.cels[layer.id];
  return true;
}

export function moveLayer(doc, from, to) {
  if (to < 0 || to >= doc.layers.length || from === to) return false;
  const [l] = doc.layers.splice(from, 1);
  doc.layers.splice(to, 0, l);
  return true;
}

// Merges layer `index` down into the one below it.
export function mergeDown(doc, index) {
  if (index <= 0) return false;
  const top = doc.layers[index], below = doc.layers[index - 1];
  for (const f of doc.frames) {
    const merged = composite([
      { bitmap: getCelOf(f, below.id, doc), visible: true, opacity: below.opacity },
      { bitmap: getCelOf(f, top.id, doc), visible: top.visible, opacity: top.opacity },
    ], doc.width, doc.height);
    f.cels[below.id] = { width: doc.width, height: doc.height, data: merged };
    delete f.cels[top.id];
  }
  below.opacity = 1;
  doc.layers.splice(index, 1);
  return true;
}

export function addFrame(doc, { at, duplicateOf } = {}) {
  const index = at ?? doc.frames.length;
  const cels = {};
  for (const l of doc.layers) {
    cels[l.id] = duplicateOf != null ? cloneBitmap(getCelOf(doc.frames[duplicateOf], l.id, doc)) : createBitmap(doc.width, doc.height);
  }
  doc.frames.splice(index, 0, { cels, duration: duplicateOf != null ? doc.frames[duplicateOf].duration : Math.round(1000 / (doc.fps || 8)) });
  shiftTags(doc, index, 1);
  return index;
}

export function removeFrame(doc, index) {
  if (doc.frames.length <= 1) return false;
  doc.frames.splice(index, 1);
  shiftTags(doc, index, -1);
  return true;
}

// Keeps tag ranges valid when frames are inserted (delta +1 at `index`) or removed (delta -1).
function shiftTags(doc, index, delta) {
  const keep = [];
  for (const t of doc.tags ?? []) {
    if (delta > 0) { if (t.from >= index) t.from++; if (t.to >= index) t.to++; }
    else {
      if (t.from === index && t.to === index) continue; // the tag's only frame is gone
      if (t.from > index) t.from--;
      if (t.to >= index) t.to--;
    }
    t.from = Math.max(0, t.from); t.to = Math.max(t.from, t.to);
    keep.push(t);
  }
  doc.tags = keep;
}

export function reverseFrames(doc, from = 0, to = doc.frames.length - 1) {
  const slice = doc.frames.slice(from, to + 1).reverse();
  doc.frames.splice(from, slice.length, ...slice);
}

// ---- tags ----
export function addTag(doc, { name = 'Tag', from, to, direction = 'forward', color = '#43d9e8' }) {
  const tag = { id: uid('t'), name, from: Math.min(from, to), to: Math.max(from, to), direction, color };
  (doc.tags ??= []).push(tag);
  return tag;
}
export function removeTag(doc, id) { doc.tags = (doc.tags ?? []).filter((t) => t.id !== id); }
export function tagsAtFrame(doc, frame) { return (doc.tags ?? []).filter((t) => frame >= t.from && frame <= t.to); }

// Next frame index when playing: whole animation or a tag, honouring direction and ping-pong.
export function nextPlayFrame(doc, current, tag = null, state = { dir: 1 }) {
  const from = tag ? tag.from : 0, to = tag ? tag.to : doc.frames.length - 1;
  const direction = tag?.direction ?? 'forward';
  if (from === to) return from;
  if (direction === 'reverse') return current <= from || current > to ? to : current - 1;
  if (direction === 'pingpong') {
    let next = current + state.dir;
    if (next > to) { state.dir = -1; next = to - 1; }
    if (next < from) { state.dir = 1; next = from + 1; }
    return Math.max(from, Math.min(to, next));
  }
  return current >= to || current < from ? from : current + 1;
}

// ---- whole-canvas operations (every cel of every frame) ----
function mapCels(doc, fn) { for (const f of doc.frames) for (const id of Object.keys(f.cels)) f.cels[id] = fn(f.cels[id]); }
export function flipDoc(doc, axis) { mapCels(doc, (b) => flip(b, axis)); }
export function rotateDoc(doc, clockwise = true) {
  mapCels(doc, (b) => rotate90(b, clockwise));
  const w = doc.width; doc.width = doc.height; doc.height = w;
}
export function scaleDoc(doc, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('integer factor only');
  mapCels(doc, (b) => scaleBitmap(b, factor));
  doc.width *= factor; doc.height *= factor;
}
export function cropDoc(doc, rect) {
  mapCels(doc, (b) => {
    const out = createBitmap(rect.w, rect.h);
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) setPixel(out, x, y, getPixel(b, rect.x + x, rect.y + y) ?? [0, 0, 0, 0]);
    return out;
  });
  doc.width = rect.w; doc.height = rect.h;
}
// Bounds of everything opaque across all frames and layers (for Trim).
export function contentBounds(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const f of doc.frames) for (const b of Object.values(f.cels)) {
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.data[(y * b.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function moveFrame(doc, from, to) {
  if (to < 0 || to >= doc.frames.length || from === to) return false;
  const [f] = doc.frames.splice(from, 1);
  doc.frames.splice(to, 0, f);
  return true;
}

export function compositeFrame(doc, frameIndex) {
  const f = doc.frames[frameIndex];
  return composite(doc.layers.map((l) => ({ bitmap: getCelOf(f, l.id, doc), visible: l.visible, opacity: l.opacity })), doc.width, doc.height);
}

export function resizeDoc(doc, width, height, anchor = 'top-left') {
  for (const f of doc.frames) for (const id of Object.keys(f.cels)) f.cels[id] = resizeBitmap(f.cels[id], width, height, anchor);
  doc.width = width; doc.height = height;
}

// ---- serialization (bitmaps as base64) ----
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(doc) {
  return {
    version: 1, name: doc.name, width: doc.width, height: doc.height, fps: doc.fps, palette: doc.palette, tags: (doc.tags ?? []).map((t) => ({ ...t })),
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ duration: f.duration, cels: Object.fromEntries(Object.entries(f.cels).map(([id, b]) => [id, bytesToBase64(b.data)])) })),
  };
}

export function deserialize(json) {
  if (!json || json.version !== 1 || !Array.isArray(json.layers) || !Array.isArray(json.frames)) throw new Error('not a pixel-editor document');
  const { width, height } = json;
  return {
    version: 1, name: json.name ?? 'untitled', width, height, fps: json.fps ?? 8, palette: json.palette ?? [],
    tags: (json.tags ?? []).map((t) => ({ id: t.id ?? uid('t'), name: t.name ?? 'Tag', from: t.from | 0, to: t.to | 0, direction: t.direction ?? 'forward', color: t.color ?? '#43d9e8' })),
    layers: json.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible !== false, opacity: l.opacity ?? 1, locked: Boolean(l.locked) })),
    frames: json.frames.map((f) => ({
      duration: f.duration ?? Math.round(1000 / (json.fps ?? 8)),
      cels: Object.fromEntries(Object.entries(f.cels).map(([id, b64]) => {
        const data = base64ToBytes(b64);
        if (data.length !== width * height * 4) throw new Error('cel size mismatch');
        return [id, { width, height, data }];
      })),
    })),
  };
}

// Deep copy used by the history stack.
export function snapshot(doc) {
  return {
    ...doc, palette: [...doc.palette], tags: (doc.tags ?? []).map((t) => ({ ...t })), layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ duration: f.duration, cels: Object.fromEntries(Object.entries(f.cels).map(([id, b]) => [id, cloneBitmap(b)])) })),
  };
}
