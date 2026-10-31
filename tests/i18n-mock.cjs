// chrome.i18n.getMessage stand-in for mocked extension contexts. Mirrors
// Chrome's placeholder rules for _locales/<locale>/messages.json.
const fs = require('node:fs');
const path = require('node:path');

function loadMessages(locale = 'zh_TW') {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', locale, 'messages.json'), 'utf8'));
}

function createGetMessage(locale = 'zh_TW') {
  const table = loadMessages(locale);
  return (key, substitutions = []) => {
    const entry = table[key];
    if (!entry) return '';
    const values = [].concat(substitutions).map(String);
    const resolve = content => content.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? '');
    return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (match, name) => {
      const placeholder = entry.placeholders?.[name.toLowerCase()];
      return placeholder ? resolve(placeholder.content) : match;
    });
  };
}

module.exports = { loadMessages, createGetMessage };
