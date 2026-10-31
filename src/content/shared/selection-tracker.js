import { hideToolbar, placeToolbar } from '../ui/toolbar.js';

// Defer until the host application updates selection. A stale async result must
// never replace a more recent selection; scroll only repositions existing UI.
export function trackSelection(resolve, onChange, observedSelector = '') {
  let revision = 0;
  let active = null;
  let previousSelection = null;
  let pending = 0;
  let pointer = null;
  let previewKey = '';
  const updatePosition = () => {
    if (!active) return;
    if (active.element.isConnected === false) { active = null; onChange(''); hideToolbar(); return; }
    const rect = active.element.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) placeToolbar(rect, active.element);
    else { active = null; onChange(''); hideToolbar(); }
  };
  const refresh = (allowPrevious = true) => {
    const token = ++revision;
    const previous = allowPrevious ? active || previousSelection : null;
    if (!allowPrevious) pointer = null;
    previousSelection = previous;
    active = null;
    onChange('');
    hideToolbar();
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      if (revision !== token) return;
      pending = requestAnimationFrame(async () => {
        if (revision !== token) return;
        try {
          const point = pointer;
          pointer = null;
          const next = await resolve(point, () => revision === token, previous);
          if (revision !== token) return;
          active = next;
          previousSelection = null;
          onChange(next?.url || '');
          updatePosition();
        } catch {
          if (revision === token) { previousSelection = null; onChange(''); hideToolbar(); }
        }
      });
    });
  };
  document.addEventListener('click', event => {
    // Saving creates a temporary anchor and invokes click(); that is not a new
    // document selection and must not consume the current image.
    if (event.isTrusted === false && event.target?.closest?.('a[download]')) return;
    if (event.target?.closest?.('#imgloupeToolbar, .viewer-container')) return;
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    refresh();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.repeat) return;
    previewKey = document.querySelector('.viewer-container:not(.viewer-hide)') ? event.key : '';
  }, true);
  document.addEventListener('keyup', event => {
    if (previewKey === event.key || event.target?.closest?.('.viewer-container')) { previewKey = ''; return; }
    if (event.key === 'Escape') { ++revision; active = previousSelection = null; pointer = null; cancelAnimationFrame(pending); onChange(''); hideToolbar(); }
    else if (event.key === 'Tab') refresh(false);
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && active) reposition();
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) refresh();
  });
  let moveFrame = 0;
  const reposition = () => {
    if (!active || moveFrame) return;
    moveFrame = requestAnimationFrame(() => { moveFrame = 0; updatePosition(); });
  };
  document.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  if (observedSelector && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(records => {
      const selected = active || previousSelection;
      const changed = selected?.element.isConnected === false || records.some(record => record.target?.matches?.(observedSelector) ||
        [...(record.addedNodes || []), ...(record.removedNodes || [])].some(node => node.matches?.(observedSelector) || node.querySelector?.(observedSelector)));
      if (changed) refresh();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'src', 'href', 'xlink:href'] });
  }
}
