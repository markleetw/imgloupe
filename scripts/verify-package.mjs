import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.version !== manifest.version) throw new Error(`package.json version ${packageJson.version} differs from manifest ${manifest.version}`);
const zip = await JSZip.loadAsync(readFileSync(`build/imgloupe-v${manifest.version}.zip`));
const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
const required = ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  '_locales/en/messages.json', '_locales/zh_TW/messages.json',
  'assets/icon16.png', 'assets/icon32.png', 'assets/icon48.png', 'assets/icon128.png',
  'dist/background/index.mjs', 'dist/contentScripts/index.global.js', 'dist/contentScripts/style.css',
  'dist/offscreen/offscreen.html', 'dist/offscreen/offscreen.js',
  'dist/popup/index.html', 'dist/popup/popup.js', 'dist/popup/popup.css', 'dist/popup/privacy.html',
  'dist/assets/tesseract/tesseract.min.js.LICENSE.txt', 'dist/assets/tesseract/worker.min.js.LICENSE.txt',
  'dist/assets/tesseract/lang/eng.traineddata.gz', 'dist/assets/tesseract/lang/chi_tra.traineddata.gz'];
for (const file of required) if (!zip.file(file)) throw new Error(`Missing publication file: ${file}`);
const allowed = /^(manifest\.json|LICENSE|THIRD_PARTY_NOTICES\.md|_locales\/[a-zA-Z_]+\/messages\.json|assets\/icon(16|32|48|128)\.png|dist\/.+)$/;
for (const file of files) {
  if (file.includes('..') || !allowed.test(file)) throw new Error(`Unexpected publication file: ${file}`);
}
// Every file referenced by the manifest must be present.
const referenced = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script => [...(script.js || []), ...(script.css || [])])];
for (const file of referenced) if (!zip.file(file)) throw new Error(`Manifest references a missing file: ${file}`);
if (manifest.permissions.join(',') !== 'offscreen,clipboardWrite') throw new Error('Unexpected permissions');
if ((manifest.host_permissions || []).join(',') !== 'https://docs.google.com/*,https://*.googleusercontent.com/*') throw new Error('Unexpected host permissions');
if (manifest.web_accessible_resources) throw new Error('Unexpected web-accessible resources');
if (!/__MSG_extName__/.test(manifest.name) || manifest.default_locale !== 'en') throw new Error('Manifest must use localized name and English default locale');
for (const file of files.filter(name => /\.(m?js|html)$/.test(name))) {
  if (/imgloupe-dev|imgloupe:dev-|\b(inspectExportParts|installDevBridge|recordOcrResponses|recordDevOcr)\b|\bif \(false\)/.test(await zip.file(file).async('string'))) throw new Error(`Development bridge in publication file: ${file}`);
}
const html = await zip.file('dist/popup/index.html').async('string');
if (/https?:[^\s"']+\.(js|css)/.test(html)) throw new Error('Popup must not load remote resources');
console.log(`Verified ZIP contents, manifest references and permissions (${files.length} files).`);
