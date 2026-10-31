const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { Resvg } = require('@resvg/resvg-js');
const { useTraditionalChinese } = require('./locale.cjs');

const versions = [{ name: 'current', source: fs.readFileSync('dist/contentScripts/index.global.js', 'utf8'), css: fs.readFileSync('dist/contentScripts/style.css', 'utf8') }];
const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#2460bb"/><rect x="120" width="120" height="80" fill="#ffc43a"/></svg>').render().asPng();
const imageUrl = 'https://docs.google.com/slides-images-rt/fixture.png';

async function workspace(page, version, { platform = 'presentation', html, prepare } = {}) {
  await page.route('https://docs.google.com/**', route => new URL(route.request().url()).pathname.includes('.png') ?
    route.fulfill({ contentType: 'image/png', body: png }) : route.fulfill({ contentType: 'text/html', body: html || `
      <html><body style="margin:0;height:1800px"><div id="workspace-container">
      <svg style="position:absolute;left:40px;top:80px" width="240" height="160"><image id="selected-image" href="${imageUrl}" width="240" height="160"/></svg>
      </div></body></html>` }));
  await page.addInitScript(() => {
    delete window.chrome;
    window.chrome = { runtime: { id: 'fixture', getURL: file => `chrome-extension://fixture/${file}`,
      onMessage: { addListener() {} }, sendMessage(message, callback) { callback?.(null); return Promise.resolve(null); } } };
    window.__copiedImages = 0;
    Object.defineProperty(navigator, 'clipboard', { value: { async write(items) {
      const blob = await items[0].getType('image/png');
      if (blob.type !== 'image/png') throw new Error('Expected a real PNG');
      window.__copiedImages++;
    }, async writeText() {} } });
  });
  await useTraditionalChinese(page);
  await page.goto(`https://docs.google.com/${platform}/d/fixture/edit`);
  await prepare?.(page);
  await page.addScriptTag({ content: version.source });
  await page.addStyleTag({ content: version.css });
}

async function selectImage(page) {
  await page.locator('#selected-image').click();
  await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
}
async function preview(page) {
  await selectImage(page);
  await page.locator('#imgloupe-action-preview').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#imgloupe-viewer-source')?.viewer?.viewed)).toBe(true);
}
async function discovered(page, type) {
  return page.evaluate(type => {
    const api = window.__imgloupe;
    return (api.getNetworkResourceUrls || api.Ir)(type);
  }, type);
}

for (const version of versions) test.describe(version.name, () => {
  test('Slides keeps the selected image actions after arrow-key movement', async ({ page }) => {
    await workspace(page, version); await selectImage(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
    await page.locator('#imgloupe-action-preview').click();
    await expect(page.locator('.viewer-canvas img')).toHaveAttribute('src', imageUrl);
  });

  test('Escape closes preview and restores the selected image actions', async ({ page }) => {
    await workspace(page, version); await preview(page);
    // Behind the open preview the image actions are hidden and inert.
    await expect(page.locator('#imgloupe-action-preview')).toBeHidden();
    expect(await page.locator('#imgloupeToolbar').evaluate(node => node.inert)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.viewer-container')).toBeHidden();
    await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
  });

  test('holding Escape through preview close does not discard the image actions', async ({ page }) => {
    await workspace(page, version); await preview(page);
    await page.keyboard.down('Escape');
    await expect(page.locator('.viewer-container')).toBeHidden();
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
  });

  test('image actions leave the viewport with their selected image and return on scroll back', async ({ page }) => {
    await workspace(page, version); await selectImage(page);
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.locator('#imgloupe-action-copy').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return getComputedStyle(el).display !== 'none' && rect.bottom > 0 && rect.top < innerHeight && !!el.checkVisibility();
    })).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#imgloupe-action-copy')).toBeVisible();
  });

  test('successful image copy gives visible completion feedback', async ({ page }) => {
    await workspace(page, version); await selectImage(page);
    await page.locator('#imgloupe-action-copy').click();
    await expect.poll(() => page.evaluate(() => window.__copiedImages)).toBe(1);
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('#imgloupe-action-copy')?.getAttribute('aria-label') === '已完成！' ||
      /已複製圖片/.test(document.querySelector('#imgloupe-toast')?.textContent || '')
    )).toBe(true);
  });

  test('Docs remembers loaded image resources before the first ZIP request', async ({ page }) => {
    await workspace(page, version, { platform: 'document', html: '<html><body></body></html>' });
    const url = 'https://docs.google.com/docs-images-rt/earlier.png';
    await page.evaluate(async url => { const img = new Image(); img.src = url; await img.decode(); }, url);
    // Let resource observers deliver before deliberately discarding browser timing history.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    await page.evaluate(() => performance.clearResourceTimings());
    expect((await discovered(page, 'document')).some(value => value.startsWith(url))).toBe(true);
  });

  test('Slides ZIP discovery includes images in the read-only viewer', async ({ page }) => {
    const url = 'https://lh3.googleusercontent.com/readonly-fixture';
    await workspace(page, version, { html: `<html><body><div class="punch-viewer-content"><svg><image href="${url}"/></svg></div></body></html>` });
    const urls = await discovered(page, 'presentation');
    expect(urls.some(value => value.startsWith(url))).toBe(true);
  });

  test('Docs download does not clear its selected image actions', async ({ page }) => {
    const url = 'https://docs.google.com/docs-images-rt/document.png';
    await workspace(page, version, { platform: 'document', html: `<html><body>
      <canvas class="kix-canvas-tile-content" width="240" height="160" style="position:absolute;left:40px;top:80px;width:240px;height:160px"></canvas>
      <svg class="kix-embeddedobject-image" style="position:absolute;left:40px;top:80px" width="240" height="160"><image href="${url}" width="240" height="160"/></svg>
      <div id="selected-image" class="docs-squarehandleselectionbox-border" style="position:absolute;left:40px;top:80px;width:240px;height:160px;z-index:2"></div>
      </body></html>`, prepare: page => page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        document.querySelector('canvas').getContext('2d').drawImage(image, 0, 0);
      }, url) });
    await selectImage(page);
    const event = page.waitForEvent('download');
    await page.locator('#imgloupe-action-download').click();
    await event;
    await expect(page.locator('#imgloupe-action-download')).toBeEnabled();
    await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
  });

  test('preview controls, drag, wheel, crop cancellation and reopen keep working', async ({ page }) => {
    await workspace(page, version); await preview(page);
    const image = page.locator('.viewer-canvas img');
    const initial = await image.boundingBox();
    await page.locator('[data-viewer-action="zoom-in"]').click();
    await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(initial.width);
    await page.locator('[data-viewer-action="reset"]').click();
    await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeCloseTo(initial.width, 0);
    await page.locator('[data-viewer-action="rotate-left"]').click();
    await expect(image).toHaveCSS('transform', /matrix\(0, -1, 1, 0,/);
    await page.locator('[data-viewer-action="reset"]').click();
    await expect(image).toHaveCSS('transform', 'none');
    await image.hover(); await page.mouse.wheel(0, -120);
    await expect.poll(() => image.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(initial.width);
    await image.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const before = await image.boundingBox();
    await page.mouse.move(before.x + 40, before.y + 40); await page.mouse.down();
    await page.mouse.move(before.x + 70, before.y + 60, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await image.boundingBox()).x).toBeGreaterThan(before.x + 20);
    await page.locator('.viewer-crop-ocr-btn').click();
    await expect(page.locator('.imgloupe-crop-overlay')).toBeVisible();
    await page.locator('.imgloupe-crop-hint-close').click();
    await expect(page.locator('.imgloupe-crop-overlay')).toHaveCount(0);
    await page.locator('.viewer-button').click();
    await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
    await page.locator('#imgloupe-action-preview').click();
    await expect(image).toBeVisible();
  });
});

