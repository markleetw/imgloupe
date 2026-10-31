// Content-script side of src/background/export-service.js: asks the
// background service worker for the Office export of this tab's document and
// reads its images back one at a time.

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.success) reject(new Error(response?.error || 'No response from the background service'));
        else resolve(response);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function base64ToBlob(data, type) {
  const response = await fetch(`data:${type};base64,${data}`);
  return new Blob([await response.arrayBuffer()], { type });
}

// Resolves to {
//   kind: 'spreadsheets' | 'presentation',
//   images: [{ name, type, size, location }],          embedded media of the export
//   imageFormulas: [{ sheet, cell, url }],              spreadsheet IMAGE() cells
//   read(index) => Promise<Blob>, close()
// }.
export async function openBackgroundExport() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('Extension runtime is unavailable');
  const { token, kind, images, imageFormulas = [] } = await sendMessage({ type: 'imgloupe:export-open' });
  return {
    kind,
    images,
    imageFormulas: imageFormulas.filter(item => item && typeof item.sheet === 'string' && typeof item.cell === 'string'
      && (item.url === null || (typeof item.url === 'string' && item.url.startsWith('https://')))),
    async read(index) {
      const { type, data } = await sendMessage({ type: 'imgloupe:export-read', token, index });
      return base64ToBlob(data, type);
    },
    close() {
      sendMessage({ type: 'imgloupe:export-close', token }).catch(() => {});
    }
  };
}
