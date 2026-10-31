/**
 * ImgLoupe - Background Service Worker Entry Point
 */

import { ensureOffscreenDocument } from "./offscreen-manager.js";
import { handleExportMessage, inspectExportParts } from "./export-service.js";

const MAX_CLIPBOARD_TEXT = 1000000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages and content scripts may use these services.
  if (!message || message.target || sender?.id !== chrome.runtime.id) return;

  // Development builds only: reload the unpacked extension from disk.
  // eslint-disable-next-line no-undef
  if (typeof __IMGLOUPE_DEV__ !== "undefined" && __IMGLOUPE_DEV__ && message.type === "imgloupe:dev-reload") {
    chrome.runtime.reload();
    return;
  }
  // eslint-disable-next-line no-undef
  if (typeof __IMGLOUPE_DEV__ !== "undefined" && __IMGLOUPE_DEV__ && message.type === "imgloupe:dev-export-parts") {
    inspectExportParts(sender?.tab?.url).then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }

  // Office export of the sender tab's document (Sheets and Slides ZIP).
  if (typeof message.type === "string" && message.type.startsWith("imgloupe:export-")) {
    return handleExportMessage(message, sender, sendResponse);
  }

  // 3. Offscreen Clipboard Fallback Copy
  if (message.type === "copy-to-clipboard") {
    if (typeof message.text !== "string" || !message.text || message.text.length > MAX_CLIPBOARD_TEXT) {
      sendResponse({ success: false, error: "Invalid clipboard text" });
      return;
    }
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "copy-to-clipboard",
          text: message.text
        });
        sendResponse(res || { success: false });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  // 4. OCR Execution Dispatch
  if (message.type === "do-ocr") {
    if (typeof message.image !== 'string' || !message.image.startsWith('data:image/') || message.image.length > 16000000) {
      sendResponse({ success: false, error: 'Invalid or oversized OCR image' });
      return;
    }
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "do-ocr",
          image: message.image
        });
        sendResponse(res || { success: false, error: "No response from offscreen document" });
      } catch (err) {
        console.error("[Background OCR Error]", err);
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
});
