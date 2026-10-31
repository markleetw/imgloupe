// Real Chrome i18n (no chrome.i18n mock): the installed extension's toolbar and
// popup follow the browser UI language, Traditional Chinese for zh-TW and
// English for everything else.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { launchWithExtension, waitForContentScript } = require('./extension-context.cjs');

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CASES = [
  { lang: 'zh-TW', labels: ['放大檢視', '複製圖片', '擷取文字', '下載圖片'], zip: '打包下載圖片' },
  { lang: 'en-US', labels: ['Preview', 'Copy image', 'Extract text', 'Download image'], zip: 'Download all images (ZIP)' },
  { lang: 'zh-CN', labels: ['Preview', 'Copy image', 'Extract text', 'Download image'], zip: 'Download all images (ZIP)' },
  { lang: 'ja', labels: ['Preview', 'Copy image', 'Extract text', 'Download image'], zip: 'Download all images (ZIP)' }
];

for (const { lang, labels, zip } of CASES) test(`installed extension: ${lang} browser UI language picks the interface language`, async () => {
  test.setTimeout(60000);
  const profile = await fs.mkdtemp(path.resolve('scratch/extension-profile-'));
  let context;
  try {
    context = await launchWithExtension(profile, { lang, extension: path.resolve('.') });
    await context.route('**/*', route => route.request().url().startsWith('https://docs.google.com/')
      ? route.fulfill({ contentType: 'text/html', body: `<html><body><div class="waffle-borderless-embedded-object-container" style="position:absolute;left:40px;top:80px;width:300px;height:200px"><img id="fixture-image" src="${PIXEL}" width="300" height="200"></div></body></html>` })
      : route.continue());
    const page = await context.newPage();
    await page.goto('https://docs.google.com/spreadsheets/d/fixture/edit');
    const worker = await waitForContentScript(context, page);
    await page.locator('#fixture-image').click();
    const buttons = page.locator('#imgloupe-action-preview, #imgloupe-action-copy, #imgloupe-action-ocr, #imgloupe-action-download');
    await expect(buttons).toHaveCount(4);
    expect(await buttons.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(labels);

    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/dist/popup/index.html`);
    await expect(popup.locator("#imgloupe-batch-export-btn")).toHaveText(zip);
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
