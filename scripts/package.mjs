import JSZip from 'jszip';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const zip = new JSZip();
const add = file => {
  zip.file(file.replaceAll('\\', '/'), readFileSync(join(root, file)), { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
};
function addDirectory(directory) {
  for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) addDirectory(file); else add(file);
  }
}
// Explicit publication allowlist: only what the extension needs at runtime plus
// its license notices. Repository documentation, sources, tests and tooling stay out.
for (const file of ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) add(file);
for (const directory of ['_locales', 'dist']) addDirectory(directory);
// Runtime icons only; the 512px icon, README logo and social preview stay in the repository.
for (const size of [16, 32, 48, 128]) add(`assets/icon${size}.png`);
mkdirSync(join(root, 'build'), { recursive: true });
const output = join(root, 'build', `imgloupe-v${manifest.version}.zip`);
writeFileSync(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
console.log(`Packaged ${Object.keys(zip.files).length} entries: ${output}`);
