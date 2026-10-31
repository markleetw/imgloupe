import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import JSZip from 'jszip';
import { webcrypto } from 'node:crypto';
import mock from '../mock-env.js';

function batchEnvironment(type = 'document') {
  const env = mock.createMockEnv(`https://docs.google.com/${type}/d/batch-fixture/edit`);
  env.context.crypto = env.win.crypto = webcrypto;
  const downloads = [];
  env.context.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:batch-fixture'; };
  return { ...env, downloads, start() {
    vm.runInNewContext(fs.readFileSync('dist/contentScripts/index.global.js', 'utf8'), env.context);
  } };
}

async function officePackage(folder, images) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  for (const [name, bytes] of Object.entries(images)) zip.file(folder + name, bytes);
  zip.file(folder + 'chart.emf', 'vector chart, not a web image');
  return zip.generateAsync({ type: 'arraybuffer' });
}

// Stand-in for the background export service (src/background/export-service.js):
// answers export-open/read/close for the sending tab, as chrome.runtime would.
function backgroundExport(env, images, { fail = false, imageFormulas = [] } = {}) {
  const calls = [];
  const previous = env.chromeMock.runtime.sendMessage;
  env.chromeMock.runtime.sendMessage = (message, callback) => {
    calls.push(message.type);
    let response = null;
    if (message.type === 'imgloupe:export-open') {
      response = fail ? { success: false, error: 'Export HTTP 403' }
        : { success: true, token: 't1', kind: env.win.location.pathname.split('/')[1],
          images: images.map(([name, type, bytes, location = null]) => ({ name, type, size: bytes.length, location })), imageFormulas };
    } else if (message.type === 'imgloupe:export-read') {
      const [, type, bytes] = images[message.index];
      response = { success: true, type, data: Buffer.from(bytes).toString('base64') };
    } else if (message.type === 'imgloupe:export-close') {
      response = { success: true };
    } else {
      return previous(message, callback);
    }
    callback?.(response);
    return Promise.resolve(response);
  };
  return calls;
}

for (const type of ['spreadsheets', 'presentation']) test(`${type} ZIP takes every image from the background Office export, in package order`, async () => {
  const env = batchEnvironment(type);
  const images = [['image1.png', 'image/png', 'first'], ['image2.jpeg', 'image/jpeg', 'second'], ['image10.png', 'image/png', 'tenth']];
  const calls = backgroundExport(env, images);
  const pageRequests = [];
  env.context.fetch = async (url) => {
    pageRequests.push(String(url));
    if (String(url).startsWith('data:')) return { arrayBuffer: async () => Buffer.from(String(url).split(',')[1], 'base64') };
    throw new Error('unexpected request ' + url);
  };
  let cacheReads = 0;
  env.win.webkitResolveLocalFileSystemURL = () => { cacheReads++; };
  env.start();
  const result = await env.win.__imgloupe.exportAllImages();
  assert.deepEqual({ ...result }, { downloaded: 3, failed: 0, source: 'export' });
  assert.deepEqual(calls, ['imgloupe:export-open', 'imgloupe:export-read', 'imgloupe:export-read', 'imgloupe:export-read', 'imgloupe:export-close']);
  assert.ok(pageRequests.every(url => url.startsWith('data:')), 'The page itself requests no export');
  assert.equal(cacheReads, 0, 'The browser image cache is never read');
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  assert.deepEqual(names, ['image-01.png', 'image-02.jpg', 'image-03.png']);
  assert.deepEqual(await Promise.all(names.map(name => zip.file(name).async('string'))), ['first', 'second', 'tenth']);
});

// Minimal DOMParser for the vm sandbox: enough to list <img src> attributes.
class ImageListParser {
  parseFromString(html) {
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => ({ getAttribute: () => m[1].replace(/&amp;/g, '&') }));
    return { querySelectorAll: () => images };
  }
}

test('Docs ZIP lists the current images in document order from the mobile view and fetches them at full size', async () => {
  const env = batchEnvironment('document');
  env.context.DOMParser = ImageListParser;
  const first = 'https://lh7-rt.googleusercontent.com/docsz/FIRST=s800?key=a';
  const second = 'https://lh7-rt.googleusercontent.com/docsz/SECOND=s800?key=b';
  const html = `<html><body><p>Intro</p><img src="${first.replace('&', '&amp;')}"><p>Later page</p>
    <img src="${second}"><img src="${first}"><img src="https://tracker.example/pixel.gif"></body></html>`;
  const requests = [];
  env.context.fetch = async (url, options) => {
    requests.push(url);
    if (url.includes('/mobilebasic')) return { ok: true, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), text: async () => html };
    if (url.includes('SECOND=s0')) return { ok: false, status: 404 };
    return { ok: true, blob: async () => new Blob([url.includes('FIRST') ? 'first-image' : 'second-image'], { type: 'image/png' }) };
  };
  env.start();
  const result = await env.win.__imgloupe.exportAllImages();
  assert.deepEqual({ ...result }, { downloaded: 2, failed: 0, source: 'export' });
  assert.equal(new URL(requests[0]).pathname, '/document/d/batch-fixture/mobilebasic');
  assert.ok(requests.includes('https://lh7-rt.googleusercontent.com/docsz/FIRST=s0?key=a'), 'Images are requested at their stored size');
  assert.ok(requests.includes(second), 'A refused full-size request falls back to the listed size');
  assert.ok(!requests.some(url => url.includes('tracker.example')), 'Only Google-hosted images are packed');
  assert.ok(!requests.some(url => url.includes('/export')), 'The cross-origin Docs export is not requested');
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  assert.deepEqual(await Promise.all(names.map(name => zip.file(name).async('string'))), ['first-image', 'second-image'],
    'ZIP numbering follows document order');
});

