const { test, expect } = require('@playwright/test');

test('bundled OCR recognizes text with every request confined to localhost', async ({ page, context }) => {
  test.setTimeout(60000);
  const remote = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    remote.push(url);
    return route.abort();
  });
  await page.addInitScript(() => {
    // Plain Chromium pages need not expose Chrome's extension namespace.
    delete window.chrome;
    window.chrome = {
      runtime: {
        id: 'imgloupe-test',
        getURL: path => `http://127.0.0.1:4173/${path}`,
        onMessage: { addListener(listener) { window.ocrListener = listener; } }
      }
    };
  });
  await page.goto('http://127.0.0.1:4173/dist/offscreen/offscreen.html');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, 600, 180);
    context.fillStyle = 'black'; context.font = '64px Arial'; context.fillText('Hello 2026', 40, 110);
    return new Promise(resolve => window.ocrListener({ target: 'offscreen', type: 'do-ocr', image: canvas.toDataURL() }, { id: 'imgloupe-test' }, resolve));
  });
  expect(result.success).toBe(true);
  expect(result.text).toMatch(/Hello\s+2026/);
  expect(remote).toEqual([]);
});
