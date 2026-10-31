import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatMessage, t, tn } from '../../src/shared/i18n.js';

const read = locale => JSON.parse(fs.readFileSync(`_locales/${locale}/messages.json`, 'utf8'));
const en = read('en');
const zhTW = read('zh_TW');

test('English and Traditional Chinese define the same messages and placeholders', () => {
  assert.deepEqual(Object.keys(zhTW).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.deepEqual(Object.keys(zhTW[key].placeholders || {}).sort(), Object.keys(en[key].placeholders || {}).sort(), key);
    assert.ok(zhTW[key].message.trim(), `${key} must not be empty`);
  }
});

test('Store-facing manifest strings respect Chrome Web Store limits and avoid Google in the name', () => {
  for (const table of [en, zhTW]) {
    assert.ok(table.extName.message.length <= 75, 'name');
    assert.ok(table.extShortName.message.length <= 12, 'short name');
    assert.ok(table.extDescription.message.length <= 132, 'description');
    assert.doesNotMatch(table.extName.message, /google/i, 'The extension name must not use Google trademarks');
  }
});

test('Placeholders are substituted like chrome.i18n', () => {
  assert.equal(formatMessage(zhTW, 'toastPacking', [3, 10]), '正在打包圖片（3/10）…');
  assert.equal(formatMessage(en, 'toastZipDonePartial', [5, 2]), 'Packed 5 images; 2 failed (see the report in the ZIP).');
  assert.equal(t('toastOcrCopied', 12), 'Copied recognized text (12 characters)', 'Outside Chrome the default (English) locale is used');
});

test('counts of one use the singular wording', () => {
  assert.equal(tn('toastZipDone', 1), 'Packed 1 image.');
  assert.equal(tn('toastZipDone', 3), 'Packed 3 images.');
  assert.equal(tn('toastZipDonePartial', 1, 2), 'Packed 1 image; 2 failed (see the report in the ZIP).');
  assert.equal(tn('popupResultExport', 1), 'Exported 1 image from the document.');
  assert.equal(tn('toastOcrCopied', 1), 'Copied recognized text (1 character)');
  assert.equal(tn('popupResultLoaded', 0).startsWith('Packed 0 loaded images.'), true);
});
