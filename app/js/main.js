// UI controller: wires the pure core (raster, model, select, fx, sheet, palette-io, gif) to the DOM.
import * as R from './raster.js';
import * as M from './model.js';
import * as S from './select.js';
import * as FX from './fx.js';
import * as SH from './sheet.js';
import * as PIO from './palette-io.js';
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
  viewport: $('#viewport'), stage: $('#stage'), canvas: $('#canvas'), overlay: $('#overlay'), preview: $('#preview'), previewCanvas: $('#preview-canvas'),
  docName: $('#doc-name'), zoomLabel: $('#zoom-label'), ctx: $('#ctx'), ctxHint: $('#ctx-hint'),
  brushSize: $('#brush-size'), brushLabel: $('#brush-size-label'), brushShape: $('#brush-shape'), optPP: $('#opt-pp'), ink: $('#ink'), inkOpacity: $('#ink-opacity'), inkOpacityLabel: $('#ink-opacity-label'),
  optFill: $('#opt-fill'), optContig: $('#opt-contiguous'), tolerance: $('#tolerance'), toleranceLabel: $('#tolerance-label'), dither: $('#dither'),
  sprayWidth: $('#spray-width'), sprayWidthLabel: $('#spray-width-label'), spraySpeed: $('#spray-speed'), spraySpeedLabel: $('#spray-speed-label'), selMode: $('#sel-mode'),
  swatchP: $('#swatch-primary'), swatchS: $('#swatch-secondary'), colorInput: $('#color-input'), colorHex: $('#color-hex'), hsvH: $('#hsv-h'), hsvS: $('#hsv-s'), hsvV: $('#hsv-v'),
  paletteSelect: $('#palette-select'), palette: $('#palette'),
  layers: $('#layers'), layerOpacity: $('#layer-opacity'), frames: $('#frames'), tags: $('#tags'), fps: $('#fps'), play: $('#btn-play'),
  pos: $('#status-pos'), size: $('#status-size'), statusFrame: $('#status-frame'), statusSel: $('#status-sel'), toast: $('#toast'), undo: $('#btn-undo'), redo: $('#btn-redo'),
  fileOpen: $('#file-open'), fileSheet: $('#file-sheet'), filePalette: $('#file-palette'), install: $('#btn-install'), menubar: $('#menubar'), popup: $('#menu-popup'),
};
const ctx = el.canvas.getContext('2d');
const octx = el.overlay.getContext('2d');

const ui = {
  lang: null, theme: 'dark', checker: true, zoom: 8, tool: 'pencil',
  brush: 1, brushShape: 'square', pp: false, ink: 'simple', opacity: 255, filled: false, contiguous: true, tolerance: 0, dither: 'none', sprayWidth: 6, spraySpeed: 10, selMode: 'replace',
  grid: true, gridW: 8, gridH: 8, gridX: 0, gridY: 0, snap: false, onion: false, onionPrev: 1, onionNext: 1, symx: false, symy: false, tiled: 'none', preview: false, hideui: false,
  primary: '#f2ede2', secondary: '#0d0a1f', paletteId: 'pico8',
  ...store.load('ui', {}),
};

const state = {
  doc: null, frame: 0, layer: 0, history: new History(80),
  drag: null, sel: null, lastSel: null, floating: null, clipboard: null, hover: null,
  playing: null, playTag: null, playDir: { dir: 1 }, previewTimer: null, previewFrame: 0,
  space: false, alt: false, ctrl: false, panning: null, poly: null, lastPoint: null, sprayTimer: null,
  saveTimer: 0, installPrompt: null, menuOpen: null,
};

const fg = () => R.hexToRgba(ui.primary);
const bg = () => R.hexToRgba(ui.secondary);
const activeLayer = () => state.doc.layers[state.layer];
const activeCel = () => M.getCel(state.doc, state.frame, activeLayer().id);
const sym = () => ({ x: ui.symx, y: ui.symy });
const W = () => state.doc.width, H = () => state.doc.height;
const tileOX = () => (ui.tiled === 'both' || ui.tiled === 'x' ? W() : 0);
const tileOY = () => (ui.tiled === 'both' || ui.tiled === 'y' ? H() : 0);
const canvasW = () => W() * (tileOX() ? 3 : 1), canvasH = () => H() * (tileOY() ? 3 : 1);
const inkOpts = (button = 0) => ({ ink: ui.ink, opacity: ui.opacity, shading: currentPaletteColors(), direction: button === 2 ? -1 : 1 });
const brushOpts = (button = 0) => ({ size: ui.brush, shape: ui.brushShape, sym: sym(), ...inkOpts(button) });

// ---------- persistence ----------
function saveUi() { store.save('ui', ui); }
function scheduleSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => store.save('doc', M.serialize(state.doc)), 400); }

// ---------- history ----------
function beginChange() { state.history.push(M.snapshot(state.doc)); }
function endChange() { scheduleSave(); renderAll(); }
function undo() { commitFloating(); const s = state.history.undo(M.snapshot(state.doc)); if (s) { state.doc = s; clampIndices(); endChange(); } }
function redo() { commitFloating(); const s = state.history.redo(M.snapshot(state.doc)); if (s) { state.doc = s; clampIndices(); endChange(); } }
function clampIndices() {
  state.frame = Math.min(state.frame, state.doc.frames.length - 1);
  state.layer = Math.min(state.layer, state.doc.layers.length - 1);
  if (state.sel && (state.sel.width !== W() || state.sel.height !== H())) state.sel = null;
}
function guardLocked() { if (activeLayer().locked) { toast(t('msg.locked')); return false; } return true; }

// ---------- coordinates ----------
function pixelFromEvent(ev, { wrap = true } = {}) {
  const rect = el.canvas.getBoundingClientRect();
  let x = Math.floor((ev.clientX - rect.left) / ui.zoom) - tileOX(), y = Math.floor((ev.clientY - rect.top) / ui.zoom) - tileOY();
  if (wrap && ui.tiled !== 'none') { if (tileOX()) x = ((x % W()) + W()) % W(); if (tileOY()) y = ((y % H()) + H()) % H(); }
  return [x, y];
}
const inDoc = (x, y) => x >= 0 && y >= 0 && x < W() && y < H();
const clampPt = (x, y) => [Math.max(0, Math.min(W() - 1, x)), Math.max(0, Math.min(H() - 1, y))];
const snapPt = (x, y) => (ui.snap ? [Math.round((x - ui.gridX) / ui.gridW) * ui.gridW + ui.gridX, Math.round((y - ui.gridY) / ui.gridH) * ui.gridH + ui.gridY] : [x, y]);

