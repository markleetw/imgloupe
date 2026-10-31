import { trackSelection } from '../shared/selection-tracker.js';
let activeUrl = '';
let initialized = false;
export const getActiveSheetsImageUrl = () => activeUrl;

export function initSheetsHandler() {
  if (initialized) return;
  initialized = true;
  trackSelection((pointer, _isCurrent, previous) => {
    const focused = document.querySelector('.focused-overlay-container .waffle-borderless-embedded-object-overlay-focused');
    const container = focused?.querySelector('.waffle-borderless-embedded-object-container') ||
      pointer?.target?.closest?.('.waffle-borderless-embedded-object-container') ||
      (!pointer && previous?.element.isConnected ? previous.element.closest('.waffle-borderless-embedded-object-container') : null);
    const image = container?.querySelector('img');
    if (!image?.src) return null;
    if (pointer && !pointer.target?.closest?.('.waffle-borderless-embedded-object-container') && !focused) return null;
    return { url: image.src, element: image };
  }, url => { activeUrl = url; }, '.waffle-borderless-embedded-object-overlay-focused, .waffle-borderless-embedded-object-container img');
}
