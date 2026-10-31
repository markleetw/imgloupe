import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileViewUrl, fullSizeImageUrl } from '../../src/content/shared/docs-mobile-view.js';

test('Mobile view URLs follow the open document, account and resource key', () => {
  assert.equal(buildMobileViewUrl('https://docs.google.com/document/d/abc_1-X/edit?tab=t.0'), 'https://docs.google.com/document/d/abc_1-X/mobilebasic');
  assert.equal(buildMobileViewUrl('https://docs.google.com/document/u/1/d/abc/edit?resourcekey=0-k'), 'https://docs.google.com/document/u/1/d/abc/mobilebasic?resourcekey=0-k');
  assert.equal(buildMobileViewUrl('https://docs.google.com/spreadsheets/d/abc/edit'), null);
  assert.equal(buildMobileViewUrl('https://evil.example/document/d/abc/edit'), null);
});

test('Google image URLs are requested at their stored size; others are unchanged', () => {
  assert.equal(fullSizeImageUrl('https://lh7-rt.googleusercontent.com/docsz/AD_4nX=s800?key=k'), 'https://lh7-rt.googleusercontent.com/docsz/AD_4nX=s0?key=k');
  assert.equal(fullSizeImageUrl('https://lh7-rt.googleusercontent.com/docsz/AD_4nX?key=k'), 'https://lh7-rt.googleusercontent.com/docsz/AD_4nX?key=k');
  assert.equal(fullSizeImageUrl('https://example.com/a=s800'), 'https://example.com/a=s800');
});
