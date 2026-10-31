// Google Sheets: images placed over cells. Sheets draws each one as an <img>
// inside an embedded-object box; a selected image's box sits in the focused
// overlay, which stays put while the pointer moves elsewhere.
import { trackSelection } from '../shared/selection-tracker.js';

const IMAGE_BOX = '.waffle-borderless-embedded-object-container';
const FOCUSED_OVERLAY = '.focused-overlay-container .waffle-borderless-embedded-object-overlay-focused';
const WATCHED = '.waffle-borderless-embedded-object-overlay-focused, .waffle-borderless-embedded-object-container img';

let selectedUrl = '';
let started = false;

export const getActiveSheetsImageUrl = () => selectedUrl;

// The image box the selection refers to: the focused overlay's box wins; a
// click elsewhere with nothing focused clears the selection; without a click
// (the page changed) the previously selected image is re-checked.
function selectedBox(pointer, previous) {
  const focused = document.querySelector(FOCUSED_OVERLAY);
  const clicked = pointer?.target?.closest?.(IMAGE_BOX) || null;
  if (pointer && !clicked && !focused) return null;
  const focusedBox = focused?.querySelector(IMAGE_BOX);
  if (focusedBox) return focusedBox;
  if (pointer) return clicked;
  return previous?.element.isConnected ? previous.element.closest(IMAGE_BOX) : null;
}

function resolveSheetsImage(pointer, _isCurrent, previous) {
  const picture = selectedBox(pointer, previous)?.querySelector('img');
  return picture?.src ? { url: picture.src, element: picture } : null;
}

export function initSheetsHandler() {
  if (started) return;
  started = true;
  trackSelection(resolveSheetsImage, url => { selectedUrl = url; }, WATCHED);
}
