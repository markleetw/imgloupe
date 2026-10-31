const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const manifest = require('../../manifest.json');
const { useTraditionalChinese } = require('./locale.cjs');
const popupUrl = pathToFileURL(path.resolve('dist/popup/index.html')).href;

async function openPopup(page, { supported = true, type = 'document', result = { downloaded: 3, failed: 0, source: 'export' }, fail = false, chinese = true } = {}) {
  await page.addInitScript(({ supported, type, result, fail, manifest }) => {
    window.sentMessages = [];
    window.chrome = {
      runtime: { getManifest: () => manifest },
      tabs: {
        query: async () => [{ id: 27 }],
        sendMessage: async (id, message) => {
          window.sentMessages.push(message.type);
          if (!supported) throw new Error('No receiver');
          if (message.type === 'imgloupe:get-app-type') return type;
          if (fail) throw new Error('The tab closed');
          return result;
        }
      }
    };
  }, { supported, type, result, fail, manifest });
  if (chinese) await useTraditionalChinese(page);
  await page.goto(popupUrl);
}

test('popup presents brand, connected document, usage help and local privacy without remote requests', async ({ page }) => {
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await openPopup(page);
  await expect(page.getByRole('heading', { name: 'ImgLoupe', exact: true })).toBeVisible();
  await expect(page.locator('#version')).toHaveText(`v${manifest.version}`);
  await expect(page.getByRole('img', { name: 'ImgLoupe' })).toBeVisible();
  await expect(page.locator('#connection-status')).toHaveText('Google 文件');
  await expect(page.getByText('放大 · 複製 · 擷取文字 · 下載', { exact: true })).toBeVisible();
  await expect(page.getByText('辨識圖片上的文字', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打包下載圖片' })).toBeEnabled();
  await expect(page.getByRole('link', { name: '回報問題' })).toHaveAttribute('href', 'https://github.com/markleetw/imgloupe/issues');
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/markleetw/imgloupe');
  await expect(page.locator('input, select, [role="switch"]')).toHaveCount(0);
  const privacy = page.getByRole('link', { name: '隱私說明' });
  await expect(privacy).toHaveAttribute('href', 'privacy.html');
  await expect(page.locator('a')).toHaveCount(3);
  expect(requests.filter(url => /^https?:/.test(url))).toEqual([]);
  await page.locator('body').screenshot({ path: 'scratch/popup-preview.png' });
});

for (const [type, name] of [['spreadsheets', 'Google 試算表'], ['presentation', 'Google 簡報']]) {
  test(`connection state names ${name} without requesting new permissions`, async ({ page }) => {
    await openPopup(page, { type });
    await expect(page.locator('#connection-status')).toHaveText(name);
    await expect(page.getByRole('button', { name: '打包下載圖片' })).toBeEnabled();
  });
}

test('privacy link opens the bundled policy and dark mode remains legible', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openPopup(page);
  const newPage = context.waitForEvent('page');
  await page.getByRole('link', { name: '隱私說明' }).click();
  const privacy = await newPage;
  await expect(privacy.getByRole('heading', { name: 'Privacy policy — ImgLoupe' })).toBeVisible();
  await expect(privacy.getByText('Information handled', { exact: true })).toBeVisible();
  await page.locator('body').screenshot({ path: 'scratch/popup-preview-dark.png' });
});

test('ZIP export reports partial success and can be retried', async ({ page }) => {
  await openPopup(page, { result: { downloaded: 3, failed: 1, source: 'export' } });
  await page.getByRole('button', { name: '打包下載圖片' }).click();
  await expect(page.getByRole('status')).toHaveText('已從文件匯出 3 張圖片。 另有 1 張未成功。');
  await expect(page.getByRole('button', { name: '打包下載圖片' })).toBeEnabled();
  expect(await page.evaluate(() => window.sentMessages)).toEqual(['imgloupe:get-app-type', 'imgloupe:export-images']);
});

test('ZIP export explains when only loaded images could be packed', async ({ page }) => {
  await openPopup(page, { result: { downloaded: 2, failed: 0, source: 'loaded' } });
  await page.getByRole('button', { name: '打包下載圖片' }).click();
  await expect(page.getByRole('status')).toContainText('無法取得文件匯出檔');
});

test('browsers in other languages get the English interface', async ({ page }) => {
  await openPopup(page, { chinese: false });
  await expect(page.locator('#connection-status')).toHaveText('Google Docs');
  await expect(page.getByRole('button', { name: 'Download all images (ZIP)' })).toBeEnabled();
  await expect(page.getByText('Preview · Copy · Extract text · Download', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', 'privacy.html');
});

test('unsupported pages disable export and explain how to enable it', async ({ page }) => {
  await openPopup(page, { supported: false });
  await expect(page.getByRole('button', { name: '打包下載圖片' })).toBeDisabled();
  await expect(page.locator('#connection-status')).toHaveText('還沒開啟支援的文件');
  await expect(page.getByRole('status')).toContainText('先開啟一份 Google 文件、試算表或簡報');
});

test('a closed tab produces an actionable error and restores the button', async ({ page }) => {
  await openPopup(page, { fail: true });
  await page.getByRole('button', { name: '打包下載圖片' }).click();
  await expect(page.getByRole('status')).toContainText('請重新整理文件後再試一次');
  await expect(page.getByRole('button', { name: '打包下載圖片' })).toBeEnabled();
});
