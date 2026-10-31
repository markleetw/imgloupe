import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { openExport, readExportImage, closeExport, handleExportMessage, bytesToBase64 } from '../../src/background/export-service.js';

async function pptx(images) {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(images)) zip.file(`ppt/media/${name}`, bytes);
  zip.file('ppt/media/vector.emf', 'not a web image');
  return zip.generateAsync({ type: 'arraybuffer' });
}
const okResponse = data => ({ ok: true, headers: new Headers({ 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), arrayBuffer: async () => data });

test('the export URL comes only from the sender tab, and images are read back per index', async () => {
  const requests = [];
  const data = await pptx({ 'image2.png': Buffer.from('two'), 'image1.jpeg': Buffer.from('one') });
  const fetchImpl = async (url, options) => { requests.push({ url, options }); return okResponse(data); };
  const opened = await openExport('https://docs.google.com/presentation/u/1/d/deck/edit?slide=id.p', 7, { fetchImpl, JSZipClass: JSZip });
  assert.deepEqual(requests.map(r => r.url), ['https://docs.google.com/presentation/u/1/d/deck/export/pptx']);
  assert.equal(requests[0].options.credentials, 'include');
  assert.deepEqual(opened.images.map(i => [i.name, i.type, i.size]), [['image1.jpeg', 'image/jpeg', 3], ['image2.png', 'image/png', 3]]);
  const first = readExportImage(opened.token, 0, 7);
  assert.deepEqual(first, { type: 'image/jpeg', data: Buffer.from('one').toString('base64') });
  assert.throws(() => readExportImage(opened.token, 0, 8), /Unknown export/, 'Another tab cannot read this export');
  assert.throws(() => readExportImage(opened.token, 5, 7), /Unknown image/);
  closeExport(opened.token, 7);
  assert.throws(() => readExportImage(opened.token, 0, 7), /Unknown export/);
});

test('non-document tabs, Docs and web-page responses are refused', async () => {
  const fetchImpl = async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(openExport('https://evil.example/presentation/d/x/edit', 1, { fetchImpl }), /Unsupported/);
  await assert.rejects(openExport('https://docs.google.com/document/d/x/edit', 1, { fetchImpl }), /Unsupported/);
  await assert.rejects(openExport('https://docs.google.com/spreadsheets/d/x/edit', 1, { fetchImpl, JSZipClass: JSZip }), /web page/);
});

test('messages without a sender tab are rejected', () => {
  let reply;
  assert.equal(handleExportMessage({ type: 'imgloupe:export-open' }, { id: 'ext', url: 'chrome-extension://ext/popup.html' }, r => { reply = r; }), false);
  assert.equal(reply.success, false);
});

test('base64 encoding handles large buffers', () => {
  const bytes = new Uint8Array(200000).map((_, i) => i % 256);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('spreadsheet exports return IMAGE() cells with sheet names and literal addresses', async () => {
  const zip = new JSZip();
  zip.file('xl/media/image1.png', 'embedded');
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="工作表1" sheetId="1" r:id="rId1"/><sheet name="Q&amp;A" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row><c r="A1"><f>IMAGE("https://cdn.example.com/b.png", 4, 10, 10)</f></c></row></sheetData></worksheet>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row>'
    + '<c r="G37" t="str"><f>image(&quot;https://blog.example.com/a.webp?x=1&amp;y=2&quot;)</f><v></v></c>'
    + '<c r="B2"><f>IMAGE(A1)</f></c><c r="B3"><f>IMAGE("http://insecure.example.com/c.png")</f></c>'
    + '<c r="B4"><f>HYPERLINK("https://example.com/not-an-image")</f></c><c r="B5"><v>1</v></c></row></sheetData></worksheet>');
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const opened = await openExport('https://docs.google.com/spreadsheets/d/sheet/edit#gid=0', 3, { fetchImpl: async () => okResponse(data), JSZipClass: JSZip });
  assert.equal(opened.kind, 'spreadsheets');
  assert.deepEqual(opened.images.map(i => i.name), ['image1.png']);
  assert.deepEqual(opened.imageFormulas, [
    { sheet: '工作表1', cell: 'G37', url: 'https://blog.example.com/a.webp?x=1&y=2' },
    { sheet: '工作表1', cell: 'B2', url: null },
    { sheet: '工作表1', cell: 'B3', url: null },
    { sheet: 'Q&A', cell: 'A1', url: 'https://cdn.example.com/b.png' }
  ]);
});

test('presentation images follow slide order and drawing order, not media file names', async () => {
  // Google names media in no fixed order: here image2 is on the first slide.
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId8"/><p:sldId id="258" r:id="rId9"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId9" Target="slides/slide3.xml"/><Relationship Id="rId7" Target="slides/slide1.xml"/><Relationship Id="rId8" Target="slides/slide2.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', '<p:sld><p:pic><a:blip r:embed="rId3"/></p:pic></p:sld>');
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId3" Target="../media/image2.png"/></Relationships>');
  // Two pictures on slide 2, drawn image4 first; image2 appears again.
  zip.file('ppt/slides/slide2.xml', '<p:sld><p:pic><a:blip r:embed="rId5"/></p:pic><p:pic><a:blip r:embed="rId4"/></p:pic><p:pic><a:blip r:embed="rId3"/></p:pic></p:sld>');
  zip.file('ppt/slides/_rels/slide2.xml.rels', '<Relationships><Relationship Id="rId3" Target="../media/image2.png"/><Relationship Id="rId4" Target="../media/image1.png"/><Relationship Id="rId5" Target="../media/image4.png"/><Relationship Id="rId6" Target="https://example.com" TargetMode="External"/></Relationships>');
  zip.file('ppt/slides/slide3.xml', '<p:sld><p:sp/></p:sld>');
  zip.file('ppt/media/image1.png', 'one');
  zip.file('ppt/media/image2.png', 'two');
  zip.file('ppt/media/image3.png', 'unused');
  zip.file('ppt/media/image4.png', 'four');
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const opened = await openExport('https://docs.google.com/presentation/d/deck/edit', 1, { fetchImpl: async () => okResponse(data), JSZipClass: JSZip });
  assert.deepEqual(opened.images.map(i => [i.name, i.location]), [
    ['image2.png', 'Slides 1, 2'], ['image4.png', 'Slide 2'], ['image1.png', 'Slide 2'], ['image3.png', null]
  ]);
  assert.deepEqual(readExportImage(opened.token, 0, 1).data, Buffer.from('two').toString('base64'));
  assert.deepEqual(opened.imageFormulas, []);
});

test('spreadsheet images follow sheet order and anchor row/column, with the anchor cell as location', async () => {
  // Mirrors Google's xlsx: every image is a oneCellAnchor in the sheet's drawing.
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="工作表1" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData/><drawing r:id="rId1"/></worksheet>');
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>');
  const anchor = (col, row, embed, rowOff = 0) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from><xdr:ext/><xdr:pic><xdr:blipFill><a:blip r:embed="${embed}"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr>${anchor(1, 3, 'rId1')}${anchor(7, 4, 'rId2', 104775)}${anchor(8, 1, 'rId3', 152400)}${anchor(1, 0, 'rId4')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../media/image4.png"/><Relationship Id="rId2" Target="../media/image2.png"/><Relationship Id="rId3" Target="../media/image3.png"/><Relationship Id="rId4" Target="../media/image1.png"/></Relationships>');
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData/><drawing r:id="rId9"/></worksheet>');
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', '<Relationships><Relationship Id="rId9" Target="/xl/drawings/drawing2.xml"/></Relationships>');
  zip.file('xl/drawings/drawing2.xml', `<xdr:wsDr>${anchor(0, 0, 'rId1')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing2.xml.rels', '<Relationships><Relationship Id="rId1" Target="../media/image0.png"/></Relationships>');
  for (const n of [0, 1, 2, 3, 4, 5]) zip.file(`xl/media/image${n}.png`, `img${n}`);
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const opened = await openExport('https://docs.google.com/spreadsheets/d/sheet/edit', 4, { fetchImpl: async () => okResponse(data), JSZipClass: JSZip });
  assert.deepEqual(opened.images.map(i => [i.name, i.location]), [
    ['image1.png', 'Sheet "工作表1", cell B1'],
    ['image3.png', 'Sheet "工作表1", cell I2'],
    ['image4.png', 'Sheet "工作表1", cell B4'],
    ['image2.png', 'Sheet "工作表1", cell H5'],
    ['image0.png', 'Sheet "Data", cell A1'],
    ['image5.png', null]
  ]);
});

test('formula cells keep their own address when empty self-closing cells come first', async () => {
  // Google's xlsx writes styled empty cells as <c r="A1" s="1"/>; the IMAGE()
  // formula in G37 must not be attributed to A1.
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="工作表1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" s="1"/><c r="B1" s="2"><v>0</v></c></row><row r="2" spans="1:7"/>'
    + '<row r="37"><c r="A37" s="1"/><c r="F37" s="1"/><c r="G37" s="3" t="str"><f>image("https://blog.example.com/a.webp")</f><v></v></c></row>'
    + '<row><c><v>1</v></c><c><f>IMAGE(A1)</f></c></row>'
    + '</sheetData></worksheet>');
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const opened = await openExport('https://docs.google.com/spreadsheets/d/sheet/edit', 2, { fetchImpl: async () => okResponse(data), JSZipClass: JSZip });
  assert.deepEqual(opened.imageFormulas, [
    { sheet: '工作表1', cell: 'G37', url: 'https://blog.example.com/a.webp' },
    { sheet: '工作表1', cell: 'B38', url: null }
  ]);
});
