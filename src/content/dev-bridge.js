// Development builds only (npm run build:dev). Lets an automated tester drive
// the installed extension from the document page: the page posts
//   { source: 'imgloupe-dev', type: 'ping' | 'export' | 'parts' | 'lastOcr' | 'reload' | 'action', action? }
// and receives { source: 'imgloupe-dev-result', type, result | error }.
// The store build is compiled with __IMGLOUPE_DEV__ = false, which removes this
// module, and scripts/verify-package.mjs rejects any package containing it.
let lastOcr = null;
export function recordDevOcr(raw, text) {
  lastOcr = { raw, text };
}

export function installDevBridge({ exportAllImages, handleToolbarAction, buildId }) {
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
