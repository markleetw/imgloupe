// failed-images.txt: written into the ZIP only when some images could not be
// packed. Always in English so it reads the same for everyone it is shared with.

export const REPORT_FILE_NAME = 'failed-images.txt';

const SOURCES = {
  document: 'Google Docs mobile view of the current version',
  spreadsheets: 'Google Sheets export (.xlsx) of the current version',
  presentation: 'Google Slides export (.pptx) of the current version',
  loaded: 'Images already loaded in the page (the document export was not available)'
};
const APPS = { document: 'Google Docs', spreadsheets: 'Google Sheets', presentation: 'Google Slides' };

// A failure reason and, where the user can act on it, how to fix it.
export function describeFailure(error) {
  const status = error?.status;
  const message = String(error?.message || error || '');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return { reason: 'The download timed out.' };
  }
  if (error instanceof TypeError || error?.name === 'TypeError') {
    return {
      reason: "The image's website does not let browser extensions read it directly (it sends no CORS header), or the site could not be reached.",
      fix: 'Open the address above and save the image yourself, or add the image with Insert > Image so it is included in future exports.'
    };
  }
  if (status === 404) {
    return { reason: 'The image no longer exists at this address (HTTP 404).', fix: 'Check that the address above still works.' };
  }
  if (status === 401 || status === 403) {
    return { reason: `The image's website refused access (HTTP ${status}).`, fix: 'Open the address above while signed in, if the site requires it, and save the image yourself.' };
  }
  if (Number.isInteger(status)) return { reason: `The image's website returned an error (HTTP ${status}).` };
  if (/^Not an image/.test(message)) return { reason: 'The address returned a web page or other content that is not an image.' };
  if (/too large/i.test(message)) return { reason: 'The image is larger than 40 MB and could not be transferred.' };
  return { reason: message || 'Unknown error.' };
}

function localTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} (${zone})`;
}

const wrap = (label, text, width = 92) => {
  const indent = ' '.repeat(label.length);
  const words = text.split(/\s+/);
  const lines = [];
  let line = label;
  for (const word of words) {
    if (line.length > label.length && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else {
      line += (line.length > label.length ? ' ' : '') + word;
    }
  }
  lines.push(line);
  return lines.join('\n');
};

// failures: [{ location, address, error }]
export function buildFailureReport({ title, app, source, found, saved, duplicates, failures, now = new Date() }) {
  const lines = [
    'ImgLoupe export report',
    '======================',
    `Document:  ${title || 'Untitled'}${APPS[app] ? ` (${APPS[app]})` : ''}`,
    `Created:   ${localTimestamp(now)}`,
    `Source:    ${SOURCES[source === 'loaded' ? 'loaded' : app] || SOURCES.loaded}`,
    '',
    'Summary',
    `  Images found:        ${found}`,
    `  Saved to this ZIP:   ${saved}`,
    `  Duplicates skipped:  ${duplicates}`,
    `  Failed:              ${failures.length}`,
    '',
    'Failed images',
    '-------------'
  ];
  failures.forEach((failure, index) => {
    const { reason, fix } = describeFailure(failure.error);
    lines.push(`${index + 1}. ${failure.location || 'Image'}`);
    if (failure.address) lines.push(`   Address: ${failure.address}`);
    lines.push(wrap('   Reason:  ', reason));
    if (fix) lines.push(wrap('   To fix:  ', fix));
    lines.push('');
  });
  return lines.join('\n').replace(/\n+$/, '\n');
}
