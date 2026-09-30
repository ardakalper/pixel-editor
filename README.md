<h1 align="center">Pixel Editor</h1>

<p align="center">
  <b>A browser pixel-art editor in the spirit of Aseprite.</b> 20 tools, mask selections, layers, frames and tags,
  palettes, effects, sprite sheet and GIF export. No account, no server, works offline, installs as an app.
</p>

<p align="center">
  <img src="docs/img/dark.png" alt="Pixel Editor: a two-layer, two-frame sprite with a tag and a selection, dark theme" width="820">
</p>

**Live:** https://ardakalper.github.io/pixel-editor/

## Features

- **Tools (Aseprite layout and keys):** rectangular and elliptical marquee, lasso, polygonal lasso, magic wand, pencil,
  spray, eraser, eyedropper, hand, move, zoom, paint bucket, gradient, line, curve-free contour, rectangle, ellipse,
  polygon, blur. A context bar under the menu shows the active tool's options.
- **Brushes and inks:** square or circle brushes 1–32 px, pixel-perfect strokes, inks *simple*, *alpha compositing*,
  *lock alpha* and *shading* (cycles through the palette), opacity, contiguous / global fill with tolerance, Bayer
  dithering for gradients, spray width and speed.
- **Selections are masks:** add with `Shift`, subtract with `Alt+Shift`, intersect with `Ctrl+Shift`. Select all,
  deselect, reselect, inverse, colour range, expand / contract / border, move with the arrow keys, cut / copy / paste /
  copy merged, fill and stroke, new layer via copy or cut, crop to selection.
- **Edit and FX:** rotate 90 / 180 / 270, flip, replace colour, invert, brightness / contrast, hue / saturation,
  outline (inside / outside, circle / square), 3×3 or 5×5 convolution matrix, despeckle, blur. Every effect dialog
  previews live on the canvas and can target the layer or the selection.
- **Sprite:** sprite size ×2–×8, canvas size with an anchor, rotate or flip the whole canvas, trim, crop.
- **Layers:** add, duplicate, reorder, hide, lock, opacity, properties, merge down, flatten. Thumbnails per layer.
- **Animation:** frames with per-frame duration, duplicate / reorder / reverse / delete, tags (forward, reverse,
  ping-pong) that limit playback, onion skin with configurable previous / next counts, constant frame rate, playback
  with a floating preview window.
- **View:** custom pixel grid (size and offset), snap to grid, tiled mode for seamless textures (X, Y or both),
  symmetry axes, zoom 100–6400% around the cursor, fit to window, hide the panels with `Tab`.
- **Palettes:** PICO-8, Sweetie 16, DawnBringer 16, Endesga 32, Game Boy, and your own. Hex and HSV editing, sort by
  hue / saturation / value / luminance, extract a palette from the image, import and export `.gpl`, `.pal`, `.act` and
  hex lists.
- **Export:** PNG at 1–16×, animated GIF (own encoder, no dependencies), sprite sheet as horizontal / vertical strip or
  rows / columns with padding, border and trim, plus Aseprite-compatible JSON (hash or array) that game engines read.
  Import a sprite sheet back into frames. Project files reopen everything, including tags.
- **Autosave** to the browser, unlimited-ish undo (80 steps), English and Turkish, dark and light themes, PWA.
- Plain HTML, CSS and ES modules. No build step, no runtime dependencies.

<p align="center">
  <img src="docs/img/light.png" alt="Light theme" width="820">
</p>

## Keyboard

| Key | Action |
|---|---|
| `M` `Shift+M` `Q` `Shift+Q` `W` | Marquee, ellipse marquee, lasso, polygonal lasso, wand |
| `B` `Shift+B` `E` `I` `H` `V` `Z` | Pencil, spray, eraser, eyedropper, hand, move, zoom |
| `G` `Shift+G` `L` `U` `Shift+U` `D` `Shift+D` `R` | Bucket, gradient, line, rectangle, ellipse, contour, polygon, blur |
| `Alt` / `Ctrl` / `Space` + drag | Temporary eyedropper / move / hand |
| `Shift` + click with the pencil | Straight line from the last point |
| `+` `-` | Brush size |
| `[` `]` `X` | Previous / next palette colour, swap primary and secondary |
| `1`–`6` `Ctrl+0` `Shift+Z` | Zoom 100–3200%, fit, centre |
| `Ctrl+Z` `Ctrl+Y` | Undo, redo |
| `Ctrl+A` `Ctrl+D` `Ctrl+Shift+D` `Ctrl+Shift+I` | Select all, deselect, reselect, inverse |
| `Ctrl+X` `Ctrl+C` `Ctrl+Shift+C` `Ctrl+V` `Delete` | Cut, copy, copy merged, paste, clear |
| `F` `S` `Shift+H` `Shift+V` `Shift+R` `Shift+O` `Ctrl+U` `F9` | Fill, stroke, flip H, flip V, replace colour, outline, hue / saturation, convolution |
| `C` `Ctrl+Alt+I` | Canvas size, sprite size |
| `Shift+N` `Shift+P` `Shift+X` `Ctrl+J` `Ctrl+Shift+J` `Ctrl+M` | New layer, properties, visibility, layer via copy / cut, merge down |
| `Alt+N` `Alt+B` `Alt+C` `Alt+I` `P` | New frame, new empty frame, delete frame, reverse frames, frame properties |
| `Enter` `,` `.` `Home` `End` | Play / stop, previous / next / first / last frame |
| `Ctrl+'` `Shift+S` `F3` `F7` `Tab` | Grid, snap, onion skin, preview window, hide panels |
| `Ctrl+N` `Ctrl+O` `Ctrl+S` `Ctrl+Shift+E` `Ctrl+E` `Ctrl+I` | New, open, save project, export, export sprite sheet, import sprite sheet |
| Wheel, `Space`+drag, middle button | Zoom around the cursor, pan |

