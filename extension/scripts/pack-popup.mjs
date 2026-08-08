// Post-build: Vite writes the popup HTML entry preserving its source-relative
// path (dist/src/popup/popup.html) with absolute /popup.js and /urls.js asset
// references. The manifest expects `dist/popup.html`. Move it to the dist root
// and rewrite ALL absolute asset refs to relative so they resolve inside
// chrome-extension://<id>/dist/.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const SRC = 'dist/src/popup/popup.html';
if (!existsSync(SRC)) process.exit(0);

let html = readFileSync(SRC, 'utf8');
// Rewrite absolute /<asset> references (script src, link href, modulepreload)
// to relative ./<asset> (resolves at dist root).
html = html.replace(/((?:src|href)=")\/([^"]+)"/g, '$1./$2"');
writeFileSync('dist/popup.html', html);

// Copy the popup stylesheet next to the html if it was emitted beside it.
if (existsSync('dist/src/popup/popup.css')) {
  writeFileSync('dist/popup.css', readFileSync('dist/src/popup/popup.css'));
}

// Remove the nested source-relative output.
rmSync('dist/src', { recursive: true, force: true });