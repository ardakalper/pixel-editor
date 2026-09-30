# Pixel Editor — notes for future sessions

- Owner: Arda. Commits are authored by Arda only: never add Co-Authored-By or session trailers.
- Style: plain HTML/CSS/ES modules, no build step, no runtime dependencies, offline-first PWA, GitHub Pages deploy from `app/`.
- Two languages (English, Turkish) in `app/js/i18n.js`; a unit test enforces key parity. Dark theme is the default.
- Visual language shared with the sibling project focus-timer: indigo `#0d0a1f`, cream `#f2ede2`, five-colour rule (cyan, green, yellow, orange, red), Barlow Condensed labels, Share Tech Mono numbers.
- Core logic (`raster.js`, `model.js`, `history.js`, `gif.js`) is pure and unit-tested with `node --test`; the UI is tested with Playwright (`PW_CHROMIUM_PATH` reuses a preinstalled Chromium).
- Keep the README screenshots in `docs/img/` in sync (`tools/screenshots.mjs`).
