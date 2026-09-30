// Document model: global layers x frames, one cel (bitmap) per (frame, layer).
import { createBitmap, cloneBitmap, composite, resizeBitmap } from './raster.js';

let nextId = 1;
export const uid = (p = 'l') => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function createDoc({ width = 32, height = 32, name = 'untitled', palette = [], fps = 8 } = {}) {
  const layer = { id: uid('l'), name: 'Layer 1', visible: true, opacity: 1 };
  return {
    version: 1, name, width, height, fps, palette: [...palette],
    layers: [layer],
    frames: [{ cels: { [layer.id]: createBitmap(width, height) } }],
  };
}

export function getCel(doc, frameIndex, layerId) {
  const frame = doc.frames[frameIndex];
  if (!frame.cels[layerId]) frame.cels[layerId] = createBitmap(doc.width, doc.height);
  return frame.cels[layerId];
}

export function addLayer(doc, { name, at } = {}) {
  const layer = { id: uid('l'), name: name ?? `Layer ${doc.layers.length + 1}`, visible: true, opacity: 1 };
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
  doc.frames.splice(index, 0, { cels });
  return index;
}

export function removeFrame(doc, index) {
  if (doc.frames.length <= 1) return false;
  doc.frames.splice(index, 1);
  return true;
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
    version: 1, name: doc.name, width: doc.width, height: doc.height, fps: doc.fps, palette: doc.palette,
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ cels: Object.fromEntries(Object.entries(f.cels).map(([id, b]) => [id, bytesToBase64(b.data)])) })),
  };
}

export function deserialize(json) {
  if (!json || json.version !== 1 || !Array.isArray(json.layers) || !Array.isArray(json.frames)) throw new Error('not a pixel-editor document');
  const { width, height } = json;
  return {
    version: 1, name: json.name ?? 'untitled', width, height, fps: json.fps ?? 8, palette: json.palette ?? [],
    layers: json.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible !== false, opacity: l.opacity ?? 1 })),
    frames: json.frames.map((f) => ({
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
    ...doc, palette: [...doc.palette], layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ cels: Object.fromEntries(Object.entries(f.cels).map(([id, b]) => [id, cloneBitmap(b)])) })),
  };
}
