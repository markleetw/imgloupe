// Development builds only (npm run build:dev). Lets an automated tester drive
// the installed extension from the document page: the page posts
//   { source: 'imgloupe-dev', type: 'ping' | 'export' | 'parts' | 'lastOcr' | 'reload' | 'action', action? }
// and receives { source: 'imgloupe-dev-result', type, result | error }.
// It is loaded only by the development entry (src/content/dev-entry.js);
// store builds never import it, and scripts/verify-package.mjs rejects any
// package containing it.
import { cleanOcrText } from './ocr/text-cleaner.js';

let lastOcr = null;

// Remember the latest recognition result by watching this content script's
// own "do-ocr" requests to the background service worker.
function recordOcrResponses() {
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message, ...rest) => {
    const callback = typeof rest.at(-1) === 'function' ? rest.pop() : null;
    if (message?.type !== 'do-ocr' || !callback) return send(message, ...rest, ...(callback ? [callback] : []));
    return send(message, ...rest, response => {
      if (response?.success) lastOcr = { raw: response.text || '', text: cleanOcrText(response.text || '') };
      callback(response);
    });
  };
}

export function installDevBridge({ exportAllImages, handleToolbarAction, buildId }) {
  recordOcrResponses();
  const reply = (type, payload) => window.postMessage({ source: 'imgloupe-dev-result', type, ...payload }, location.origin);
  document.documentElement.dataset.imgloupeDevBuild = buildId;
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'imgloupe-dev') return;
    const { type, action } = event.data;
    try {
      if (type === 'ping') reply(type, { result: { build: buildId } });
      else if (type === 'export') reply(type, { result: await exportAllImages() });
      else if (type === 'lastOcr') reply(type, { result: lastOcr });
      else if (type === 'parts') {
        const response = await chrome.runtime.sendMessage({ type: 'imgloupe:dev-export-parts' });
        if (!response?.success) throw new Error(response?.error || 'No response');
        reply(type, { result: response.result });
      }
      else if (type === 'action') reply(type, { result: await handleToolbarAction(action) });
      else if (type === 'reload') {
        reply(type, { result: 'reloading' });
        chrome.runtime.sendMessage({ type: 'imgloupe:dev-reload' });
      }
    } catch (error) {
      reply(type, { error: error?.message || String(error) });
    }
  });
}
