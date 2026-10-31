/**
 * Viewer.js Lightbox Integration
 * Enhances Viewer.js with modern glassmorphism floating island toolbar,
 * SVG icons, and interactive drag-to-select snippet OCR.
 */

import { toggleToolbarPreviewHidden, OCR_ICON_DRAWING } from "./toolbar.js";
import { startLightboxCrop } from "./lightbox-crop.js";
import { ocrImageToText } from "../ocr/ocr-service.js";
import { t } from "../../shared/i18n.js";

const VIEWER_SOURCE_CONTAINER_ID = "imgloupe-viewer-source";
let viewerInstance = null;

const TOOLBAR_SVG_ICONS = {
  "zoom-in": {
    titleKey: "viewerZoomIn",
    svg: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`
  },
  "zoom-out": {
    titleKey: "viewerZoomOut",
    svg: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`
  },
  "one-to-one": {
    titleKey: "viewerOneToOne",
    svg: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M9 8v8M15 8v8"></path></svg>`
  },
  "reset": {
    titleKey: "viewerReset",
    svg: `<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path><rect x="9" y="9" width="6" height="6" rx="1"></rect></svg>`
  },
  "prev": {
    titleKey: "viewerPrev",
    svg: `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>`
  },
  "next": {
    titleKey: "viewerNext",
    svg: `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>`
  },
  "rotate-left": {
    titleKey: "viewerRotateLeft",
    svg: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`
  },
  "rotate-right": {
    titleKey: "viewerRotateRight",
    svg: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 0-2.64 6.36"></path><polyline points="21 22 21 12 11 12"></polyline></svg>`
  },
  "crop-ocr": {
    titleKey: "viewerCropOcr",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${OCR_ICON_DRAWING}</svg>`
  }
};

export function renderModernViewerToolbar(vInstance) {
  if (!vInstance) return;
  const container = vInstance.viewer || document.querySelector(".viewer-container");
  if (!container) return;

  const items = container.querySelectorAll(".viewer-toolbar > ul > li");
  items.forEach((li) => {
    if (li.querySelector("svg")) return;

    let action = li.getAttribute("data-viewer-action") || "";
    if (!action) {
      for (const cls of li.classList) {
        if (cls.startsWith("viewer-") && cls !== "viewer-large" && cls !== "viewer-small") {
          action = cls.replace("viewer-", "");
          break;
        }
      }
    }
    if (!action) return;

    const normalizedAction = action.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^viewer-/, "");
    const config = TOOLBAR_SVG_ICONS[normalizedAction] || TOOLBAR_SVG_ICONS[action];
    if (config) {
      li.classList.add("imgloupe-has-svg");
      if (normalizedAction === "crop-ocr" || action === "cropOcr") {
        li.classList.add("viewer-crop-ocr-btn");
      }
      const title = t(config.titleKey);
      li.setAttribute("title", title);
      li.setAttribute("aria-label", title);
      li.innerHTML = config.svg;
    }
  });
}

export function getOrCreateViewerSourceContainer() {
  let container = document.getElementById(VIEWER_SOURCE_CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = VIEWER_SOURCE_CONTAINER_ID;
    container.hidden = true;
    document.body.appendChild(container);
  }
  return container;
}

export function openViewerLightbox(urls, initialIndex = 0, ViewerClass) {
  const validUrls = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!validUrls.length) return false;

  const container = getOrCreateViewerSourceContainer();
  const images = validUrls.map((url, idx) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Image ${idx + 1} of ${validUrls.length}`;
    img.dataset.viewerLabel = img.alt;
    return img;
  });

  container.replaceChildren(...images);

  if (viewerInstance) {
    viewerInstance.destroy();
    viewerInstance = null;
  }

  const VClass = ViewerClass;
  if (!VClass) return false;

  viewerInstance = new VClass(container, {
    initialViewIndex: Math.max(0, Math.min(initialIndex, validUrls.length - 1)),
    keyboard: true,
    loop: false,
    title: validUrls.length > 1 ? [1, (img) => img.dataset.viewerLabel || ""] : false,
    navbar: false,
    toolbar: {
      zoomIn: 1,
      zoomOut: 1,
      oneToOne: 0,
      reset: 1,
      prev: 0,
      next: 0,
      rotateLeft: 1,
      rotateRight: 0,
      cropOcr: {
        show: 1,
        click: () => {
          startLightboxCrop(viewerInstance, (cropDataUrl) => ocrImageToText(cropDataUrl));
        }
      }
    },
    zoomRatio: 0.3,
    viewed: () => {
      renderModernViewerToolbar(viewerInstance);
    },
    shown: () => {
      renderModernViewerToolbar(viewerInstance);
    },
    hidden: () => toggleToolbarPreviewHidden(false)
  });

  toggleToolbarPreviewHidden(true);
  try {
    viewerInstance.show();
    setTimeout(() => renderModernViewerToolbar(viewerInstance), 50);
    return true;
  } catch (err) {
    toggleToolbarPreviewHidden(false);
    throw err;
  }
}
