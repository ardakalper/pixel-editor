// UI controller: wires the pure core (raster, model, history, gif) to the DOM.
import * as R from './raster.js';
import * as M from './model.js';
import { History } from './history.js';
import { encodeGif } from './gif.js';
import { PALETTES } from './palettes.js';
import { t, setLang, getLang, detectLang } from './i18n.js';
import * as store from './store.js';

const MAX_SIZE = 512;
const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const el = {
  viewport: $('#viewport'), stage: $('#stage'), canvas: $('#canvas'), overlay: $('#overlay'),
  docName: $('#doc-name'), zoomLabel: $('#zoom-label'), brushSize: $('#brush-size'), brushLabel: $('#brush-size-label'),
  optFill: $('#opt-fill'), optGlobal: $('#opt-global'),
  swatchP: $('#swatch-primary'), swatchS: $('#swatch-secondary'), colorInput: $('#color-input'), paletteSelect: $('#palette-select'), palette: $('#palette'),
  layers: $('#layers'), layerOpacity: $('#layer-opacity'), frames: $('#frames'), fps: $('#fps'), play: $('#btn-play'),
  pos: $('#status-pos'), size: $('#status-size'), toast: $('#toast'), undo: $('#btn-undo'), redo: $('#btn-redo'),
  fileOpen: $('#file-open'), install: $('#btn-install'),
};
const ctx = el.canvas.getContext('2d');
const octx = el.overlay.getContext('2d');

const ui = {
  lang: null, theme: 'dark', checker: true, zoom: 8, tool: 'pencil', brush: 1, filled: false, global: false,
  grid: true, onion: false, symx: false, symy: false, primary: '#f2ede2', secondary: '#0d0a1f', paletteId: 'pico8',
  ...store.load('ui', {}),
};

const state = {
  doc: null, frame: 0, layer: 0, history: new History(80),
  drag: null,        // { tool, x0, y0, x, y, button, snapshotTaken }
  sel: null,         // { x0, y0, x1, y1 } inclusive, normalized
  floating: null,    // { bitmap, x, y } pixels lifted from the layer while moving a selection
  clipboard: null,   // bitmap
  hover: null,       // [x, y]
  playing: null,     // interval id
  space: false, panning: null,
  saveTimer: 0,
};

const primaryRgba = () => R.hexToRgba(ui.primary);
const secondaryRgba = () => R.hexToRgba(ui.secondary);
const activeLayer = () => state.doc.layers[state.layer];
const activeCel = () => M.getCel(state.doc, state.frame, activeLayer().id);
const sym = () => ({ x: ui.symx, y: ui.symy });

// ---------- persistence ----------
function saveUi() { store.save('ui', ui); }
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => store.save('doc', M.serialize(state.doc)), 400);
}

// ---------- history ----------
function beginChange() { state.history.push(M.snapshot(state.doc)); }
function endChange() { scheduleSave(); renderAll(); }
function undo() { const s = state.history.undo(M.snapshot(state.doc)); if (s) { state.doc = s; clampIndices(); commitFloating(false); endChange(); } }
function redo() { const s = state.history.redo(M.snapshot(state.doc)); if (s) { state.doc = s; clampIndices(); endChange(); } }
function clampIndices() {
  state.frame = Math.min(state.frame, state.doc.frames.length - 1);
  state.layer = Math.min(state.layer, state.doc.layers.length - 1);
  if (state.sel) state.sel = clampRect(state.sel);
}
function clampRect(r) {
  const w = state.doc.width, h = state.doc.height;
  const c = (v, m) => Math.max(0, Math.min(m - 1, v));
  return { x0: c(r.x0, w), y0: c(r.y0, h), x1: c(r.x1, w), y1: c(r.y1, h) };
}

// ---------- coordinates ----------
function pixelFromEvent(ev) {
  const rect = el.canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left) / ui.zoom), y = Math.floor((ev.clientY - rect.top) / ui.zoom);
  return [x, y];
}
const inDoc = (x, y) => x >= 0 && y >= 0 && x < state.doc.width && y < state.doc.height;
const clampPt = (x, y) => [Math.max(0, Math.min(state.doc.width - 1, x)), Math.max(0, Math.min(state.doc.height - 1, y))];

