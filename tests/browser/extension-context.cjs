// Launch Chromium with the unpacked extension. CI uses Playwright's Chromium;
// set IMGLOUPE_CHROME to a Chrome/Chromium executable to run locally instead.
// The UI language is zh-TW unless a test asks for another one.
const { chromium, expect } = require('@playwright/test');
// Route and observe requests made by the extension's service worker as well.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const path = require('node:path');

function launchWithExtension(profile, { lang = 'zh-TW', extension = path.resolve(process.env.IMGLOUPE_TEST_EXTENSION_PATH || '.') } = {}) {
  const browser = process.env.IMGLOUPE_CHROME ? { executablePath: process.env.IMGLOUPE_CHROME } : { channel: 'chromium' };
  return chromium.launchPersistentContext(profile, {
    ...browser,
    headless: true,
    locale: lang,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--lang=${lang}`]
  });
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}

// Resolves once the content script in the active tab answers the popup query.
async function waitForContentScript(context, page) {
  const worker = await extensionWorker(context);
  await page.bringToFront();
  await expect.poll(() => worker.evaluate(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return await chrome.tabs.sendMessage(tab.id, { type: 'imgloupe:get-app-type' });
    } catch {
      return null;
    }
  }), { timeout: 15000 }).not.toBeNull();
  return worker;
}

async function exportFromPopup(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'imgloupe:export-images' });
  });
}

module.exports = { launchWithExtension, extensionWorker, waitForContentScript, exportFromPopup };
