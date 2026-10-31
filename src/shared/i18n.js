// UI strings come from _locales/<locale>/messages.json through chrome.i18n,
// which follows the browser's UI language (English unless it is zh-TW).
// Outside an extension context (unit tests, plain pages) the English table
// bundled from _locales/en is used with the same placeholder rules.
import fallbackMessages from '../../_locales/en/messages.json' with { type: 'json' };

export function formatMessage(table, key, substitutions = []) {
  const entry = table?.[key];
  if (!entry) return '';
  const values = substitutions.map(value => String(value));
  const resolve = content => content.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? '');
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (match, name) => {
    const placeholder = entry.placeholders?.[name.toLowerCase()];
    return placeholder ? resolve(placeholder.content) : match;
  });
}

export function t(key, ...substitutions) {
  try {
    const message = globalThis.chrome?.i18n?.getMessage?.(key, substitutions.map(value => String(value)));
    if (message) return message;
  } catch { /* fall back to the bundled default locale */ }
  return formatMessage(fallbackMessages, key, substitutions) || key;
}

// Messages with a leading count: "<key>One" holds the singular wording
// (English "1 image"); every other count uses "<key>".
export function tn(key, count, ...substitutions) {
  return t(count === 1 ? `${key}One` : key, count, ...substitutions);
}
