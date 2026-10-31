import { trackSelection } from '../shared/selection-tracker.js';
let activeUrl = '';
let initialized = false;
export const getActiveSlidesImageUrl = () => activeUrl;

export function initSlidesHandler() {
  if (initialized) return;
  initialized = true;
  trackSelection((pointer, _isCurrent, previous) => {
    const stack = pointer ? document.elementsFromPoint(pointer.x, pointer.y) : [];
    const image = pointer ? stack.find(element => element.tagName?.toLowerCase() === 'image' && element.closest('#workspace-container')) : previous?.element;
    if (!image?.isConnected || !image.closest('#workspace-container')) return null;
    const url = image?.getAttribute('href') || image?.getAttribute('xlink:href');
    return url ? { url, element: image } : null;
  }, url => { activeUrl = url; }, '#workspace-container image');
}
