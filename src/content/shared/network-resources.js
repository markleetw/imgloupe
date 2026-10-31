// Addresses of the images the open document has shown.
//
// Two sources feed one list per document: resource timing entries (every
// image the page has fetched, including ones scrolled out of view) and the
// image elements on the page right now. Google image addresses are compared
// without their size suffix, so the same image loaded at several sizes, or
// from several shard hosts, is listed once, at full size.
import { extractFormulaBarImageUrl } from '../sheets/formula-parser.js';
import { fetchAndCacheImage } from './lru-cache.js';
import { describeBitmap } from './image-signature.js';

const GOOGLE_HOSTS = ['googleusercontent.com', 'docs.google.com'];
const IMAGE_FAMILY = /\/(docs|sheets|slides)-images-rt\//;
const APP_BY_FAMILY = Object.freeze({ docs: 'document', sheets: 'spreadsheets', slides: 'presentation' });
const SHEETS_UPLOADS = '/docsubipk/';
const FULL_SIZE = '=s2048';
const MAX_ENTRIES = 2000;
const THUMBNAIL_WORKERS = 4;
const PROTOCOLS = new Set(['https:', 'blob:', 'filesystem:']);
// Path segments of profile pictures (comment authors, collaborators).
const AVATAR_SEGMENTS = new Set(['a', 'a-', 'ogw', 'account', 'user', 'profile']);
// Image elements on the page, per app.
const PAGE_IMAGES = Object.freeze({
  document: 'svg.kix-embeddedobject-image image',
  spreadsheets: '.waffle-borderless-embedded-object-container img',
  presentation: '#workspace-container image, .punch-viewer-content image, .punch-filmstrip-thumbnail image'
});

const seen = { path: null, images: new Map() };
let observer = null;

function toUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const onHost = (url, domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`);
const isGoogleImageHost = url => Boolean(url) && GOOGLE_HOSTS.some(domain => onHost(url, domain));

// "/docs-images-rt/ID=w800-h600" -> "/docs-images-rt/ID"
function withoutSize(pathname) {
  const suffix = pathname.indexOf('=', pathname.lastIndexOf('/') + 1);
  return suffix < 0 ? pathname : pathname.slice(0, suffix);
}

function appOfPath(pathname) {
  const family = IMAGE_FAMILY.exec(pathname)?.[1];
  if (family) return APP_BY_FAMILY[family];
  return pathname.startsWith(SHEETS_UPLOADS) ? 'spreadsheets' : null;
}

// Forget the previous document's images when the page moves to another one.
function enterCurrentDocument() {
  const path = typeof location === 'undefined' ? '' : location.pathname;
  if (seen.path === path) return;
  seen.path = path;
  seen.images.clear();
}

export function isUserAvatarUrl(value) {
  const segments = (toUrl(value)?.pathname || '').split('/');
  return segments.slice(0, -1).some(segment => AVATAR_SEGMENTS.has(segment.toLowerCase()));
}

// One address per Google image, whatever its size or shard host.
export function getBaseImageUrl(value) {
  const url = toUrl(value);
  if (!url) return value || '';
  return isGoogleImageHost(url) ? `https://googleusercontent.com${withoutSize(url.pathname)}${url.search}` : url.href;
}

export function upgradeToHighResUrl(value) {
  const url = toUrl(value);
  const documentImage = isGoogleImageHost(url) && (IMAGE_FAMILY.test(url.pathname) || url.pathname.includes(SHEETS_UPLOADS));
  if (!documentImage) return value;
  url.pathname = withoutSize(url.pathname) + FULL_SIZE;
  return url.href;
}

function acceptable(value, url) {
  if (!url || !PROTOCOLS.has(url.protocol) || onHost(url, 'gstatic.com') || isUserAvatarUrl(value)) return false;
  // filesystem: URLs of this page only.
  return url.protocol !== 'filesystem:' || toUrl(value.slice('filesystem:'.length))?.origin === location.origin;
}

export function registerImageUrl(value, type) {
  if (!acceptable(value, toUrl(value))) return;
  seen.images.set(`${type}:${getBaseImageUrl(value)}`, { type, url: upgradeToHighResUrl(value) });
  // Oldest first out.
  if (seen.images.size > MAX_ENTRIES) seen.images.delete(seen.images.keys().next().value);
}

function recordResource(entry) {
  enterCurrentDocument();
  const value = typeof entry === 'string' ? entry : entry.name;
  const url = toUrl(value);
  if (!isGoogleImageHost(url)) return;
  const app = appOfPath(url.pathname);
  if (app) registerImageUrl(value, app);
}

export function initResourceObserver() {
  enterCurrentDocument();
  if (observer || typeof PerformanceObserver === 'undefined') return;
  observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) recordResource(entry);
  });
  observer.observe({ type: 'resource', buffered: true });
}

function recordPageImages(type) {
  for (const element of document.querySelectorAll(PAGE_IMAGES[type] || PAGE_IMAGES.document)) {
    const address = ['href', 'xlink:href', 'src'].map(name => element.getAttribute(name)).find(Boolean);
    registerImageUrl(address, type);
  }
  if (type === 'spreadsheets') registerImageUrl(extractFormulaBarImageUrl(), type);
}

export function getNetworkResourceUrls(type, entries = typeof performance === 'undefined' ? [] : performance.getEntriesByType('resource')) {
  enterCurrentDocument();
  initResourceObserver();
  entries.forEach(recordResource);
  if (typeof document !== 'undefined') recordPageImages(type);
  const urls = [];
  for (const image of seen.images.values()) if (image.type === type) urls.push(image.url);
  return urls;
}

// Images loaded in this page for the current document. Used for ZIP export
// only when Google's document export is unavailable.
export async function getBatchImageUrls(type) {
  return getNetworkResourceUrls(type).slice(0, MAX_ENTRIES);
}

// Fetch candidate images a few at a time and describe each one. Calls run one
// after another; `isCurrent` turning false stops the remaining fetches.
async function describeCandidates(urls, isCurrent) {
  const pending = Array.from(new Set(urls));
  const described = [];
  const worker = async () => {
    while (pending.length > 0 && isCurrent()) {
      const url = pending.shift();
      try {
        const image = await fetchAndCacheImage(url);
        const signature = image?.bitmap ? describeBitmap(image.bitmap) : null;
        if (signature) described.push({ url, signature });
      } catch {
        // One image that fails to load must not stop the others.
      }
    }
  };
  const workers = Math.min(THUMBNAIL_WORKERS, pending.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return described;
}

let previousRun = Promise.resolve();
export function fetchCandidateThumbnails(urls, isCurrent = () => true) {
  const run = previousRun.then(() => describeCandidates(urls, isCurrent));
  previousRun = run.catch(() => {});
  return run;
}
