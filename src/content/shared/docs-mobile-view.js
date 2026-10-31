// Google Docs' Office export redirects to a download host on another origin,
// which a content script cannot read. The document's basic mobile view is
// served from docs.google.com itself and lists every image of the current
// version, in document order, as ordinary <img> elements. Deleted images are
// absent and pages never scrolled into view are included.

const VIEW_TIMEOUT_MS = 60000;
const IMAGE_HOST = /(^|\.)googleusercontent\.com$/;

export function buildMobileViewUrl(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== 'https://docs.google.com') return null;
  const match = url.pathname.match(/^\/document\/((?:u\/\d+\/)?)d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match) return null;
  const view = new URL(`/document/${match[1]}d/${match[2]}/mobilebasic`, url.origin);
  const resourceKey = url.searchParams.get('resourcekey');
  if (resourceKey) view.searchParams.set('resourcekey', resourceKey);
  return view.href;
}

// Google image URLs end with a size option such as "=s800"; "=s0" asks for the
// stored size. Other URLs are returned unchanged.
export function fullSizeImageUrl(value) {
  const url = new URL(value);
  if (!IMAGE_HOST.test(url.hostname) || !/=[^/]*$/.test(url.pathname)) return url.href;
  url.pathname = url.pathname.replace(/=[^/]*$/, '=s0');
  return url.href;
}

// Image URLs in document order, without duplicates.
export function parseMobileViewImages(html, baseUrl) {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const urls = [];
  for (const image of page.querySelectorAll('img[src]')) {
    let url;
    try { url = new URL(image.getAttribute('src'), baseUrl); } catch { continue; }
    if (url.protocol === 'https:' && IMAGE_HOST.test(url.hostname) && !urls.includes(url.href)) urls.push(url.href);
  }
  return urls;
}

export async function fetchMobileViewImageUrls(href = location.href) {
  const viewUrl = buildMobileViewUrl(href);
  if (!viewUrl) throw new Error('Not a Google Docs document URL');
  const options = { credentials: 'include' };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(VIEW_TIMEOUT_MS);
  const response = await fetch(viewUrl, options);
  if (!response.ok) throw new Error(`Mobile view HTTP ${response.status}`);
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('text/html')) throw new Error('Mobile view is not a web page');
  return parseMobileViewImages(await response.text(), viewUrl);
}
