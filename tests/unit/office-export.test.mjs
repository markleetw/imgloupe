import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportUrl } from '../../src/shared/office-export.js';

test('Export URLs follow the open document, account and resource key', () => {
  assert.deepEqual(buildExportUrl('https://docs.google.com/document/d/abc_123-X/edit#heading=h.1'),
    { type: 'document', url: 'https://docs.google.com/document/d/abc_123-X/export?format=docx' });
  assert.deepEqual(buildExportUrl('https://docs.google.com/spreadsheets/u/2/d/sheetId/edit?gid=0'),
    { type: 'spreadsheets', url: 'https://docs.google.com/spreadsheets/u/2/d/sheetId/export?format=xlsx' });
  assert.deepEqual(buildExportUrl('https://docs.google.com/presentation/d/deck/edit?resourcekey=0-key&usp=sharing'),
    { type: 'presentation', url: 'https://docs.google.com/presentation/d/deck/export/pptx?resourcekey=0-key' });
});

test('Export URLs are refused for other hosts and pages', () => {
  assert.equal(buildExportUrl('https://evil.example/document/d/abc/edit'), null);
  assert.equal(buildExportUrl('https://docs.google.com/forms/d/abc/edit'), null);
  assert.equal(buildExportUrl('https://docs.google.com/document/u/0/'), null);
  assert.equal(buildExportUrl('not a url'), null);
});
