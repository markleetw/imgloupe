/**
 * ImgLoupe - Offscreen Document Main Controller
 */

import { getTesseractWorker, runWithTesseract } from "./tesseract-client.js";
import { fitOcrImage } from "./ocr-input.js";
import { extractLinesFromResult } from "./line-extractor.js";
import { copyToOffscreenClipboard } from "./clipboard-fallback.js";
import { enhanceImageForOcr, getWideStripSegments } from "./image-enhancer.js";

// Export for tests and global execution
if (typeof globalThis !== "undefined") {
  globalThis.extractLinesFromResult = extractLinesFromResult;
  globalThis.copyToOffscreenClipboard = copyToOffscreenClipboard;
  globalThis.getTesseractWorker = getTesseractWorker;
  globalThis.enhanceImageForOcr = enhanceImageForOcr;
  globalThis.getWideStripSegments = getWideStripSegments;
}
if (typeof window !== "undefined") {
  window.__imgloupeOffscreen = {
    extractLinesFromResult,
    copyToOffscreenClipboard,
    getTesseractWorker,
    enhanceImageForOcr,
    getWideStripSegments
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the background service worker addresses the offscreen document; it
  // validates sizes before forwarding.
  if (!message || message.target !== "offscreen" || sender?.id !== chrome.runtime.id || sender?.tab) {
    return;
  }

  // Fallback Copy to Clipboard
  if (message.type === "copy-to-clipboard") {
    copyToOffscreenClipboard(message.text).then((copied) => {
      sendResponse({ success: copied, copied });
    });
    return true;
  }

  // Execute OCR Recognition
  if (message.type === "do-ocr") {
    (async () => {
      try {
        const result = await runWithTesseract(async (worker) => {
        const input = await fitOcrImage(message.image);
        const segments = await getWideStripSegments(input, 12);

        let res = null;
        let lines = [];
        let text = "";

        if (segments && segments.length > 1) {
          const segLines = [];
          for (const segUrl of segments) {
            const safeSegment = await fitOcrImage(segUrl);
            let segRes = await worker.recognize(safeSegment);
            let l = extractLinesFromResult(segRes);
            let t = l.join(" ") || (segRes?.data?.text || "").trim();
            if (!t && worker && typeof worker.setParameters === "function") {
              try {
                await worker.setParameters({ tessedit_pageseg_mode: "6" });
                segRes = await worker.recognize(safeSegment);
                l = extractLinesFromResult(segRes);
                t = l.join(" ") || (segRes?.data?.text || "").trim();
              } finally {
                await worker.setParameters({ tessedit_pageseg_mode: "3" });
              }
            }
            if (t) segLines.push(t);
          }
          text = segLines.join(" ");
          lines = [text];
        } else {
          const enhancedImg = await fitOcrImage(await enhanceImageForOcr(input));
          res = await worker.recognize(enhancedImg);
          lines = extractLinesFromResult(res);
          text = lines.join("\n");
          if (!text && res?.data?.text) {
            text = res.data.text.trim();
          }

        // Snippet / Single-line fallback: if automatic layout (PSM 3) found no text,
        // retry assuming single uniform text block (PSM 6)
        if (!text && worker && typeof worker.setParameters === "function") {
          try {
            await worker.setParameters({ tessedit_pageseg_mode: "6" });
            const retryRes = await worker.recognize(enhancedImg);
            const retryLines = extractLinesFromResult(retryRes);
            const retryText = retryLines.join("\n") || (retryRes?.data?.text || "").trim();
            if (retryText) {
              res = retryRes;
              lines = retryLines;
              text = retryText;
            }
          } catch (retryErr) {
            console.warn("[Offscreen OCR] PSM 6 retry error:", retryErr);
          } finally {
            try {
              await worker.setParameters({ tessedit_pageseg_mode: "3" });
            } catch {}
          }
        }
        }

        return { success: true, text };
        });
        sendResponse(result);
      } catch (err) {
        console.error("[Offscreen OCR Error]", err);
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
});
}
