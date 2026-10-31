// Downloads Google's Office export of the document open in the sending tab and
// hands its images back to that tab's content script one at a time.
//
// The export URL is always derived here from the sender tab's own address, so
// a content script cannot use this service to fetch any other address. The
// request follows Google's redirect to its googleusercontent.com download host,
// which the content script itself cannot read across origins.
import JSZip from 'jszip';
import { buildExportUrl, extractPackageImages, extractSheetImageFormulas, EXPORT_TIMEOUT_MS, EXPORT_MAX_BYTES } from '../shared/office-export.js';

const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024; // stays well inside the 64 MiB message limit once encoded
const sessions = new Map();

function expireSessions(now = Date.now()) {
  for (const [token, session] of sessions) if (now - session.created > SESSION_TTL_MS) sessions.delete(token);
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function openExport(senderUrl, tabId, { fetchImpl = fetch, JSZipClass = JSZip } = {}) {
  const target = buildExportUrl(senderUrl);
  if (!target || target.type === 'document') throw new Error('Unsupported document');
  const options = { credentials: 'include' };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(EXPORT_TIMEOUT_MS);
  const response = await fetchImpl(target.url, options);
  if (!response.ok) throw new Error(`Export HTTP ${response.status}`);
  // A sign-in or permission page is HTML, not an Office package.
  if ((response.headers.get('content-type') || '').toLowerCase().startsWith('text/')) throw new Error('Export returned a web page');
  if (Number(response.headers.get('content-length')) > EXPORT_MAX_BYTES) throw new Error('Export is too large');
  const data = await response.arrayBuffer();
  if (data.byteLength > EXPORT_MAX_BYTES) throw new Error('Export is too large');
  const images = await extractPackageImages(target.type, data, JSZipClass);
  const imageFormulas = target.type === 'spreadsheets' ? await extractSheetImageFormulas(data, JSZipClass) : [];
  expireSessions();
  const token = crypto.randomUUID();
  sessions.set(token, { tabId, images, created: Date.now() });
  return {
    token,
    kind: target.type,
    images: images.map(({ name, type, bytes, location }) => ({ name, type, size: bytes.length, location })),
    imageFormulas
  };
}

// Development builds only: the export's part names and its small XML parts, to
// check how Google lays out real packages. Not reachable in the store build.
export async function inspectExportParts(senderUrl, { fetchImpl = fetch, JSZipClass = JSZip } = {}) {
  const target = buildExportUrl(senderUrl);
  if (!target || target.type === 'document') throw new Error('Unsupported document');
  const response = await fetchImpl(target.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Export HTTP ${response.status}`);
  const zip = await JSZipClass.loadAsync(await response.arrayBuffer());
  const parts = {};
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    parts[name] = /\.(xml|rels)$/.test(name) ? (await zip.file(name).async('string')).slice(0, 20000) : null;
  }
  return parts;
}

export function readExportImage(token, index, tabId) {
  const session = sessions.get(token);
  if (!session || session.tabId !== tabId) throw new Error('Unknown export');
  const image = Number.isInteger(index) ? session.images[index] : undefined;
  if (!image) throw new Error('Unknown image');
  if (image.bytes.length > MAX_IMAGE_BYTES) throw new Error('Image is too large to transfer');
  return { type: image.type, data: bytesToBase64(image.bytes) };
}

export function closeExport(token, tabId) {
  const session = sessions.get(token);
  if (session && session.tabId === tabId) sessions.delete(token);
}

// Message handler for content scripts. Returns true when it will respond.
export function handleExportMessage(message, sender, sendResponse) {
  const tabId = sender?.tab?.id;
  const senderUrl = sender?.tab?.url || sender?.url;
  if (!Number.isInteger(tabId) || !senderUrl) {
    sendResponse({ success: false, error: 'Exports are available only to document tabs' });
    return false;
  }
  const reply = promise => {
    promise.then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  };
  switch (message.type) {
    case 'imgloupe:export-open': return reply(openExport(senderUrl, tabId));
    case 'imgloupe:export-read': return reply(Promise.resolve().then(() => readExportImage(message.token, message.index, tabId)));
    case 'imgloupe:export-close': closeExport(message.token, tabId); sendResponse({ success: true }); return false;
    default: return false;
  }
}
