// ImgLoupe content script.
//
// Runs on an open Google Docs, Sheets or Slides document. Each app module
// tracks which image is selected; the image toolbar's four actions and the
// popup's ZIP export work on that app's images.
import JSZip from "jszip";
import Viewer from "viewerjs";
import { createFloatingToolbar, setToolbarActionHandler } from "./ui/toolbar.js";
import { openImagePreview } from "./ui/image-preview.js";
import { uiToast } from "./ui/toast.js";
import { ocrImageToText } from "./ocr/ocr-service.js";
import { cleanOcrText } from "./ocr/text-cleaner.js";
import { copyTextToClipboard, copyImageToClipboard } from "./shared/clipboard.js";
import { documentFileStem, downloadSingleImage, packImagesToZip, exportDocumentImages } from "./shared/download-manager.js";
import { getNetworkResourceUrls, getBatchImageUrls, initResourceObserver } from "./shared/network-resources.js";
import { extractFormulaBarImageUrl } from "./sheets/formula-parser.js";
import { initDocsHandler, getActiveDocsImageUrl } from "./docs/docs-handler.js";
import { initSheetsHandler, getActiveSheetsImageUrl } from "./sheets/sheets-handler.js";
import { initSlidesHandler, getActiveSlidesImageUrl } from "./slides/slides-handler.js";
import { imageCache } from "./shared/lru-cache.js";
import { GET_APP_TYPE_MESSAGE, EXPORT_IMAGES_MESSAGE } from "../shared/messages.js";
import { installDevBridge } from "./dev-bridge.js";

// The three supported apps, keyed by the first segment of the document path.
const APPS = Object.freeze({
  document: { start: initDocsHandler, selectedImage: getActiveDocsImageUrl },
  spreadsheets: { start: initSheetsHandler, selectedImage: getActiveSheetsImageUrl },
  presentation: { start: initSlidesHandler, selectedImage: getActiveSlidesImageUrl }
});

// What each toolbar button does with the selected image's address.
const ACTIONS = Object.freeze({
  zoom: url => openImagePreview(url, Viewer),
  copy: url => copyImageToClipboard(url),
  ocr: url => ocrImageToText(url),
  download: url => downloadSingleImage(url)
});

// An open document: /<app>/d/<id>/… or /<app>/u/<n>/d/<id>/…, not the file
// list (/<app>/u/0/) or a published copy (/<app>/d/e/<id>/pub…).
const DOCUMENT_PATH = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/(?!e\/)[\w-]+(?:\/|$)/;

export function getDocumentType(pathname = location.pathname) {
  return DOCUMENT_PATH.exec(pathname)?.[1] || "";
}

const currentApp = () => APPS[getDocumentType()] || null;

export function getActiveImageUrl() {
  return currentApp()?.selectedImage() || "";
}

export async function handleToolbarAction(action) {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  return run ? run(getActiveImageUrl()) : false;
}

// ZIP export of the whole document (popup action).
export function exportAllImages(onProgress) {
  return exportDocumentImages({
    discoverLoadedUrls: () => getBatchImageUrls(getDocumentType()),
    onProgress,
    JSZipClass: JSZip
  });
}

// Pack an explicit URL list, or the images loaded in this page.
export async function batchDownloadAllImages(urlsOrProgress, onProgress) {
  const explicit = Array.isArray(urlsOrProgress);
  const urls = explicit ? urlsOrProgress : await getBatchImageUrls(getDocumentType());
  return packImagesToZip(urls, explicit ? onProgress : urlsOrProgress, JSZip);
}

// Popup requests: which app is open, and "download all images".
function answerPopup(message, _sender, reply) {
  switch (message?.type) {
    case GET_APP_TYPE_MESSAGE:
      reply(getDocumentType());
      return false;
    case EXPORT_IMAGES_MESSAGE:
      exportAllImages().then(reply, error => reply({ downloaded: 0, failed: 1, error: error?.message || String(error) }));
      return true;
    default:
      return false;
  }
}

export function bootstrap() {
  const app = currentApp();
  if (!app) return;
  initResourceObserver();
  setToolbarActionHandler(handleToolbarAction);
  globalThis.chrome?.runtime?.onMessage?.addListener(answerPopup);
  app.start();

  // Test hooks. Content scripts run in an isolated world, so the page cannot
  // reach this object.
  window.__imgloupe = {
    createToolbar: (handler = handleToolbarAction) => createFloatingToolbar(handler),
    documentFileStem,
    getActiveImageUrl,
    uiToast,
    batchDownloadAllImages,
    exportAllImages,
    extractFormulaBarImageUrl,
    cleanOcrText,
    getNetworkResourceUrls,
    handleToolbarAction,
    ocrImageToText,
    copyTextToClipboard,
    copyImageToClipboard,
    getCache: () => imageCache
  };
}

if (typeof window !== "undefined") {
  bootstrap();
  // eslint-disable-next-line no-undef
  if (typeof __IMGLOUPE_DEV__ !== "undefined" && __IMGLOUPE_DEV__ && currentApp()) {
    // eslint-disable-next-line no-undef
    installDevBridge({ exportAllImages, handleToolbarAction, buildId: __IMGLOUPE_BUILD_ID__ });
  }
}
