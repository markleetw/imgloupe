/**
 * Image Download Manager & ZIP Packager
 */

import { uiToast } from "../ui/toast.js";
import JSZip from "jszip";
import { readFilesystemImage } from './image-source.js';
import { blobToPngBlob } from './raster.js';
import { openBackgroundExport } from './export-client.js';
import { fetchMobileViewImageUrls, fullSizeImageUrl } from './docs-mobile-view.js';
import { fetchProxiedImageCells } from '../sheets/html-view.js';
import { buildFailureReport, REPORT_FILE_NAME } from './failure-report.js';
import { t, tn } from '../../shared/i18n.js';

// Window titles end with " - Google <app>" in the UI language.
const APP_TITLE_SUFFIXES = ['Docs', 'Sheets', 'Slides', '文件', '試算表', '簡報', '文档', '表格', '幻灯片']
  .map(app => ` - google ${app}`.toLowerCase());
const STEM_FALLBACK = 'imgloupe';
const STEM_MAX_LENGTH = 80;

// Build a portable file-name stem from the document title: keep the title's
// own case and scripts, drop the app suffix and characters that file systems
// reject, and join words with hyphens.
export function documentFileStem(title = typeof document !== 'undefined' ? document.title : '') {
  // Pad so an untitled " - Google Docs" title still matches after trimming.
  let stem = ` ${String(title || '').normalize('NFC').trim()}`;
  const lower = stem.toLowerCase();
  const suffix = APP_TITLE_SUFFIXES.find(candidate => lower.endsWith(candidate));
  if (suffix) stem = stem.slice(0, -suffix.length);
  const words = stem.split(/[\s\\/:*?"<>|\u0000-\u001f\u007f]+/u).filter(Boolean);
  const joined = words.join('-').replace(/^[.-]+|[.-]+$/g, '');
  return Array.from(joined).slice(0, STEM_MAX_LENGTH).join('') || STEM_FALLBACK;
}

const EXTENSION_BY_SUBTYPE = new Map([
  ['png', 'png'], ['jpeg', 'jpg'], ['jpg', 'jpg'], ['gif', 'gif'], ['webp', 'webp'],
  ['svg+xml', 'svg'], ['svg', 'svg'], ['avif', 'avif'], ['bmp', 'bmp']
]);

// Prefer the response's image MIME type; otherwise trust only a known image
// extension in the URL path. Unknown inputs are saved as PNG.
export function imageExtensionFor(blob, url = '') {
  const mime = (blob?.type || '').toLowerCase().split(';')[0].trim();
  if (mime.startsWith('image/') && EXTENSION_BY_SUBTYPE.has(mime.slice(6))) return EXTENSION_BY_SUBTYPE.get(mime.slice(6));
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { /* not an absolute URL */ }
  const name = pathname.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  const candidate = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return EXTENSION_BY_SUBTYPE.get(candidate) || 'png';
}

export function triggerBlobDownload(blob, filename) {
  if (typeof document === "undefined") return;
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the address valid until Chrome has started the download.
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60000)?.unref?.();
}

// Run `task` on every item, at most `limit` at a time, sharing one index
// iterator between the lanes.
async function forEachConcurrently(items, limit, task) {
  const indexes = items.keys();
  const lane = async () => {
    for (const index of indexes) await task(items[index], index);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

const FETCH_TIMEOUT_MS = 20000;
const CONCURRENT_FETCHES = 4;
const withTimeout = (ms) => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
  ? { signal: AbortSignal.timeout(ms) } : {});

// Signatures of the image formats Google serves. A response without an image
// MIME type is accepted only when its first bytes match one of them, so a
// sign-in page or other HTML is never saved under an image extension.
const SIGNATURES = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/bmp', [0x42, 0x4d]]
];
export async function ensureImageBlob(blob) {
  if (!blob) throw new Error('Empty response');
  if ((blob.type || '').toLowerCase().startsWith('image/')) return blob;
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  for (const [type, bytes] of SIGNATURES) {
    if (bytes.every((value, index) => head[index] === value)) return new Blob([blob], { type });
  }
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return new Blob([blob], { type: 'image/webp' });
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(ascii)) return new Blob([blob], { type: 'image/svg+xml' });
  throw new Error(`Not an image (${blob.type || 'unknown type'})`);
}

async function fetchOnce(url) {
  const res = await fetch(url, withTimeout(FETCH_TIMEOUT_MS));
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return ensureImageBlob(await res.blob());
}

