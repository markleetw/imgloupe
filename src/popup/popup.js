import { GET_APP_TYPE_MESSAGE, EXPORT_IMAGES_MESSAGE } from '../shared/messages.js';
import { t, tn } from '../shared/i18n.js';

const APPLICATION_NAMES = { document: 'appDocs', spreadsheets: 'appSheets', presentation: 'appSlides' };

function localizePage() {
  document.documentElement.lang = t('htmlLang') || 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  document.title = t('extName');
}

export function describeExportResult(result) {
  const { downloaded, failed, source } = result;
  if (downloaded === 0 && failed === 0) return t('popupResultNone');
  const summary = source === 'export' ? tn('popupResultExport', downloaded) : tn('popupResultLoaded', downloaded);
  return failed > 0 ? `${summary} ${t('popupResultFailed', failed)}` : summary;
}

// No settings are persisted: the content toolbar always sits at the top right.
async function initializePopup() {
  localizePage();
  const manifest = chrome.runtime.getManifest();
  document.getElementById('name').textContent = t('extShortName') || 'ImgLoupe';
  document.getElementById('version').textContent = `v${manifest.version}`;
  const button = document.getElementById('imgloupe-batch-export-btn');
  const status = document.getElementById('imgloupe-batch-export-status');
  const connection = document.getElementById('connection-status');
  const state = document.querySelector('.connection');
  let tabId;
  let applicationName;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (tabId == null) throw new Error('No active tab');
    const type = await chrome.tabs.sendMessage(tabId, { type: GET_APP_TYPE_MESSAGE });
    if (!Object.hasOwn(APPLICATION_NAMES, type)) throw new Error('Unsupported page');
    applicationName = t(APPLICATION_NAMES[type]);
    connection.textContent = applicationName;
    state.dataset.state = 'connected';
    button.disabled = false;
  } catch {
    connection.textContent = t('popupUnsupported');
    state.dataset.state = 'disconnected';
    status.textContent = t('popupUnsupportedHint');
    return;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = t('popupExporting');
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: EXPORT_IMAGES_MESSAGE });
      if (!result || result.error) throw new Error('Export failed');
      if (!Number.isInteger(result.downloaded) || !Number.isInteger(result.failed)) throw new Error('Invalid response');
      connection.textContent = applicationName;
      state.dataset.state = 'connected';
      status.textContent = describeExportResult(result);
    } catch {
      connection.textContent = t('popupExportFailedState');
      state.dataset.state = 'disconnected';
      status.textContent = t('popupExportFailed');
    } finally {
      button.disabled = false;
    }
  });
}

initializePopup().catch(() => {
  document.getElementById('imgloupe-batch-export-status').textContent = t('popupOpenFailed');
});
