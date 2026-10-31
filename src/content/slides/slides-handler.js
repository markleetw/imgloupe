// Google Slides: images on the slide being edited are SVG <image> elements in
// the workspace. A click picks the topmost one under the pointer; without a
// click (the page changed) the previously selected image is re-checked.
import { trackSelection } from '../shared/selection-tracker.js';

const WORKSPACE = '#workspace-container';
const WATCHED = '#workspace-container image';

let selectedUrl = '';
let started = false;

export const getActiveSlidesImageUrl = () => selectedUrl;

const isWorkspaceImage = node => node?.tagName?.toLowerCase() === 'image' && Boolean(node.closest?.(WORKSPACE));

function candidate(pointer, previous) {
  if (!pointer) return previous?.element;
  return document.elementsFromPoint(pointer.x, pointer.y).find(isWorkspaceImage);
}

function resolveSlidesImage(pointer, _isCurrent, previous) {
  const image = candidate(pointer, previous);
  if (!image?.isConnected || !image.closest(WORKSPACE)) return null;
  const url = ['href', 'xlink:href'].map(name => image.getAttribute(name)).find(Boolean);
  return url ? { element: image, url } : null;
}

export function initSlidesHandler() {
  if (started) return;
  started = true;
  trackSelection(resolveSlidesImage, url => { selectedUrl = url; }, WATCHED);
}
