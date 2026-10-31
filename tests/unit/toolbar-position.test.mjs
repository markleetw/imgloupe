import test from 'node:test';
import assert from 'node:assert/strict';
import { computeToolbarPosition } from '../../src/content/ui/toolbar.js';

const size = { width: 142, height: 40 };
const view = { left: 0, top: 100, right: 1200, bottom: 800 };
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('wide images get the toolbar above, right-aligned with the image', () => {
  assert.deepEqual(computeToolbarPosition(rect(200, 300, 600, 300), size, view), { placement: 'above', top: 252, left: 658 });
});

test('narrow images get the toolbar on their right, clear of the app controls above', () => {
  assert.deepEqual(computeToolbarPosition(rect(200, 300, 300, 200), size, view), { placement: 'right', top: 300, left: 508 });
});

test('no room above: to the right; no room on either side: inside the top-right corner', () => {
  assert.equal(computeToolbarPosition(rect(200, 120, 600, 300), size, view).placement, 'right');
  assert.deepEqual(computeToolbarPosition(rect(0, 120, 1200, 600), size, view), { placement: 'inside', top: 128, left: 1050 });
});

test('narrow image at the right edge falls back to above', () => {
  assert.deepEqual(computeToolbarPosition(rect(1000, 300, 200, 150), size, view), { placement: 'above', top: 252, left: 1058 });
});

test('the toolbar stays inside the visible area', () => {
  // Image scrolled partly above the editing area: the toolbar is not placed over the app's menus.
  const scrolled = computeToolbarPosition(rect(0, 20, 1200, 400), size, view);
  assert.ok(scrolled.top >= view.top, JSON.stringify(scrolled));
  // Image partly beyond the right edge: the toolbar is pulled back into view.
  const clipped = computeToolbarPosition(rect(900, 300, 600, 300), size, view);
  assert.ok(clipped.left + size.width <= view.right, JSON.stringify(clipped));
});

test('images outside the visible area hide the toolbar', () => {
  assert.equal(computeToolbarPosition(rect(200, 0, 600, 90), size, view), null);
  assert.equal(computeToolbarPosition(rect(1300, 300, 100, 100), size, view), null);
});
