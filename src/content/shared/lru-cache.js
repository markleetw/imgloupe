/**
 * LRU Image Cache with Explicit GPU VRAM Cleanup
 * Maintains up to 60 ImageBitmaps. Explicitly calls bitmap.close() on eviction.
 */

const MAX_CACHE_SIZE = 60;
import { readFilesystemImage } from './image-source.js';
export const imageCache = new Map();


export function evictOldestCacheEntry() {
  while (imageCache.size > MAX_CACHE_SIZE) {
    const oldestKey = imageCache.keys().next().value;
    const promise = imageCache.get(oldestKey);
    imageCache.delete(oldestKey);
    if (promise && typeof promise.then === "function") {
      promise.then((entry) => {
        if (entry?.bitmap && typeof entry.bitmap.close === "function") {
          try {
            entry.bitmap.close();
          } catch {}
        }
      }).catch(() => {});
    }
  }
}

export function fetchAndCacheImage(url) {
  const existing = imageCache.get(url);
  if (existing) {
    imageCache.delete(url);
    imageCache.set(url, existing);
    return existing;
  }

  const source = url.startsWith('filesystem:') ? readFilesystemImage(url) :
    fetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {})
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))));
  const promise = source
    .then(async (blob) => {
      const decoded = await createImageBitmap(blob);
      const scale = Math.min(1, 256 / Math.max(decoded.width, decoded.height));
      if (scale === 1) return { bitmap: decoded, mimeType: blob.type };
      try {
        const bitmap = await createImageBitmap(decoded, {
          resizeWidth: Math.max(1, Math.round(decoded.width * scale)),
          resizeHeight: Math.max(1, Math.round(decoded.height * scale))
        });
        return { bitmap, mimeType: blob.type };
      } finally { decoded.close(); }
    })
    .catch(() => null);

  imageCache.set(url, promise);

  promise.then((res) => {
    if (!res && imageCache.get(url) === promise) {
      imageCache.delete(url);
    }
  });

  evictOldestCacheEntry();
  return promise;
}

export async function getImageBitmap(url) {
  const res = await fetchAndCacheImage(url);
  return res?.bitmap ?? null;
}
