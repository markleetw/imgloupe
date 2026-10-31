import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFailureReport, describeFailure, REPORT_FILE_NAME } from '../../src/content/shared/failure-report.js';

test('the report names the cell, address, reason and fix in English', () => {
  const report = buildFailureReport({
    title: '未命名的試算表', app: 'spreadsheets', source: 'export', found: 5, saved: 4, duplicates: 0,
    now: new Date(2026, 9, 31, 10, 5),
    failures: [{ location: 'Sheet "工作表1", cell G37 (IMAGE formula)', address: 'https://blog.example.com/photo.webp', error: new TypeError('Failed to fetch') }]
  });
  assert.equal(REPORT_FILE_NAME, 'failed-images.txt');
  assert.match(report, /^ImgLoupe export report\n/);
  assert.match(report, /Document:  未命名的試算表 \(Google Sheets\)/);
  assert.match(report, /Created:   2026-10-31 10:05 \(UTC[+-]\d\d:\d\d\)/);
  assert.match(report, /Source:    Google Sheets export \(\.xlsx\) of the current version/);
  assert.match(report, /Images found: {8}5\n {2}Saved to this ZIP: {3}4\n {2}Duplicates skipped: {2}0\n {2}Failed: {14}1/);
  assert.match(report, /1\. Sheet "工作表1", cell G37 \(IMAGE formula\)\n {3}Address: https:\/\/blog\.example\.com\/photo\.webp\n {3}Reason: {2}The image's website does not let browser extensions read it directly/);
  assert.match(report, /To fix: {2}Open the address above and save the image yourself/);
  assert.ok(report.split('\n').every(line => line.length <= 100 || line.includes('Address:')), 'Long explanations wrap');
});

test('failure reasons cover HTTP, timeout, content and size errors', () => {
  const http = status => Object.assign(new Error(`HTTP ${status}`), { status });
  assert.match(describeFailure(http(404)).reason, /no longer exists .*HTTP 404/);
  assert.match(describeFailure(http(403)).reason, /refused access \(HTTP 403\)/);
  assert.match(describeFailure(http(500)).reason, /returned an error \(HTTP 500\)/);
  assert.equal(describeFailure(http(500)).fix, undefined);
  assert.match(describeFailure(Object.assign(new Error('x'), { name: 'TimeoutError' })).reason, /timed out/);
  assert.match(describeFailure(new Error('Not an image (text/html)')).reason, /not an image/);
  assert.match(describeFailure(new Error('Image is too large to transfer')).reason, /larger than 40 MB/);
});
