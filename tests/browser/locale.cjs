// Installs chrome.i18n on pages that mock the extension namespace, so UI text
// is rendered from _locales exactly as Chrome would for a zh-TW browser.
const fs = require('node:fs');
const path = require('node:path');

const readMessages = locale => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '_locales', locale, 'messages.json'), 'utf8'));
const zhTW = readMessages('zh_TW');

function installI18n({ table, language }) {
  const getMessage = (key, substitutions = []) => {
    const entry = table[key];
    if (!entry) return '';
    const values = [].concat(substitutions).map(String);
    const resolve = content => content.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? '');
    return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (match, name) => {
      const placeholder = entry.placeholders && entry.placeholders[name.toLowerCase()];
      return placeholder ? resolve(placeholder.content) : match;
    });
  };
  window.chrome = window.chrome || {};
  window.chrome.i18n = { getMessage, getUILanguage: () => language };
}

const useTraditionalChinese = page => page.addInitScript(installI18n, { table: zhTW, language: 'zh-TW' });

module.exports = { readMessages, zhTW, useTraditionalChinese };
