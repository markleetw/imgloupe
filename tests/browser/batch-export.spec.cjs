const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Resvg } = require('@resvg/resvg-js');
const JSZip = require('jszip');
const { launchWithExtension, waitForContentScript, exportFromPopup } = require('./extension-context.cjs');

const fixtures = ['#2678be', '#ed9a29', '#3b9c5a'].map(color => new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${color}"/></svg>`
).render().asPng());

const OFFICE = {
  spreadsheets: { folder: 'xl/media/', exportPath: '/spreadsheets/d/batch-fixture/export' },
  presentation: { folder: 'ppt/media/', exportPath: '/presentation/d/batch-fixture/export/pptx' }
};

async function officePackage(folder, images) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  images.forEach((bytes, index) => zip.file(`${folder}image${index + 1}.png`, bytes));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function withExtension(run) {
  const scratch = path.resolve('scratch');
  await fs.mkdir(scratch, { recursive: true });
  const profile = await fs.mkdtemp(path.join(scratch, 'batch-export-profile-'));
  let context;
  try {
    context = await launchWithExtension(profile);
    await run(context);
  } finally {
    await context?.close();
    if (!profile.startsWith(scratch + path.sep)) throw new Error('Refusing cleanup outside scratch');
    await fs.rm(profile, { recursive: true, force: true });
  }
}

async function zipContents(download) {
  const zip = await JSZip.loadAsync(await fs.readFile(await download.path()));
  return Promise.all(Object.values(zip.files).filter(file => !file.dir).map(file => file.async('nodebuffer')));
}

for (const platform of Object.keys(OFFICE)) test(`installed extension: ${platform} ZIP comes from Google's export of the current version`, async () => {
  test.setTimeout(60000);
  const { folder, exportPath } = OFFICE[platform];
  // The export holds only the current images; a stale image is loaded in the page
  // (as if deleted from the document) and must not appear in the ZIP.
  const current = fixtures.slice(0, 2);
  const packageBytes = await officePackage(folder, current);
  await withExtension(async context => {
    const exportRequests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://docs.google.com' && url.hostname !== 'doc-00-docstext.googleusercontent.com') return /^https?:$/.test(url.protocol) ? route.abort() : route.continue();
      // Google redirects the export to a googleusercontent download host. Playwright
      // cannot synthesize redirects for service-worker requests, so the package is
      // served directly; the request must come from the background worker.
      if (url.pathname === exportPath) {
        exportRequests.push({ url: url.href, fromWorker: !!route.request().serviceWorker() });
        return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument', body: packageBytes });
      }
      if (url.pathname.includes('-images-rt/stale')) return route.fulfill({ contentType: 'image/png', body: fixtures[2] });
      return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="workspace-container"><svg width="160" height="100"><image href="https://docs.google.com/slides-images-rt/stale" width="160" height="100"/></svg></div></body></html>' });
    });
    const page = await context.newPage();
    await page.goto(`https://docs.google.com/${platform}/d/batch-fixture/edit`);
    const worker = await waitForContentScript(context, page);
    const event = page.waitForEvent('download');
    expect(await exportFromPopup(worker)).toEqual({ downloaded: 2, failed: 0, source: 'export' });
    expect(exportRequests).toHaveLength(1);
    expect(exportRequests[0].fromWorker).toBe(true);
    const contents = await zipContents(await event);
    expect(contents).toHaveLength(2);
    for (const fixture of current) expect(contents.filter(bytes => bytes.equals(fixture))).toHaveLength(1);
    expect(contents.some(bytes => bytes.equals(fixtures[2]))).toBe(false);
  });
});

test('installed extension: Docs ZIP lists current images from the mobile view, in document order, at full size', async () => {
  test.setTimeout(60000);
  await withExtension(async context => {
    const requested = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'lh7-rt.googleusercontent.com') {
        requested.push(url.pathname);
        const index = url.pathname.includes('SECOND') ? 1 : 0;
        return route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: fixtures[index] });
      }
      if (url.origin !== 'https://docs.google.com') return /^https?:$/.test(url.protocol) ? route.abort() : route.continue();
      if (url.pathname.endsWith('/export')) return route.fulfill({ status: 307, headers: { location: 'https://doc-00-docstext.googleusercontent.com/export/x' } });
      if (url.pathname.endsWith('/mobilebasic')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        '<html><body><p>one</p><img src="https://lh7-rt.googleusercontent.com/docsz/FIRST=s800?key=a"><p>two</p><img src="https://lh7-rt.googleusercontent.com/docsz/SECOND=s800?key=b"></body></html>' });
      return route.fulfill({ contentType: 'text/html', body: '<html><body><canvas class="kix-canvas-tile-content" width="200" height="200"></canvas></body></html>' });
    });
    const page = await context.newPage();
    await page.goto('https://docs.google.com/document/d/batch-fixture/edit?tab=t.0');
    const worker = await waitForContentScript(context, page);
    const event = page.waitForEvent('download');
    expect(await exportFromPopup(worker)).toEqual({ downloaded: 2, failed: 0, source: 'export' });
    expect(requested).toEqual(expect.arrayContaining(['/docsz/FIRST=s0', '/docsz/SECOND=s0']));
    const zip = await JSZip.loadAsync(await fs.readFile(await (await event).path()));
    const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
    const contents = await Promise.all(names.map(name => zip.file(name).async('nodebuffer')));
    expect(contents.map(bytes => bytes.equals(fixtures[0]) ? 'first' : bytes.equals(fixtures[1]) ? 'second' : '?')).toEqual(['first', 'second']);
  });
});

test('installed extension: ZIP falls back to loaded images when the export is refused', async () => {
  test.setTimeout(60000);
  await withExtension(async context => {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://docs.google.com') return /^https?:$/.test(url.protocol) ? route.abort() : route.continue();
      if (url.pathname.endsWith('/export/pptx')) return route.fulfill({ status: 403, contentType: 'text/html', body: 'Forbidden' });
      if (url.pathname.includes('-images-rt/loaded')) return route.fulfill({ contentType: 'image/png', body: fixtures[0] });
      return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="workspace-container"><svg width="160" height="100"><image href="https://docs.google.com/slides-images-rt/loaded" width="160" height="100"/></svg></div></body></html>' });
    });
    const page = await context.newPage();
    await page.goto('https://docs.google.com/presentation/d/batch-fixture/edit');
    const worker = await waitForContentScript(context, page);
    const event = page.waitForEvent('download');
    expect(await exportFromPopup(worker)).toEqual({ downloaded: 1, failed: 0, source: 'loaded' });
    const contents = await zipContents(await event);
    expect(contents).toHaveLength(1);
    expect(contents[0].equals(fixtures[0])).toBe(true);
  });
});
