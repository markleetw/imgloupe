const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: { width: 390, height: 480 } },
  outputDir: 'scratch/browser-results',
  webServer: { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
