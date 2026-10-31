// Google Sheets' HTML view (/spreadsheets/d/<id>/htmlview) renders every
// worksheet as a table from docs.google.com itself. Cells showing an IMAGE()
// result carry Google's own copy of that image (lh*.googleusercontent.com/
// docsubipk/…), which can be read even when the image's original website does
// not allow cross-site reads (no CORS header).
//
// Parsing is done with regular expressions on Google's server-rendered markup,
// so it does not depend on DOMParser or the page's Trusted Types policy.

const VIEW_TIMEOUT_MS = 60000;
const PROXIED_IMAGE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/docsubipk\//i;

export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function decodeJsString(text) {
  try {
    return JSON.parse(`"${text.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1').replace(/\\'/g, "'")}"`);
  } catch {
    return text;
  }
}

function sheetViewBase(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== 'https://docs.google.com') return null;
  const match = url.pathname.match(/^\/spreadsheets\/((?:u\/\d+\/)?)d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match) return null;
  return { base: `https://docs.google.com/spreadsheets/${match[1]}d/${match[2]}/htmlview`, resourceKey: url.searchParams.get('resourcekey') };
}

// [{ name, gid }] from the HTML view's sheet switcher.
export function parseSheetList(html) {
  return [...html.matchAll(/items\.push\(\{\s*name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)]
    .map(([, name, gid]) => ({ name: decodeJsString(name), gid }));
}

const cellAttribute = (tag, name) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(tag)?.[1] || 1);

// Map of "G37" -> image URL for cells showing a proxied IMAGE() result.
// Column letters come from the header ids (<gid>C<index>), so hidden columns,
// merged cells (colspan/rowspan) and frozen panes keep their real addresses.
export function parseSheetImageCells(html, baseUrl) {
  const cells = new Map();
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1]);
  const header = rows.find(row => /<th\b[^>]*\bid="\d+C\d+"/.test(row));
  if (!header) return cells;
  const columns = [...header.matchAll(/<th\b[^>]*\bid="\d+C(\d+)"/g)].map(match => Number(match[1]));
  const spanned = new Map(); // visible column position -> remaining rows covered by a rowspan
  for (const row of rows) {
    const rowId = /<th\b[^>]*\bid="\d+R(\d+)"/.exec(row);
    if (!rowId) continue;
    const rowNumber = Number(rowId[1]) + 1;
    let position = 0;
    const skipSpanned = () => { while (spanned.get(position) > 0) position++; };
    for (const [, tag, body] of row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)) {
      skipSpanned();
      const colspan = cellAttribute(tag, 'colspan');
      const rowspan = cellAttribute(tag, 'rowspan');
      const src = /<img\b[^>]*\bsrc="([^"]+)"/.exec(body)?.[1];
      if (src && columns[position] !== undefined) {
        try {
          const url = new URL(src.replace(/&amp;/g, '&'), baseUrl).href;
          if (PROXIED_IMAGE.test(url)) cells.set(`${columnName(columns[position])}${rowNumber}`, url);
        } catch { /* ignore malformed sources */ }
      }
      if (rowspan > 1) for (let offset = 0; offset < colspan; offset++) spanned.set(position + offset, rowspan);
      position += colspan;
    }
    for (const [key, remaining] of spanned) spanned.set(key, remaining - 1);
  }
  return cells;
}

async function fetchText(url) {
  const options = { credentials: 'include' };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(VIEW_TIMEOUT_MS);
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTML view HTTP ${response.status}`);
  return response.text();
}

// Map of sheet name -> Map(cell -> Google's copy of the IMAGE() result), for the
// named sheets only. Sheets that cannot be read are left out.
export async function fetchProxiedImageCells(sheetNames, href = location.href) {
  const view = sheetViewBase(href);
  const result = new Map();
  if (!view || !sheetNames.length) return result;
  const withKey = url => {
    if (view.resourceKey) url.searchParams.set('resourcekey', view.resourceKey);
    return url.href;
  };
  const sheets = parseSheetList(await fetchText(withKey(new URL(view.base))));
  for (const sheet of sheets.filter(item => sheetNames.includes(item.name))) {
    try {
      const url = new URL(`${view.base}/sheet`);
      url.searchParams.set('headers', 'true');
      url.searchParams.set('gid', sheet.gid);
      result.set(sheet.name, parseSheetImageCells(await fetchText(withKey(url)), url.href));
    } catch { /* this sheet keeps the original addresses only */ }
  }
  return result;
}