test('changing a selected Slides source updates actions and removal clears selection', async ({ page }) => {
  await workspace(page, versions.at(-1)); await selectImage(page);
  const replacement = 'https://docs.google.com/slides-images-rt/replacement.png';
  await page.locator('#selected-image').evaluate((image, url) => image.setAttribute('href', url), replacement);
  await expect.poll(() => page.evaluate(() => window.__imgloupe.getActiveImageUrl())).toBe(replacement);
  const latest = 'https://docs.google.com/slides-images-rt/latest.png';
  await page.locator('#selected-image').evaluate(async (image, url) => {
    image.setAttribute('href', url + '?pending');
    await Promise.resolve();
    image.setAttribute('href', url);
  }, latest);
  await expect.poll(() => page.evaluate(() => window.__imgloupe.getActiveImageUrl())).toBe(latest);
  await page.locator('#selected-image').evaluate(image => image.remove());
  await expect(page.locator('#imgloupe-action-preview')).toBeHidden();
});

test('rapidly selecting two Slides images keeps the latest click', async ({ page }) => {
  await workspace(page, versions.at(-1));
  const secondUrl = 'https://docs.google.com/slides-images-rt/second.png';
  await page.evaluate(async url => {
    const first = document.querySelector('svg');
    first.setAttribute('width', '120'); first.setAttribute('height', '80'); first.style.left = '20px';
    const image = first.querySelector('image'); image.setAttribute('width', '120'); image.setAttribute('height', '80');
    const second = first.cloneNode(true); second.style.left = '220px';
    second.querySelector('image').setAttribute('href', url); second.querySelector('image').removeAttribute('id'); first.after(second);
    const click = element => { const r = element.getBoundingClientRect(); element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); };
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    click(image);
    await new Promise(requestAnimationFrame);
    click(second.querySelector('image'));
  }, secondUrl);
  await expect.poll(() => page.evaluate(() => window.__imgloupe.getActiveImageUrl())).toBe(secondUrl);
});

for (const platform of ['presentation', 'spreadsheets']) test(`${platform}: Tab cannot retain an unconfirmed previous image`, async ({ page }) => {
  const html = platform === 'spreadsheets' ? `<html><body><div class="waffle-borderless-embedded-object-container" style="position:absolute;left:40px;top:80px;width:240px;height:160px"><img id="selected-image" src="${imageUrl}" width="240" height="160"></div></body></html>` : undefined;
  await workspace(page, versions.at(-1), { platform, html }); await selectImage(page);
  await page.keyboard.press('Tab');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await expect(page.locator('#imgloupe-action-preview')).toBeHidden();
  expect(await page.evaluate(() => window.__imgloupe.handleToolbarAction('copy'))).toBe(false);
});