export async function fetchImageBlobWithRetry(url, retries = 2) {
  if (url.startsWith('filesystem:')) return ensureImageBlob(await readFilesystemImage(url));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      lastError = err;
      // Missing files and non-image responses do not improve on retry.
      if (err?.status === 404 || /^Not an image/.test(err?.message || '')) break;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  // An upgraded "=s2048" Google image URL may be refused; retry its original size.
  const fallbackUrl = url.replace(/=s2048(?=$|[?#])/, '');
  if (fallbackUrl !== url) {
    try { return await fetchOnce(fallbackUrl); } catch { /* report the first error */ }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

export async function fetchImageBlob(url) {
  return fetchImageBlobWithRetry(url, 1);
}

export async function fetchPngBlob(url) {
  return blobToPngBlob(await fetchImageBlob(url));
}

// Save the selected image through a same-origin blob URL. A failed read is
// reported; it never falls back to opening the source URL, which would
// navigate the document tab for cross-origin images.
export async function downloadSingleImage(url) {
  if (!url) {
    uiToast(t('toastNoImageSource'), 3000);
    return false;
  }
  uiToast(t('toastDownloading'), 0);
  let blob;
  try {
    blob = await fetchImageBlob(url);
  } catch {
    uiToast(t('toastDownloadFailed'), 3000);
    return false;
  }
  triggerBlobDownload(blob, `${documentFileStem()}.${imageExtensionFor(blob, url)}`);
  uiToast(t('toastDownloaded'), 2500);
  return true;
}

const sha256Hex = async blob => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
};

// Window title without the " - Google <app>" suffix.
export function documentTitle(title = typeof document !== 'undefined' ? document.title : '') {
  const text = String(title || '').trim();
  const lower = ` ${text}`.toLowerCase();
  const suffix = APP_TITLE_SUFFIXES.find(candidate => lower.endsWith(candidate));
  return (suffix ? text.slice(0, text.length - suffix.length + 1) : text).trim();
}

const currentApp = () => (typeof location !== 'undefined' ? location.pathname.split('/')[1] : '');

// Pack items into one ZIP, four at a time, keeping one copy of byte-identical
// files. Each item is { label, location?, address?, load: () => Promise<Blob> }:
// label picks the file extension; location and address describe the item in
// the failure report.
async function packItems(items, { source, onProgress, JSZipClass = JSZip }) {
  const zip = new JSZipClass();
  const failures = [];
  const loaded = new Array(items.length);
  let finished = 0;
  const report = () => {
    uiToast(t('toastPacking', finished, items.length), 0);
    if (finished === 0 || typeof onProgress !== 'function') return;
    try { onProgress(finished, items.length); } catch { /* progress is advisory */ }
  };
  report();
  await forEachConcurrently(items, CONCURRENT_FETCHES, async (item, index) => {
    try {
      const blob = await item.load();
      loaded[index] = { blob, fingerprint: await sha256Hex(blob) };
    } catch (error) {
      failures[index] = { location: item.location, address: item.address, error };
    }
    finished += 1;
    report();
  });

  // Name files after all loads finish so numbering is consecutive and follows
  // the source order no matter which download completed first. Of identical
  // files, the first in source order is kept.
  const fingerprints = new Set();
  const unique = [];
  loaded.forEach((entry, idx) => {
    if (!entry || fingerprints.has(entry.fingerprint)) return;
    fingerprints.add(entry.fingerprint);
    unique.push({ blob: entry.blob, label: items[idx].label });
  });
  const digits = Math.max(2, `${unique.length}`.length);
  for (const [position, { blob, label }] of unique.entries()) {
    const number = `${position + 1}`.padStart(digits, '0');
    zip.file(`image-${number}.${imageExtensionFor(blob, label)}`, blob);
  }
  const savedCount = unique.length;

  const failed = failures.filter(Boolean);
  if (failed.length > 0) {
    zip.file(REPORT_FILE_NAME, buildFailureReport({
      title: documentTitle(),
      app: currentApp(),
      source,
      found: items.length,
      saved: savedCount,
      duplicates: items.length - savedCount - failed.length,
      failures: failed
    }));
  }

  if (savedCount > 0) {
    uiToast(t('toastZipping'), 0);
    // Images are already compressed; STORE avoids spending CPU on them again.
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    triggerBlobDownload(zipBlob, `${documentFileStem()}-images.zip`);
    uiToast(failed.length > 0 ? tn('toastZipDonePartial', savedCount, failed.length) : tn('toastZipDone', savedCount), failed.length > 0 ? 4500 : 3500);
  } else {
    uiToast(t('toastZipFailed'), 3000);
  }
  return { downloaded: savedCount, failed: failed.length, source };
}

// Pack image URLs discovered in the page (network entries and image elements).
export async function packImagesToZip(urls, onProgress, JSZipClass = JSZip) {
  if (!urls?.length) {
    uiToast(t('toastNoImagesFound'), 3000);
    return { downloaded: 0, failed: 0, source: 'loaded' };
  }
  const items = urls.map(url => ({ label: url, location: 'Image loaded in the page', address: url, load: () => fetchImageBlobWithRetry(url) }));
  return packItems(items, { source: 'loaded', onProgress, JSZipClass });
}

// Load an image at its stored size, falling back to the URL as listed.
async function fetchFullSizeImage(url) {
  const full = fullSizeImageUrl(url);
  if (full !== url) {
    try { return await fetchImageBlobWithRetry(full, 1); } catch { /* use the listed size */ }
  }
  return fetchImageBlobWithRetry(url);
}

// Spreadsheet IMAGE() cells. The formula's own https address is tried first
// (original file); when that site refuses cross-site reads or the formula has
// no literal address (e.g. IMAGE(A1)), Google's copy from the HTML view is used.
async function sheetFormulaItems(formulas, href) {
  if (!formulas.length) return [];
  let proxies = new Map();
  try {
    proxies = await fetchProxiedImageCells([...new Set(formulas.map(item => item.sheet))], href);
  } catch (err) {
    console.warn('[ImgLoupe] Sheets HTML view unavailable:', err?.message || err);
  }
  const items = [];
  for (const { sheet, cell, url } of formulas) {
    const proxy = proxies.get(sheet)?.get(cell);
    if (!url && !proxy) continue; // nothing to download (for example an empty reference)
    items.push({
      label: url || proxy,
      location: `Sheet "${sheet}", cell ${cell} (IMAGE formula)`,
      address: url || undefined,
      async load() {
        if (url) {
          try {
            return await fetchImageBlobWithRetry(url, proxy ? 0 : 1);
          } catch (error) {
            if (!proxy) throw error;
            try { return await fetchFullSizeImage(proxy); } catch { throw error; }
          }
        }
        return fetchFullSizeImage(proxy);
      }
    });
  }
  return items;
}

// Every image of the current document version, as packable items.
//   Docs: the basic mobile view, read directly from docs.google.com.
//   Sheets and Slides: the media folder of Google's Office export, which the
//   background service worker downloads (Google serves it from another origin),
//   plus Sheets IMAGE() formula images.
export async function collectDocumentImages(JSZipClass = JSZip, href = location.href) {
  if (/^\/document\//.test(new URL(href).pathname)) {
    const urls = await fetchMobileViewImageUrls(href);
    return {
      items: urls.map((url, index) => ({
        label: url,
        location: `Image ${index + 1} of ${urls.length} (in document order)`,
        load: () => fetchFullSizeImage(url)
      })),
      close() {}
    };
  }
  const exported = await openBackgroundExport();
  try {
    const embedded = exported.images.map((image, index) => ({
      label: image.name,
      location: image.location || `Embedded image ${image.name}`,
      load: () => exported.read(index)
    }));
    const formulas = exported.kind === 'spreadsheets' ? await sheetFormulaItems(exported.imageFormulas, href) : [];
    return { items: [...embedded, ...formulas], close: () => exported.close() };
  } catch (err) {
    exported.close();
    throw err;
  }
}

// Pack every image of the current document version. When Google provides none
// (download disabled, network failure, unsupported layout), fall back to the
// images loaded in this page.
export async function exportDocumentImages({ discoverLoadedUrls, onProgress, JSZipClass = JSZip, collectImages = collectDocumentImages } = {}) {
  uiToast(t('toastExporting'), 0);
  let collection = null;
  try {
    collection = await collectImages(JSZipClass);
  } catch (err) {
    console.warn('[ImgLoupe] Document export unavailable:', err?.message || err);
  }
  if (collection?.items.length) {
    try {
      return await packItems(collection.items, { source: 'export', onProgress, JSZipClass });
    } finally {
      collection.close();
    }
  }
  collection?.close();
  uiToast(t('toastExportFallback'), 0);
  const urls = typeof discoverLoadedUrls === 'function' ? await discoverLoadedUrls() : [];
  return packImagesToZip(urls, onProgress, JSZipClass);
}
