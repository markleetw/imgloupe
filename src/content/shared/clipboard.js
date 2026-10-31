/**
 * Clipboard Utilities
 * Supports binary image copying via ClipboardItem (with auto PNG conversion), and clean text copying.
 */

import { uiToast } from "../ui/toast.js";
import { fetchPngBlob } from "./download-manager.js";
import { blobToPngBlob } from "./raster.js";
import { t } from "../../shared/i18n.js";

export async function copyTextToClipboard(text) {
  if (!text) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("[ImgLoupe] clipboard writeText error:", err);
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    ta.style.contain = "strict";
    const stopPropagation = (e) => e.stopPropagation();
    ta.addEventListener("copy", stopPropagation, true);
    ta.addEventListener("select", stopPropagation, true);
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Convert an image source (URL string, data URL or Blob) to a PNG Blob
 */
export async function imageSourceToPngBlob(source) {
  if (!source) {
    throw new Error("No image source provided");
  }

  if (source instanceof Blob) return blobToPngBlob(source);

  // String URL or data URL
  if (typeof source === "string" && source.trim()) {
    return fetchPngBlob(source.trim());
  }

  throw new Error("Unsupported image source type");
}

/**
 * Copy high-resolution image to clipboard via ClipboardItem
 * In Chromium, passing a Promise<Blob> to ClipboardItem preserves the active user gesture!
 */
export async function copyImageToClipboard(imgUrlOrBlob) {
  if (
    !imgUrlOrBlob ||
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    uiToast(t("toastClipboardUnsupported"), 3000);
    return false;
  }

  const pngBlobPromise = imageSourceToPngBlob(imgUrlOrBlob);
  try {
    const item = new ClipboardItem({ "image/png": pngBlobPromise });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    let resolvedBlob;
    try {
      resolvedBlob = await pngBlobPromise;
    } catch {
      uiToast(t('toastImageUnreadable'), 3000);
      return false;
    }
    try {
      const item = new ClipboardItem({ "image/png": resolvedBlob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (fallbackErr) {
      console.warn('[ImgLoupe] Clipboard write failed:', fallbackErr?.name);
      uiToast(t('toastClipboardBlocked'), 3000);
      return false;
    }
  }
}

