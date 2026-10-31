import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import mock from '../mock-env.js';

test('content URL OCR preserves a 3200px source at 1600px instead of using a 256px preview', async () => {
  const { context, win, doc, chromeMock } = mock.createMockEnv();
  let closed = 0;
  context.createImageBitmap = win.createImageBitmap = async (_source, options) => ({
    width: options?.resizeWidth || 3200, height: options?.resizeHeight || 1600,
    close() { closed++; }
  });
  const dimensions = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const element = create(tag);
    if (tag === 'canvas') element.toDataURL = () => {
      dimensions.push([element.width, element.height]);
      return 'data:image/png;base64,prepared';
    };
    return element;
  };
  chromeMock.runtime.sendMessage = (message, callback) => {
    const response = message.type === 'do-ocr' ? { success: true, text: 'Hello 2026' } : null;
    callback?.(response);
    return Promise.resolve(response);
  };
  vm.runInNewContext(fs.readFileSync('dist/contentScripts/index.global.js', 'utf8'), context);
  assert.equal(await win.__imgloupe.ocrImageToText('https://example.com/large.png'), true);
  assert.deepEqual(dimensions, [[1600, 800]]);
  assert.equal(closed, 1, 'The OCR-only original bitmap must be released');
});

test('an unreadable image reports a read error without submitting its URL as OCR data', async () => {
  const { context, win, doc, chromeMock } = mock.createMockEnv();
  // The awaited download retry must keep Node alive; UI-only timers remain unref'd.
  context.setTimeout = setTimeout;
  let attempts = 0;
  context.fetch = async () => { attempts++; throw new TypeError('Failed to fetch'); };
  const messages = [];
  chromeMock.runtime.sendMessage = (message, callback) => { messages.push(message); callback?.(null); };
  vm.runInNewContext(fs.readFileSync('dist/contentScripts/index.global.js', 'utf8'), context);
  assert.equal(await win.__imgloupe.ocrImageToText('https://example.com/unreadable.png'), false);
  assert.equal(attempts, 2, 'The initial read and its retry must both finish');
  assert.equal(messages.length, 0);
  assert.match(doc.getElementById('imgloupe-toast').textContent, /無法讀取/);
});

test('recognized text is not reported as copied when both clipboard routes fail', async () => {
  const { context, win, doc, chromeMock } = mock.createMockEnv();
  win.navigator.clipboard.writeText = async () => { throw new Error('Denied'); };
  doc.execCommand = () => false;
  chromeMock.runtime.sendMessage = (message, callback) => callback?.(message.type === 'do-ocr' ?
    { success: true, text: 'Hello 2026' } : { copied: false });
  vm.runInNewContext(fs.readFileSync('dist/contentScripts/index.global.js', 'utf8'), context);
  assert.equal(await win.__imgloupe.ocrImageToText('data:image/png;base64,fixture'), false);
  assert.match(doc.getElementById('imgloupe-toast').textContent, /無法寫入剪貼簿/);
});
