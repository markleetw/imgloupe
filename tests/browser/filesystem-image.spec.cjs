const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const JSZip = require('jszip');
const { launchWithExtension, waitForContentScript, exportFromPopup } = require('./extension-context.cjs');

for (const platform of ['document', 'spreadsheets', 'presentation']) test(`installed extension: ${platform} filesystem copy, download, ZIP and OCR without network access`, async () => {
  test.setTimeout(90000);
  const root = path.resolve('.');
  const profile = await fs.mkdtemp(path.resolve('scratch/extension-profile-'));
  let context;
  try {
    context = await launchWithExtension(profile, { extension: root });
    const remote = [];
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://docs.google.com' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('https://docs.google.com/')) {
        if (/^https?:/.test(url)) { remote.push(url); return route.abort(); }
        return route.continue();
      }
      const position = 'position:absolute;left:40px;top:80px;width:600px;height:360px';
      const svg = '<svg width="600" height="360"><image id="fixture-image" width="600" height="360"/></svg>';
      const body = platform === 'spreadsheets' ? `<div class="waffle-borderless-embedded-object-container" style="${position}"><img id="fixture-image" width="600" height="360"></div>` :
        platform === 'presentation' ? `<div id="workspace-container" style="${position}">${svg}</div>` :
          `<div class="docs-squarehandleselectionbox-border" style="${position}"></div><div class="kix-embeddedobjectdragger" style="display:none;${position}">${svg.replace('<svg ', '<svg class="kix-embeddedobject-image" ')}</div>`;
      return route.fulfill({ contentType: 'text/html', body: `<html><body>${body}</body></html>` });
    });
    const page = await context.newPage();
    await page.goto(`https://docs.google.com/${platform}/d/fixture/edit`);
    await waitForContentScript(context, page);
    await page.evaluate(() => navigator.clipboard.writeText('before image copy'));
    await context.clearPermissions();
    const source = await page.evaluate(async platform => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 360;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 360);
      ctx.fillStyle = 'black'; ctx.font = '64px Arial'; ctx.fillText('Hello 2026', 40, 110);
      ctx.fillText('Total 12345', 40, 300);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, platform === 'presentation' ? 'image/jpeg' : 'image/png'));
      const filesystem = await new Promise((resolve, reject) => window.webkitRequestFileSystem(window.TEMPORARY, 1024 * 1024, resolve, reject));
      const entry = await new Promise((resolve, reject) => filesystem.root.getFile('fixture.png', { create: true }, resolve, reject));
      const writer = await new Promise((resolve, reject) => entry.createWriter(resolve, reject));
      await new Promise((resolve, reject) => { writer.onwriteend = resolve; writer.onerror = reject; writer.write(blob); });
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = entry.toURL(); await img.decode();
      const target = document.querySelector('#fixture-image');
      if (target.tagName === 'IMG') { target.crossOrigin = 'anonymous'; target.src = img.src; await target.decode(); }
      else target.setAttribute('href', img.src);
      return { url: img.src, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    }, platform);
    expect(source.url).toMatch(/^filesystem:https:\/\/docs.google.com\//);
    const selected = page.locator(platform === 'document' ? '.docs-squarehandleselectionbox-border' : '#fixture-image');
    await selected.click();
    await expect(page.locator('#imgloupe-action-copy')).toBeVisible();
    await page.locator('#imgloupe-action-copy').click();
    await expect(page.locator('#imgloupe-action-copy')).toBeEnabled();
    await context.grantPermissions(['clipboard-read'], { origin: 'https://docs.google.com' });
    await expect.poll(() => page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find(item => item.types.includes('image/png'));
      if (!item) return null;
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
    })).toEqual([600, 360]);
    await context.clearPermissions();
    await page.locator('#imgloupe-action-ocr').click();
    await expect(page.locator('#imgloupe-toast')).toContainText('已複製圖片文字', { timeout: 60000 });
    await context.grantPermissions(['clipboard-read'], { origin: 'https://docs.google.com' });
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 60000 }).toMatch(/Hello\s+2026/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/Total\s+12345/);

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#imgloupe-action-download').click();
    const downloaded = await downloadEvent;
    expect(await fs.readFile(await downloaded.path())).toEqual(Buffer.from(source.bytes));

    // The fixture page has no Office export, so the ZIP falls back to loaded images.
    const worker = await waitForContentScript(context, page);
    const zipEvent = page.waitForEvent('download');
    expect(await exportFromPopup(worker)).toEqual({ downloaded: 1, failed: 0, source: 'loaded' });
    const zip = await JSZip.loadAsync(await fs.readFile(await (await zipEvent).path()));
    const files = Object.values(zip.files).filter(file => !file.dir);
    expect(files).toHaveLength(1);
    expect(await files[0].async('nodebuffer')).toEqual(Buffer.from(source.bytes));

    // Crop the top half: it contains Hello, while Total is near the bottom.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://docs.google.com' });
    await page.evaluate(() => navigator.clipboard.writeText('before crop'));
    await context.clearPermissions();
    await selected.click();
    await page.locator('#imgloupe-action-preview').click();
    const preview = page.locator('.viewer-canvas img');
    await expect.poll(() => preview.evaluate(image => parseFloat(image.style.width))).toBeGreaterThan(0);
    await preview.evaluate(image => Promise.all(image.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const rect = await preview.boundingBox();
    await page.locator('.viewer-crop-ocr-btn').click();
    await page.mouse.move(rect.x + 8, rect.y + 8); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 8, rect.y + rect.height / 2 - 8, { steps: 4 }); await page.mouse.up();
    await expect(page.locator('.imgloupe-crop-overlay')).toHaveCount(0);
    await expect(page.locator('#imgloupe-toast')).toContainText('已複製圖片文字', { timeout: 60000 });
    await context.grantPermissions(['clipboard-read'], { origin: 'https://docs.google.com' });
    const croppedText = await page.evaluate(() => navigator.clipboard.readText());
    expect(croppedText).toMatch(/Hello\s+2026/);
    expect(croppedText).not.toMatch(/Total/);
    expect(remote).toEqual([]);
  } finally {
    await context?.close();
    if (!profile.startsWith(path.resolve('scratch') + path.sep)) throw new Error('Profile escaped scratch directory');
    await fs.rm(profile, { recursive: true, force: true });
  }
});
