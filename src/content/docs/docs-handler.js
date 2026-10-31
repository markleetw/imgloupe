import { trackSelection } from '../shared/selection-tracker.js';
import { getNetworkResourceUrls, fetchCandidateThumbnails } from '../shared/network-resources.js';
import { chooseCandidate } from '../shared/image-signature.js';
import { describeSelection } from './selection-raster.js';
import { getHiddenImageBounds } from './hidden-image-bounds.js';
let activeUrl = '';
let initialized = false;
export const getActiveDocsImageUrl = () => activeUrl;

async function resolveDocsSelection(pointer, isCurrent) {
  const selection = Array.from(document.querySelectorAll('.docs-squarehandleselectionbox-border')).find(element => {
    const rect = element.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  });
  if (!selection) return null;
  const rect = selection.getBoundingClientRect();
  if (pointer && (pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom)) return null;
  const matchingImages = Array.from(document.querySelectorAll('svg.kix-embeddedobject-image image')).filter(image => {
    let imageRect = image.getBoundingClientRect();
    // Only accept a hidden source whose layout matches the visible selection.
    if (!imageRect.width || !imageRect.height) {
      imageRect = getHiddenImageBounds(image);
      if (!imageRect) return false;
    }
    return Math.abs(imageRect.left - rect.left) < 4 && Math.abs(imageRect.top - rect.top) < 4 &&
      Math.abs(imageRect.width - rect.width) < 4 && Math.abs(imageRect.height - rect.height) < 4;
  });
  const urls = [...new Set(matchingImages.map(image => image.getAttribute('href') || image.getAttribute('xlink:href')).filter(Boolean))];
  const direct = urls.length === 1 ? urls[0] : '';
  if (direct) return { url: direct, element: selection };
  const signature = describeSelection(rect);
  if (!signature) return null;
  const candidates = await fetchCandidateThumbnails(getNetworkResourceUrls('document'), isCurrent);
  const match = chooseCandidate(signature, candidates);
  return match ? { url: match.url, element: selection } : null;
}

export function initDocsHandler() {
  if (initialized) return;
  initialized = true;
  trackSelection(resolveDocsSelection, url => { activeUrl = url; },
    '.docs-squarehandleselectionbox-border, .kix-embeddedobjectdragger, .kix-embeddedobject-image image');
}
