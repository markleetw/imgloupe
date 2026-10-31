import { uiToast } from './toast.js';
import { t } from '../../shared/i18n.js';

export const TOOLBAR_ID = 'imgloupeToolbar';
export const PREVIEW_HIDDEN_CLASS = 'imgloupe-actions--preview-hidden';
export const OCR_ICON_DRAWING = '<path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 9h8m-4 0v7"/>';
export const ACTION_BUTTON_IDS = Object.freeze({
  zoom: 'imgloupe-action-preview',
  copy: 'imgloupe-action-copy',
  ocr: 'imgloupe-action-ocr',
  download: 'imgloupe-action-download'
});
const actions = [
  ['zoom', 'actionPreview', '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>'],
  ['copy', 'actionCopy', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 5H5v10"/>'],
  ['ocr', 'actionOcr', OCR_ICON_DRAWING],
  ['download', 'actionDownload', '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>']
];

let defaultActionHandler = null;
export function setToolbarActionHandler(handler) {
  defaultActionHandler = handler;
}

export function createFloatingToolbar(actionHandler = defaultActionHandler) {
  let toolbar = document.getElementById(TOOLBAR_ID);
  if (toolbar) return toolbar;
  toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.className = 'imgloupe-actions';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', t('toolbarLabel'));
  toolbar.style.display = 'none';
  for (const [action, labelKey, drawing] of actions) {
    const label = t(labelKey);
    const button = document.createElement('button');
    button.id = ACTION_BUTTON_IDS[action];
    button.type = 'button';
    button.title = label;
    button.className = 'imgloupe-action';
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const success = await actionHandler?.(action);
        if (action === 'copy' && success) uiToast(t('toastImageCopied'), 2000);
      }
      finally { button.disabled = false; }
    };
    toolbar.appendChild(button);
  }
  document.body.appendChild(toolbar);
  return toolbar;
}

const GAP = 8;

// Visible area of the document: the viewport clipped by every scrolling
// ancestor of the image, so the toolbar never covers the app's menus,
// rulers or toolbars outside the editing area.
export function visibleBounds(element) {
  let bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const own = element?.getBoundingClientRect?.();
  // A clipping wrapper the size of the image itself is not the editing area.
  const wrapsImage = r => own && ['left', 'top', 'right', 'bottom'].every(side => Math.abs(r[side] - own[side]) <= 2);
  for (let node = element?.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/(auto|scroll|hidden)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || wrapsImage(r)) continue;
    bounds = { left: Math.max(bounds.left, r.left), top: Math.max(bounds.top, r.top),
      right: Math.min(bounds.right, r.right), bottom: Math.min(bounds.bottom, r.bottom) };
  }
  return bounds;
}

// Position for a toolbar of the given size next to the image, outside it so it
// covers neither the picture nor the app's selection handles:
//   1. above the image, right-aligned with its right edge;
//   2. to the right of the image, aligned with its top;
//   3. inside the image's top-right corner, when there is no room outside.
// Narrow images try the right side first: the apps put their own image
// controls above the left half and center (Slides' quick toolbar and rotate
// handle). Returns null when the image is outside the visible area.
export function computeToolbarPosition(rect, size, bounds) {
  if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.right <= bounds.left || rect.left >= bounds.right) return null;
  const clampLeft = left => Math.min(Math.max(left, bounds.left), bounds.right - size.width);
  const clampTop = top => Math.min(Math.max(top, bounds.top), bounds.bottom - size.height);
  const above = () => {
    const top = rect.top - GAP - size.height;
    return top >= bounds.top && top + size.height <= bounds.bottom ? { placement: 'above', top, left: clampLeft(rect.right - size.width) } : null;
  };
  const beside = () => {
    const left = rect.right + GAP;
    return left + size.width <= bounds.right ? { placement: 'right', top: clampTop(rect.top), left } : null;
  };
  const narrow = rect.width < size.width * 2.5;
  return (narrow ? beside() || above() : above() || beside())
    || { placement: 'inside', top: clampTop(rect.top + GAP), left: clampLeft(rect.right - GAP - size.width) };
}

export function placeToolbar(rect, element) {
  const toolbar = createFloatingToolbar();
  Object.assign(toolbar.style, { display: 'flex', position: 'fixed', right: 'auto' });
  const size = { width: toolbar.offsetWidth || 142, height: toolbar.offsetHeight || 40 };
  const position = computeToolbarPosition(rect, size, visibleBounds(element));
  if (!position) {
    hideToolbar();
    return;
  }
  toolbar.dataset.placement = position.placement;
  Object.assign(toolbar.style, { top: `${Math.round(position.top)}px`, left: `${Math.round(position.left)}px` });
}

export function hideToolbar() {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (toolbar) toolbar.style.display = 'none';
}

export function toggleToolbarPreviewHidden(hidden) {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;
  toolbar.classList.toggle(PREVIEW_HIDDEN_CLASS, hidden);
  if (hidden) toolbar.setAttribute('aria-hidden', 'true');
  else toolbar.removeAttribute('aria-hidden');
}