// ---------- rendering ----------
function frameImage(fi) {
  const d = state.doc, img = new ImageData(M.compositeFrame(d, fi), d.width, d.height);
  if (fi === state.frame && state.floating) {
    const f = state.floating;
    for (let j = 0; j < f.bitmap.height; j++) for (let i = 0; i < f.bitmap.width; i++) {
      if (f.mask && !f.mask.data[j * f.bitmap.width + i]) continue;
      const p = R.getPixel(f.bitmap, i, j), x = f.x + i, y = f.y + j;
      if (p[3] > 0 && inDoc(x, y)) img.data.set(p, (y * d.width + x) * 4);
    }
  }
  return img;
}
function render() {
  const d = state.doc, cw = canvasW(), ch = canvasH();
  if (el.canvas.width !== cw || el.canvas.height !== ch) { el.canvas.width = cw; el.canvas.height = ch; applyZoomCss(); }
  const img = frameImage(state.frame);
  ctx.clearRect(0, 0, cw, ch);
  const tmp = document.createElement('canvas'); tmp.width = d.width; tmp.height = d.height; tmp.getContext('2d').putImageData(img, 0, 0);
  for (let ty = 0; ty < (tileOY() ? 3 : 1); ty++) for (let tx = 0; tx < (tileOX() ? 3 : 1); tx++) ctx.drawImage(tmp, tx * d.width, ty * d.height);
  renderOverlay();
}
function applyZoomCss() {
  const w = canvasW() * ui.zoom, h = canvasH() * ui.zoom;
  el.stage.style.width = `${w}px`; el.stage.style.height = `${h}px`;
  el.canvas.style.width = `${w}px`; el.canvas.style.height = `${h}px`;
  el.overlay.style.width = `${w}px`; el.overlay.style.height = `${h}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.overlay.width = Math.round(w * dpr); el.overlay.height = Math.round(h * dpr);
  el.zoomLabel.textContent = `${ui.zoom * 100}%`;
  el.stage.classList.toggle('checker', ui.checker);
  el.viewport.dataset.tool = ui.tool;
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function mirrored(x, y) {
  const out = [[x, y]];
  if (ui.symx) out.push([W() - 1 - x, y]);
  if (ui.symy) out.push([x, H() - 1 - y]);
  if (ui.symx && ui.symy) out.push([W() - 1 - x, H() - 1 - y]);
  return out;
}
function renderOverlay() {
  const d = state.doc, z = ui.zoom, dpr = el.overlay.width / (canvasW() * z);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, canvasW() * z, canvasH() * z);
  octx.imageSmoothingEnabled = false;
  const ox = tileOX() * z, oy = tileOY() * z;
  // dim the tiled copies slightly
  if (ui.tiled !== 'none') { octx.fillStyle = 'rgba(0,0,0,.25)'; octx.fillRect(0, 0, canvasW() * z, canvasH() * z); octx.clearRect(ox, oy, d.width * z, d.height * z); }
  // onion skin
  if (ui.onion && d.frames.length > 1) {
    for (let k = 1; k <= ui.onionPrev; k++) drawGhost(state.frame - k, 0.4 / k, '#ff5a7a');
    for (let k = 1; k <= ui.onionNext; k++) drawGhost(state.frame + k, 0.3 / k, '#43d9e8');
  }
  function drawGhost(fi, alpha, tint) {
    if (fi < 0 || fi >= d.frames.length) return;
    const tmp = document.createElement('canvas'); tmp.width = d.width; tmp.height = d.height;
    const c2 = tmp.getContext('2d'); c2.putImageData(new ImageData(M.compositeFrame(d, fi), d.width, d.height), 0, 0);
    c2.globalCompositeOperation = 'source-atop'; c2.fillStyle = tint; c2.globalAlpha = .5; c2.fillRect(0, 0, d.width, d.height);
    octx.globalAlpha = alpha; octx.drawImage(tmp, ox, oy, d.width * z, d.height * z); octx.globalAlpha = 1;
  }
  // grid
  if (ui.grid && z >= 4) {
    octx.lineWidth = 1;
    const gw = Math.max(1, ui.gridW), gh = Math.max(1, ui.gridH);
    if (z >= 8) { octx.strokeStyle = cssVar('--grid'); for (let x = 1; x < canvasW(); x++) line(x * z + .5, 0, x * z + .5, canvasH() * z); for (let y = 1; y < canvasH(); y++) line(0, y * z + .5, canvasW() * z, y * z + .5); }
    octx.strokeStyle = cssVar('--grid-major');
    for (let x = ((ui.gridX % gw) + gw) % gw; x <= canvasW(); x += gw) if (x > 0 && x < canvasW()) line(x * z + .5, 0, x * z + .5, canvasH() * z);
    for (let y = ((ui.gridY % gh) + gh) % gh; y <= canvasH(); y += gh) if (y > 0 && y < canvasH()) line(0, y * z + .5, canvasW() * z, y * z + .5);
  }
  function line(a, b, c, e) { octx.beginPath(); octx.moveTo(a, b); octx.lineTo(c, e); octx.stroke(); }
  // symmetry axes
  octx.setLineDash([4, 4]); octx.strokeStyle = cssVar('--c-blue'); octx.lineWidth = 1;
  if (ui.symx) line(ox + (d.width * z) / 2, oy, ox + (d.width * z) / 2, oy + d.height * z);
  if (ui.symy) line(ox, oy + (d.height * z) / 2, ox + d.width * z, oy + (d.height * z) / 2);
  octx.setLineDash([]);
  // shape / polygon preview
  const drag = state.drag;
  const previewColor = drag?.button === 2 ? ui.secondary : ui.primary;
  if (drag && ['line', 'rect', 'ellipse'].includes(drag.tool)) drawPts(shapePoints(drag), previewColor);
  if (drag && drag.tool === 'lasso') drawPath(drag.pts, previewColor, true);
  if (drag && drag.tool === 'contour') drawPath(drag.pts, previewColor, true);
  if (state.poly) { drawPath(state.poly.pts.concat(state.hover ? [state.hover] : []), ui.primary, false); }
  if (drag && drag.tool === 'gradient') { octx.strokeStyle = '#fff'; octx.lineWidth = 2; line(ox + (drag.x0 + .5) * z, oy + (drag.y0 + .5) * z, ox + (drag.x + .5) * z, oy + (drag.y + .5) * z); }
  if (drag && (drag.tool === 'marquee' || drag.tool === 'ellipsemarquee') && drag.mode === 'draw') {
    const m = drag.tool === 'marquee' ? S.maskFromRect(d.width, d.height, { x0: drag.x0, y0: drag.y0, x1: drag.x, y1: drag.y }) : S.maskFromEllipse(d.width, d.height, { x0: drag.x0, y0: drag.y0, x1: drag.x, y1: drag.y });
    drawAnts(m);
  } else if (state.sel) drawAnts(state.sel);
  function drawPts(pts, color) { octx.fillStyle = color; octx.globalAlpha = .85; for (const [x, y] of pts) for (const [tx, ty] of mirrored(x, y)) for (const [dx, dy] of R.brushOffsets(ui.brush, ui.brushShape)) octx.fillRect(ox + (tx + dx) * z, oy + (ty + dy) * z, z, z); octx.globalAlpha = 1; }
  function drawPath(pts, color, close) { if (pts.length < 2) return; octx.strokeStyle = color; octx.lineWidth = 2; octx.beginPath(); pts.forEach(([x, y], i) => (i ? octx.lineTo(ox + (x + .5) * z, oy + (y + .5) * z) : octx.moveTo(ox + (x + .5) * z, oy + (y + .5) * z))); if (close) octx.closePath(); octx.stroke(); }
  function drawAnts(m) {
    const segs = S.maskEdges(m);
    octx.lineWidth = 2;
    for (const [color, off] of [['#000', 0], [cssVar('--sel'), 5]]) {
      octx.strokeStyle = color; octx.setLineDash([6, 4]); octx.lineDashOffset = off; octx.beginPath();
      for (const [x0, y0, x1, y1] of segs) { octx.moveTo(ox + x0 * z, oy + y0 * z); octx.lineTo(ox + x1 * z, oy + y1 * z); }
      octx.stroke();
    }
    octx.setLineDash([]); octx.lineDashOffset = 0;
  }
  // hover brush preview
  if (state.hover && !drag && ['pencil', 'eraser', 'line', 'rect', 'ellipse', 'spray', 'blur', 'contour', 'polygon'].includes(ui.tool)) {
    octx.strokeStyle = cssVar('--fg'); octx.lineWidth = 1; octx.globalAlpha = .7;
    for (const [dx, dy] of R.brushOffsets(ui.brush, ui.brushShape)) octx.strokeRect(ox + (state.hover[0] + dx) * z + .5, oy + (state.hover[1] + dy) * z + .5, z - 1, z - 1);
    octx.globalAlpha = 1;
  }
}

function currentPaletteColors() {
  if (ui.paletteId === 'custom') return state.doc.palette;
  return (PALETTES.find((p) => p.id === ui.paletteId) ?? PALETTES[0]).colors;
}
function renderPalette() {
  const colors = currentPaletteColors();
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
  el.colorInput.value = ui.primary.slice(0, 7); el.colorHex.value = ui.primary;
  const [h, s, v] = FX.rgbToHsv(...R.hexToRgba(ui.primary).slice(0, 3));
  if (document.activeElement !== el.hsvH) el.hsvH.value = Math.round(h);
  if (document.activeElement !== el.hsvS) el.hsvS.value = Math.round(s * 100);
  if (document.activeElement !== el.hsvV) el.hsvV.value = Math.round(v * 100);
}
function setColor(which, hex) { ui[which] = hex.toLowerCase(); saveUi(); renderPalette(); }

function renderLayers() {
  const d = state.doc;
  el.layers.replaceChildren(...[...d.layers].reverse().map((l, ri) => {
    const i = d.layers.length - 1 - ri;
    const li = document.createElement('li');
    li.className = 'layer' + (l.visible ? '' : ' hidden'); li.setAttribute('aria-selected', String(i === state.layer)); li.dataset.index = i;
    const eye = document.createElement('button'); eye.className = 'eye'; eye.type = 'button'; eye.textContent = '👁'; eye.setAttribute('aria-pressed', String(l.visible)); eye.title = t('layer.visible');
    eye.addEventListener('click', (e) => { e.stopPropagation(); beginChange(); l.visible = !l.visible; endChange(); });
    const lock = document.createElement('button'); lock.className = 'lock'; lock.type = 'button'; lock.textContent = '🔒'; lock.setAttribute('aria-pressed', String(Boolean(l.locked))); lock.title = t('layer.lock');
    lock.addEventListener('click', (e) => { e.stopPropagation(); beginChange(); l.locked = !l.locked; endChange(); });
    const th = document.createElement('canvas'); th.width = d.width; th.height = d.height;
    th.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(M.getCel(d, state.frame, l.id).data), d.width, d.height), 0, 0);
    const name = document.createElement('span'); name.className = 'name'; name.textContent = l.name;
    li.append(eye, lock, th, name);
    li.addEventListener('click', () => { commitFloating(); state.layer = i; renderLayers(); });
    li.addEventListener('dblclick', () => commands.layerProps());
    return li;
  }));
  el.layerOpacity.value = Math.round(activeLayer().opacity * 100);
  $('#btn-layer-del').disabled = d.layers.length <= 1;
  $('#btn-layer-merge').disabled = state.layer <= 0;
  $('#btn-layer-up').disabled = state.layer >= d.layers.length - 1;
  $('#btn-layer-down').disabled = state.layer <= 0;
}

const FRAME_W = 56, FRAME_GAP = 6;
function renderFrames() {
  const d = state.doc;
  el.frames.replaceChildren(...d.frames.map((f, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'frame'; b.setAttribute('aria-selected', String(i === state.frame)); b.dataset.index = i;
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
    c.getContext('2d').putImageData(new ImageData(M.compositeFrame(d, i), d.width, d.height), 0, 0);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    const dur = document.createElement('span'); dur.className = 'dur'; dur.textContent = `${f.duration ?? Math.round(1000 / d.fps)}`;
    b.append(c, n, dur);
    b.addEventListener('click', () => { commitFloating(); state.frame = i; renderAll(); });
    b.addEventListener('dblclick', () => commands.frameProps());
    return b;
  }));
  el.tags.replaceChildren(...(d.tags ?? []).map((tag) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tag'; b.textContent = tag.name; b.style.background = tag.color; b.title = `${tag.name} ${tag.from + 1}–${tag.to + 1} (${tag.direction})`;
    b.style.left = `${tag.from * (FRAME_W + FRAME_GAP)}px`; b.style.width = `${(tag.to - tag.from + 1) * (FRAME_W + FRAME_GAP) - FRAME_GAP}px`;
    b.setAttribute('aria-pressed', String(state.playTag?.id === tag.id)); b.dataset.id = tag.id;
    b.addEventListener('click', () => { state.playTag = state.playTag?.id === tag.id ? null : tag; renderFrames(); });
    b.addEventListener('dblclick', () => commands.tagProps(tag));
    return b;
  }));
  el.fps.value = d.fps;
  el.statusFrame.textContent = `${state.frame + 1}/${d.frames.length}`;
  $('#btn-frame-del').disabled = d.frames.length <= 1;
  $('#btn-frame-left').disabled = state.frame <= 0;
  $('#btn-frame-right').disabled = state.frame >= d.frames.length - 1;
}

function renderCtx() {
  $$('#ctx .c[data-tools]').forEach((c) => { c.hidden = !c.dataset.tools.split(' ').includes(ui.tool); });
  el.brushSize.value = ui.brush; el.brushLabel.textContent = ui.brush; el.brushShape.value = ui.brushShape; el.optPP.checked = ui.pp;
  el.ink.value = ui.ink; el.inkOpacity.value = ui.opacity; el.inkOpacityLabel.textContent = ui.opacity; el.optFill.checked = ui.filled;
  el.optContig.checked = ui.contiguous; el.tolerance.value = ui.tolerance; el.toleranceLabel.textContent = ui.tolerance; el.dither.value = ui.dither;
  el.sprayWidth.value = ui.sprayWidth; el.sprayWidthLabel.textContent = ui.sprayWidth; el.spraySpeed.value = ui.spraySpeed; el.spraySpeedLabel.textContent = ui.spraySpeed; el.selMode.value = ui.selMode;
  const hints = { polylasso: 'hint.polylasso', polygon: 'hint.polygon', pencil: 'hint.pencil', rect: 'hint.shape', ellipse: 'hint.shape', line: 'hint.shape', gradient: 'hint.gradient', wand: 'hint.wand', move: 'hint.move', zoom: 'hint.zoom' };
  el.ctxHint.textContent = hints[ui.tool] ? t(hints[ui.tool]) : '';
}

function renderAll() {
  applyZoomCss(); render(); renderLayers(); renderFrames(); renderPalette(); renderCtx();
  el.size.textContent = `${W()} × ${H()}`;
  el.docName.value = state.doc.name;
  el.undo.disabled = !state.history.canUndo; el.redo.disabled = !state.history.canRedo;
  const b = state.sel ? S.maskBounds(state.sel) : null;
  el.statusSel.textContent = b ? `${b.w}×${b.h}` : '';
  for (const [id, key] of [['#tg-grid', 'grid'], ['#tg-onion', 'onion'], ['#tg-symx', 'symx'], ['#tg-symy', 'symy']]) $(id).setAttribute('aria-pressed', String(ui[key]));
  $$('.tool').forEach((b2) => b2.setAttribute('aria-pressed', String(b2.dataset.tool === ui.tool)));
  document.body.dataset.hideui = String(ui.hideui);
  el.preview.hidden = !ui.preview;
  if (ui.preview) renderPreviewFrame();
}

// ---------- selection helpers ----------
function selMode(ev) {
  if (ev?.shiftKey && ev?.altKey) return 'subtract';
  if (ev?.shiftKey && (ev?.ctrlKey || ev?.metaKey)) return 'intersect';
  if (ev?.shiftKey) return 'add';
  return ui.selMode;
}
function applySelection(mask, mode) {
  const prev = state.sel;
  let next = mask;
  if (mode === 'add' && prev) next = S.maskUnion(prev, mask);
  else if (mode === 'subtract') next = prev ? S.maskSubtract(prev, mask) : S.createMask(W(), H());
  else if (mode === 'intersect') next = prev ? S.maskIntersect(prev, mask) : S.createMask(W(), H());
  state.sel = S.maskIsEmpty(next) ? null : next;
  if (state.sel) state.lastSel = state.sel;
}
function selectAll() { commitFloating(); state.sel = S.createMask(W(), H(), 1); state.lastSel = state.sel; renderAll(); }
function deselect() { commitFloating(); if (state.sel) state.lastSel = state.sel; state.sel = null; renderAll(); }
function insideSel(x, y) { return state.sel && S.maskGet(state.sel, x, y); }
function liftSelection() {
  const f = S.extractMasked(activeCel(), state.sel, { clear: true });
  if (f) state.floating = f;
}
function liftLayer() {
  const cel = activeCel();
  state.floating = { bitmap: R.cloneBitmap(cel), mask: null, x: 0, y: 0 };
  cel.data.fill(0);
}
function commitFloating(keep = true) {
  if (!state.floating) return;
  const f = state.floating, cel = activeCel();
  if (keep) {
    for (let j = 0; j < f.bitmap.height; j++) for (let i = 0; i < f.bitmap.width; i++) {
      if (f.mask && !f.mask.data[j * f.bitmap.width + i]) continue;
      const p = R.getPixel(f.bitmap, i, j);
      if (p[3] > 0) R.setPixel(cel, f.x + i, f.y + j, p);
    }
  }
  state.floating = null;
  if (keep) scheduleSave();
  render();
}
function selectionOrAll() { return state.sel ?? S.createMask(W(), H(), 1); }
function paintMasked(mask, rgba, button = 0) {
  const cel = activeCel();
  for (let y = 0; y < H(); y++) for (let x = 0; x < W(); x++) if (mask.data[y * W() + x]) R.paintPixel(cel, x, y, rgba, inkOpts(button));
}

// ---------- tools ----------
function shapePoints(drag) {
  let [x0, y0] = clampPt(...snapPt(drag.x0, drag.y0)), [x1, y1] = clampPt(...snapPt(drag.x, drag.y));
  if (drag.shift) { // square / 45°
    const dx = x1 - x0, dy = y1 - y0, m = Math.max(Math.abs(dx), Math.abs(dy));
    if (drag.tool === 'line') { if (Math.abs(dx) > 2 * Math.abs(dy)) y1 = y0; else if (Math.abs(dy) > 2 * Math.abs(dx)) x1 = x0; else { x1 = x0 + Math.sign(dx) * m; y1 = y0 + Math.sign(dy) * m; } }
    else { x1 = x0 + Math.sign(dx || 1) * m; y1 = y0 + Math.sign(dy || 1) * m; }
    [x1, y1] = clampPt(x1, y1);
  }
  if (drag.ctrl && drag.tool !== 'line') { const dx = x1 - x0, dy = y1 - y0; [x0, y0] = clampPt(x0 - dx, y0 - dy); }
  if (drag.tool === 'line') return R.linePoints(x0, y0, x1, y1);
  if (drag.tool === 'rect') return R.rectPoints(x0, y0, x1, y1, ui.filled);
  return R.ellipsePoints(x0, y0, x1, y1, ui.filled);
}
function paintPoints(points, rgba, button = 0, size = ui.brush) {
  const cel = activeCel(), opts = { ...brushOpts(button), size };
  for (const [x, y] of points) R.stampInk(cel, x, y, rgba, opts);
}
function erasePoints(points) {
  const cel = activeCel();
  for (const [x, y] of points) for (const [tx, ty] of mirrored(x, y)) for (const [dx, dy] of R.brushOffsets(ui.brush, ui.brushShape)) {
    const p = R.getPixel(cel, tx + dx, ty + dy);
    if (!p) continue;
    R.setPixel(cel, tx + dx, ty + dy, ui.opacity >= 255 ? R.TRANSPARENT : [p[0], p[1], p[2], Math.max(0, p[3] - ui.opacity)]);
  }
}
function blurPoints(points, base) {
  const cel = activeCel();
  for (const [x, y] of points) for (const [dx, dy] of R.brushOffsets(ui.brush, ui.brushShape)) {
    const px = x + dx, py = y + dy;
    if (!inDoc(px, py)) continue;
    const acc = [0, 0, 0, 0];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const p = R.getPixel(base, Math.max(0, Math.min(W() - 1, px + i)), Math.max(0, Math.min(H() - 1, py + j))); for (let c = 0; c < 4; c++) acc[c] += p[c]; }
    R.setPixel(cel, px, py, acc.map((v) => Math.round(v / 9)));
  }
}
function finishPolygon(close = true) {
  const poly = state.poly;
  state.poly = null;
  if (!poly || poly.pts.length < (poly.tool === 'polylasso' ? 3 : 2)) { render(); return; }
  if (poly.tool === 'polylasso') { applySelection(S.maskFromPolygon(W(), H(), poly.pts), poly.mode); renderAll(); return; }
  if (!guardLocked()) return;
  beginChange();
  if (ui.filled && poly.pts.length >= 3) { const m = S.maskFromPolygon(W(), H(), poly.pts); paintMasked(m, fg(), 0); }
  else { const pts = []; for (let i = 0; i < poly.pts.length - (close ? 0 : 1); i++) { const a = poly.pts[i], b = poly.pts[(i + 1) % poly.pts.length]; pts.push(...R.linePoints(a[0], a[1], b[0], b[1])); } paintPoints(pts, fg(), 0); }
  endChange();
}

function onPointerDown(ev) {
  if (state.playing) stopPlayback();
  closeMenu();
  el.viewport.focus?.();
  const [x, y] = pixelFromEvent(ev);
  let tool = ui.tool;
  if (state.alt) tool = 'picker';
  if (state.ctrl && !ev.shiftKey && tool !== 'zoom') tool = 'move';
  if (ev.button === 1 || state.space || tool === 'pan') { state.panning = { x: ev.clientX, y: ev.clientY, sl: el.viewport.scrollLeft, st: el.viewport.scrollTop }; el.viewport.classList.add('panning'); el.viewport.setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
  if (ev.button !== 0 && ev.button !== 2) return;
  ev.preventDefault();
  el.viewport.setPointerCapture(ev.pointerId);
  const button = ev.button, color = button === 2 ? bg() : fg();
  const mods = { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey, alt: ev.altKey };

  if (tool === 'picker') { pick(x, y, button === 2 ? 'secondary' : 'primary'); return; }
  if (tool === 'zoom') { zoomStep(button === 2 ? -1 : 1, { x: ev.clientX, y: ev.clientY }); return; }
  if (tool === 'polylasso' || tool === 'polygon') {
    if (!inDoc(x, y)) return;
    if (!state.poly) state.poly = { tool, pts: [], mode: selMode(ev) };
    const last = state.poly.pts[state.poly.pts.length - 1];
    if (last && last[0] === x && last[1] === y && ev.detail >= 2) { finishPolygon(); return; }
    state.poly.pts.push([x, y]);
    if (ev.detail >= 2 && state.poly.pts.length > 2) finishPolygon();
    render(); return;
  }
  if (tool === 'marquee' || tool === 'ellipsemarquee' || tool === 'lasso') {
    if (state.sel && insideSel(x, y) && !ev.shiftKey && !ev.altKey) {
      if (!guardLocked()) return;
      if (!state.floating) { beginChange(); liftSelection(); }
      state.drag = { tool: 'movesel', x0: x, y0: y, x, y, fx: state.floating.x, fy: state.floating.y, sel0: state.sel };
      return;
    }
    commitFloating();
    state.drag = { tool, mode: 'draw', x0: x, y0: y, x, y, pts: [[x, y]], selmode: selMode(ev), ...mods };
    render(); return;
  }
  if (tool === 'wand') {
    if (!inDoc(x, y)) return;
    commitFloating();
    applySelection(S.maskFromWand(activeCel(), x, y, { contiguous: ui.contiguous, tolerance: ui.tolerance }), selMode(ev));
    renderAll(); return;
  }
  if (tool === 'move') {
    if (!guardLocked()) return;
    if (!state.floating) { beginChange(); if (state.sel) liftSelection(); else liftLayer(); if (!state.floating) return; }
    state.drag = { tool: 'movesel', x0: x, y0: y, x, y, fx: state.floating.x, fy: state.floating.y, sel0: state.sel };
    return;
  }
  // painting tools below
  if (!guardLocked()) return;
  commitFloating();
  if (tool === 'fill') {
    if (!inDoc(x, y)) return;
    beginChange();
    for (const [tx, ty] of mirrored(x, y)) {
      let m = S.maskFromWand(activeCel(), tx, ty, { contiguous: ui.contiguous, tolerance: ui.tolerance });
      if (state.sel) m = S.maskIntersect(m, state.sel);
      paintMasked(m, color, button);
    }
    endChange(); return;
  }
  if (tool === 'pencil') {
    beginChange();
    const pts = mods.shift && state.lastPoint ? R.linePoints(state.lastPoint[0], state.lastPoint[1], x, y) : [[x, y]];
    state.drag = { tool, x0: x, y0: y, x, y, button, rgba: color, pts: [...pts], base: ui.pp ? R.cloneBitmap(activeCel()) : null, last: [x, y] };
    paintPoints(ui.pp ? R.pixelPerfect(pts) : pts, color, button);
    state.lastPoint = [x, y];
    render(); return;
  }
  if (tool === 'eraser') { beginChange(); state.drag = { tool, x0: x, y0: y, x, y, last: [x, y] }; erasePoints([[x, y]]); render(); return; }
  if (tool === 'blur') { beginChange(); state.drag = { tool, x0: x, y0: y, x, y, last: [x, y], base: R.cloneBitmap(activeCel()) }; blurPoints([[x, y]], state.drag.base); render(); return; }
  if (tool === 'spray') {
    beginChange();
    state.drag = { tool, x0: x, y0: y, x, y, button, rgba: color };
    const spray = () => { if (!state.drag) return; paintPoints(R.sprayPoints(state.drag.x, state.drag.y, ui.sprayWidth, Math.ceil(ui.spraySpeed / 4)).filter(([px, py]) => inDoc(px, py)), state.drag.rgba, state.drag.button, 1); render(); };
    spray(); state.sprayTimer = setInterval(spray, 60); return;
  }
  if (tool === 'contour') { beginChange(); state.drag = { tool, x0: x, y0: y, x, y, button, rgba: color, pts: [[x, y]] }; render(); return; }
  if (tool === 'gradient') { state.drag = { tool, x0: x, y0: y, x, y, button }; render(); return; }
  if (['line', 'rect', 'ellipse'].includes(tool)) { state.drag = { tool, x0: x, y0: y, x, y, button, rgba: color, ...mods }; render(); }
}

function onPointerMove(ev) {
  if (state.panning) { el.viewport.scrollLeft = state.panning.sl - (ev.clientX - state.panning.x); el.viewport.scrollTop = state.panning.st - (ev.clientY - state.panning.y); return; }
  const [x, y] = pixelFromEvent(ev);
  state.hover = inDoc(x, y) ? [x, y] : null;
  el.pos.textContent = `${Math.max(0, Math.min(W() - 1, x))}, ${Math.max(0, Math.min(H() - 1, y))}`;
  const drag = state.drag;
  if (!drag) { renderOverlay(); return; }
  drag.x = x; drag.y = y; drag.shift = ev.shiftKey; drag.ctrl = ev.ctrlKey || ev.metaKey;
  if (drag.tool === 'pencil') {
    const [lx, ly] = drag.last;
    if (lx === x && ly === y) return;
    const seg = R.linePoints(lx, ly, x, y).slice(1);
    drag.last = [x, y];
    if (ui.pp) { drag.pts.push(...seg); activeCel().data.set(drag.base.data); paintPoints(R.pixelPerfect(drag.pts), drag.rgba, drag.button); }
    else paintPoints(seg, drag.rgba, drag.button);
    state.lastPoint = [x, y];
    render(); return;
  }
  if (drag.tool === 'eraser' || drag.tool === 'blur') {
    const [lx, ly] = drag.last; if (lx === x && ly === y) return;
    const seg = R.linePoints(lx, ly, x, y).slice(1); drag.last = [x, y];
    if (drag.tool === 'eraser') erasePoints(seg); else blurPoints(seg, drag.base);
    render(); return;
  }
  if (drag.tool === 'lasso' || drag.tool === 'contour') { const last = drag.pts[drag.pts.length - 1]; if (last[0] !== x || last[1] !== y) drag.pts.push([x, y]); renderOverlay(); return; }
  if (drag.tool === 'movesel') {
    const dx = x - drag.x0, dy = y - drag.y0;
    state.floating.x = drag.fx + dx; state.floating.y = drag.fy + dy;
    if (drag.sel0) state.sel = S.maskShift(drag.sel0, dx, dy);
    render(); return;
  }
  renderOverlay();
}

function onPointerUp(ev) {
  if (state.panning) { state.panning = null; el.viewport.classList.remove('panning'); return; }
  const drag = state.drag;
  if (!drag) return;
  state.drag = null;
  if (state.sprayTimer) { clearInterval(state.sprayTimer); state.sprayTimer = null; }
  if (['line', 'rect', 'ellipse'].includes(drag.tool)) { beginChange(); paintPoints(shapePoints(drag), drag.rgba, drag.button); endChange(); return; }
  if (drag.tool === 'gradient') {
    beginChange();
    const [a, b] = drag.button === 2 ? [bg(), fg()] : [fg(), bg()];
    R.gradient(activeCel(), drag.x0, drag.y0, drag.x, drag.y, a, b, { dither: ui.dither, mask: state.sel });
    endChange(); return;
  }
  if (drag.tool === 'contour') { if (drag.pts.length >= 3) paintMasked(S.maskFromPolygon(W(), H(), drag.pts), drag.rgba, drag.button); else paintPoints(drag.pts, drag.rgba, drag.button); endChange(); return; }
  if (drag.tool === 'marquee' || drag.tool === 'ellipsemarquee') {
    const rect = { x0: drag.x0, y0: drag.y0, x1: drag.x, y1: drag.y };
    if (drag.shift) { const m = Math.max(Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0)); rect.x1 = rect.x0 + Math.sign(rect.x1 - rect.x0 || 1) * m; rect.y1 = rect.y0 + Math.sign(rect.y1 - rect.y0 || 1) * m; }
    const moved = drag.x !== drag.x0 || drag.y !== drag.y0;
    if (!moved && drag.selmode === 'replace') { state.sel = null; renderAll(); return; }
    applySelection(drag.tool === 'marquee' ? S.maskFromRect(W(), H(), rect) : S.maskFromEllipse(W(), H(), rect), drag.selmode);
    renderAll(); return;
  }
  if (drag.tool === 'lasso') { if (drag.pts.length >= 3) applySelection(S.maskFromPolygon(W(), H(), drag.pts), drag.selmode); renderAll(); return; }
  if (drag.tool === 'movesel') { renderAll(); return; }
  endChange();
}

function pick(x, y, which) {
  if (!inDoc(x, y)) return;
  const comp = M.compositeFrame(state.doc, state.frame), i = (y * W() + x) * 4;
  if (comp[i + 3] === 0) return;
  setColor(which, R.rgbaToHex([comp[i], comp[i + 1], comp[i + 2], 255]));
}

// ---------- edit operations on the selection ----------
function withSelection(fn) {
  if (!state.sel) { toast(t('msg.nosel')); return; }
  if (!guardLocked()) return;
  commitFloating(); beginChange(); fn(state.sel); endChange();
}
function copySelection(merged = false) {
  if (!state.sel) { toast(t('msg.nosel')); return; }
  commitFloating();
  const src = merged ? { width: W(), height: H(), data: M.compositeFrame(state.doc, state.frame) } : activeCel();
  const f = S.extractMasked(src, state.sel);
  if (f) { state.clipboard = f; toast(t('msg.copied')); }
}
function pasteClipboard() {
  if (!state.clipboard || !guardLocked()) return;
  commitFloating(); beginChange();
  const c = state.clipboard;
  state.floating = { bitmap: R.cloneBitmap(c.bitmap), mask: S.cloneMask(c.mask), x: c.x, y: c.y };
  const m = S.createMask(W(), H());
  for (let j = 0; j < c.mask.height; j++) for (let i = 0; i < c.mask.width; i++) if (c.mask.data[j * c.mask.width + i] && inDoc(c.x + i, c.y + j)) m.data[(c.y + j) * W() + c.x + i] = 1;
  state.sel = m; ui.tool = 'marquee'; renderAll();
}
function transformFloatingOrSel(fn) {
  // with no selection the whole cel is transformed (like Aseprite)
  const whole = !state.sel;
  if (whole) { if (!guardLocked()) return; commitFloating(); beginChange(); state.sel = S.maskFromRect(W(), H(), { x0: 0, y0: 0, x1: W() - 1, y1: H() - 1 }); }
  const apply = (sel) => {
    const f = S.extractMasked(activeCel(), sel, { clear: true });
    if (!f) return;
    const out = fn(f.bitmap);
    // keep the result centred on the original bounds
    const x = f.x + Math.floor((f.bitmap.width - out.width) / 2), y = f.y + Math.floor((f.bitmap.height - out.height) / 2);
    R.blit(activeCel(), out, x, y);
    state.sel = S.maskFromRect(W(), H(), { x0: x, y0: y, x1: x + out.width - 1, y1: y + out.height - 1 });
  };
  if (whole) { apply(state.sel); state.sel = null; endChange(); } else withSelection(apply);
}
function shiftSelection(dx, dy) {
  if (!state.sel || !guardLocked()) return;
  if (!state.floating) { beginChange(); liftSelection(); }
  state.floating.x += dx; state.floating.y += dy; state.sel = S.maskShift(state.sel, dx, dy);
  render(); renderAll();
}

// ---------- document actions ----------
function newDoc(w, h) {
  commitFloating();
  state.doc = M.createDoc({ width: w, height: h, name: 'untitled' });
  resetView();
}
function loadDoc(doc) { commitFloating(); state.doc = doc; resetView(); }
function resetView() {
  state.frame = 0; state.layer = 0; state.sel = null; state.lastSel = null; state.floating = null; state.playTag = null; state.history.clear();
  ui.zoom = fitZoom(); saveUi(); scheduleSave(); renderAll(); centerView();
}
function fitZoom() {
  const vw = el.viewport.clientWidth - 80, vh = el.viewport.clientHeight - 80;
  const z = Math.floor(Math.min(vw / canvasW(), vh / canvasH()));
  return ZOOMS.filter((v) => v <= Math.max(1, z)).pop() ?? 1;
}
function centerView() { requestAnimationFrame(() => { el.viewport.scrollLeft = (el.viewport.scrollWidth - el.viewport.clientWidth) / 2; el.viewport.scrollTop = (el.viewport.scrollHeight - el.viewport.clientHeight) / 2; }); }
function setZoom(z, anchor) {
  z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
  if (z === ui.zoom) return;
  const rect = el.canvas.getBoundingClientRect(), vrect = el.viewport.getBoundingClientRect();
  const ax = anchor ? (anchor.x - rect.left) / ui.zoom : canvasW() / 2, ay = anchor ? (anchor.y - rect.top) / ui.zoom : canvasH() / 2;
  const vx = anchor ? anchor.x - vrect.left : el.viewport.clientWidth / 2, vy = anchor ? anchor.y - vrect.top : el.viewport.clientHeight / 2;
  ui.zoom = z; saveUi(); applyZoomCss(); render();
  el.viewport.scrollLeft = el.stage.offsetLeft + ax * z - vx; el.viewport.scrollTop = el.stage.offsetTop + ay * z - vy;
}
const zoomStep = (dir, anchor) => { const i = ZOOMS.indexOf(ui.zoom); setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + dir))], anchor); };

// ---------- export / import ----------
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function bitmapToCanvas(b) { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0); return c; }
const canvasBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
function frameBitmaps() { const d = state.doc; return d.frames.map((f, i) => ({ bitmap: { width: d.width, height: d.height, data: M.compositeFrame(d, i) }, duration: f.duration ?? Math.round(1000 / d.fps) })); }
async function exportAs(type, scale) {
  commitFloating();
  const d = state.doc, name = d.name || 'pixel';
  if (type === 'json') { download(new Blob([JSON.stringify(M.serialize(d))], { type: 'application/json' }), `${name}.json`); return; }
  const frames = frameBitmaps();
  if (type === 'png') { download(await canvasBlob(bitmapToCanvas(R.scaleBitmap(frames[state.frame].bitmap, scale))), `${name}.png`); return; }
  if (type === 'gif') {
    const bytes = encodeGif({ width: d.width * scale, height: d.height * scale, frames: frames.map((f) => R.scaleBitmap(f.bitmap, scale).data), delaysMs: frames.map((f) => f.duration) });
    download(new Blob([bytes], { type: 'image/gif' }), `${name}.gif`);
  }
}
async function exportSheet(opts) {
  commitFloating();
  const d = state.doc, name = d.name || 'pixel';
  const { bitmap, rects } = SH.layoutSheet(frameBitmaps(), opts);
  download(await canvasBlob(bitmapToCanvas(bitmap)), `${name}-sheet.png`);
  if (opts.json !== 'none') download(new Blob([JSON.stringify(SH.sheetJson({ doc: d, rects, imageName: `${name}-sheet.png`, format: opts.json, scale: opts.scale }), null, 1)], { type: 'application/json' }), `${name}-sheet.json`);
}
async function fileToBitmap(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const cctx = c.getContext('2d'); cctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: cctx.getImageData(0, 0, bmp.width, bmp.height).data };
}
async function importFile(file) {
  try {
    if (file.type === 'application/json' || file.name.endsWith('.json') || !file.type.startsWith('image/')) {
      loadDoc(M.deserialize(JSON.parse(await file.text()))); toast(t('msg.imported', { name: file.name })); return;
    }
    const b = await fileToBitmap(file);
    if (b.width > MAX_SIZE || b.height > MAX_SIZE) { toast(t('msg.toolarge', { max: MAX_SIZE })); return; }
    const doc = M.createDoc({ width: b.width, height: b.height, name: file.name.replace(/\.[^.]+$/, '') });
    M.getCel(doc, 0, doc.layers[0].id).data.set(b.data);
    loadDoc(doc); toast(t('msg.imported', { name: file.name }));
  } catch { toast(t('msg.badfile')); }
}
async function importSheet(file, { cw, ch, padding, border }) {
  try {
    const b = await fileToBitmap(file);
    const cells = SH.splitSheet(b, cw, ch, { padding, border });
    if (!cells.length) { toast(t('msg.badfile')); return; }
    const doc = M.createDoc({ width: cw, height: ch, name: file.name.replace(/\.[^.]+$/, '') });
    cells.forEach((cell, i) => { if (i > 0) M.addFrame(doc); M.getCel(doc, i, doc.layers[0].id).data.set(cell.data); });
    loadDoc(doc); toast(t('msg.imported', { name: file.name }));
  } catch { toast(t('msg.badfile')); }
}
async function importPalette(file) {
  try {
    let colors;
    if (file.type.startsWith('image/')) colors = PIO.extractPalette([(await fileToBitmap(file)).data]);
    else if (file.name.endsWith('.act')) colors = PIO.parseAct(new Uint8Array(await file.arrayBuffer())).colors;
    else colors = PIO.parsePalette(await file.text()).colors;
    if (!colors.length) throw new Error('empty');
    beginChange(); state.doc.palette = colors; ui.paletteId = 'custom'; saveUi(); endChange();
    toast(t('msg.imported', { name: file.name }));
  } catch { toast(t('msg.badfile')); }
}

let toastTimer = 0;
function toast(msg) { el.toast.textContent = msg; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800); }

// ---------- playback & preview ----------
function startPlayback() {
  if (state.playing) return;
  commitFloating();
  el.play.textContent = '■'; el.play.title = t('frames.stop');
  state.playDir = { dir: 1 };
  const tick = () => {
    state.frame = M.nextPlayFrame(state.doc, state.frame, state.playTag, state.playDir);
    render(); renderFrames();
    state.playing = setTimeout(tick, state.doc.frames[state.frame].duration ?? Math.round(1000 / state.doc.fps));
  };
  state.playing = setTimeout(tick, state.doc.frames[state.frame].duration ?? Math.round(1000 / state.doc.fps));
}
function stopPlayback() { if (!state.playing) return; clearTimeout(state.playing); state.playing = null; el.play.textContent = '▶'; el.play.title = t('frames.play'); renderAll(); }
function renderPreviewFrame() {
  const d = state.doc, scale = Math.max(1, Math.floor(160 / Math.max(d.width, d.height)));
  el.previewCanvas.width = d.width; el.previewCanvas.height = d.height; el.previewCanvas.style.width = `${d.width * scale}px`; el.previewCanvas.style.height = `${d.height * scale}px`;
  const fi = state.playing ? state.frame : Math.min(state.previewFrame, d.frames.length - 1);
  el.previewCanvas.getContext('2d').putImageData(frameImage(fi), 0, 0);
}
function startPreview() {
  clearTimeout(state.previewTimer);
  const tick = () => {
    if (!ui.preview) return;
    state.previewFrame = M.nextPlayFrame(state.doc, state.previewFrame, state.playTag, { dir: 1 });
    renderPreviewFrame();
    state.previewTimer = setTimeout(tick, state.doc.frames[state.previewFrame]?.duration ?? 125);
  };
  state.previewTimer = setTimeout(tick, 125);
}

// ---------- generic dialogs ----------
function formDialog(title, fields) {
  return new Promise((resolve) => {
    const dlg = $('#dlg-form'), box = $('#form-controls');
    $('#form-title').textContent = title;
    box.replaceChildren(...fields.map((f) => fieldRow(f)));
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok' ? readFields(fields, box) : null); };
    dlg.addEventListener('close', done);
    dlg.showModal();
  });
}
function fieldRow(f) {
  const row = document.createElement('label'); row.className = 'fx-row';
  const lab = document.createElement('span'); lab.textContent = f.label;
  let input;
  if (f.type === 'select') { input = document.createElement('select'); for (const [v, l] of f.options) input.append(Object.assign(document.createElement('option'), { value: v, textContent: l })); input.value = f.value; }
  else { input = document.createElement('input'); input.type = f.type ?? 'text'; if (f.type === 'checkbox') input.checked = Boolean(f.value); else input.value = f.value; if (f.min != null) input.min = f.min; if (f.max != null) input.max = f.max; if (f.step != null) input.step = f.step; }
  input.dataset.key = f.key;
  const v = document.createElement('span'); v.className = 'v'; v.textContent = f.type === 'range' ? f.value : '';
  if (f.type === 'range') input.addEventListener('input', () => { v.textContent = input.value; });
  row.append(lab, input, v);
  return row;
}
function readFields(fields, box) {
  const out = {};
  for (const f of fields) { const input = box.querySelector(`[data-key="${f.key}"]`); out[f.key] = f.type === 'checkbox' ? input.checked : f.type === 'range' || f.type === 'number' ? Number(input.value) : input.value; }
  return out;
}
// Effect dialog with live preview on the active layer; `apply(values, bitmap, mask)` returns a new bitmap.
function fxDialog(title, fields, apply) {
  if (!guardLocked()) return;
  commitFloating();
  const dlg = $('#dlg-fx'), box = $('#fx-controls');
  $('#fx-title').textContent = title;
  const allFields = [...fields, { key: 'target', label: t('fx.applyto'), type: 'select', value: state.sel ? 'selection' : 'layer', options: [['layer', t('fx.layer')], ['selection', t('fx.selection')]] }];
  box.replaceChildren(...allFields.map((f) => fieldRow(f)));
  const cel = activeCel(), base = R.cloneBitmap(cel);
  const preview = () => { const v = readFields(allFields, box); const mask = v.target === 'selection' ? state.sel : null; try { cel.data.set(apply(v, base, mask).data); } catch { cel.data.set(base.data); } render(); };
  box.addEventListener('input', preview);
  preview();
  const done = () => {
    dlg.removeEventListener('close', done); box.removeEventListener('input', preview);
    const result = R.cloneBitmap(cel); cel.data.set(base.data);
    if (dlg.returnValue === 'ok') { beginChange(); activeCel().data.set(result.data); endChange(); } else render();
  };
  dlg.addEventListener('close', done);
  dlg.showModal();
}

// ---------- commands (menu + shortcuts) ----------
const commands = {
  new: () => openNew(),
  open: () => el.fileOpen.click(),
  save: () => { exportAs('json'); toast(t('msg.saved')); },
  saveAs: async () => { const v = await formDialog(t('file.saveas'), [{ key: 'name', label: t('layer.name'), type: 'text', value: state.doc.name }]); if (v) { state.doc.name = v.name.trim() || 'untitled'; exportAs('json'); renderAll(); } },
  export: () => $('#dlg-export').showModal(),
  exportSheet: () => $('#dlg-sheet').showModal(),
  importSheet: () => el.fileSheet.click(),
  undo, redo,
  cut: () => { copySelection(); withSelection((sel) => S.extractMasked(activeCel(), sel, { clear: true })); },
  copy: () => copySelection(false),
  copyMerged: () => copySelection(true),
  paste: () => pasteClipboard(),
  clear: () => { if (state.floating) { state.floating = null; state.sel = null; endChange(); return; } withSelection((sel) => S.extractMasked(activeCel(), sel, { clear: true })); },
  fill: () => withSelection((sel) => paintMasked(sel, fg(), 0)),
  stroke: () => withSelection((sel) => paintMasked(S.maskBorder(sel, 1), fg(), 0)),
  rot90: () => transformFloatingOrSel((b) => R.rotate90(b, true)),
  rot180: () => transformFloatingOrSel((b) => R.rotate90(R.rotate90(b, true), true)),
  rot270: () => transformFloatingOrSel((b) => R.rotate90(b, false)),
  flipH: () => transformFloatingOrSel((b) => R.flip(b, 'x')),
  flipV: () => transformFloatingOrSel((b) => R.flip(b, 'y')),
  replaceColor: () => fxDialog(t('edit.replace'), [{ key: 'from', label: t('fx.from'), type: 'color', value: ui.primary.slice(0, 7) }, { key: 'to', label: t('fx.to'), type: 'color', value: ui.secondary.slice(0, 7) }, { key: 'tol', label: t('ctx.tolerance'), type: 'range', min: 0, max: 255, value: 0 }], (v, b, m) => FX.replaceColor(b, R.hexToRgba(v.from), R.hexToRgba(v.to), { tolerance: v.tol }, m).bitmap),
  invert: () => { if (!guardLocked()) return; commitFloating(); beginChange(); activeCel().data.set(FX.invert(activeCel(), state.sel).data); endChange(); },
  brightnessContrast: () => fxDialog(t('edit.bc'), [{ key: 'brightness', label: t('fx.brightness'), type: 'range', min: -100, max: 100, value: 0 }, { key: 'contrast', label: t('fx.contrast'), type: 'range', min: -100, max: 100, value: 0 }], (v, b, m) => FX.brightnessContrast(b, v, m)),
  hueSaturation: () => fxDialog(t('edit.hs'), [{ key: 'hue', label: t('fx.hue'), type: 'range', min: -180, max: 180, value: 0 }, { key: 'saturation', label: t('fx.saturation'), type: 'range', min: -100, max: 100, value: 0 }, { key: 'lightness', label: t('fx.lightness'), type: 'range', min: -100, max: 100, value: 0 }], (v, b, m) => FX.hueSaturation(b, v, m)),
  outline: () => fxDialog(t('edit.outline'), [{ key: 'color', label: t('tag.color'), type: 'color', value: ui.primary.slice(0, 7) }, { key: 'place', label: t('fx.place'), type: 'select', value: 'outside', options: [['outside', t('fx.outside')], ['inside', t('fx.inside')]] }, { key: 'matrix', label: t('fx.matrix'), type: 'select', value: 'circle', options: [['circle', t('ctx.circle')], ['square', t('ctx.square')]] }], (v, b, m) => FX.outline(b, R.hexToRgba(v.color), { place: v.place, matrix: v.matrix }, m)),
  convolution: () => fxDialog(t('edit.matrix'), [{ key: 'kernel', label: t('fx.kernel'), type: 'text', value: '0 -1 0 -1 5 -1 0 -1 0' }, { key: 'divisor', label: t('fx.divisor'), type: 'number', value: 0 }, { key: 'bias', label: t('fx.bias'), type: 'number', value: 0 }], (v, b, m) => { const k = v.kernel.trim().split(/[\s,]+/).map(Number); if (k.length !== 9 && k.length !== 25 || k.some(Number.isNaN)) return b; return FX.convolve(b, k, { divisor: v.divisor || null, bias: v.bias }, m); }),
  despeckle: () => { if (!guardLocked()) return; commitFloating(); beginChange(); activeCel().data.set(FX.despeckle(activeCel(), state.sel).data); endChange(); },
  blurLayer: () => { if (!guardLocked()) return; commitFloating(); beginChange(); activeCel().data.set(FX.blur(activeCel(), state.sel).data); endChange(); },
  spriteSize: async () => { const v = await formDialog(t('sprite.size'), [{ key: 'f', label: t('sprite.factor'), type: 'select', value: '2', options: [['2', '×2'], ['3', '×3'], ['4', '×4'], ['8', '×8']] }]); if (!v) return; const f = Number(v.f); if (W() * f > MAX_SIZE || H() * f > MAX_SIZE) { toast(t('msg.toolarge', { max: MAX_SIZE })); return; } commitFloating(); beginChange(); M.scaleDoc(state.doc, f); state.sel = null; endChange(); centerView(); },
  canvasSize: () => { $('#resize-w').value = W(); $('#resize-h').value = H(); $('#dlg-resize').showModal(); },
  canvasRot90: () => { commitFloating(); beginChange(); M.rotateDoc(state.doc, true); state.sel = null; endChange(); centerView(); },
  canvasRot180: () => { commitFloating(); beginChange(); M.rotateDoc(state.doc, true); M.rotateDoc(state.doc, true); state.sel = null; endChange(); },
  canvasRot270: () => { commitFloating(); beginChange(); M.rotateDoc(state.doc, false); state.sel = null; endChange(); centerView(); },
  canvasFlipH: () => { commitFloating(); beginChange(); M.flipDoc(state.doc, 'x'); state.sel = null; endChange(); },
  canvasFlipV: () => { commitFloating(); beginChange(); M.flipDoc(state.doc, 'y'); state.sel = null; endChange(); },
  crop: () => { if (!state.sel) { toast(t('msg.nosel')); return; } commitFloating(); const b = S.maskBounds(state.sel); beginChange(); M.cropDoc(state.doc, b); state.sel = null; endChange(); centerView(); },
  trim: () => { commitFloating(); const b = M.contentBounds(state.doc); if (!b) return; beginChange(); M.cropDoc(state.doc, b); state.sel = null; endChange(); centerView(); },
  layerProps: async () => { const l = activeLayer(); const v = await formDialog(t('layer.props'), [{ key: 'name', label: t('layer.name'), type: 'text', value: l.name }, { key: 'opacity', label: t('layers.opacity'), type: 'range', min: 0, max: 100, value: Math.round(l.opacity * 100) }, { key: 'locked', label: t('layer.locked'), type: 'checkbox', value: l.locked }]); if (!v) return; beginChange(); l.name = v.name.trim() || l.name; l.opacity = v.opacity / 100; l.locked = v.locked; endChange(); },
  layerVisible: () => { beginChange(); activeLayer().visible = !activeLayer().visible; endChange(); },
  layerLock: () => { beginChange(); activeLayer().locked = !activeLayer().locked; endChange(); },
  layerNew: () => { commitFloating(); beginChange(); M.addLayer(state.doc, { name: t('layers.new', { n: state.doc.layers.length + 1 }), at: state.layer + 1 }); state.layer += 1; endChange(); },
  layerViaCopy: () => { if (!state.sel) { toast(t('msg.nosel')); return; } commitFloating(); beginChange(); const f = S.extractMasked(activeCel(), state.sel); const l = M.addLayer(state.doc, { name: t('layers.new', { n: state.doc.layers.length + 1 }), at: state.layer + 1 }); if (f) R.blit(M.getCel(state.doc, state.frame, l.id), f.bitmap, f.x, f.y); state.layer += 1; endChange(); },
  layerViaCut: () => { if (!state.sel || !guardLocked()) { if (!state.sel) toast(t('msg.nosel')); return; } commitFloating(); beginChange(); const f = S.extractMasked(activeCel(), state.sel, { clear: true }); const l = M.addLayer(state.doc, { name: t('layers.new', { n: state.doc.layers.length + 1 }), at: state.layer + 1 }); if (f) R.blit(M.getCel(state.doc, state.frame, l.id), f.bitmap, f.x, f.y); state.layer += 1; endChange(); },
  layerDelete: () => { commitFloating(); if (state.doc.layers.length <= 1) return; beginChange(); M.removeLayer(state.doc, state.layer); state.layer = Math.max(0, state.layer - 1); endChange(); },
  layerDup: () => { commitFloating(); beginChange(); const l = M.duplicateLayer(state.doc, state.layer); l.name = t('layers.copy', { name: state.doc.layers[state.layer].name }); state.layer += 1; endChange(); },
  layerUp: () => { commitFloating(); beginChange(); if (M.moveLayer(state.doc, state.layer, state.layer + 1)) state.layer += 1; endChange(); },
  layerDown: () => { commitFloating(); beginChange(); if (M.moveLayer(state.doc, state.layer, state.layer - 1)) state.layer -= 1; endChange(); },
  layerMerge: () => { commitFloating(); if (state.layer <= 0) return; beginChange(); M.mergeDown(state.doc, state.layer); state.layer -= 1; endChange(); },
  flatten: (visibleOnly = false) => { commitFloating(); beginChange(); const d = state.doc; for (let i = d.layers.length - 1; i > 0; i--) { if (visibleOnly && !d.layers[i].visible) continue; M.mergeDown(d, i); } if (visibleOnly && !d.layers[0].visible && d.layers.length > 1) { /* keep as is */ } state.layer = 0; endChange(); },
  frameProps: async () => { const f = state.doc.frames[state.frame]; const v = await formDialog(t('frame.props'), [{ key: 'duration', label: t('frame.duration'), type: 'number', min: 1, max: 60000, value: f.duration ?? Math.round(1000 / state.doc.fps) }]); if (!v) return; beginChange(); f.duration = Math.max(1, Math.round(v.duration)); endChange(); },
  frameNew: () => { commitFloating(); beginChange(); state.frame = M.addFrame(state.doc, { at: state.frame + 1, duplicateOf: state.frame }); endChange(); },
  frameNewEmpty: () => { commitFloating(); beginChange(); state.frame = M.addFrame(state.doc, { at: state.frame + 1 }); endChange(); },
  frameDelete: () => { commitFloating(); if (state.doc.frames.length <= 1) return; beginChange(); M.removeFrame(state.doc, state.frame); state.frame = Math.max(0, state.frame - 1); endChange(); },
  frameLeft: () => { commitFloating(); beginChange(); if (M.moveFrame(state.doc, state.frame, state.frame - 1)) state.frame -= 1; endChange(); },
  frameRight: () => { commitFloating(); beginChange(); if (M.moveFrame(state.doc, state.frame, state.frame + 1)) state.frame += 1; endChange(); },
  gotoFrame: (i) => { commitFloating(); state.frame = Math.max(0, Math.min(state.doc.frames.length - 1, i)); renderAll(); },
  constantRate: async () => { const v = await formDialog(t('frame.constant'), [{ key: 'duration', label: t('frame.duration'), type: 'number', min: 1, max: 60000, value: Math.round(1000 / state.doc.fps) }]); if (!v) return; beginChange(); const ms = Math.max(1, Math.round(v.duration)); state.doc.fps = Math.max(1, Math.min(60, Math.round(1000 / ms))); for (const f of state.doc.frames) f.duration = ms; endChange(); },
  reverseFrames: () => { commitFloating(); beginChange(); M.reverseFrames(state.doc); endChange(); },
  play: () => (state.playing ? stopPlayback() : startPlayback()),
  onionSettings: async () => { const v = await formDialog(t('frame.onion'), [{ key: 'prev', label: t('onion.prev'), type: 'range', min: 0, max: 5, value: ui.onionPrev }, { key: 'next', label: t('onion.next'), type: 'range', min: 0, max: 5, value: ui.onionNext }]); if (!v) return; ui.onionPrev = v.prev; ui.onionNext = v.next; ui.onion = true; saveUi(); renderAll(); },
  tagNew: async () => {
    const v = await formDialog(t('tags.new'), tagFields({ name: `Tag ${(state.doc.tags?.length ?? 0) + 1}`, from: state.frame, to: state.frame, direction: 'forward', color: '#43d9e8' }));
    if (!v) return; beginChange(); const tag = M.addTag(state.doc, { name: v.name || 'Tag', from: v.from - 1, to: v.to - 1, direction: v.direction, color: v.color }); state.playTag = tag; endChange();
  },
  tagProps: async (tag = state.playTag ?? M.tagsAtFrame(state.doc, state.frame)[0]) => {
    if (!tag) { toast(t('msg.nosel')); return; }
    const v = await formDialog(t('tags.props'), tagFields(tag));
    if (!v) return; beginChange(); Object.assign(tag, { name: v.name || tag.name, from: Math.min(v.from, v.to) - 1, to: Math.max(v.from, v.to) - 1, direction: v.direction, color: v.color }); endChange();
  },
  tagDelete: () => { const tag = state.playTag ?? M.tagsAtFrame(state.doc, state.frame)[0]; if (!tag) return; beginChange(); M.removeTag(state.doc, tag.id); if (state.playTag?.id === tag.id) state.playTag = null; endChange(); },
  selectAll, deselect,
  reselect: () => { if (state.lastSel && state.lastSel.width === W()) { commitFloating(); state.sel = state.lastSel; renderAll(); } },
  inverse: () => { commitFloating(); state.sel = S.maskInvert(selectionOrAll()); if (S.maskIsEmpty(state.sel)) state.sel = null; renderAll(); },
  colorRange: async () => { const v = await formDialog(t('select.colorrange'), [{ key: 'color', label: t('tag.color'), type: 'color', value: ui.primary.slice(0, 7) }, { key: 'tol', label: t('ctx.tolerance'), type: 'range', min: 0, max: 255, value: 0 }]); if (!v) return; commitFloating(); const comp = { width: W(), height: H(), data: M.compositeFrame(state.doc, state.frame) }; const target = R.hexToRgba(v.color); const m = S.createMask(W(), H()); for (let i = 0; i < W() * H(); i++) { const d = comp.data; const o = i * 4; if (d[o + 3] && Math.max(Math.abs(d[o] - target[0]), Math.abs(d[o + 1] - target[1]), Math.abs(d[o + 2] - target[2])) <= v.tol) m.data[i] = 1; } state.sel = S.maskIsEmpty(m) ? null : m; if (state.sel) state.lastSel = state.sel; renderAll(); },
  modify: async (mode) => { if (!state.sel) { toast(t('msg.nosel')); return; } const v = await formDialog(t(`select.${mode}`), [{ key: 'n', label: t('select.amount'), type: 'range', min: 1, max: 16, value: 1 }, { key: 'shape', label: t('ctx.shape'), type: 'select', value: 'circle', options: [['circle', t('ctx.circle')], ['square', t('ctx.square')]] }]); if (!v) return; commitFloating(); const fn = mode === 'expand' ? S.maskExpand : mode === 'contract' ? S.maskContract : S.maskBorder; state.sel = mode === 'border' ? S.maskBorder(state.sel, v.n) : fn(state.sel, v.n, v.shape); if (S.maskIsEmpty(state.sel)) state.sel = null; renderAll(); },
  toggleGrid: () => { ui.grid = !ui.grid; saveUi(); renderAll(); },
  gridSettings: async () => { const v = await formDialog(t('view.gridsettings'), [{ key: 'w', label: t('grid.w'), type: 'number', min: 1, max: 256, value: ui.gridW }, { key: 'h', label: t('grid.h'), type: 'number', min: 1, max: 256, value: ui.gridH }, { key: 'x', label: t('grid.x'), type: 'number', min: -256, max: 256, value: ui.gridX }, { key: 'y', label: t('grid.y'), type: 'number', min: -256, max: 256, value: ui.gridY }, { key: 'snap', label: t('view.snap'), type: 'checkbox', value: ui.snap }]); if (!v) return; ui.gridW = Math.max(1, v.w); ui.gridH = Math.max(1, v.h); ui.gridX = v.x; ui.gridY = v.y; ui.snap = v.snap; ui.grid = true; saveUi(); renderAll(); },
  toggleSnap: () => { ui.snap = !ui.snap; saveUi(); toast(`${t('view.snap')}: ${ui.snap ? 'on' : 'off'}`); },
  tiled: (mode) => { commitFloating(); ui.tiled = mode; saveUi(); renderAll(); centerView(); },
  toggleOnion: () => { ui.onion = !ui.onion; saveUi(); renderAll(); },
  togglePreview: () => { ui.preview = !ui.preview; saveUi(); renderAll(); if (ui.preview) startPreview(); else clearTimeout(state.previewTimer); },
  toggleUi: () => { ui.hideui = !ui.hideui; saveUi(); renderAll(); },
  zoomTo: (z) => { setZoom(z); },
  zoomFit: () => { setZoom(fitZoom()); centerView(); },
  center: () => centerView(),
  swapColors: () => { const tmp = ui.primary; ui.primary = ui.secondary; ui.secondary = tmp; saveUi(); renderPalette(); },
  nextColor: (dir) => { const colors = currentPaletteColors(); if (!colors.length) return; const i = colors.findIndex((c) => c.toLowerCase() === ui.primary.toLowerCase()); setColor('primary', colors[((i < 0 ? 0 : i + dir) + colors.length) % colors.length]); },
  brushSize: (d) => { ui.brush = Math.max(1, Math.min(32, ui.brush + d)); saveUi(); renderCtx(); renderOverlay(); },
  paletteLoad: () => el.filePalette.click(),
  paletteSave: async () => { const v = await formDialog(t('palette.save'), [{ key: 'fmt', label: t('sheet.layout'), type: 'select', value: 'gpl', options: [['gpl', 'GIMP (.gpl)'], ['pal', 'JASC (.pal)'], ['hex', 'HEX (.hex)'], ['act', 'Photoshop (.act)']] }]); if (!v) return; const data = PIO.writePalette(currentPaletteColors(), v.fmt, state.doc.name); download(new Blob([data], { type: v.fmt === 'act' ? 'application/octet-stream' : 'text/plain' }), `${state.doc.name}.${v.fmt}`); },
  paletteFromSprite: () => { const colors = PIO.extractPalette(state.doc.frames.map((_, i) => M.compositeFrame(state.doc, i))); if (!colors.length) return; beginChange(); state.doc.palette = colors; ui.paletteId = 'custom'; saveUi(); endChange(); },
  paletteSort: (by) => { beginChange(); state.doc.palette = PIO.sortPalette(currentPaletteColors(), by); ui.paletteId = 'custom'; saveUi(); endChange(); },
  paletteReverse: () => { beginChange(); state.doc.palette = [...currentPaletteColors()].reverse(); ui.paletteId = 'custom'; saveUi(); endChange(); },
  paletteAdd: () => { const c = ui.primary.toLowerCase(); const cur = currentPaletteColors(); if (cur.includes(c)) return; beginChange(); state.doc.palette = [...cur, c]; ui.paletteId = 'custom'; saveUi(); endChange(); },
  paletteRemove: () => { const c = ui.primary.toLowerCase(); beginChange(); state.doc.palette = currentPaletteColors().filter((x) => x !== c); ui.paletteId = 'custom'; saveUi(); endChange(); },
  paletteClear: () => { beginChange(); state.doc.palette = []; ui.paletteId = 'custom'; saveUi(); endChange(); },
  settings: () => { $('#set-lang').value = getLang(); $('#set-theme').value = ui.theme; $('#set-checker').checked = ui.checker; $('#dlg-settings').showModal(); },
};
function tagFields(tag) {
  return [
    { key: 'name', label: t('tag.name'), type: 'text', value: tag.name },
    { key: 'from', label: t('tag.from'), type: 'number', min: 1, max: state.doc.frames.length, value: tag.from + 1 },
    { key: 'to', label: t('tag.to'), type: 'number', min: 1, max: state.doc.frames.length, value: tag.to + 1 },
    { key: 'direction', label: t('tag.direction'), type: 'select', value: tag.direction, options: [['forward', t('dir.forward')], ['reverse', t('dir.reverse')], ['pingpong', t('dir.pingpong')]] },
    { key: 'color', label: t('tag.color'), type: 'color', value: tag.color },
  ];
}

// ---------- menus ----------
const MENUS = () => [
  { id: 'file', label: t('menu.file'), items: [
    { l: t('file.new') + '…', c: 'new', k: 'Ctrl+N' }, { l: t('file.open') + '…', c: 'open', k: 'Ctrl+O' }, { sep: true },
    { l: t('file.save'), c: 'save', k: 'Ctrl+S' }, { l: t('file.saveas'), c: 'saveAs', k: 'Ctrl+Shift+S' }, { sep: true },
    { l: t('file.export') + '…', c: 'export', k: 'Ctrl+Shift+E' }, { l: t('file.exportsheet'), c: 'exportSheet', k: 'Ctrl+E' }, { l: t('file.importsheet'), c: 'importSheet', k: 'Ctrl+I' },
  ] },
  { id: 'edit', label: t('menu.edit'), items: [
    { l: t('edit.undo'), c: 'undo', k: 'Ctrl+Z' }, { l: t('edit.redo'), c: 'redo', k: 'Ctrl+Y' }, { sep: true },
    { l: t('edit.cut'), c: 'cut', k: 'Ctrl+X' }, { l: t('edit.copy'), c: 'copy', k: 'Ctrl+C' }, { l: t('edit.copymerged'), c: 'copyMerged', k: 'Ctrl+Shift+C' }, { l: t('edit.paste'), c: 'paste', k: 'Ctrl+V' }, { l: t('edit.clear'), c: 'clear', k: 'Del' }, { sep: true },
    { l: t('edit.fill'), c: 'fill', k: 'F' }, { l: t('edit.stroke'), c: 'stroke', k: 'S' }, { sep: true },
    { l: t('edit.rot90'), c: 'rot90' }, { l: t('edit.rot180'), c: 'rot180' }, { l: t('edit.rot270'), c: 'rot270' }, { l: t('edit.fliph'), c: 'flipH', k: 'Shift+H' }, { l: t('edit.flipv'), c: 'flipV', k: 'Shift+V' }, { sep: true },
    { l: t('edit.replace'), c: 'replaceColor', k: 'Shift+R' }, { l: t('edit.invert'), c: 'invert' }, { l: t('edit.bc'), c: 'brightnessContrast' }, { l: t('edit.hs'), c: 'hueSaturation', k: 'Ctrl+U' }, { sub: 'FX' },
    { l: t('edit.outline'), c: 'outline', k: 'Shift+O' }, { l: t('edit.matrix'), c: 'convolution', k: 'F9' }, { l: t('edit.despeckle'), c: 'despeckle' }, { l: t('edit.blur'), c: 'blurLayer' },
  ] },
  { id: 'sprite', label: t('menu.sprite'), items: [
    { l: t('sprite.size'), c: 'spriteSize', k: 'Ctrl+Alt+I' }, { l: t('sprite.canvas'), c: 'canvasSize', k: 'C' }, { sep: true },
    { l: t('sprite.rot90'), c: 'canvasRot90' }, { l: t('sprite.rot180'), c: 'canvasRot180' }, { l: t('sprite.rot270'), c: 'canvasRot270' }, { l: t('sprite.fliph'), c: 'canvasFlipH' }, { l: t('sprite.flipv'), c: 'canvasFlipV' }, { sep: true },
    { l: t('sprite.crop'), c: 'crop' }, { l: t('sprite.trim'), c: 'trim' },
  ] },
  { id: 'layer', label: t('menu.layer'), items: [
    { l: t('layer.props'), c: 'layerProps', k: 'Shift+P' }, { l: t('layer.visible'), c: 'layerVisible', k: 'Shift+X', checked: activeLayer().visible }, { l: t('layer.lock'), c: 'layerLock', checked: Boolean(activeLayer().locked) }, { sep: true },
    { l: t('layer.new'), c: 'layerNew', k: 'Shift+N' }, { l: t('layer.viacopy'), c: 'layerViaCopy', k: 'Ctrl+J' }, { l: t('layer.viacut'), c: 'layerViaCut', k: 'Ctrl+Shift+J' }, { l: t('layer.delete'), c: 'layerDelete' }, { sep: true },
    { l: t('layer.dup'), c: 'layerDup' }, { l: t('layer.merge'), c: 'layerMerge', k: 'Ctrl+M' }, { l: t('layer.flatten'), c: 'flatten' }, { l: t('layer.flattenvisible'), c: 'flattenVisible' },
  ] },
  { id: 'frame', label: t('menu.frame'), items: [
    { l: t('frame.props'), c: 'frameProps', k: 'P' }, { sep: true },
    { l: t('frame.new'), c: 'frameNew', k: 'Alt+N' }, { l: t('frame.newempty'), c: 'frameNewEmpty', k: 'Alt+B' }, { l: t('frame.delete'), c: 'frameDelete', k: 'Alt+C' }, { sep: true },
    { l: t('frame.play'), c: 'play', k: 'Enter' }, { l: t('frame.first'), c: 'gotoFirst', k: 'Home' }, { l: t('frame.prev'), c: 'gotoPrev', k: '←' }, { l: t('frame.next'), c: 'gotoNext', k: '→' }, { l: t('frame.last'), c: 'gotoLast', k: 'End' }, { sep: true },
    { l: t('tags.new'), c: 'tagNew' }, { l: t('tags.props'), c: 'tagProps' }, { l: t('tags.delete'), c: 'tagDelete' }, { l: t('tags.playall'), c: 'playAll', checked: !state.playTag }, { sep: true },
    { l: t('frame.constant'), c: 'constantRate' }, { l: t('frame.reverse'), c: 'reverseFrames', k: 'Alt+I' }, { l: t('frame.onion'), c: 'onionSettings' },
  ] },
  { id: 'select', label: t('menu.select'), items: [
    { l: t('select.all'), c: 'selectAll', k: 'Ctrl+A' }, { l: t('select.none'), c: 'deselect', k: 'Ctrl+D' }, { l: t('select.reselect'), c: 'reselect', k: 'Ctrl+Shift+D' }, { l: t('select.inverse'), c: 'inverse', k: 'Ctrl+Shift+I' }, { sep: true },
    { l: t('select.colorrange'), c: 'colorRange' }, { l: t('select.expand'), c: 'modifyExpand' }, { l: t('select.contract'), c: 'modifyContract' }, { l: t('select.border'), c: 'modifyBorder' },
  ] },
  { id: 'view', label: t('menu.view'), items: [
    { l: t('view.grid'), c: 'toggleGrid', k: "Ctrl+'", checked: ui.grid }, { l: t('view.gridsettings'), c: 'gridSettings' }, { l: t('view.snap'), c: 'toggleSnap', k: 'Shift+S', checked: ui.snap }, { sep: true },
    { sub: t('view.tiled') }, { l: t('tiled.none'), c: 'tiledNone', checked: ui.tiled === 'none' }, { l: t('tiled.both'), c: 'tiledBoth', checked: ui.tiled === 'both' }, { l: t('tiled.x'), c: 'tiledX', checked: ui.tiled === 'x' }, { l: t('tiled.y'), c: 'tiledY', checked: ui.tiled === 'y' }, { sep: true },
    { l: t('view.onion'), c: 'toggleOnion', k: 'F3', checked: ui.onion }, { l: t('view.preview'), c: 'togglePreview', k: 'F7', checked: ui.preview }, { l: t('view.hideui'), c: 'toggleUi', k: 'Tab', checked: ui.hideui }, { sep: true },
    { l: t('view.zoom100'), c: 'zoom100', k: '1' }, { l: t('view.fit'), c: 'zoomFit', k: 'Ctrl+0' }, { l: t('view.center'), c: 'center', k: 'Shift+Z' },
  ] },
];
const aliases = {
  gotoFirst: () => commands.gotoFrame(0), gotoPrev: () => commands.gotoFrame(state.frame - 1), gotoNext: () => commands.gotoFrame(state.frame + 1), gotoLast: () => commands.gotoFrame(state.doc.frames.length - 1),
  playAll: () => { state.playTag = null; renderFrames(); }, flattenVisible: () => commands.flatten(true),
  modifyExpand: () => commands.modify('expand'), modifyContract: () => commands.modify('contract'), modifyBorder: () => commands.modify('border'),
  tiledNone: () => commands.tiled('none'), tiledBoth: () => commands.tiled('both'), tiledX: () => commands.tiled('x'), tiledY: () => commands.tiled('y'), zoom100: () => commands.zoomTo(1),
};
function runCommand(name, ...args) { closeMenu(); (commands[name] ?? aliases[name])?.(...args); }
function renderMenubar() {
  el.menubar.replaceChildren(...MENUS().map((m) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = m.label; b.dataset.menu = m.id; b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => { e.stopPropagation(); if (state.menuOpen === m.id) closeMenu(); else openMenu(m.id, b); });
    b.addEventListener('pointerenter', () => { if (state.menuOpen && state.menuOpen !== m.id) openMenu(m.id, b); });
    return b;
  }));
}
function openMenu(id, anchor) {
  const m = MENUS().find((x) => x.id === id);
  state.menuOpen = id;
  $$('#menubar > button').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.menu === id)));
  el.popup.replaceChildren(...m.items.map((it) => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; return s; }
    if (it.sub) { const s = document.createElement('div'); s.className = 'sub'; s.textContent = it.sub; return s; }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mi'; b.dataset.cmd = it.c;
    if (it.checked != null) b.setAttribute('aria-checked', String(it.checked));
    const lab = document.createElement('span'); lab.textContent = it.l; const k = document.createElement('kbd'); k.textContent = it.k ?? '';
    b.append(lab, k); b.addEventListener('click', () => runCommand(it.c));
    return b;
  }));
  const r = anchor.getBoundingClientRect();
  el.popup.style.left = `${r.left}px`; el.popup.style.top = `${r.bottom + 2}px`; el.popup.hidden = false;
}
function closeMenu() { if (!state.menuOpen) return; state.menuOpen = null; el.popup.hidden = true; $$('#menubar > button').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
function paletteMenu(anchor) {
  const items = [
    { l: t('palette.load'), c: 'paletteLoad' }, { l: t('palette.save') + '…', c: 'paletteSave' }, { l: t('palette.fromsprite'), c: 'paletteFromSprite' }, { sep: true },
    { l: t('palette.addcolor'), c: 'paletteAdd' }, { l: t('palette.removecolor'), c: 'paletteRemove' }, { sep: true },
    { l: t('palette.sorthue'), c: 'paletteSortHue' }, { l: t('palette.sortlum'), c: 'paletteSortLum' }, { l: t('palette.reverse'), c: 'paletteReverse' }, { l: t('palette.clear'), c: 'paletteClear' },
  ];
  aliases.paletteSortHue = () => commands.paletteSort('hue'); aliases.paletteSortLum = () => commands.paletteSort('luminance');
  state.menuOpen = 'palette';
  el.popup.replaceChildren(...items.map((it) => { if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; return s; } const b = document.createElement('button'); b.type = 'button'; b.className = 'mi'; b.dataset.cmd = it.c; b.append(Object.assign(document.createElement('span'), { textContent: it.l }), document.createElement('kbd')); b.addEventListener('click', () => runCommand(it.c)); return b; }));
  const r = anchor.getBoundingClientRect();
  el.popup.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`; el.popup.style.top = `${r.bottom + 2}px`; el.popup.hidden = false;
}

