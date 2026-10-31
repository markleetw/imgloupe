import test from 'node:test';
import assert from 'node:assert/strict';
import { imageCache, fetchAndCacheImage, getImageBitmap } from '../../src/content/shared/lru-cache.js';

test('real cache coalesces concurrent URL requests and releases full-size decoded originals', async () => {
  const originalFetch = globalThis.fetch;
  const originalDecode = globalThis.createImageBitmap;
  imageCache.clear();
  let fetched = 0;
  let decodedClosed = 0;
  try {
    globalThis.fetch = async () => { fetched++; return { ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) }; };
    globalThis.createImageBitmap = async (_source, options) => options
      ? { width: options.resizeWidth, height: options.resizeHeight, close() {} }
      : { width: 4000, height: 2000, close() { decodedClosed++; } };
    const first = fetchAndCacheImage('https://example.com/coalesced.png');
    assert.equal(first, fetchAndCacheImage('https://example.com/coalesced.png'));
    const bitmap = await getImageBitmap('https://example.com/coalesced.png');
    assert.equal(fetched, 1);
    assert.equal(bitmap.width, 256);
    assert.equal(bitmap.height, 128);
    assert.equal(decodedClosed, 1);
  } finally {
    imageCache.clear();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalDecode;
  }
});

test('real cache evicts the least recently used preview and closes its bitmap', async () => {
  const originalFetch = globalThis.fetch;
  const originalDecode = globalThis.createImageBitmap;
  imageCache.clear();
  const closed = [];
  let id = 0;
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['x']) });
    globalThis.createImageBitmap = async () => {
      const current = id++;
      return { width: 100, height: 100, close() { closed.push(current); } };
    };
    for (let index = 0; index < 60; index++) await getImageBitmap(`https://example.com/${index}.png`);
    await getImageBitmap('https://example.com/0.png'); // Touch the oldest entry.
    await getImageBitmap('https://example.com/60.png');
    await Promise.resolve();
    assert.equal(imageCache.size, 60);
    assert.equal(imageCache.has('https://example.com/0.png'), true);
    assert.equal(imageCache.has('https://example.com/1.png'), false);
    assert.deepEqual(closed, [1]);
  } finally {
    imageCache.clear();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalDecode;
  }
});