test('Spreadsheet IMAGE() cells: original address first, Google\'s copy when the site refuses, cell named in the report', async () => {
  const env = batchEnvironment('spreadsheets');
  backgroundExport(env, [['image1.png', 'image/png', 'embedded']], { imageFormulas: [
    { sheet: '工作表1', cell: 'C3', url: 'https://open.example.com/ok.webp' },
    { sheet: '工作表1', cell: 'G37', url: 'https://blog.example.com/blocked.webp' },
    { sheet: '工作表1', cell: 'B2', url: null },
    { sheet: '工作表1', cell: 'H9', url: 'https://gone.example.com/missing.png' },
    { sheet: '工作表1', cell: 'Z1', url: null }
  ] });
  const proxy = cell => `https://lh3.googleusercontent.com/docsubipk/${cell}=s100-w100-h20`;
  const top = 'items.push({name: "\\u5de5\\u4f5c\\u88681", pageUrl: "x", gid: "0",initialSheet: true});';
  const sheet = `<table><tr><th></th><th id="0C0">A</th><th id="0C1">B</th><th id="0C2">C</th><th id="0C6">G</th></tr>
    <tr><th id="0R1">2</th><td></td><td><img src="${proxy('B2')}"></td><td></td><td></td></tr>
    <tr><th id="0R36">37</th><td></td><td></td><td></td><td><img src="${proxy('G37')}"></td></tr></table>`;
  const requested = [];
  env.context.fetch = async url => {
    url = String(url);
    requested.push(url);
    if (url.startsWith('data:')) return { arrayBuffer: async () => Buffer.from(url.split(',')[1], 'base64') };
    if (url.includes('/htmlview/sheet')) return { ok: true, text: async () => sheet };
    if (url.includes('/htmlview')) return { ok: true, text: async () => top };
    if (url.includes('blocked.webp')) throw new TypeError('Failed to fetch');
    if (url.includes('missing.png')) return { ok: false, status: 404 };
    return { ok: true, blob: async () => new Blob([url.replace(/.*\//, '')], { type: 'image/png' }) };
  };
  env.start();
  const result = await env.win.__imgloupe.exportAllImages();
  assert.deepEqual({ ...result }, { downloaded: 4, failed: 1, source: 'export' });
  assert.ok(requested.some(url => url.endsWith('/docsubipk/G37=s0')), "Google's copy is requested at its stored size");
  assert.ok(requested.some(url => url.endsWith('/docsubipk/B2=s0')), 'IMAGE(A1)-style cells use Google\'s copy');
  assert.ok(requested.some(url => url.includes('htmlview/sheet') && url.includes('gid=0')));
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  assert.deepEqual(Object.keys(zip.files).sort(), ['failed-images.txt', 'image-01.png', 'image-02.png', 'image-03.png', 'image-04.png']);
  assert.deepEqual(await Promise.all(['image-01.png', 'image-02.png', 'image-03.png', 'image-04.png'].map(n => zip.file(n).async('string'))),
    ['embedded', 'ok.webp', 'G37=s0', 'B2=s0']);
  const report = await zip.file('failed-images.txt').async('string');
  assert.match(report, /1\. Sheet "工作表1", cell H9 \(IMAGE formula\)\n {3}Address: https:\/\/gone\.example\.com\/missing\.png\n {3}Reason: {2}The image no longer exists at this address \(HTTP 404\)\./);
  assert.doesNotMatch(report, /Z1/, 'Cells with nothing to download are not reported');
});

test('ZIP falls back to loaded images when the background export is refused', async () => {
  const env = batchEnvironment('presentation');
  backgroundExport(env, [], { fail: true });
  env.context.performance.getEntriesByType = () => [{ name: 'https://docs.google.com/slides-images-rt/loaded' }];
  env.context.fetch = async url => url.includes('/export')
    ? { ok: true, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), arrayBuffer: async () => new ArrayBuffer(8) }
    : { ok: true, blob: async () => new Blob(['loaded-image'], { type: 'image/png' }) };
  env.start();
  const result = await env.win.__imgloupe.exportAllImages();
  assert.deepEqual({ ...result }, { downloaded: 1, failed: 0, source: 'loaded' });
});

test('Non-image responses are reported as failures, never saved under an image name', async () => {
  const env = batchEnvironment('spreadsheets');
  env.context.fetch = async () => ({ ok: true, blob: async () => new Blob(['<html>login page</html>'], { type: 'text/html' }) });
  env.start();
  const result = await env.win.__imgloupe.batchDownloadAllImages(['https://example.com/hr/report']);
  assert.equal(result.downloaded, 0);
  assert.equal(result.failed, 1);
  assert.equal(env.downloads.length, 0, 'No ZIP is created when nothing could be packed');
});

test('Slides ZIP writes identical HTTP/filesystem image bytes only once and preserves distinct images', async () => {
  const env = batchEnvironment('presentation');
  const image = Buffer.from('full-size-slide-image');
  const other = Buffer.from('different-slide-image');
  const filesystemUrl = 'filesystem:https://docs.google.com/persistent/slides/image-a';
  env.win.webkitResolveLocalFileSystemURL = (url, resolve, reject) => {
    url === filesystemUrl ? resolve({ isFile: true, file: callback => callback(new Blob([image], { type: 'image/png' })) }) : reject(new Error('Not found'));
  };
  env.context.fetch = async url => ({ ok: true, blob: async () => new Blob([
    url.includes('other') ? other : image
  ], { type: 'image/png' }) });
  env.start();
  const result = await env.win.__imgloupe.batchDownloadAllImages([
    'https://docs.google.com/slides-images-rt/image-a', filesystemUrl,
    'https://docs.google.com/slides-images-rt/other'
  ]);
  assert.equal(result.downloaded, 2);
  assert.equal(result.failed, 0, 'Duplicate representations are not failed downloads');
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  const contents = await Promise.all(Object.values(zip.files).filter(file => !file.dir).map(file => file.async('nodebuffer')));
  assert.equal(contents.length, 2);
  assert.equal(contents.filter(bytes => bytes.equals(image)).length, 1);
  assert.equal(contents.filter(bytes => bytes.equals(other)).length, 1);
  const again = await env.win.__imgloupe.batchDownloadAllImages([
    'https://docs.google.com/slides-images-rt/image-a', filesystemUrl,
    'https://docs.google.com/slides-images-rt/other'
  ]);
  assert.equal(again.downloaded, 2, 'Each ZIP has its own deduplication scope');
  assert.equal(env.downloads.length, 2);
});

test('ZIP counts duplicate aliases separately from failed reads and retains the failure report', async () => {
  const env = batchEnvironment('presentation');
  env.context.fetch = async url => url.endsWith('/missing') ? { ok: false, status: 404 } :
    { ok: true, blob: async () => new Blob(['same-image'], { type: 'image/png' }) };
  env.start();
  const result = await env.win.__imgloupe.batchDownloadAllImages([
    'https://example.com/first', 'https://example.com/alias', 'https://example.com/missing'
  ]);
  assert.equal(result.downloaded, 1);
  assert.equal(result.failed, 1);
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  assert.equal(Object.keys(zip.files).length, 2);
  const report = await zip.file('failed-images.txt').async('string');
  assert.match(report, /Duplicates skipped: {2}1/);
  assert.match(report, /missing/);
  assert.doesNotMatch(report, /#2:/, 'A duplicate must not be reported as a failed image');
});

test('Docs loaded-image packing uses network-discovered images', async () => {
  const env = batchEnvironment();
  env.context.performance.getEntriesByType = () => [
    { name: 'https://docs.google.com/docs-images-rt/first' },
    { name: 'https://docs.google.com/docs-images-rt/second' }
  ];
  env.context.fetch = async url => ({ ok: true, blob: async () => new Blob([url], { type: 'image/png' }) });
  env.start();
  const result = await env.win.__imgloupe.batchDownloadAllImages();
  assert.equal(result.downloaded, 2);
  assert.equal(result.failed, 0);
});

test('ZIP numbering is consecutive and follows source order even when downloads finish out of order', async () => {
  const env = batchEnvironment('presentation');
  // The first URL resolves last; the second is a byte-identical alias of the fourth.
  const delays = { a: 30, b: 0, c: 10, d: 0 };
  const bytes = { a: 'first', b: 'shared', c: 'third', d: 'shared' };
  env.context.fetch = async url => {
    const key = url.slice(-1);
    await new Promise(resolve => setImmediate(() => setTimeout(resolve, delays[key])));
    return { ok: true, blob: async () => new Blob([bytes[key]], { type: 'image/png' }) };
  };
  env.start();
  const result = await env.win.__imgloupe.batchDownloadAllImages(['https://x.test/a', 'https://x.test/b', 'https://x.test/c', 'https://x.test/d']);
  assert.equal(result.downloaded, 3);
  const zip = await JSZip.loadAsync(Buffer.from(await env.downloads[0].arrayBuffer()));
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  assert.deepEqual(names, ['image-01.png', 'image-02.png', 'image-03.png'], 'No gaps left by skipped duplicates');
  assert.deepEqual(await Promise.all(names.map(name => zip.file(name).async('string'))), ['first', 'shared', 'third']);
});
