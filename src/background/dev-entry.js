// Service worker entry of development builds (npm run build:dev): the normal
// service worker plus two test-bridge requests. Store builds use
// src/background/index.js directly.
import './index.js';
import { inspectExportParts } from './export-service.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target || sender?.id !== chrome.runtime.id) return;
  // Reload the unpacked extension from disk.
  if (message.type === 'imgloupe:dev-reload') {
    chrome.runtime.reload();
    return;
  }
  // Describe the media of the sender tab's Office export.
  if (message.type === 'imgloupe:dev-export-parts') {
    inspectExportParts(sender?.tab?.url).then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }
});
