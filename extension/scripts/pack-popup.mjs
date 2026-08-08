// Post-build: Vite writes the popup HTML entry preserving its source-relative
// path (dist/src/popup/popup.html) with an absolute /popup.js reference. The
// manifest expects `dist/popup.html`. Move it to the dist root and make its
// asset references relative so it resolves inside chrome-extension://<id>/.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const SRC = 'dist/src/popup/popup.html';
if (!existsSync(SRC)) process.exit(0);

let html = readFileSync(SRC, 'utf8');
// Rewrite absolute /popup.* asset refs to relative ./popup.* (resolves at dist root).
html = html.replace(/((?:src|href)=")\/popup\./g, '$1./popup.');
writeFileSync('dist/popup.html', html);

// Copy the popup stylesheet next to the html if it was emitted beside it.
if (existsSync('dist/src/popup/popup.css')) {
  writeFileSync('dist/popup.css', readFileSync('dist/src/popup/popup.css'));
}

// Remove the nested source-relative output.
rmSync('dist/src', { recursive: true, force: true });