// ---------- keyboard ----------
const KEYS = [
  // [ctrl, shift, alt, key, command]
  [1, 0, 0, 'n', 'new'], [1, 0, 0, 'o', 'open'], [1, 0, 0, 's', 'save'], [1, 1, 0, 's', 'saveAs'], [1, 1, 0, 'e', 'export'], [1, 0, 0, 'e', 'exportSheet'], [1, 0, 0, 'i', 'importSheet'],
  [1, 0, 0, 'z', 'undo'], [1, 1, 0, 'z', 'redo'], [1, 0, 0, 'y', 'redo'], [1, 0, 0, 'x', 'cut'], [1, 0, 0, 'c', 'copy'], [1, 1, 0, 'c', 'copyMerged'], [1, 0, 0, 'v', 'paste'],
  [0, 0, 0, 'f', 'fill'], [0, 0, 0, 's', 'stroke'], [0, 1, 0, 'h', 'flipH'], [0, 1, 0, 'v', 'flipV'], [0, 1, 0, 'r', 'replaceColor'], [1, 0, 0, 'u', 'hueSaturation'], [0, 1, 0, 'o', 'outline'], [0, 0, 0, 'f9', 'convolution'],
  [1, 0, 1, 'i', 'spriteSize'], [0, 0, 0, 'c', 'canvasSize'], [0, 1, 0, 'p', 'layerProps'], [0, 1, 0, 'x', 'layerVisible'], [0, 1, 0, 'n', 'layerNew'], [1, 0, 0, 'j', 'layerViaCopy'], [1, 1, 0, 'j', 'layerViaCut'], [1, 0, 0, 'm', 'layerMerge'],
  [0, 0, 0, 'p', 'frameProps'], [0, 0, 1, 'n', 'frameNew'], [0, 0, 1, 'b', 'frameNewEmpty'], [0, 0, 1, 'c', 'frameDelete'], [0, 0, 1, 'i', 'reverseFrames'], [0, 0, 0, 'home', 'gotoFirst'], [0, 0, 0, 'end', 'gotoLast'], [0, 0, 0, 'enter', 'play'],
  [1, 0, 0, 'a', 'selectAll'], [1, 0, 0, 'd', 'deselect'], [1, 1, 0, 'd', 'reselect'], [1, 1, 0, 'i', 'inverse'],
  [1, 0, 0, "'", 'toggleGrid'], [0, 1, 0, 's', 'toggleSnap'], [0, 0, 0, 'f3', 'toggleOnion'], [0, 0, 0, 'f7', 'togglePreview'], [0, 0, 0, 'tab', 'toggleUi'], [1, 0, 0, '0', 'zoomFit'], [0, 1, 0, 'z', 'center'],
  [0, 0, 0, 'x', 'swapColors'],
];
const TOOL_KEYS = { m: 'marquee', 'shift+m': 'ellipsemarquee', q: 'lasso', 'shift+q': 'polylasso', w: 'wand', b: 'pencil', 'shift+b': 'spray', e: 'eraser', i: 'picker', h: 'pan', v: 'move', z: 'zoom', g: 'fill', 'shift+g': 'gradient', l: 'line', u: 'rect', 'shift+u': 'ellipse', d: 'contour', 'shift+d': 'polygon', r: 'blur' };
function setTool(name) { commitFloating(); state.poly = null; ui.tool = name; saveUi(); renderAll(); }
function onKeyDown(e) {
  const tag = e.target?.tagName, type = e.target?.type;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio', 'range'].includes(type));
  if (typing || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (k === 'alt') { state.alt = true; e.preventDefault(); return; }
  if (k === 'control' || k === 'meta') { state.ctrl = true; return; }
  if (state.menuOpen && k === 'escape') { closeMenu(); return; }
  if ((k === ' ' || k === 'enter') && (tag === 'BUTTON' || tag === 'INPUT')) { if (k === ' ') { state.space = true; el.viewport.style.cursor = 'grab'; e.preventDefault(); } return; }
  if (k === ' ') { e.preventDefault(); state.space = true; el.viewport.style.cursor = 'grab'; return; }
  if (k === 'escape') { if (state.poly) { state.poly = null; render(); } else { commitFloating(); state.sel = null; renderAll(); } return; }
  if (k === 'enter' && state.poly) { e.preventDefault(); finishPolygon(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); commands.clear(); return; }
  if (!ctrl && !e.altKey && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
    e.preventDefault();
    const d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    const step = e.shiftKey ? [ui.gridW, ui.gridH] : [1, 1];
    if (state.sel) shiftSelection(d[0] * step[0], d[1] * step[1]);
    else if (k === 'arrowleft') commands.gotoFrame(state.frame - 1); else if (k === 'arrowright') commands.gotoFrame(state.frame + 1);
    return;
  }
  if (!ctrl && !e.altKey) {
    const tk = (e.shiftKey ? 'shift+' : '') + k;
    if (TOOL_KEYS[tk] && !(e.shiftKey && ['h', 'v', 'r', 'o', 'p', 'x', 'n', 's', 'z'].includes(k))) { e.preventDefault(); setTool(TOOL_KEYS[tk]); return; }
    if (!e.shiftKey) {
      if (k === '+' || k === '=') { commands.brushSize(1); return; }
      if (k === '-') { commands.brushSize(-1); return; }
      if (k === '[') { commands.nextColor(-1); return; }
      if (k === ']') { commands.nextColor(1); return; }
      const zooms = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 };
      if (zooms[k]) { commands.zoomTo(zooms[k]); return; }
      if (k === ',') { commands.gotoFrame(state.frame - 1); return; }
      if (k === '.') { commands.gotoFrame(state.frame + 1); return; }
    }
  }
  if (ctrl && (k === '+' || k === '=')) { e.preventDefault(); zoomStep(1); return; }
  if (ctrl && k === '-') { e.preventDefault(); zoomStep(-1); return; }
  for (const [c, s, a, key, cmd] of KEYS) {
    if (Boolean(c) === ctrl && Boolean(s) === e.shiftKey && Boolean(a) === e.altKey && key === k) { e.preventDefault(); runCommand(cmd); return; }
  }
}
function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (k === ' ') { state.space = false; el.viewport.style.cursor = ''; }
  if (k === 'alt') state.alt = false;
  if (k === 'control' || k === 'meta') state.ctrl = false;
}

