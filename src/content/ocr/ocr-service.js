/**
 * OCR Image-to-Text Service
 * Sends the selected image (or a cropped area) to the offscreen Tesseract
 * worker, cleans the result and copies it to the clipboard.
 */

import { uiToast } from "../ui/toast.js";
import { cleanOcrText } from "./text-cleaner.js";
import { copyTextToClipboard } from "../shared/clipboard.js";
import { fetchImageBlob } from "../shared/download-manager.js";
import { getOcrDimensions } from "../../shared/ocr-limits.js";
import { t, tn } from "../../shared/i18n.js";
import { recordDevOcr } from "../dev-bridge.js";

function cleanupCropButtonStates() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".viewer-crop-ocr-btn, [data-viewer-action='cropOcr']").forEach((btn) => {
    btn.classList.remove("is-active");
    if (typeof btn.blur === "function") btn.blur();
  });
  document.querySelectorAll(".viewer-container.imgloupe-crop-active").forEach((container) => {
    container.classList.remove("imgloupe-crop-active");
  });
}

// Remote and filesystem images are decoded here, bounded to the OCR input
// limit and passed to the offscreen document as a PNG data URL.
async function prepareOcrPayload(source) {
  if (source.startsWith("data:image/")) return source;
  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(await fetchImageBlob(source));
    const size = getOcrDimensions(bitmap.width, bitmap.height);
    canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("OCR canvas is unavailable");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap?.close?.();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function ocrImageToText(imgUrl) {
  cleanupCropButtonStates();
  if (!imgUrl) {
    uiToast(t("toastOcrNoImage"), 3000);
    return false;
  }
  uiToast(t("toastOcrRunning"), 0);

  let payload;
  try {
    payload = await prepareOcrPayload(imgUrl);
  } catch {
    uiToast(t("toastImageUnreadable"), 3000);
    return false;
  }

  const response = typeof chrome !== "undefined" && chrome.runtime?.sendMessage
    ? await sendRuntimeMessage({ type: "do-ocr", image: payload })
    : null;
  cleanupCropButtonStates();
  if (!response?.success) {
    uiToast(t("toastOcrFailed"), 3000);
    return false;
  }

  const text = cleanOcrText(response.text || "");
  // Development builds only: lets the test bridge read the recognized text.
  // eslint-disable-next-line no-undef
  if (typeof __IMGLOUPE_DEV__ !== "undefined" && __IMGLOUPE_DEV__) recordDevOcr(response.text || "", text);
  if (!text) {
    uiToast(t("toastOcrNoText"), 3000);
    return false;
  }

  let copied = await copyTextToClipboard(text);
  if (!copied) {
    const copyResponse = await sendRuntimeMessage({ type: "copy-to-clipboard", text });
    copied = copyResponse?.success === true && copyResponse.copied === true;
  }
  uiToast(copied ? tn("toastOcrCopied", Array.from(text).length) : t("toastOcrCopyFailed"), 3500);
  return copied;
}
