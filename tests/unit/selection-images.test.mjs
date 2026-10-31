import test from 'node:test';
import assert from 'node:assert/strict';
import { describePixels, chooseCandidate } from '../../src/content/shared/image-signature.js';
import { intersectRect } from '../../src/content/docs/selection-raster.js';

function solid(r, g, b, width = 12, height = 12) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([r, g, b, 255], offset);
  return { width, height, pixels };
}

test('selected image matching chooses the same colors despite source dimensions', () => {
  const selected = describePixels(solid(200, 20, 20));
  const candidates = [
    { url: 'blue', signature: describePixels(solid(20, 20, 200)) },
    { url: 'red', signature: describePixels(solid(200, 20, 20, 24, 24)) }
  ];
  assert.equal(chooseCandidate(selected, candidates)?.url, 'red');
});

test('unrelated and ambiguous images are not silently substituted', () => {
  const selected = describePixels(solid(200, 20, 20));
  const blue = { url: 'blue', signature: describePixels(solid(20, 20, 200)) };
  assert.equal(chooseCandidate(selected, [blue]), null);
  const red = { url: 'red', signature: selected };
  assert.equal(chooseCandidate(selected, [red, { url: 'duplicate', signature: selected }]), null);
});

test('tile intersections are clipped to the selected viewport rectangle', () => {
  assert.deepEqual(intersectRect(
    { left: 10, top: 30, width: 90, height: 40 },
    { left: 0, top: 0, width: 80, height: 50 }
  ), { left: 10, top: 30, width: 70, height: 20 });
  assert.equal(intersectRect(
    { left: 0, top: 0, width: 10, height: 10 },
    { left: 10, top: 0, width: 10, height: 10 }
  ), null);
});
