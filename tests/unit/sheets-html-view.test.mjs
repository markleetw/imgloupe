import test from 'node:test';
import assert from 'node:assert/strict';
import { columnName, parseSheetList, parseSheetImageCells } from '../../src/content/sheets/html-view.js';

const proxied = name => `https://lh3.googleusercontent.com/docsubipk/${name}=s100-w100-h20`;

test('column names follow spreadsheet lettering', () => {
  assert.deepEqual([0, 6, 25, 26, 27, 51, 52, 701, 702].map(columnName), ['A', 'G', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('the sheet switcher yields names and gids, including escaped names', () => {
  const html = `items.push({name: "\\u5de5\\u4f5c\\u88681", pageUrl: "https:\\/\\/docs.google.com\\/x", gid: "0",initialSheet: ("0" == gid)});
    items.push({name: "Q4 \\x22Plan\\x22", pageUrl: "https:\\/\\/docs.google.com\\/y", gid: "123456",initialSheet: ("123456" == gid)});`;
  assert.deepEqual(parseSheetList(html), [{ name: '工作表1', gid: '0' }, { name: 'Q4 "Plan"', gid: '123456' }]);
});

test('proxied IMAGE() results map to their real cell addresses', () => {
  // Column C is hidden (no header), B2:C2 are merged, and A3 spans two rows.
  const html = `<table><tr><th class="row-header"></th><th id="0C0">A</th><th id="0C1">B</th><th id="0C3">D</th><th id="0C4">E</th></tr>
    <tr><th id="0R0"><div>1</div></th><td></td><td><img src="https://docs.google.com/sheets-images-rt/inserted=w100-h20"/></td><td></td><td><img src="${proxied('E1')}"/></td></tr>
    <tr><th id="0R1"><div>2</div></th><td></td><td colspan="2"></td><td><img src="${proxied('E2')}"/></td></tr>
    <tr><th id="0R2"><div>3</div></th><td rowspan="2"><img src="${proxied('A3')}"/></td><td></td><td></td><td></td></tr>
    <tr><th id="0R3"><div>4</div></th><td><img src="${proxied('B4')}"/></td><td></td><td><img src="${proxied('E4').replace('&', '&amp;')}"/></td></tr></table>`;
  const cells = parseSheetImageCells(html, 'https://docs.google.com/spreadsheets/d/x/htmlview/sheet?gid=0');
  assert.deepEqual([...cells.keys()], ['E1', 'E2', 'A3', 'B4', 'E4'], 'Inserted in-cell images (already in the export) are not included');
  assert.equal(cells.get('E2'), proxied('E2'));
});
