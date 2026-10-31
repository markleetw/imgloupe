// Full-screen preview of the selected image, built on Viewer.js.
//
// One image at a time: zoom, reset, rotate, and ImgLoupe's "recognize text in
// an area" tool. Viewer.js draws its own buttons; after it renders them we put
// ImgLoupe's icons and localized labels on the ones we enable. The image
// toolbar next to the document image is hidden while the preview is open.
import { toggleToolbarPreviewHidden, OCR_ICON_DRAWING } from './toolbar.js';
import { startLightboxCrop } from './lightbox-crop.js';
import { ocrImageToText } from '../ocr/ocr-service.js';
import { t } from '../../shared/i18n.js';

const HOST_ID = 'imgloupe-viewer-source';
const DECORATED = 'imgloupe-has-svg';

// Viewer.js button class suffix -> label message and icon drawing (24×24,
// stroked like the image toolbar's own icons).
const PREVIEW_BUTTONS = new Map([
  ['zoom-in', ['viewerZoomIn', '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>']],
  ['zoom-out', ['viewerZoomOut', '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/>']],
  ['reset', ['viewerReset', '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/><rect x="9" y="9" width="6" height="6" rx="1"/>']],
  ['rotate-left', ['viewerRotateLeft', '<path d="M5 5v5h5"/><path d="M5.6 10A7 7 0 1 1 7 16.9"/>']],
  ['crop-ocr', ['viewerCropOcr', OCR_ICON_DRAWING]]
]);

let current = null;

function hostElement() {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const host = Object.assign(document.createElement('div'), { id: HOST_ID, hidden: true });
  document.body.append(host);
  return host;
}

function iconMarkup(drawing) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;
}

// Replace Viewer.js's icon glyphs with ImgLoupe's on every enabled button.
export function decoratePreviewToolbar(viewer) {
  const bar = viewer?.viewer?.querySelector('.viewer-toolbar');
  if (!bar) return;
  PREVIEW_BUTTONS.forEach(([labelKey, drawing], name) => {
    const button = bar.querySelector(`.viewer-${name}`);
    if (!button || button.classList.contains(DECORATED)) return;
    const label = t(labelKey);
    button.classList.add(DECORATED);
    if (name === 'crop-ocr') button.classList.add('viewer-crop-ocr-btn');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconMarkup(drawing);
  });
}

export function closeImagePreview() {
  const previous = current;
  current = null;
  previous?.destroy();
}

// Show `url` in the preview. Returns false when there is nothing to show.
export function openImagePreview(url, ViewerClass) {
  if (!url || typeof ViewerClass !== 'function') return false;
  closeImagePreview();

  const picture = new Image();
  picture.src = url;
  picture.alt = '';
  hostElement().replaceChildren(picture);

  const decorate = () => decoratePreviewToolbar(current);
  current = new ViewerClass(hostElement(), {
    navbar: false,
    title: false,
    loop: false,
    keyboard: true,
    zoomRatio: 0.25,
    toolbar: {
      zoomIn: true,
      zoomOut: true,
      reset: true,
      rotateLeft: true,
      cropOcr: { show: true, click: () => startLightboxCrop(current, area => ocrImageToText(area)) }
    },
    shown: decorate,
    viewed: decorate,
    hidden: () => toggleToolbarPreviewHidden(false)
  });

  toggleToolbarPreviewHidden(true);
  let opened = false;
  try {
    current.show();
    opened = true;
  } finally {
    if (!opened) toggleToolbarPreviewHidden(false);
  }
  setTimeout(decorate, 0);
  return true;
}