## Run it locally

```sh
git clone https://github.com/ardakalper/pixel-editor
cd pixel-editor
npm start            # serves app/ on http://localhost:4174
```

## Tests

```sh
npm install
npm run test:unit    # raster ops, masks, effects, palette files, sheet layouts, model, history, GIF, i18n (node --test)
npm run test:e2e     # Playwright: real mouse strokes, selections, layers, frames, menus, effects, exports, persistence
```

Set `PW_CHROMIUM_PATH=/path/to/chrome` to reuse an installed Chromium. CI runs both suites on every push and deploys
`app/` to GitHub Pages when `main` is green.

## How it is built

```
app/
  index.html         layout: menu bar, context bar, tool grid, canvas viewport, colour and layer panels, timeline, dialogs
  css/app.css        tokens (dark / light), layout
  js/raster.js       pure pixel ops: brushes, inks, pixel-perfect, lines, rects, ellipses, flood fill, spray, gradient,
                     compositing, region extract / blit, flip / rotate / resize / scale
  js/select.js       mask selections: rect / ellipse / polygon / wand, boolean ops, expand / contract / border, edges
  js/fx.js           effects: invert, brightness / contrast, hue / saturation, replace colour, outline, convolution, blur
  js/palette-io.js   GPL / JASC-PAL / ACT / hex palette read and write, sorting, median-cut extraction
  js/sheet.js        sprite sheet layouts, Aseprite JSON, sheet splitting
  js/model.js        document = layers × frames, one cel per pair, tags, durations; serialize / deserialize; snapshots
  js/history.js      undo / redo over snapshots
  js/gif.js          GIF89a encoder with LZW, global palette and transparency (and a tiny decoder for tests)
  js/palettes.js     built-in palettes
  js/main.js         the UI: menus, tools, rendering, selection, playback, dialogs, export / import, shortcuts
  js/i18n.js         English and Turkish
tests/               node:test unit tests and Playwright e2e specs
tools/               static server, icon generator, screenshot script
```

The document is rendered to a canvas at its native size and scaled with CSS (`image-rendering: pixelated`); the grid,
onion skin, symmetry axes, tool previews and marching ants are drawn on a second canvas above it. Tiled mode draws the
sprite nine times and wraps pointer coordinates. Every edit takes a snapshot first, so undo is a pointer swap.

## Credits

Tool set, menus and default shortcuts follow [Aseprite](https://www.aseprite.org/), which remains the better program;
this is an independent, from-scratch web editor. Fonts are bundled as subsetted woff2 files under the SIL Open Font
License 1.1: Barlow Condensed, Share Tech Mono, IBM Plex Sans and Righteous, from Google Fonts. Palettes by their
respective authors (Lexaloffle, GrafxKid, DawnBringer, Endesga).

## License

MIT.

---

### Türkçe özet

**Pixel Editor**, tarayıcıda çalışan, Aseprite'ın araç seti ve kısayollarını izleyen bir piksel sanat editörü.
Dikdörtgen / elips / kement / çokgen / sihirli değnek seçimleri (ekle, çıkar, kesiştir, genişlet, daralt, ters çevir);
kalem, sprey, silgi, damlalık, el, taşı, yakınlaştır, kova, gradyan, çizgi, kontur, dikdörtgen, elips, çokgen, bulanıklık
araçları; fırça şekilleri, pixel-perfect ve mürekkep modları; katmanlar (kilit, opaklık, birleştir, düzleştir);
kareler, kare süreleri, etiketler (ileri / geri / ping-pong), soğan zarı ve önizleme penceresi; efektler (ters çevir,
parlaklık / kontrast, ton / doygunluk, renk değiştir, dış çizgi, konvolüsyon, bulanıklık) canlı önizlemeli; döşeme
(tiled) modu, özel ızgara, simetri; palet içe / dışa aktarma (GPL, PAL, ACT, hex); PNG, animasyonlu GIF, sprite sheet
+ Aseprite uyumlu JSON dışa aktarma ve sprite sheet içe aktarma. Tarayıcıya otomatik kaydeder, çevrimdışı çalışır,
uygulama olarak kurulur. Türkçe ve İngilizce, koyu tema varsayılan.
