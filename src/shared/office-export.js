// Google's own Office-format export of a document (the same file as
// File > Download > .xlsx/.pptx). It reflects the current version, so images
// removed from the document are absent and pages never scrolled into view are
// present. Google redirects the export to a googleusercontent.com download
// host, which only the background service worker (with host permission) can
// read; see src/background/export-service.js.

const EXPORT_PATH = {
  document: 'export?format=docx',
  spreadsheets: 'export?format=xlsx',
  presentation: 'export/pptx'
};
const MEDIA_FOLDER = {
  document: 'word/media/',
  spreadsheets: 'xl/media/',
  presentation: 'ppt/media/'
};
const IMAGE_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['bmp', 'image/bmp'], ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['tif', 'image/tiff'], ['tiff', 'image/tiff']
]);
export const EXPORT_TIMEOUT_MS = 120000;
export const EXPORT_MAX_BYTES = 300 * 1024 * 1024;

// /document/d/<id>/edit, /document/u/1/d/<id>/edit, etc. Keeps the account
// segment and an optional resourcekey so link-shared files resolve the same way.
export function buildExportUrl(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== 'https://docs.google.com') return null;
  const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/((?:u\/\d+\/)?)d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match) return null;
  const [, type, account, id] = match;
  const exportUrl = new URL(`/${type}/${account}d/${id}/${EXPORT_PATH[type]}`, url.origin);
  const resourceKey = url.searchParams.get('resourcekey');
  if (resourceKey) exportUrl.searchParams.set('resourcekey', resourceKey);
  return { type, url: exportUrl.href };
}

const naturalOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const XML_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const unescapeXml = text => text.replace(/&(amp|quot|apos|lt|gt);/g, (_, name) => XML_ENTITIES[name]);
const attribute = (tag, name) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? unescapeXml(match[1]) : null;
};
const fileName = path => path.slice(path.lastIndexOf('/') + 1);
// Resolve a relationship target relative to the part that owns the .rels file.
function resolveTarget(ownerPath, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ownerPath.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}
async function readRelationships(zip, ownerPath) {
  const relsPath = ownerPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const file = zip.file(relsPath);
  if (!file) return new Map();
  const xml = await file.async('string');
  const map = new Map();
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(tag, 'Id');
    const target = attribute(tag, 'Target');
    if (id && target && attribute(tag, 'TargetMode') !== 'External') map.set(id, resolveTarget(ownerPath, target));
  }
  return map;
}

// Google names media files in no particular order (image1.png may be on the last
// slide), so images are ordered by where they appear in the document instead:
// slides in presentation order and, within a slide, in the order the slide
// draws them; sheets in workbook order and, within a sheet, by anchor row and
// column. Media not placed anywhere (for example only in a layout) come last,
// by name.

// [{ name, path }] of the workbook's sheets in tab order.
async function workbookSheets(zip) {
  const workbook = zip.file('xl/workbook.xml');
  if (!workbook) return [];
  const rels = await readRelationships(zip, 'xl/workbook.xml');
  return [...(await workbook.async('string')).matchAll(/<sheet\b[^>]*>/g)]
    .map(([tag]) => ({ name: attribute(tag, 'name'), path: rels.get(attribute(tag, 'r:id')) }))
    .filter(sheet => sheet.name && sheet.path && zip.file(sheet.path));
}

// Media paths referenced by a part's r:embed attributes, in document order.
async function embeddedMedia(zip, partPath, xml) {
  const rels = await readRelationships(zip, partPath);
  return [...xml.matchAll(/\br:embed="([^"]*)"/g)].map(([, id]) => rels.get(unescapeXml(id))).filter(Boolean);
}

// [{ media, location }] in presentation order.
async function presentationPlacements(zip) {
  const presentation = zip.file('ppt/presentation.xml');
  if (!presentation) return [];
  const rels = await readRelationships(zip, 'ppt/presentation.xml');
  const xml = await presentation.async('string');
  const slides = [...xml.matchAll(/<p:sldId\b[^>]*>/g)].map(([tag]) => rels.get(attribute(tag, 'r:id'))).filter(path => path && zip.file(path));
  const placements = [];
  for (const [index, slidePath] of slides.entries()) {
    const slideXml = await zip.file(slidePath).async('string');
    for (const media of await embeddedMedia(zip, slidePath, slideXml)) placements.push({ media, slide: index + 1 });
  }
  return placements;
}

const columnLetters = index => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const columnIndex = letters => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
// Positions are [row, column, rowOffset, columnOffset]; Array.prototype.sort is stable.
const comparePositions = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const anchorNumber = (from, name) => Number((new RegExp(`<xdr:${name}>(\\d+)</xdr:${name}>`).exec(from) || [])[1]) || 0;

