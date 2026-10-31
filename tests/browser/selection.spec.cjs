const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function documentPage(page, platform = 'document') {
  await page.route('https://docs.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html><body>
    <div class="kix-page-content-wrapper" style="height:500px">
      <div class="docs-squarehandleselectionbox-border" style="position:absolute;left:60px;top:70px;width:180px;height:120px"></div>
      <svg class="kix-embeddedobject-image" style="position:absolute;left:60px;top:70px" width="180" height="120">
        <image href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='120'%3E%3Crect width='180' height='120' fill='blue'/%3E%3C/svg%3E" width="180" height="120"/>
      </svg>
    </div></body></html>` }));
  await page.addInitScript(() => {
    window.messages = [];
    chrome.runtime = {
      id: 'local-test',
      getURL: file => `chrome-extension://local-test/${file}`,
      sendMessage: async message => { window.messages.push(message); return null; },
      onMessage: { addListener() {} }
    };
  });
  await page.goto(`https://docs.google.com/${platform}/d/test/edit`);
  await page.addScriptTag({ path: path.resolve('dist/contentScripts/index.global.js') });
  await page.addStyleTag({ path: path.resolve('dist/contentScripts/style.css') });
}

test('opening a document never starts OCR in the background', async ({ page }) => {
  await documentPage(page);
  expect(await page.evaluate(() => window.messages)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'prewarm-ocr' })]));
});

test('selected Docs images get four actions outside the image, never over it', async ({ page }) => {
  await documentPage(page);
  await page.locator('svg image').click();
  const toolbar = page.locator('#imgloupeToolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button')).toHaveCount(4);
  // A narrow image (180px): the toolbar sits on its right, aligned with its top.
  const frame = await toolbar.boundingBox();
  expect(await toolbar.getAttribute('data-placement')).toBe('right');
  expect(frame.x).toBeGreaterThanOrEqual(240);
  expect(Math.round(frame.y)).toBe(70);
  expect(await page.evaluate(() => window.messages.some(m => m.type === 'prewarm-ocr'))).toBe(false);
});

for (const scale of [1, 0.5]) test(`Docs resolves a hidden dragger at scale ${scale} only when its layout matches`, async ({ page }) => {
  await documentPage(page);
  await page.evaluate(scale => {
    document.querySelector('.kix-page-content-wrapper').style.cssText = `position:relative;height:500px;transform:scale(${scale});transform-origin:top left;border:5px solid transparent;overflow:scroll`;
    const svg = document.querySelector('svg');
    const dragger = document.createElement('div');
    dragger.className = 'kix-embeddedobjectdragger';
    dragger.style.cssText = 'display:none;position:absolute;left:60px;top:70px;width:180px;height:120px';
    svg.before(dragger); dragger.append(svg);
  }, scale);
  await page.locator('.docs-squarehandleselectionbox-border').click();
  await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
  await page.evaluate(() => { document.querySelector('.kix-embeddedobjectdragger').style.left = '260px'; });
  await page.locator('.docs-squarehandleselectionbox-border').click();
  await expect(page.locator('#imgloupe-action-preview')).toBeHidden();
});

test('preview SVG button centers zoom, rotate and reset the actual image', async ({ page }) => {
  await documentPage(page);
  await page.locator('svg image').click();
  await page.locator('#imgloupe-action-preview').click();
  const image = page.locator('.viewer-canvas img');
  await expect(image).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('#imgloupe-viewer-source').viewer?.viewed)).toBe(true);
  const initialWidth = await image.evaluate(el => parseFloat(el.style.width));
  await page.locator('[data-viewer-action="zoom-in"]').click();
  await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(initialWidth);
  await page.locator('[data-viewer-action="zoom-out"]').click();
  await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeCloseTo(initialWidth, 0);
  await page.locator('[data-viewer-action="rotate-left"]').click();
  await expect(image).toHaveCSS('transform', /matrix\(0, -1, 1, 0,/);
  await page.locator('[data-viewer-action="reset"]').click();
  await expect(image).toHaveCSS('transform', 'none');
  await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeCloseTo(initialWidth, 0);
});

test('wide images get the toolbar above their top-right corner', async ({ page }) => {
  await documentPage(page);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('.docs-squarehandleselectionbox-border, svg.kix-embeddedobject-image')) {
      Object.assign(element.style, { left: '20px', top: '150px', width: '360px', height: '200px' });
    }
    const svg = document.querySelector('svg.kix-embeddedobject-image');
    svg.setAttribute('width', '360'); svg.setAttribute('height', '200');
    svg.querySelector('image').setAttribute('width', '360'); svg.querySelector('image').setAttribute('height', '200');
  });
  await page.locator('svg image').click();
  const toolbar = page.locator('#imgloupeToolbar');
  await expect(toolbar).toBeVisible();
  expect(await toolbar.getAttribute('data-placement')).toBe('above');
  const frame = await toolbar.boundingBox();
  expect(frame.y + frame.height).toBeLessThanOrEqual(150);
  expect(Math.round(frame.x + frame.width)).toBe(380);
});