// ---------- rendering ----------
function render() {
  const d = state.doc;
  if (el.canvas.width !== d.width || el.canvas.height !== d.height) { el.canvas.width = d.width; el.canvas.height = d.height; }
  const img = new ImageData(M.compositeFrame(d, state.frame), d.width, d.height);
  if (state.floating) {
    // draw the lifted pixels on top, at their current position
    const f = state.floating;
    for (let j = 0; j < f.bitmap.height; j++) for (let i = 0; i < f.bitmap.width; i++) {
      const p = R.getPixel(f.bitmap, i, j);
      const x = f.x + i, y = f.y + j;
      if (p[3] > 0 && inDoc(x, y)) img.data.set(p, (y * d.width + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  renderOverlay();
}

function applyZoomCss() {
  const d = state.doc, w = d.width * ui.zoom, h = d.height * ui.zoom;
  el.stage.style.width = `${w}px`; el.stage.style.height = `${h}px`;
  el.canvas.style.width = `${w}px`; el.canvas.style.height = `${h}px`;
  el.overlay.style.width = `${w}px`; el.overlay.style.height = `${h}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.overlay.width = Math.round(w * dpr); el.overlay.height = Math.round(h * dpr);
  el.zoomLabel.textContent = `${ui.zoom * 100}%`;
  el.stage.classList.toggle('checker', ui.checker);
  el.viewport.dataset.tool = ui.tool;
}

function renderOverlay() {
  const d = state.doc, z = ui.zoom, dpr = el.overlay.width / (d.width * z);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, d.width * z, d.height * z);
  octx.imageSmoothingEnabled = false;
  // onion skin: previous and next frames
  if (ui.onion && d.frames.length > 1) {
    for (const [fi, alpha] of [[state.frame - 1, 0.35], [state.frame + 1, 0.2]]) {
      if (fi < 0 || fi >= d.frames.length) continue;
      const tmp = document.createElement('canvas'); tmp.width = d.width; tmp.height = d.height;
      tmp.getContext('2d').putImageData(new ImageData(M.compositeFrame(d, fi), d.width, d.height), 0, 0);
      octx.globalAlpha = alpha; octx.drawImage(tmp, 0, 0, d.width * z, d.height * z); octx.globalAlpha = 1;
    }
  }
  // grid
  if (ui.grid && z >= 4) {
    octx.lineWidth = 1;
    for (let x = 1; x < d.width; x++) { octx.strokeStyle = x % 8 === 0 ? cssVar('--grid-major') : cssVar('--grid'); octx.beginPath(); octx.moveTo(x * z + 0.5, 0); octx.lineTo(x * z + 0.5, d.height * z); octx.stroke(); }
    for (let y = 1; y < d.height; y++) { octx.strokeStyle = y % 8 === 0 ? cssVar('--grid-major') : cssVar('--grid'); octx.beginPath(); octx.moveTo(0, y * z + 0.5); octx.lineTo(d.width * z, y * z + 0.5); octx.stroke(); }
  }
  // symmetry axes
  octx.setLineDash([4, 4]); octx.strokeStyle = cssVar('--c-orange'); octx.lineWidth = 1;
  if (ui.symx) { octx.beginPath(); octx.moveTo((d.width * z) / 2, 0); octx.lineTo((d.width * z) / 2, d.height * z); octx.stroke(); }
  if (ui.symy) { octx.beginPath(); octx.moveTo(0, (d.height * z) / 2); octx.lineTo(d.width * z, (d.height * z) / 2); octx.stroke(); }
  octx.setLineDash([]);
  // shape preview while dragging
  const drag = state.drag;
  if (drag && ['line', 'rect', 'ellipse'].includes(drag.tool)) {
    const color = drag.button === 2 ? ui.secondary : ui.primary;
    octx.fillStyle = color; octx.globalAlpha = 0.85;
    for (const [x, y] of shapePoints(drag)) for (const [tx, ty] of mirrored(x, y)) octx.fillRect(tx * z, ty * z, z, z);
    octx.globalAlpha = 1;
  }
  if (drag && drag.tool === 'select' && drag.mode === 'draw') drawSelRect(normSel({ x0: drag.x0, y0: drag.y0, x1: drag.x, y1: drag.y }), z);
  else if (state.sel) drawSelRect(state.sel, z);
  // hover cell
  if (state.hover && !drag && ['pencil', 'eraser', 'line', 'rect', 'ellipse'].includes(ui.tool)) {
    const off = Math.floor((ui.brush - 1) / 2);
    octx.strokeStyle = cssVar('--fg'); octx.lineWidth = 1; octx.globalAlpha = .7;
    octx.strokeRect((state.hover[0] - off) * z + 0.5, (state.hover[1] - off) * z + 0.5, ui.brush * z - 1, ui.brush * z - 1);
    octx.globalAlpha = 1;
  }
}
function drawSelRect(s, z) {
  const r = R.normRect(s);
  octx.setLineDash([6, 4]); octx.lineWidth = 2;
  octx.strokeStyle = '#000'; octx.strokeRect(r.x * z + 1, r.y * z + 1, r.w * z - 2, r.h * z - 2);
  octx.strokeStyle = cssVar('--sel'); octx.lineDashOffset = 5; octx.strokeRect(r.x * z + 1, r.y * z + 1, r.w * z - 2, r.h * z - 2);
  octx.lineDashOffset = 0; octx.setLineDash([]);
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function normSel(s) { return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) }; }
function mirrored(x, y) {
  const d = state.doc, out = [[x, y]];
  if (ui.symx) out.push([d.width - 1 - x, y]);
  if (ui.symy) out.push([x, d.height - 1 - y]);
  if (ui.symx && ui.symy) out.push([d.width - 1 - x, d.height - 1 - y]);
  return out;
}

function renderPalette() {
  const pal = PALETTES.find((p) => p.id === ui.paletteId) ?? PALETTES[0];
  const colors = ui.paletteId === 'custom' ? state.doc.palette : pal.colors;
  el.paletteSelect.replaceChildren(...PALETTES.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name })), Object.assign(document.createElement('option'), { value: 'custom', textContent: getLang() === 'tr' ? 'Belge paleti' : 'Document palette' }));
  el.paletteSelect.value = ui.paletteId;
  el.palette.replaceChildren(...colors.map((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c; b.title = c; b.dataset.color = c;
    b.setAttribute('aria-pressed', String(c.toLowerCase() === ui.primary.toLowerCase()));
    b.addEventListener('click', () => setColor('primary', c));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); setColor('secondary', c); });
    return b;
  }));
  el.swatchP.style.background = ui.primary; el.swatchS.style.background = ui.secondary;
  el.colorInput.value = ui.primary.slice(0, 7);
}
function setColor(which, hex) {
  ui[which] = hex; saveUi(); renderPalette();
}

function renderLayers() {
  const d = state.doc;
  const items = [...d.layers].reverse().map((l, ri) => {
    const i = d.layers.length - 1 - ri;
    const li = document.createElement('li');
    li.className = 'layer' + (l.visible ? '' : ' hidden'); li.setAttribute('aria-selected', String(i === state.layer)); li.dataset.index = i;
    const eye = document.createElement('button'); eye.className = 'eye'; eye.type = 'button'; eye.textContent = '👁'; eye.setAttribute('aria-pressed', String(l.visible)); eye.title = l.visible ? 'Hide' : 'Show';
    eye.addEventListener('click', (e) => { e.stopPropagation(); beginChange(); l.visible = !l.visible; endChange(); });
    const th = document.createElement('canvas'); th.width = d.width; th.height = d.height;
    th.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(M.getCel(d, state.frame, l.id).data), d.width, d.height), 0, 0);
    const name = document.createElement('span'); name.className = 'name'; name.textContent = l.name;
    li.append(eye, th, name);
    li.addEventListener('click', () => { commitFloating(); state.layer = i; renderLayers(); });
    li.addEventListener('dblclick', () => { const n = prompt(t('layers.rename'), l.name); if (n) { beginChange(); l.name = n.trim() || l.name; endChange(); } });
    return li;
  });
  el.layers.replaceChildren(...items);
  el.layerOpacity.value = Math.round(activeLayer().opacity * 100);
  $('#btn-layer-del').disabled = d.layers.length <= 1;
  $('#btn-layer-merge').disabled = state.layer <= 0;
  $('#btn-layer-up').disabled = state.layer >= d.layers.length - 1;
  $('#btn-layer-down').disabled = state.layer <= 0;
}

function renderFrames() {
  const d = state.doc;
  el.frames.replaceChildren(...d.frames.map((f, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'frame'; b.setAttribute('aria-selected', String(i === state.frame)); b.dataset.index = i;
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
    c.getContext('2d').putImageData(new ImageData(M.compositeFrame(d, i), d.width, d.height), 0, 0);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    b.append(c, n);
    b.addEventListener('click', () => { commitFloating(); state.frame = i; renderAll(); });
    return b;
  }));
  el.fps.value = d.fps;
  $('#btn-frame-del').disabled = d.frames.length <= 1;
  $('#btn-frame-left').disabled = state.frame <= 0;
  $('#btn-frame-right').disabled = state.frame >= d.frames.length - 1;
}

function renderAll() {
  applyZoomCss();
  render();
  renderLayers();
  renderFrames();
  renderPalette();
  el.size.textContent = `${state.doc.width} × ${state.doc.height}`;
  el.docName.value = state.doc.name;
  el.undo.disabled = !state.history.canUndo; el.redo.disabled = !state.history.canRedo;
  el.brushLabel.textContent = ui.brush; el.brushSize.value = ui.brush;
  el.optFill.checked = ui.filled; el.optGlobal.checked = ui.global;
  for (const [id, key] of [['#tg-grid', 'grid'], ['#tg-onion', 'onion'], ['#tg-symx', 'symx'], ['#tg-symy', 'symy']]) $(id).setAttribute('aria-pressed', String(ui[key]));
  $$('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === ui.tool)));
}

// ---------- tools ----------
function shapePoints(drag) {
  const [x0, y0] = clampPt(drag.x0, drag.y0), [x1, y1] = clampPt(drag.x, drag.y);
  if (drag.tool === 'line') return R.linePoints(x0, y0, x1, y1);
  if (drag.tool === 'rect') return R.rectPoints(x0, y0, x1, y1, ui.filled);
  return R.ellipsePoints(x0, y0, x1, y1, ui.filled);
}
function paintPoints(points, rgba, size = 1) {
  const cel = activeCel();
  for (const [x, y] of points) R.stamp(cel, x, y, rgba, size, sym());
}

function onPointerDown(ev) {
  if (state.playing) stopPlayback();
  el.viewport.focus?.();
  const pan = ev.button === 1 || state.space || ui.tool === 'pan';
  if (pan) { state.panning = { x: ev.clientX, y: ev.clientY, sl: el.viewport.scrollLeft, st: el.viewport.scrollTop }; el.viewport.classList.add('panning'); el.viewport.setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
  if (ev.button !== 0 && ev.button !== 2) return;
  const [x, y] = pixelFromEvent(ev);
  const tool = ui.tool, rgba = ev.button === 2 ? secondaryRgba() : primaryRgba();
  el.viewport.setPointerCapture(ev.pointerId);
  ev.preventDefault();
  if (tool === 'picker') { pick(x, y, ev.button === 2 ? 'secondary' : 'primary'); return; }
  if (tool === 'fill') {
    if (!inDoc(x, y)) return;
    commitFloating();
    beginChange();
    for (const [tx, ty] of mirrored(x, y)) R.floodFill(activeCel(), tx, ty, rgba, { contiguous: !ui.global });
    endChange(); return;
  }
  if (tool === 'select') {
    if (state.sel && insideSel(x, y)) {
      // start moving the selection (lift pixels once)
      if (!state.floating) { beginChange(); liftSelection(); }
      state.drag = { tool, mode: 'move', x0: x, y0: y, x, y, fx: state.floating.x, fy: state.floating.y, sx: state.sel.x0, sy: state.sel.y0 };
    } else {
      commitFloating();
      state.sel = null;
      state.drag = { tool, mode: 'draw', x0: x, y0: y, x, y };
    }
    render(); return;
  }
  commitFloating();
  if (tool === 'pencil' || tool === 'eraser') {
    beginChange();
    state.drag = { tool, x0: x, y0: y, x, y, button: ev.button, rgba: tool === 'eraser' ? R.TRANSPARENT : rgba, last: [x, y] };
    paintPoints([[x, y]], state.drag.rgba, ui.brush);
    render(); return;
  }
  if (['line', 'rect', 'ellipse'].includes(tool)) {
    state.drag = { tool, x0: x, y0: y, x, y, button: ev.button, rgba };
    render();
  }
}

function onPointerMove(ev) {
  if (state.panning) {
    el.viewport.scrollLeft = state.panning.sl - (ev.clientX - state.panning.x);
    el.viewport.scrollTop = state.panning.st - (ev.clientY - state.panning.y);
    return;
  }
  const [x, y] = pixelFromEvent(ev);
  state.hover = inDoc(x, y) ? [x, y] : null;
  el.pos.textContent = `${Math.max(0, Math.min(state.doc.width - 1, x))}, ${Math.max(0, Math.min(state.doc.height - 1, y))}`;
  const drag = state.drag;
  if (!drag) { renderOverlay(); return; }
  drag.x = x; drag.y = y;
  if (drag.tool === 'pencil' || drag.tool === 'eraser') {
    const [lx, ly] = drag.last;
    if (lx !== x || ly !== y) { paintPoints(R.linePoints(lx, ly, x, y), drag.rgba, ui.brush); drag.last = [x, y]; }
    render(); return;
  }
  if (drag.tool === 'select' && drag.mode === 'move') {
    const dx = x - drag.x0, dy = y - drag.y0;
    state.floating.x = drag.fx + dx; state.floating.y = drag.fy + dy;
    const w = state.sel.x1 - state.sel.x0, h = state.sel.y1 - state.sel.y0;
    state.sel = { x0: drag.sx + dx, y0: drag.sy + dy, x1: drag.sx + dx + w, y1: drag.sy + dy + h };
    render(); return;
  }
  renderOverlay();
}

function onPointerUp(ev) {
  if (state.panning) { state.panning = null; el.viewport.classList.remove('panning'); return; }
  const drag = state.drag;
  if (!drag) return;
  state.drag = null;
  if (['line', 'rect', 'ellipse'].includes(drag.tool)) {
    beginChange();
    paintPoints(shapePoints(drag), drag.rgba, 1);
    endChange(); return;
  }
  if (drag.tool === 'select') {
    if (drag.mode === 'draw') {
      const s = normSel({ x0: drag.x0, y0: drag.y0, x1: drag.x, y1: drag.y });
      const [a, b] = [clampPt(s.x0, s.y0), clampPt(s.x1, s.y1)];
      state.sel = inDoc(drag.x0, drag.y0) || inDoc(drag.x, drag.y) ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1] } : null;
    }
    render(); return;
  }
  endChange();
}

function pick(x, y, which) {
  if (!inDoc(x, y)) return;
  const comp = M.compositeFrame(state.doc, state.frame);
  const i = (y * state.doc.width + x) * 4;
  if (comp[i + 3] === 0) return;
  setColor(which, R.rgbaToHex([comp[i], comp[i + 1], comp[i + 2], 255]));
}

// ---------- selection ----------
function insideSel(x, y) { const s = state.sel; return s && x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1; }
function liftSelection() {
  const s = state.sel;
  state.floating = { bitmap: R.extractRegion(activeCel(), s, { clear: true }), x: s.x0, y: s.y0 };
}
// Puts floating pixels back into the active layer. `keep` false drops them (used by undo).
function commitFloating(keep = true) {
  if (!state.floating) return;
  if (keep) R.blit(activeCel(), state.floating.bitmap, state.floating.x, state.floating.y);
  state.floating = null;
  if (keep) scheduleSave();
  render();
}
function deleteSelection() {
  if (!state.sel) return;
  if (state.floating) { state.floating = null; state.sel = null; endChange(); return; }
  beginChange();
  R.extractRegion(activeCel(), state.sel, { clear: true });
  endChange();
}
function copySelection() {
  if (!state.sel) return;
  commitFloating();
  state.clipboard = R.extractRegion(activeCel(), state.sel);
  toast(getLang() === 'tr' ? 'Kopyalandı' : 'Copied');
}
function pasteClipboard() {
  if (!state.clipboard) return;
  commitFloating();
  beginChange();
  const x = state.sel ? state.sel.x0 : 0, y = state.sel ? state.sel.y0 : 0;
  state.floating = { bitmap: R.cloneBitmap(state.clipboard), x, y };
  state.sel = clampRect({ x0: x, y0: y, x1: x + state.clipboard.width - 1, y1: y + state.clipboard.height - 1 });
  ui.tool = 'select';
  renderAll();
}

// ---------- document actions ----------
function newDoc(w, h) {
  commitFloating();
  state.doc = M.createDoc({ width: w, height: h, name: 'untitled' });
  state.frame = 0; state.layer = 0; state.sel = null; state.history.clear();
  ui.zoom = fitZoom(); saveUi();
  scheduleSave(); renderAll(); centerView();
}
function loadDoc(doc) {
  commitFloating();
  state.doc = doc; state.frame = 0; state.layer = 0; state.sel = null; state.history.clear();
  ui.zoom = fitZoom(); saveUi();
  scheduleSave(); renderAll(); centerView();
}
function fitZoom() {
  const vw = el.viewport.clientWidth - 80, vh = el.viewport.clientHeight - 80;
  const z = Math.floor(Math.min(vw / state.doc.width, vh / state.doc.height));
  return ZOOMS.filter((v) => v <= Math.max(1, z)).pop() ?? 1;
}
function centerView() {
  requestAnimationFrame(() => {
    el.viewport.scrollLeft = (el.viewport.scrollWidth - el.viewport.clientWidth) / 2;
    el.viewport.scrollTop = (el.viewport.scrollHeight - el.viewport.clientHeight) / 2;
  });
}
function setZoom(z, anchor) {
  z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
  if (z === ui.zoom) return;
  // keep the pixel under `anchor` (client coords) in place
  const rect = el.canvas.getBoundingClientRect();
  const ax = anchor ? (anchor.x - rect.left) / ui.zoom : state.doc.width / 2;
  const ay = anchor ? (anchor.y - rect.top) / ui.zoom : state.doc.height / 2;
  const before = { sl: el.viewport.scrollLeft, st: el.viewport.scrollTop };
  const vx = anchor ? anchor.x - el.viewport.getBoundingClientRect().left : el.viewport.clientWidth / 2;
  const vy = anchor ? anchor.y - el.viewport.getBoundingClientRect().top : el.viewport.clientHeight / 2;
  ui.zoom = z; saveUi(); applyZoomCss(); render();
  const stageLeft = el.stage.offsetLeft, stageTop = el.stage.offsetTop;
  el.viewport.scrollLeft = stageLeft + ax * z - vx;
  el.viewport.scrollTop = stageTop + ay * z - vy;
  void before;
}
const zoomStep = (dir) => { const i = ZOOMS.indexOf(ui.zoom); setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + dir))]); };

// ---------- export / import ----------
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function bitmapToCanvas(b) {
  const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0);
  return c;
}
async function exportAs(type, scale) {
  commitFloating();
  const d = state.doc, name = d.name || 'pixel';
  if (type === 'json') { download(new Blob([JSON.stringify(M.serialize(d))], { type: 'application/json' }), `${name}.json`); return; }
  const frames = d.frames.map((_, i) => ({ width: d.width, height: d.height, data: M.compositeFrame(d, i) }));
  if (type === 'png') {
    const c = bitmapToCanvas(R.scaleBitmap(frames[state.frame], scale));
    c.toBlob((blob) => download(blob, `${name}.png`), 'image/png'); return;
  }
  if (type === 'sheet') {
    const sheet = R.createBitmap(d.width * frames.length, d.height);
    frames.forEach((f, i) => R.blit(sheet, f, i * d.width, 0, { replace: true }));
    bitmapToCanvas(R.scaleBitmap(sheet, scale)).toBlob((blob) => download(blob, `${name}-sheet.png`), 'image/png'); return;
  }
  if (type === 'gif') {
    const scaled = frames.map((f) => R.scaleBitmap(f, scale).data);
    const bytes = encodeGif({ width: d.width * scale, height: d.height * scale, frames: scaled, delaysMs: frames.map(() => 1000 / d.fps) });
    download(new Blob([bytes], { type: 'image/gif' }), `${name}.gif`);
  }
}
async function importFile(file) {
  try {
    if (file.type === 'application/json' || file.name.endsWith('.json') || !file.type.startsWith('image/')) {
      const doc = M.deserialize(JSON.parse(await file.text()));
      loadDoc(doc); toast(t('msg.imported', { name: file.name })); return;
    }
    const bmp = await createImageBitmap(file);
    if (bmp.width > MAX_SIZE || bmp.height > MAX_SIZE) { toast(t('msg.toolarge', { max: MAX_SIZE })); return; }
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const cctx = c.getContext('2d'); cctx.drawImage(bmp, 0, 0);
    const doc = M.createDoc({ width: bmp.width, height: bmp.height, name: file.name.replace(/\.[^.]+$/, '') });
    M.getCel(doc, 0, doc.layers[0].id).data.set(cctx.getImageData(0, 0, bmp.width, bmp.height).data);
    loadDoc(doc); toast(t('msg.imported', { name: file.name }));
  } catch { toast(t('msg.badfile')); }
}

let toastTimer = 0;
function toast(msg) { el.toast.textContent = msg; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800); }

// ---------- playback ----------
function startPlayback() {
  if (state.playing) return;
  commitFloating();
  el.play.textContent = '■'; el.play.title = t('frames.stop');
  const tick = () => { state.frame = (state.frame + 1) % state.doc.frames.length; render(); renderFrames(); };
  state.playing = setInterval(tick, 1000 / Math.max(1, state.doc.fps));
}
function stopPlayback() {
  if (!state.playing) return;
  clearInterval(state.playing); state.playing = null;
  el.play.textContent = '▶'; el.play.title = t('frames.play');
  renderAll();
}

// ---------- wiring ----------
function applyI18n() {
  $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  $$('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', n.title); });
  const anchors = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
  $('#resize-anchor').replaceChildren(...anchors.map((a) => Object.assign(document.createElement('option'), { value: a, textContent: t(`anchor.${a}`) })));
  $('#resize-anchor').value = 'top-left';
}
function applyTheme() { document.documentElement.dataset.theme = ui.theme; }

function bind() {
  el.viewport.addEventListener('pointerdown', onPointerDown);
  el.viewport.addEventListener('pointermove', onPointerMove);
  el.viewport.addEventListener('pointerup', onPointerUp);
  el.viewport.addEventListener('pointercancel', onPointerUp);
  el.viewport.addEventListener('pointerleave', () => { state.hover = null; renderOverlay(); });
  el.viewport.addEventListener('contextmenu', (e) => e.preventDefault());
  el.viewport.addEventListener('wheel', (e) => { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY }); }, { passive: false });

  $$('.tool').forEach((b) => b.addEventListener('click', () => { commitFloating(); ui.tool = b.dataset.tool; saveUi(); renderAll(); }));
  el.brushSize.addEventListener('input', () => { ui.brush = Number(el.brushSize.value); el.brushLabel.textContent = ui.brush; saveUi(); renderOverlay(); });
  el.optFill.addEventListener('change', () => { ui.filled = el.optFill.checked; saveUi(); });
  el.optGlobal.addEventListener('change', () => { ui.global = el.optGlobal.checked; saveUi(); });
  for (const [id, key] of [['#tg-grid', 'grid'], ['#tg-onion', 'onion'], ['#tg-symx', 'symx'], ['#tg-symy', 'symy']]) {
    $(id).addEventListener('click', () => { ui[key] = !ui[key]; saveUi(); renderAll(); });
  }
  $('#btn-zoom-in').addEventListener('click', () => zoomStep(1));
  $('#btn-zoom-out').addEventListener('click', () => zoomStep(-1));
  el.zoomLabel.addEventListener('click', () => { setZoom(fitZoom()); centerView(); });
  el.undo.addEventListener('click', undo); el.redo.addEventListener('click', redo);

  // colours
  el.swatchP.addEventListener('click', () => el.colorInput.click());
  el.swatchS.addEventListener('click', () => { const tmp = ui.primary; ui.primary = ui.secondary; ui.secondary = tmp; saveUi(); renderPalette(); });
  $('#btn-swap').addEventListener('click', () => { const tmp = ui.primary; ui.primary = ui.secondary; ui.secondary = tmp; saveUi(); renderPalette(); });
  el.colorInput.addEventListener('input', () => setColor('primary', el.colorInput.value));
  $('#btn-add-color').addEventListener('click', () => {
    const c = ui.primary.toLowerCase();
    if (!state.doc.palette.includes(c)) { beginChange(); state.doc.palette.push(c); ui.paletteId = 'custom'; saveUi(); endChange(); }
  });
  el.paletteSelect.addEventListener('change', () => { ui.paletteId = el.paletteSelect.value; saveUi(); renderPalette(); });
  el.palette.addEventListener('auxclick', (e) => {
    const c = e.target?.dataset?.color;
    if (e.button === 1 && c && ui.paletteId === 'custom') { e.preventDefault(); beginChange(); state.doc.palette = state.doc.palette.filter((x) => x !== c); endChange(); }
  });

  // layers
  $('#btn-layer-add').addEventListener('click', () => { commitFloating(); beginChange(); M.addLayer(state.doc, { name: t('layers.new', { n: state.doc.layers.length + 1 }), at: state.layer + 1 }); state.layer += 1; endChange(); });
  $('#btn-layer-dup').addEventListener('click', () => { commitFloating(); beginChange(); const l = M.duplicateLayer(state.doc, state.layer); l.name = t('layers.copy', { name: state.doc.layers[state.layer].name }); state.layer += 1; endChange(); });
  $('#btn-layer-del').addEventListener('click', () => { commitFloating(); if (state.doc.layers.length <= 1) return; beginChange(); M.removeLayer(state.doc, state.layer); state.layer = Math.max(0, state.layer - 1); endChange(); });
  $('#btn-layer-up').addEventListener('click', () => { commitFloating(); beginChange(); if (M.moveLayer(state.doc, state.layer, state.layer + 1)) state.layer += 1; endChange(); });
  $('#btn-layer-down').addEventListener('click', () => { commitFloating(); beginChange(); if (M.moveLayer(state.doc, state.layer, state.layer - 1)) state.layer -= 1; endChange(); });
  $('#btn-layer-merge').addEventListener('click', () => { commitFloating(); if (state.layer <= 0) return; beginChange(); M.mergeDown(state.doc, state.layer); state.layer -= 1; endChange(); });
  el.layerOpacity.addEventListener('change', () => { beginChange(); activeLayer().opacity = Number(el.layerOpacity.value) / 100; endChange(); });
  el.layerOpacity.addEventListener('input', () => { activeLayer().opacity = Number(el.layerOpacity.value) / 100; render(); });
  const transform = (fn) => { commitFloating(); beginChange(); const f = state.doc.frames[state.frame]; f.cels[activeLayer().id] = fn(activeCel()); endChange(); };
  $('#btn-flip-h').addEventListener('click', () => transform((b) => R.flip(b, 'x')));
  $('#btn-flip-v').addEventListener('click', () => transform((b) => R.flip(b, 'y')));
  $('#btn-rot').addEventListener('click', () => {
    if (state.doc.width !== state.doc.height) { toast(getLang() === 'tr' ? 'Döndürme için kare tuval gerekir' : 'Rotation needs a square canvas'); return; }
    transform((b) => R.rotate90(b, true));
  });
  $('#btn-clear-layer').addEventListener('click', () => transform((b) => R.createBitmap(b.width, b.height)));

  // frames
  $('#btn-frame-add').addEventListener('click', () => { commitFloating(); beginChange(); state.frame = M.addFrame(state.doc, { at: state.frame + 1 }); endChange(); });
  $('#btn-frame-dup').addEventListener('click', () => { commitFloating(); beginChange(); state.frame = M.addFrame(state.doc, { at: state.frame + 1, duplicateOf: state.frame }); endChange(); });
  $('#btn-frame-del').addEventListener('click', () => { commitFloating(); if (state.doc.frames.length <= 1) return; beginChange(); M.removeFrame(state.doc, state.frame); state.frame = Math.max(0, state.frame - 1); endChange(); });
  $('#btn-frame-left').addEventListener('click', () => { commitFloating(); beginChange(); if (M.moveFrame(state.doc, state.frame, state.frame - 1)) state.frame -= 1; endChange(); });
  $('#btn-frame-right').addEventListener('click', () => { commitFloating(); beginChange(); if (M.moveFrame(state.doc, state.frame, state.frame + 1)) state.frame += 1; endChange(); });
  el.fps.addEventListener('change', () => { state.doc.fps = Math.max(1, Math.min(60, Number(el.fps.value) || 8)); el.fps.value = state.doc.fps; scheduleSave(); if (state.playing) { stopPlayback(); startPlayback(); } });
  el.play.addEventListener('click', () => (state.playing ? stopPlayback() : startPlayback()));

  // file
  el.docName.addEventListener('change', () => { state.doc.name = el.docName.value.trim() || 'untitled'; el.docName.value = state.doc.name; scheduleSave(); });
  $('#btn-new').addEventListener('click', openNew);
  $('#btn-open').addEventListener('click', () => el.fileOpen.click());
  el.fileOpen.addEventListener('change', () => { if (el.fileOpen.files[0]) importFile(el.fileOpen.files[0]); el.fileOpen.value = ''; });
  $('#btn-save').addEventListener('click', () => { exportAs('json'); toast(t('msg.saved')); });
  $('#btn-export').addEventListener('click', () => $('#dlg-export').showModal());
  $('#dlg-export').addEventListener('close', () => { if ($('#dlg-export').returnValue === 'ok') exportAs(document.querySelector('input[name="export-type"]:checked').value, Number($('#export-scale').value)); });
  $('#btn-resize').addEventListener('click', () => { $('#resize-w').value = state.doc.width; $('#resize-h').value = state.doc.height; $('#dlg-resize').showModal(); });
  $('#dlg-resize').addEventListener('close', () => {
    if ($('#dlg-resize').returnValue !== 'ok') return;
    const w = clampSize($('#resize-w').value), h = clampSize($('#resize-h').value);
    commitFloating(); beginChange(); M.resizeDoc(state.doc, w, h, $('#resize-anchor').value); state.sel = null; endChange(); centerView();
  });
  $('#btn-settings').addEventListener('click', () => { $('#set-lang').value = getLang(); $('#set-theme').value = ui.theme; $('#set-checker').checked = ui.checker; $('#dlg-settings').showModal(); });
  $('#set-lang').addEventListener('change', () => { ui.lang = $('#set-lang').value; setLang(ui.lang); saveUi(); applyI18n(); renderAll(); });
  $('#set-theme').addEventListener('change', () => { ui.theme = $('#set-theme').value; saveUi(); applyTheme(); renderOverlay(); });
  $('#set-checker').addEventListener('change', () => { ui.checker = $('#set-checker').checked; saveUi(); applyZoomCss(); });

  // drag & drop, paste
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) importFile(f); });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); importFile(item.getAsFile()); }
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName, type = e.target?.type;
    // Text fields, selects and open dialogs keep their keys; checkboxes, ranges and buttons don't block shortcuts.
    const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio', 'range'].includes(type));
    if (typing || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if ((k === ' ' || k === 'enter') && (tag === 'BUTTON' || tag === 'INPUT')) return; // let the control activate
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'a') { e.preventDefault(); commitFloating(); state.sel = { x0: 0, y0: 0, x1: state.doc.width - 1, y1: state.doc.height - 1 }; ui.tool = 'select'; renderAll(); }
      else if (k === 'c') { e.preventDefault(); copySelection(); }
      else if (k === 'v') { /* paste of images is handled by the paste event; pixels: */ if (state.clipboard) { e.preventDefault(); pasteClipboard(); } }
      else if (k === 's') { e.preventDefault(); exportAs('json'); toast(t('msg.saved')); }
      else if (k === 'd') { e.preventDefault(); commitFloating(); state.sel = null; render(); }
      return;
    }
    const tools = { b: 'pencil', e: 'eraser', g: 'fill', l: 'line', r: 'rect', o: 'ellipse', i: 'picker', m: 'select', h: 'pan' };
    if (tools[k]) { commitFloating(); ui.tool = tools[k]; saveUi(); renderAll(); return; }
    if (k === 'x') { const tmp = ui.primary; ui.primary = ui.secondary; ui.secondary = tmp; saveUi(); renderPalette(); }
    else if (k === '[') { ui.brush = Math.max(1, ui.brush - 1); saveUi(); renderAll(); }
    else if (k === ']') { ui.brush = Math.min(8, ui.brush + 1); saveUi(); renderAll(); }
    else if (k === '+' || k === '=') zoomStep(1);
    else if (k === '-') zoomStep(-1);
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelection(); }
    else if (k === 'escape') { commitFloating(); state.sel = null; render(); }
    else if (k === 'enter') { e.preventDefault(); state.playing ? stopPlayback() : startPlayback(); }
    else if (k === ',') { commitFloating(); state.frame = (state.frame - 1 + state.doc.frames.length) % state.doc.frames.length; renderAll(); }
    else if (k === '.') { commitFloating(); state.frame = (state.frame + 1) % state.doc.frames.length; renderAll(); }
    else if (k === ' ') { e.preventDefault(); state.space = true; el.viewport.style.cursor = 'grab'; }
    else if (/^[1-9]$/.test(k)) { const c = el.palette.children[Number(k) - 1]; if (c) setColor('primary', c.dataset.color); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { state.space = false; el.viewport.style.cursor = ''; } });
  window.addEventListener('resize', () => renderOverlay());
  window.addEventListener('pagehide', () => { commitFloating(); store.save('doc', M.serialize(state.doc)); });

  // install prompt + service worker
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); state.installPrompt = ev; el.install.hidden = false; });
  el.install.addEventListener('click', async () => { state.installPrompt?.prompt(); await state.installPrompt?.userChoice.catch(() => {}); el.install.hidden = true; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

const clampSize = (v) => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(v) || 1)));
function openNew() {
  const dlg = $('#dlg-new');
  $('#new-presets').replaceChildren(...[8, 16, 32, 48, 64, 96, 128].map((n) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = `${n}×${n}`;
    b.addEventListener('click', () => { $('#new-w').value = n; $('#new-h').value = n; });
    return b;
  }));
  $('#new-w').value = state.doc.width; $('#new-h').value = state.doc.height;
  dlg.showModal();
}
$('#dlg-new').addEventListener('close', () => {
  if ($('#dlg-new').returnValue !== 'ok') return;
  const dirty = state.doc.frames.some((f) => Object.values(f.cels).some((c) => c.data.some((v) => v !== 0)));
  if (dirty && !confirm(t('new.confirm'))) return;
  newDoc(clampSize($('#new-w').value), clampSize($('#new-h').value));
});

// ---------- boot ----------
function boot() {
  setLang(ui.lang ?? detectLang());
  applyTheme();
  const saved = store.load('doc', null);
  try { state.doc = saved ? M.deserialize(saved) : M.createDoc({ width: 32, height: 32 }); } catch { state.doc = M.createDoc({ width: 32, height: 32 }); }
  if (!ZOOMS.includes(ui.zoom)) ui.zoom = 8;
  applyI18n();
  bind();
  renderAll();
  if (!saved) { ui.zoom = fitZoom(); applyZoomCss(); render(); }
  centerView();
  // test hook
  window.__px = {
    state, ui, doc: () => state.doc,
    pixel: (x, y, layer = state.layer) => R.getPixel(M.getCel(state.doc, state.frame, state.doc.layers[layer].id), x, y),
    composite: (x, y) => { const c = M.compositeFrame(state.doc, state.frame); const i = (y * state.doc.width + x) * 4; return [c[i], c[i + 1], c[i + 2], c[i + 3]]; },
    encodeGif, R, M,
  };
}
boot();