// [{ media, sheet, cell }] in workbook order, then by anchor position.
async function spreadsheetPlacements(zip) {
  const placements = [];
  for (const sheet of await workbookSheets(zip)) {
    const sheetXml = await zip.file(sheet.path).async('string');
    const sheetRels = await readRelationships(zip, sheet.path);
    const anchored = [];
    for (const [tag] of sheetXml.matchAll(/<drawing\b[^>]*>/g)) {
      const drawingPath = sheetRels.get(attribute(tag, 'r:id'));
      const drawing = drawingPath && zip.file(drawingPath);
      if (!drawing) continue;
      const drawingXml = await drawing.async('string');
      const drawingRels = await readRelationships(zip, drawingPath);
      for (const [, , body] of drawingXml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
        const from = (/<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(body) || [])[1];
        const position = from
          ? [anchorNumber(from, 'row'), anchorNumber(from, 'col'), anchorNumber(from, 'rowOff'), anchorNumber(from, 'colOff')]
          : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, 0];
        for (const [, id] of body.matchAll(/\br:embed="([^"]*)"/g)) {
          const media = drawingRels.get(unescapeXml(id));
          if (media) anchored.push({ media, position, cell: from ? `${columnLetters(position[1])}${position[0] + 1}` : null });
        }
      }
    }
    anchored.sort((a, b) => comparePositions(a.position, b.position));
    for (const { media, cell } of anchored) placements.push({ media, sheet: sheet.name, cell });
  }
  return placements;
}

function describePlacements(type, placements) {
  // media path -> location text, using every place an image appears.
  const places = new Map();
  for (const placement of placements) {
    if (!places.has(placement.media)) places.set(placement.media, []);
    places.get(placement.media).push(placement);
  }
  const locations = new Map();
  for (const [media, list] of places) {
    if (type === 'presentation') {
      const slides = [...new Set(list.map(place => place.slide))];
      locations.set(media, `Slide${slides.length > 1 ? 's' : ''} ${slides.join(', ')}`);
    } else {
      const first = list[0];
      locations.set(media, first.cell ? `Sheet "${first.sheet}", cell ${first.cell}` : `Sheet "${first.sheet}"`);
    }
  }
  return locations;
}

// Returns [{ name, type, bytes, location }] for every web image in the package's
// media folder, in document order. location names the slide(s) or the sheet and
// anchor cell; null for media not placed in the document.
export async function extractPackageImages(type, data, JSZipClass) {
  const folder = MEDIA_FOLDER[type];
  if (!folder) throw new Error('Unsupported document type');
  const zip = await JSZipClass.loadAsync(data);
  const isImage = name => name.startsWith(folder) && zip.files[name] && !zip.files[name].dir
    && IMAGE_TYPES.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase());
  const placements = (type === 'presentation' ? await presentationPlacements(zip)
    : type === 'spreadsheets' ? await spreadsheetPlacements(zip) : []).filter(place => isImage(place.media));
  const locations = describePlacements(type, placements);
  const ordered = [...new Set(placements.map(place => place.media))];
  const unplaced = Object.keys(zip.files).filter(name => isImage(name) && !locations.has(name)).sort(naturalOrder);
  const images = [];
  for (const name of [...ordered, ...unplaced]) {
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const bytes = await zip.file(name).async('uint8array');
    images.push({ name: name.slice(folder.length), type: IMAGE_TYPES.get(extension), bytes, location: locations.get(name) ?? null });
  }
  return images;
}


// Cells of a worksheet with their address and inner XML. Self-closing cells
// (<c r="A1"/>) have no content and are skipped; cells or rows without an r
// attribute take the position after the previous one, as in SpreadsheetML.
export function* worksheetCells(xml) {
  let rowNumber = 0;
  for (const [, rowTag, rowBody = ''] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    rowNumber = Number(attribute(rowTag, 'r')) || rowNumber + 1;
    let column = -1;
    for (const [, cellTag, cellBody] of rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attribute(cellTag, 'r');
      const parsed = ref && /^([A-Z]+)(\d+)$/.exec(ref);
      column = parsed ? columnIndex(parsed[1]) : column + 1;
      if (cellBody === undefined) continue;
      yield { ref: parsed ? ref : `${columnLetters(column)}${rowNumber}`, body: cellBody };
    }
  }
}

const IMAGE_CALL = /\bIMAGE\(/i;
const IMAGE_LITERAL = /\bIMAGE\(\s*"(https:\/\/[^"\s]+)"/i;

// Cells whose formula calls IMAGE(), per worksheet, in workbook order:
// [{ sheet, cell, url }]. url is the literal https address when the formula
// has one (IMAGE("https://…")), otherwise null (for example IMAGE(A1)).
// IMAGE() results are links, not embedded media, so the export keeps them only
// as formula text.
export async function extractSheetImageFormulas(data, JSZipClass) {
  const zip = await JSZipClass.loadAsync(data);
  const sheets = await workbookSheets(zip);
  const formulas = [];
  for (const sheet of sheets) {
    const xml = await zip.file(sheet.path).async('string');
    for (const cell of worksheetCells(xml)) {
      const formula = /<f\b[^>]*>([^<]*)<\/f>/.exec(cell.body);
      if (!formula) continue;
      const text = unescapeXml(formula[1]);
      if (!IMAGE_CALL.test(text)) continue;
      let url = null;
      const literal = IMAGE_LITERAL.exec(text);
      if (literal) {
        try { const parsed = new URL(literal[1]); if (parsed.protocol === 'https:') url = parsed.href; } catch { /* not a URL */ }
      }
      formulas.push({ sheet: sheet.name, cell: cell.ref, url });
    }
  }
  return formulas;
}
