import { build } from 'esbuild';
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
process.chdir(root);
// Only these exact generated directories can be cleared; never remove a computed
// ancestor, the source tree, node_modules, or anything outside this repository.
function clearGenerated(name) {
  if (!['dist', 'dist.next', 'assets'].includes(name)) throw new Error('Not a generated directory');
  const target = resolve(root, name);
  if (dirname(target) !== root) throw new Error('Refusing deletion outside repository');
  rmSync(target, { recursive: true, force: true });
}
clearGenerated('dist.next');
const stage = join(root, 'dist.next');
const copy = (source, target) => { mkdirSync(dirname(target), { recursive: true }); cpSync(source, target); };
// Development builds (npm run build:dev) add the page-driven test bridge in
// src/content/dev-bridge.js; store builds compile it out.
const dev = process.argv.includes('--dev') || process.env.IMGLOUPE_DEV === '1';
const base = {
  bundle: true, platform: 'browser', target: 'chrome116', minify: false, legalComments: 'inline',
  define: { __IMGLOUPE_DEV__: JSON.stringify(dev), __IMGLOUPE_BUILD_ID__: JSON.stringify(dev ? new Date().toISOString() : '') }
};
const entries = [
  ['src/content/index.js', 'contentScripts/index.global.js', 'iife'],
  ['src/background/index.js', 'background/index.mjs', 'iife'],
  ['src/offscreen/offscreen.js', 'offscreen/offscreen.js', 'iife'],
  ['src/popup/popup.js', 'popup/popup.js', 'iife']
];
for (const [entry, output, format] of entries) {
  await build({ ...base, entryPoints: [entry], outfile: join(stage, output), format });
}
copy('src/popup/index.html', join(stage, 'popup/index.html'));
copy('src/popup/popup.css', join(stage, 'popup/popup.css'));
// Render a local, readable policy from the same source shipped with the package.
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const policy = readFileSync('PRIVACY.md', 'utf8').trim().split(/\r?\n\s*\r?\n/).map(block => {
  const heading = /^(#{1,2})\s+([^\n]+)$/.exec(block);
  if (heading) return `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`;
  const linked = escapeHtml(block.replace(/\r?\n/g, ' '))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<"]*[^\s<".,;:)])?/gi, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  return `<p>${linked}</p>`;
}).join('\n');
writeFileSync(join(stage, 'popup/privacy.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ImgLoupe — Privacy</title><link rel="stylesheet" href="popup.css"></head><body class="privacy-page"><main>${policy}</main></body></html>`);
copy('src/offscreen/offscreen.html', join(stage, 'offscreen/offscreen.html'));
mkdirSync(join(stage, 'contentScripts'), { recursive: true });
writeFileSync(join(stage, 'contentScripts/style.css'),
  readFileSync('node_modules/viewerjs/dist/viewer.css', 'utf8') + '\n' + readFileSync('src/content/content.css', 'utf8'));

for (const file of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
  copy(`node_modules/tesseract.js/dist/${file}`, join(stage, 'assets/tesseract', file));
}
// OEM=1 uses only the LSTM core, with SIMD chosen by Tesseract when available.
for (const file of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) {
  copy(`node_modules/tesseract.js-core/${file}`, join(stage, 'assets/tesseract', file));
}
const hashes = {
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  chi_tra: '529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b'
};
for (const [language, expected] of Object.entries(hashes)) {
  const source = `vendor/tessdata-fast/${language}.traineddata.gz`;
  const digest = createHash('sha256').update(gunzipSync(readFileSync(source))).digest('hex');
  if (digest !== expected) throw new Error(`Unverified OCR model: ${language}`);
  copy(source, join(stage, 'assets/tesseract/lang', `${language}.traineddata.gz`));
}

// Include complete licenses from the installed lockfile-resolved dependencies.
// Development-only packages are not shipped in the extension.
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [directory, metadata] of Object.entries(lock.packages)) {
  if (!directory || metadata.dev || !existsSync(directory)) continue;
  for (const file of readdirSync(directory)) {
    if (/^(license|notice|copying)(\.|$)/i.test(file)) {
      copy(join(directory, file), join(stage, 'licenses', `${metadata.name || directory.replaceAll('node_modules/', '').replaceAll('/', '--')}-${metadata.version}`, file));
    }
  }
}
copy('vendor/tessdata-fast/LICENSE', join(stage, 'licenses/tessdata-fast/LICENSE'));
// Build all PNGs from the project's own vector artwork.
const svg = readFileSync('src/branding/icon.svg');
const nestedSvg = (source, placement) => source.toString().replace(/<svg\b/, `<svg ${placement}`);
// Toolbar sizes are full-bleed. The 128px icon (install dialog, Chrome Web
// Store) follows the store guideline: 96px artwork with 16px transparent padding.
const paddedIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${nestedSvg(svg, 'x="16" y="16" width="96" height="96"')}</svg>`;
const icons = new Map();
for (const size of [16, 32, 48, 128, 512]) {
  icons.set(size, new Resvg(size === 128 ? paddedIcon : svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
// Compose the same source artwork for README headers and GitHub link previews.
// Lettering is paths so all build platforms render identical assets without fonts.
// Compose the padded masters in artwork coordinates without clipping their edges.
const svgBody = source => source.toString().replace(/<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const artwork = (source, transform) => `<g transform="${transform}">${svgBody(source)}</g>`;
const mark = readFileSync('src/branding/mark.svg');
const wordmark = readFileSync('src/branding/wordmark.svg');
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220"><rect width="800" height="220" rx="24" fill="#fdfbf5"/>${artwork(mark, `translate(26 24) scale(${180 / 530}) translate(-370 -143)`)}${artwork(wordmark, `translate(230 59) scale(${540 / 826}) translate(-220 -685)`)}</svg>`;
const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="#fdfbf5"/>${artwork(logo, 'translate(100 172) scale(1.35)')}</svg>`;
clearGenerated('assets');
mkdirSync('assets');
for (const [size, png] of icons) writeFileSync(size === 512 ? 'assets/icon.png' : `assets/icon${size}.png`, png);
writeFileSync('assets/logo.png', new Resvg(logo, { fitTo: { mode: 'width', value: 800 } }).render().asPng());
writeFileSync('assets/social-preview.png', new Resvg(social, { fitTo: { mode: 'width', value: 1280 } }).render().asPng());
clearGenerated('dist');
renameSync(stage, join(root, 'dist'));
console.log('Built content, popup, OCR, styles, icons and licenses from verified sources.');