// ---------- wiring ----------
function applyI18n() {
  $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  $$('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', n.title); });
  const anchors = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
  $('#resize-anchor').replaceChildren(...anchors.map((a) => Object.assign(document.createElement('option'), { value: a, textContent: t(`anchor.${a}`) })));
  $('#resize-anchor').value = 'top-left';
  renderMenubar();
}
function applyTheme() { document.documentElement.dataset.theme = ui.theme; }
const clampSize = (v) => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(v) || 1)));
function openNew() {
  $('#new-presets').replaceChildren(...[8, 16, 32, 48, 64, 96, 128].map((n) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = `${n}×${n}`; b.addEventListener('click', () => { $('#new-w').value = n; $('#new-h').value = n; }); return b; }));
  $('#new-w').value = W(); $('#new-h').value = H();
  $('#dlg-new').showModal();
}

function bind() {
  el.viewport.addEventListener('pointerdown', onPointerDown);
  el.viewport.addEventListener('pointermove', onPointerMove);
  el.viewport.addEventListener('pointerup', onPointerUp);
  el.viewport.addEventListener('pointercancel', onPointerUp);
  el.viewport.addEventListener('pointerleave', () => { state.hover = null; renderOverlay(); });
  el.viewport.addEventListener('contextmenu', (e) => e.preventDefault());
  el.viewport.addEventListener('wheel', (e) => { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY }); }, { passive: false });
  document.addEventListener('click', (e) => { if (!el.popup.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', () => { state.alt = false; state.ctrl = false; state.space = false; });

  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const bindRange = (input, key, label) => input.addEventListener('input', () => { ui[key] = Number(input.value); if (label) label.textContent = ui[key]; saveUi(); renderOverlay(); });
  bindRange(el.brushSize, 'brush', el.brushLabel); bindRange(el.inkOpacity, 'opacity', el.inkOpacityLabel); bindRange(el.tolerance, 'tolerance', el.toleranceLabel); bindRange(el.sprayWidth, 'sprayWidth', el.sprayWidthLabel); bindRange(el.spraySpeed, 'spraySpeed', el.spraySpeedLabel);
  el.brushShape.addEventListener('change', () => { ui.brushShape = el.brushShape.value; saveUi(); renderOverlay(); });
  el.optPP.addEventListener('change', () => { ui.pp = el.optPP.checked; saveUi(); });
  el.ink.addEventListener('change', () => { ui.ink = el.ink.value; saveUi(); });
  el.optFill.addEventListener('change', () => { ui.filled = el.optFill.checked; saveUi(); });
  el.optContig.addEventListener('change', () => { ui.contiguous = el.optContig.checked; saveUi(); });
  el.dither.addEventListener('change', () => { ui.dither = el.dither.value; saveUi(); });
  el.selMode.addEventListener('change', () => { ui.selMode = el.selMode.value; saveUi(); });
  for (const [id, key] of [['#tg-grid', 'grid'], ['#tg-onion', 'onion'], ['#tg-symx', 'symx'], ['#tg-symy', 'symy']]) $(id).addEventListener('click', () => { ui[key] = !ui[key]; saveUi(); renderAll(); });
  $('#btn-zoom-in').addEventListener('click', () => zoomStep(1)); $('#btn-zoom-out').addEventListener('click', () => zoomStep(-1)); el.zoomLabel.addEventListener('click', () => commands.zoomFit());
  el.undo.addEventListener('click', undo); el.redo.addEventListener('click', redo);
  $('#btn-settings').addEventListener('click', () => commands.settings());

  // colours
  el.swatchP.addEventListener('click', () => el.colorInput.click());
  el.swatchS.addEventListener('click', () => commands.swapColors());
  $('#btn-swap').addEventListener('click', () => commands.swapColors());
  el.colorInput.addEventListener('input', () => setColor('primary', el.colorInput.value));
  el.colorHex.addEventListener('change', () => { const v = el.colorHex.value.trim(); if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) setColor('primary', v.startsWith('#') ? v : `#${v}`); else el.colorHex.value = ui.primary; });
  const hsvInput = () => { const [r, g, b] = FX.hsvToRgb(Number(el.hsvH.value), Number(el.hsvS.value) / 100, Number(el.hsvV.value) / 100); setColor('primary', R.rgbaToHex([r, g, b, 255])); };
  for (const i of [el.hsvH, el.hsvS, el.hsvV]) i.addEventListener('input', hsvInput);
  el.paletteSelect.addEventListener('change', () => { ui.paletteId = el.paletteSelect.value; saveUi(); renderPalette(); });
  $('#btn-palette-menu').addEventListener('click', (e) => { e.stopPropagation(); if (state.menuOpen === 'palette') closeMenu(); else paletteMenu(e.currentTarget); });
  el.filePalette.addEventListener('change', () => { if (el.filePalette.files[0]) importPalette(el.filePalette.files[0]); el.filePalette.value = ''; });

  // layers
  $('#btn-layer-add').addEventListener('click', () => commands.layerNew());
  $('#btn-layer-dup').addEventListener('click', () => commands.layerDup());
  $('#btn-layer-del').addEventListener('click', () => commands.layerDelete());
  $('#btn-layer-up').addEventListener('click', () => commands.layerUp());
  $('#btn-layer-down').addEventListener('click', () => commands.layerDown());
  $('#btn-layer-merge').addEventListener('click', () => commands.layerMerge());
  el.layerOpacity.addEventListener('change', () => { beginChange(); activeLayer().opacity = Number(el.layerOpacity.value) / 100; endChange(); });
  el.layerOpacity.addEventListener('input', () => { activeLayer().opacity = Number(el.layerOpacity.value) / 100; render(); });
  const transform = (fn) => { if (!guardLocked()) return; commitFloating(); beginChange(); const f = state.doc.frames[state.frame]; f.cels[activeLayer().id] = fn(activeCel()); endChange(); };
  $('#btn-flip-h').addEventListener('click', () => transform((b) => R.flip(b, 'x')));
  $('#btn-flip-v').addEventListener('click', () => transform((b) => R.flip(b, 'y')));
  $('#btn-rot').addEventListener('click', () => { if (W() !== H()) { toast(t('msg.square')); return; } transform((b) => R.rotate90(b, true)); });
  $('#btn-clear-layer').addEventListener('click', () => transform((b) => R.createBitmap(b.width, b.height)));

  // frames
  $('#btn-frame-add').addEventListener('click', () => commands.frameNewEmpty());
  $('#btn-frame-dup').addEventListener('click', () => commands.frameNew());
  $('#btn-frame-del').addEventListener('click', () => commands.frameDelete());
  $('#btn-frame-left').addEventListener('click', () => commands.frameLeft());
  $('#btn-frame-right').addEventListener('click', () => commands.frameRight());
  $('#btn-tag-add').addEventListener('click', () => commands.tagNew());
  el.fps.addEventListener('change', () => { const fps = Math.max(1, Math.min(60, Number(el.fps.value) || 8)); beginChange(); state.doc.fps = fps; for (const f of state.doc.frames) f.duration = Math.round(1000 / fps); endChange(); if (state.playing) { stopPlayback(); startPlayback(); } });
  el.play.addEventListener('click', () => commands.play());

  // file
  el.docName.addEventListener('change', () => { state.doc.name = el.docName.value.trim() || 'untitled'; el.docName.value = state.doc.name; scheduleSave(); });
  el.fileOpen.addEventListener('change', () => { if (el.fileOpen.files[0]) importFile(el.fileOpen.files[0]); el.fileOpen.value = ''; });
  el.fileSheet.addEventListener('change', async () => {
    const file = el.fileSheet.files[0]; el.fileSheet.value = '';
    if (!file) return;
    const dlg = $('#dlg-import'); dlg.showModal();
    dlg.addEventListener('close', () => { if (dlg.returnValue === 'ok') importSheet(file, { cw: clampSize($('#import-w').value), ch: clampSize($('#import-h').value), padding: Number($('#import-padding').value) || 0, border: Number($('#import-border').value) || 0 }); }, { once: true });
  });
  $('#dlg-export').addEventListener('close', () => { if ($('#dlg-export').returnValue === 'ok') exportAs(document.querySelector('input[name="export-type"]:checked').value, Number($('#export-scale').value)); });
  $('#dlg-sheet').addEventListener('close', () => { if ($('#dlg-sheet').returnValue === 'ok') exportSheet({ layout: $('#sheet-layout').value, columns: Number($('#sheet-count').value) || 0, padding: Number($('#sheet-padding').value) || 0, border: Number($('#sheet-border').value) || 0, trim: $('#sheet-trim').checked, scale: Number($('#sheet-scale').value), json: $('#sheet-json').value }); });
  $('#dlg-resize').addEventListener('close', () => { if ($('#dlg-resize').returnValue !== 'ok') return; commitFloating(); beginChange(); M.resizeDoc(state.doc, clampSize($('#resize-w').value), clampSize($('#resize-h').value), $('#resize-anchor').value); state.sel = null; endChange(); centerView(); });
  $('#dlg-new').addEventListener('close', () => { if ($('#dlg-new').returnValue !== 'ok') return; const dirty = state.doc.frames.some((f) => Object.values(f.cels).some((c) => c.data.some((v) => v !== 0))); if (dirty && !confirm(t('new.confirm'))) return; newDoc(clampSize($('#new-w').value), clampSize($('#new-h').value)); });
  $('#set-lang').addEventListener('change', () => { ui.lang = $('#set-lang').value; setLang(ui.lang); saveUi(); applyI18n(); renderAll(); });
  $('#set-theme').addEventListener('change', () => { ui.theme = $('#set-theme').value; saveUi(); applyTheme(); renderOverlay(); });
  $('#set-checker').addEventListener('change', () => { ui.checker = $('#set-checker').checked; saveUi(); applyZoomCss(); });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) importFile(f); });
  document.addEventListener('paste', (e) => { const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/')); if (item) { e.preventDefault(); importFile(item.getAsFile()); } });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => renderOverlay());
  window.addEventListener('pagehide', () => { commitFloating(); store.save('doc', M.serialize(state.doc)); });
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); state.installPrompt = ev; el.install.hidden = false; });
  el.install.addEventListener('click', async () => { state.installPrompt?.prompt(); await state.installPrompt?.userChoice.catch(() => {}); el.install.hidden = true; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- boot ----------
function boot() {
  setLang(ui.lang ?? detectLang());
  applyTheme();
  const saved = store.load('doc', null);
  try { state.doc = saved ? M.deserialize(saved) : M.createDoc({ width: 32, height: 32 }); } catch { state.doc = M.createDoc({ width: 32, height: 32 }); }
  if (!ZOOMS.includes(ui.zoom)) ui.zoom = 8;
  if (!TOOL_KEYS[Object.keys(TOOL_KEYS).find((k) => TOOL_KEYS[k] === ui.tool)]) ui.tool = 'pencil';
  applyI18n();
  bind();
  renderAll();
  if (!saved) { ui.zoom = fitZoom(); applyZoomCss(); render(); }
  centerView();
  if (ui.preview) startPreview();
  window.__px = {
    state, ui, doc: () => state.doc, commands, run: runCommand,
    pixel: (x, y, layer = state.layer) => R.getPixel(M.getCel(state.doc, state.frame, state.doc.layers[layer].id), x, y),
    composite: (x, y) => { const c = M.compositeFrame(state.doc, state.frame); const i = (y * W() + x) * 4; return [c[i], c[i + 1], c[i + 2], c[i + 3]]; },
    selCount: () => (state.sel ? S.maskCount(state.sel) : 0), selHas: (x, y) => Boolean(state.sel && S.maskGet(state.sel, x, y)),
    R, M, S, FX, SH, PIO, encodeGif,
  };
}
boot();
