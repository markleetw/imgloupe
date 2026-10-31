/**
 * ImgLoupe - Content Script Entrypoint
 * Coordinates document routing, toolbar actions, popup messaging and app handlers.
 */

import JSZip from "jszip";
import Viewer from "viewerjs";
import { createFloatingToolbar, setToolbarActionHandler } from "./ui/toolbar.js";
import { openViewerLightbox } from "./ui/viewer-lightbox.js";
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

const ACTIVE_URL_GETTERS = {
  document: getActiveDocsImageUrl,
  spreadsheets: getActiveSheetsImageUrl,
  presentation: getActiveSlidesImageUrl
};

// An open document: /<app>/d/<id>/… or /<app>/u/<n>/d/<id>/…, not the file
// list (/<app>/u/0/) or a published copy (/<app>/d/e/<id>/pub…).
const DOCUMENT_PATH = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/(?!e\/)[\w-]+(?:\/|$)/;

export function getDocumentType(pathname = location.pathname) {
  return DOCUMENT_PATH.exec(pathname)?.[1] || "";
}

export function getActiveImageUrl() {
  return ACTIVE_URL_GETTERS[getDocumentType()]?.() || "";
}

export async function handleToolbarAction(action) {
  const url = getActiveImageUrl();
  switch (action) {
    case "zoom":
      return openViewerLightbox([url], 0, Viewer);
    case "copy":
      return copyImageToClipboard(url);
    case "ocr":
      return ocrImageToText(url);
    case "download":
      return downloadSingleImage(url);
    default:
      return false;
  }
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
  if (Array.isArray(urlsOrProgress)) return packImagesToZip(urlsOrProgress, onProgress, JSZip);
  return packImagesToZip(await getBatchImageUrls(getDocumentType()), urlsOrProgress, JSZip);
}

export function bootstrap() {
  const docType = getDocumentType();
  if (!Object.hasOwn(ACTIVE_URL_GETTERS, docType)) return;
  initResourceObserver();
  setToolbarActionHandler(handleToolbarAction);

  const runtime = typeof chrome !== "undefined" && chrome.runtime;
  runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === GET_APP_TYPE_MESSAGE) {
      sendResponse(docType);
      return false;
    }
    if (msg?.type === EXPORT_IMAGES_MESSAGE) {
      exportAllImages()
        .then(sendResponse)
        .catch((err) => sendResponse({ downloaded: 0, failed: 1, error: err?.message || String(err) }));
      return true;
    }
    return false;
  });

  if (docType === "document") initDocsHandler();
  else if (docType === "presentation") initSlidesHandler();
  else initSheetsHandler();

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
  if (typeof __IMGLOUPE_DEV__ !== "undefined" && __IMGLOUPE_DEV__ && Object.hasOwn(ACTIVE_URL_GETTERS, getDocumentType())) {
    // eslint-disable-next-line no-undef
    installDevBridge({ exportAllImages, handleToolbarAction, buildId: __IMGLOUPE_BUILD_ID__ });
  }
}
