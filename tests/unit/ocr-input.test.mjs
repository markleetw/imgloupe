import test from 'node:test';
import assert from 'node:assert/strict';
import { getOcrDimensions } from '../../src/offscreen/ocr-input.js';

test('all OCR paths obey the common 1600px and pixel-budget limits', () => {
  assert.deepEqual(getOcrDimensions(4000, 2000), { width: 1600, height: 800 });
  assert.deepEqual(getOcrDimensions(3200, 3200), { width: 1600, height: 1600 });
  assert.deepEqual(getOcrDimensions(300, 100), { width: 300, height: 100 });
  assert.throws(() => getOcrDimensions(0, 100), /dimensions/);
  assert.throws(() => getOcrDimensions(Infinity, 1), /dimensions/);
});
