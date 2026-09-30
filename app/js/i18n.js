// English and Turkish UI strings. A unit test checks both sets have the same keys.
const en = {
  'app.name': 'Pixel Editor',
  'file.new': 'New', 'file.open': 'Open', 'file.save': 'Save', 'file.export': 'Export', 'file.resize': 'Resize',
  'edit.undo': 'Undo', 'edit.redo': 'Redo',
  'view.grid': 'Grid', 'view.onion': 'Onion skin', 'view.symx': 'Mirror X', 'view.symy': 'Mirror Y',
  'zoom.in': 'Zoom in', 'zoom.out': 'Zoom out', 'zoom.fit': 'Fit',
  'tool.pencil': 'Pencil (B)', 'tool.eraser': 'Eraser (E)', 'tool.fill': 'Fill (G)', 'tool.line': 'Line (L)',
  'tool.rect': 'Rectangle (R)', 'tool.ellipse': 'Ellipse (O)', 'tool.picker': 'Color picker (I)', 'tool.select': 'Select (M)', 'tool.pan': 'Pan (H)',
  'tool.size': 'Size', 'tool.filled': 'Filled', 'tool.global': 'Fill all',
  'color.title': 'Colors', 'color.primary': 'Primary', 'color.secondary': 'Secondary', 'color.swap': 'Swap (X)', 'color.add': 'Add color', 'color.remove': 'Remove from palette',
  'layers.title': 'Layers', 'layers.add': 'Add layer', 'layers.dup': 'Duplicate layer', 'layers.del': 'Delete layer', 'layers.up': 'Move up', 'layers.down': 'Move down', 'layers.merge': 'Merge down', 'layers.opacity': 'Opacity', 'layers.rename': 'Layer name',
  'layers.new': 'Layer {n}', 'layers.copy': '{name} copy',
  'transform.title': 'Layer', 'transform.fliph': 'Flip horizontal', 'transform.flipv': 'Flip vertical', 'transform.rot': 'Rotate 90°', 'transform.clear': 'Clear',
  'frames.title': 'Frames', 'frames.add': 'Add frame', 'frames.dup': 'Duplicate frame', 'frames.del': 'Delete frame', 'frames.left': 'Move left', 'frames.right': 'Move right', 'frames.play': 'Play (Enter)', 'frames.stop': 'Stop (Enter)', 'frames.fps': 'FPS',
  'status.hint': 'Left: primary · Right: secondary · Wheel: zoom · Space+drag: pan',
  'new.title': 'New image', 'new.width': 'Width', 'new.height': 'Height', 'new.ok': 'Create', 'new.confirm': 'Discard the current image?',
  'resize.title': 'Resize canvas', 'resize.anchor': 'Anchor', 'resize.ok': 'Resize',
  'anchor.top-left': 'Top left', 'anchor.top': 'Top', 'anchor.top-right': 'Top right', 'anchor.left': 'Left', 'anchor.center': 'Center', 'anchor.right': 'Right', 'anchor.bottom-left': 'Bottom left', 'anchor.bottom': 'Bottom', 'anchor.bottom-right': 'Bottom right',
  'export.title': 'Export', 'export.png': 'PNG (current frame)', 'export.sheet': 'Sprite sheet (all frames in a row)', 'export.gif': 'Animated GIF', 'export.json': 'Project file (.json)', 'export.scale': 'Scale', 'export.ok': 'Download',
  'settings.title': 'Settings', 's.lang': 'Language', 's.theme': 'Theme', 's.theme.dark': 'Dark', 's.theme.light': 'Light', 's.checker': 'Checkerboard background', 's.pixelgrid': 'Grid from zoom',
  'btn.close': 'Close', 'btn.cancel': 'Cancel',
  'msg.imported': 'Imported {name}', 'msg.saved': 'Saved', 'msg.badfile': 'Could not read that file', 'msg.toolarge': 'Images up to {max}×{max} pixels',
  'install': 'Install as an app',
};
const tr = {
  'app.name': 'Pixel Editor',
  'file.new': 'Yeni', 'file.open': 'Aç', 'file.save': 'Kaydet', 'file.export': 'Dışa aktar', 'file.resize': 'Boyut',
  'edit.undo': 'Geri al', 'edit.redo': 'Yinele',
  'view.grid': 'Izgara', 'view.onion': 'Soğan zarı', 'view.symx': 'X ayna', 'view.symy': 'Y ayna',
  'zoom.in': 'Yakınlaştır', 'zoom.out': 'Uzaklaştır', 'zoom.fit': 'Sığdır',
  'tool.pencil': 'Kalem (B)', 'tool.eraser': 'Silgi (E)', 'tool.fill': 'Kova (G)', 'tool.line': 'Çizgi (L)',
  'tool.rect': 'Dikdörtgen (R)', 'tool.ellipse': 'Elips (O)', 'tool.picker': 'Renk seçici (I)', 'tool.select': 'Seçim (M)', 'tool.pan': 'Kaydır (H)',
  'tool.size': 'Boyut', 'tool.filled': 'Dolu', 'tool.global': 'Tümü',
  'color.title': 'Renkler', 'color.primary': 'Birincil', 'color.secondary': 'İkincil', 'color.swap': 'Değiştir (X)', 'color.add': 'Renk ekle', 'color.remove': 'Paletten çıkar',
  'layers.title': 'Katmanlar', 'layers.add': 'Katman ekle', 'layers.dup': 'Katmanı çoğalt', 'layers.del': 'Katmanı sil', 'layers.up': 'Yukarı taşı', 'layers.down': 'Aşağı taşı', 'layers.merge': 'Alttakiyle birleştir', 'layers.opacity': 'Opaklık', 'layers.rename': 'Katman adı',
  'layers.new': 'Katman {n}', 'layers.copy': '{name} kopya',
  'transform.title': 'Katman', 'transform.fliph': 'Yatay çevir', 'transform.flipv': 'Dikey çevir', 'transform.rot': '90° döndür', 'transform.clear': 'Temizle',
  'frames.title': 'Kareler', 'frames.add': 'Kare ekle', 'frames.dup': 'Kareyi çoğalt', 'frames.del': 'Kareyi sil', 'frames.left': 'Sola taşı', 'frames.right': 'Sağa taşı', 'frames.play': 'Oynat (Enter)', 'frames.stop': 'Durdur (Enter)', 'frames.fps': 'FPS',
  'status.hint': 'Sol: birincil · Sağ: ikincil · Tekerlek: yakınlaştır · Boşluk+sürükle: kaydır',
  'new.title': 'Yeni görsel', 'new.width': 'Genişlik', 'new.height': 'Yükseklik', 'new.ok': 'Oluştur', 'new.confirm': 'Mevcut görsel silinsin mi?',
  'resize.title': 'Tuval boyutu', 'resize.anchor': 'Hizalama', 'resize.ok': 'Uygula',
  'anchor.top-left': 'Sol üst', 'anchor.top': 'Üst', 'anchor.top-right': 'Sağ üst', 'anchor.left': 'Sol', 'anchor.center': 'Orta', 'anchor.right': 'Sağ', 'anchor.bottom-left': 'Sol alt', 'anchor.bottom': 'Alt', 'anchor.bottom-right': 'Sağ alt',
  'export.title': 'Dışa aktar', 'export.png': 'PNG (bu kare)', 'export.sheet': 'Sprite sheet (tüm kareler yan yana)', 'export.gif': 'Animasyonlu GIF', 'export.json': 'Proje dosyası (.json)', 'export.scale': 'Ölçek', 'export.ok': 'İndir',
  'settings.title': 'Ayarlar', 's.lang': 'Dil', 's.theme': 'Tema', 's.theme.dark': 'Koyu', 's.theme.light': 'Açık', 's.checker': 'Dama tahtası arka plan', 's.pixelgrid': 'Yakınlaşınca ızgara',
  'btn.close': 'Kapat', 'btn.cancel': 'Vazgeç',
  'msg.imported': '{name} içe aktarıldı', 'msg.saved': 'Kaydedildi', 'msg.badfile': 'Dosya okunamadı', 'msg.toolarge': 'En fazla {max}×{max} piksel',
  'install': 'Uygulama olarak kur',
};
export const DICTS = { en, tr };
let current = 'en';
export function setLang(l) { current = DICTS[l] ? l : 'en'; if (typeof document !== 'undefined') document.documentElement.lang = current; }
export function getLang() { return current; }
export function detectLang() { const nav = (globalThis.navigator?.language || 'en').slice(0, 2).toLowerCase(); return DICTS[nav] ? nav : 'en'; }
export function t(key, vars) {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
export function missingKeys() {
  const out = [];
  for (const k of Object.keys(en)) if (!(k in tr)) out.push(`tr:${k}`);
  for (const k of Object.keys(tr)) if (!(k in en)) out.push(`en:${k}`);
  return out;
}
