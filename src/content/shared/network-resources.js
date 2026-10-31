import { extractFormulaBarImageUrl } from '../sheets/formula-parser.js';
import { fetchAndCacheImage } from './lru-cache.js';
import { describeBitmap } from './image-signature.js';

const paths = { document: '/docs-images-rt/', spreadsheets: '/sheets-images-rt/', presentation: '/slides-images-rt/' };
const discovered = new Map();
let observing = false;
let documentKey = '';
const parse = value => { try { return new URL(value); } catch { return null; } };
const googleImage = url => url && /(^|\.)(googleusercontent\.com|docs\.google\.com)$/.test(url.hostname);
function syncDocumentScope() {
  const key = typeof location !== 'undefined' ? location.pathname : '';
  if (key !== documentKey) { discovered.clear(); documentKey = key; }
}
export const isUserAvatarUrl = value => /\/(?:a|a-|ogw|account|user|profile)\//i.test(parse(value)?.pathname || '');

export function getBaseImageUrl(value) {
  const url = parse(value);
  if (!url) return value || '';
  if (googleImage(url)) return `https://googleusercontent.com${url.pathname.replace(/=[^/]*$/, '')}${url.search}`;
  return url.href;
}

export function upgradeToHighResUrl(value) {
  const url = parse(value);
  if (!googleImage(url) || !Object.values(paths).some(segment => url.pathname.includes(segment)) && !url.pathname.includes('/docsubipk/')) return value;
  url.pathname = `${url.pathname.replace(/=[^/]*$/, '')}=s2048`;
  return url.href;
}

export function registerImageUrl(value, type) {
  const url = parse(value);
  if (!url || !['https:', 'blob:', 'filesystem:'].includes(url.protocol) || isUserAvatarUrl(value)) return;
  if (url.protocol === 'filesystem:' && parse(value.slice('filesystem:'.length))?.origin !== location.origin) return;
  if (/(^|\.)gstatic\.com$/.test(url.hostname)) return;
  const key = `${type}:${getBaseImageUrl(value)}`;
  discovered.set(key, { type, url: upgradeToHighResUrl(value) });
  if (discovered.size > 2000) discovered.delete(discovered.keys().next().value);
}

function ingest(entry) {
  syncDocumentScope();
  const value = typeof entry === 'string' ? entry : entry.name;
  const url = parse(value);
  if (!googleImage(url)) return;
  const type = Object.keys(paths).find(type => url.pathname.includes(paths[type])) || (url.pathname.startsWith('/docsubipk/') ? 'spreadsheets' : null);
  if (type) registerImageUrl(value, type);
}

export function initResourceObserver() {
  syncDocumentScope();
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;
  const observer = new PerformanceObserver(list => list.getEntries().forEach(ingest));
  observer.observe({ type: 'resource', buffered: true });
}

export function getNetworkResourceUrls(type, entries = typeof performance !== 'undefined' ? performance.getEntriesByType('resource') : []) {
  syncDocumentScope();
  initResourceObserver();
  for (const entry of entries) ingest(entry);
  if (typeof document !== 'undefined') {
    const selector = type === 'presentation' ? '#workspace-container image, .punch-viewer-content image, .punch-filmstrip-thumbnail image' :
      type === 'spreadsheets' ? '.waffle-borderless-embedded-object-container img' : 'svg.kix-embeddedobject-image image';
    for (const element of document.querySelectorAll(selector)) {
      registerImageUrl(element.getAttribute('href') || element.getAttribute('xlink:href') || element.getAttribute('src'), type);
    }
    if (type === 'spreadsheets') registerImageUrl(extractFormulaBarImageUrl(), type);
  }
  return Array.from(discovered.values()).filter(item => item.type === type).map(item => item.url);
}

// Images loaded in this page for the current document. Used for ZIP export
// only when Google's document export is unavailable.
export async function getBatchImageUrls(type) {
  return getNetworkResourceUrls(type).slice(0, 2000);
}

let thumbnailWork = Promise.resolve();
export function fetchCandidateThumbnails(urls, isCurrent = () => true) {
  const task = thumbnailWork.then(async () => {
  const results = [];
  const queue = [...new Set(urls)];
  const consume = async () => {
    while (queue.length && isCurrent()) {
      const url = queue.shift();
      try {
        const image = await fetchAndCacheImage(url);
        const signature = image?.bitmap && describeBitmap(image.bitmap);
        if (signature) results.push({ url, signature });
      } catch { /* A failed image must not prevent other selections. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, consume));
  return results;
  });
  thumbnailWork = task.catch(() => {});
  return task;
}
