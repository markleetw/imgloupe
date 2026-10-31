const { test, expect } = require('@playwright/test');
const { Resvg } = require('@resvg/resvg-js');
const path = require('node:path');
const correct = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#2460bb"/><rect x="150" width="150" height="100" fill="#ffc43a"/></svg>').render().asPng();
const decoy = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#f13b31"/></svg>').render().asPng();

test('a Docs selection spanning two canvas tiles opens the matching loaded image', async ({ page }) => {
  await page.route('https://fixtures.example.test/**', route => route.fulfill({
    contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
    body: route.request().url().endsWith('correct.png') ? correct : decoy
  }));
  await page.route('https://docs.google.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><div class="docs-squarehandleselectionbox-border" style="position:absolute;left:50px;top:50px;width:180px;height:120px;z-index:2"></div>
    <canvas class="kix-canvas-tile-content" width="360" height="120" style="position:absolute;left:50px;top:50px;width:180px;height:60px"></canvas>
    <canvas class="kix-canvas-tile-content" width="360" height="120" style="position:absolute;left:50px;top:110px;width:180px;height:60px"></canvas>
    <svg class="kix-embeddedobject-image" style="display:none"><image href="https://fixtures.example.test/decoy.png"/><image href="https://fixtures.example.test/correct.png"/></svg>
    </body></html>` }));
  await page.addInitScript(() => {
    chrome.runtime = { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener() {} } };
  });
  await page.goto('https://docs.google.com/document/d/test/edit');
  await page.evaluate(async () => {
    const image = new Image(); image.crossOrigin = 'anonymous'; image.src = 'https://fixtures.example.test/correct.png'; await image.decode();
    const tiles = document.querySelectorAll('canvas');
    tiles[0].getContext('2d').drawImage(image, 0, 0, 300, 100, 0, 0, 360, 120);
    tiles[1].getContext('2d').drawImage(image, 0, 100, 300, 100, 0, 0, 360, 120);
  });
  await page.addScriptTag({ path: path.resolve('dist/contentScripts/index.global.js') });
  await page.addStyleTag({ path: path.resolve('dist/contentScripts/style.css') });
  await page.locator('.docs-squarehandleselectionbox-border').click();
  await expect(page.locator('#imgloupe-action-preview')).toBeVisible();
  await page.locator('#imgloupe-action-preview').click();
  await expect(page.locator('.viewer-canvas img')).toHaveAttribute('src', 'https://fixtures.example.test/correct.png');
});
