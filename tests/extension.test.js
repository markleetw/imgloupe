const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const { createMockEnv } = require("./mock-env.js");

const contentScriptCode = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
const backgroundScriptCode = fs.readFileSync("dist/background/index.mjs", "utf8");

test("Suite 1: Content Script Initialization & Document Type Routing", async (t) => {
  await t.test("Google Docs: loads with zero runtime errors and mounts event listeners", async () => {
    const { context, listeners, doc, chromeMock } = createMockEnv("https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit");
    
    assert.doesNotThrow(() => {
      vm.runInNewContext(contentScriptCode, context);
    }, "Content script execution must not throw any ReferenceError or TypeError");

    // Check listeners
    assert.ok(listeners.doc.click && listeners.doc.click.length > 0, "Document click listener must be mounted");
    assert.ok(listeners.doc.scroll && listeners.doc.scroll.length > 0, "Document scroll listener must be mounted");
    assert.ok(listeners.win.resize && listeners.win.resize.length > 0, "Window resize listener must be mounted");

    // The stylesheet is injected by the manifest, not by the script.
    assert.ok(!doc.head.children.some(el => el.tagName === "LINK"), "Content script must not inject stylesheet links into the page");

    // Check runtime message handler for the popup app-type query
    assert.ok(chromeMock.runtime.onMessage._listeners.length > 0, "Runtime message listener must be registered");
    const docTypeListener = chromeMock.runtime.onMessage._listeners[0];
    const reply = await new Promise(resolve => docTypeListener({ type: "imgloupe:get-app-type" }, {}, resolve));
    assert.strictEqual(reply, "document", "Must report document type as 'document'");
  });

  await t.test("Google Slides: routes to presentation handler", async () => {
    const { context, listeners, chromeMock } = createMockEnv("https://docs.google.com/presentation/d/1BxiMVs0/edit");
    assert.doesNotThrow(() => {
      vm.runInNewContext(contentScriptCode, context);
    });
    assert.ok(listeners.doc.click && listeners.doc.click.length > 0, "Presentation click listener must be mounted");
    const docTypeListener = chromeMock.runtime.onMessage._listeners[0];
    const reply = await new Promise(resolve => docTypeListener({ type: "imgloupe:get-app-type" }, {}, resolve));
    assert.strictEqual(reply, "presentation", "Must report document type as 'presentation'");
  });

  await t.test("Google Sheets: routes to spreadsheets handler", async () => {
    const { context, chromeMock } = createMockEnv("https://docs.google.com/spreadsheets/d/1BxiMVs0/edit");
    assert.doesNotThrow(() => {
      vm.runInNewContext(contentScriptCode, context);
    });
    const docTypeListener = chromeMock.runtime.onMessage._listeners[0];
    const reply = await new Promise(resolve => docTypeListener({ type: "imgloupe:get-app-type" }, {}, resolve));
    assert.strictEqual(reply, "spreadsheets", "Must report document type as 'spreadsheets'");
  });

  await t.test("Account-scoped document URLs are documents too", async () => {
    const { context, chromeMock } = createMockEnv("https://docs.google.com/presentation/u/1/d/1BxiMVs0/edit");
    vm.runInNewContext(contentScriptCode, context);
    const reply = await new Promise(resolve => chromeMock.runtime.onMessage._listeners[0]({ type: "imgloupe:get-app-type" }, {}, resolve));
    assert.strictEqual(reply, "presentation");
  });

  // File lists and published copies are not documents: the popup must not offer
  // a ZIP export there, and no toolbar or listeners are installed.
  for (const url of [
    "https://docs.google.com/spreadsheets/u/0/",
    "https://docs.google.com/document/u/1/?tgif=d",
    "https://docs.google.com/presentation/",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vExample/pubhtml"
  ]) {
    await t.test(`stays inactive on ${url}`, () => {
      const { context, listeners, chromeMock } = createMockEnv(url);
      vm.runInNewContext(contentScriptCode, context);
      assert.strictEqual(chromeMock.runtime.onMessage._listeners.length, 0, "No popup message handler");
      assert.ok(!listeners.doc.click || listeners.doc.click.length === 0, "No selection listener");
    });
  }
});

test("Suite 2: Floating Toolbar & Action Button Construction", (t) => {
  const { context, doc, win } = createMockEnv("https://docs.google.com/document/d/123/edit");
  vm.runInNewContext(contentScriptCode, context);

  // Construct the floating toolbar through the debug API
  win.__imgloupe.createToolbar();

  const toolbar = doc.getElementById("imgloupeToolbar");
  assert.ok(toolbar, "Floating toolbar #imgloupeToolbar must be created and present in DOM");
  assert.ok(toolbar.classList.contains("imgloupe-actions"), "Toolbar must have imgloupe-actions class");

  // Check all 3 action buttons
  const expectedButtons = [
    ["imgloupe-action-preview", "放大檢視"],
    ["imgloupe-action-copy", "複製圖片"],
    ["imgloupe-action-ocr", "擷取文字"],
    ["imgloupe-action-download", "下載圖片"]
  ];
  for (const [id, label] of expectedButtons) {
    const button = doc.getElementById(id);
    assert.ok(button, `Toolbar button #${id} must be rendered`);
    assert.strictEqual(button.getAttribute("aria-label"), label);
  }
  assert.strictEqual(toolbar.children.length, expectedButtons.length, "Batch download belongs only to the popup, not the floating toolbar");
});

test("Suite 3: Chinese & Unicode Document Title and Download Filename Sanitization", (t) => {
  const { context, win } = createMockEnv("https://docs.google.com/document/d/123/edit");
  vm.runInNewContext(contentScriptCode, context);

  const titles = [
    { input: "测试文件 - Google 文件", expected: "测试文件" },
    { input: "2026年Q3財務季報表 - Google Docs", expected: "2026年Q3財務季報表" },
    { input: "产品设计稿（最终版） - Google 幻灯片", expected: "产品设计稿（最终版）" },
    { input: "Project_Proposal_v2 - Google Sheets", expected: "Project_Proposal_v2" },
    { input: "   繁體中文與English 混合檔名   - Google 試算表", expected: "繁體中文與English-混合檔名" },
    { input: "Q4: 營收 / 成本 <草稿> - Google Docs", expected: "Q4-營收-成本-草稿" },
    { input: " - Google Docs", expected: "imgloupe" },
  ];

  for (const { input, expected } of titles) {
    const result = win.__imgloupe.documentFileStem(input);
    assert.strictEqual(result, expected, `Document title '${input}' should sanitize to '${expected}' without mangling unicode/chinese`);
  }
});

test("Suite 4: LRU Image Cache & Explicit GPU VRAM Cleanup", (t) => {
  const { context, win } = createMockEnv("https://docs.google.com/document/d/123/edit");
  vm.runInNewContext(contentScriptCode, context);

  const cache = win.__imgloupe.getCache();
  assert.ok(cache instanceof Map, "Cache must be an instance of Map");
  assert.strictEqual(win.__imgloupeCache, undefined, "The LRU map must not be exposed as a separate window global");

  // Actual eviction/decode behavior is tested through production APIs in
  // tests/unit/lru-cache.test.mjs; do not recreate the algorithm in this test.
});

test("Suite 5: Clipboard Failure UI Feedback (Toast & Button Error State)", async (t) => {
  const { context, doc, win } = createMockEnv("https://docs.google.com/document/d/123/edit");
  vm.runInNewContext(contentScriptCode, context);

  // Invoke uiToast via __imgloupe
  win.__imgloupe.uiToast("無法寫入剪貼簿，請點一下頁面後再試");

  const toast = doc.getElementById("imgloupe-toast");
  assert.ok(toast, "Toast alert #imgloupe-toast must be created in DOM on error");
  assert.ok(toast.textContent.includes("無法寫入剪貼簿"), "Toast message must notify user about copy failure");
  assert.ok(toast.classList.contains("imgloupe-toast"), "Toast appearance comes from the content stylesheet class");

  await t.test("uiToast stays persistent when duration is 0, and updates smoothly on completion", () => {
    win.__imgloupe.uiToast("正在辨識圖片文字…", 0);
    const liveToast = doc.getElementById("imgloupe-toast");
    assert.ok(liveToast, "Toast must be present in DOM");
    assert.strictEqual(liveToast.textContent, "正在辨識圖片文字…", "Toast must display running state");

    // When OCR completes, it updates the same element in-place
    win.__imgloupe.uiToast("已複製圖片文字（15 字）", 3500);
    assert.strictEqual(liveToast.textContent, "已複製圖片文字（15 字）", "Toast text must update in-place without removing early");
  });

  await t.test("copyImageToClipboard writes image/png Blob to navigator.clipboard", async () => {
    let writtenItems = [];
    win.navigator.clipboard.write = async (items) => {
      writtenItems = items;
    };

    const ok = await win.__imgloupe.copyImageToClipboard("https://example.com/sample-image.png");
    assert.strictEqual(ok, true, "copyImageToClipboard must succeed");
    assert.strictEqual(writtenItems.length, 1, "Must write 1 ClipboardItem");
    assert.ok(writtenItems[0].types.includes("image/png"), "ClipboardItem must have image/png type");
  });

  await t.test("Toolbar Copy Button: clicking copy button triggers copy and success state", async () => {
    let writeCalled = false;
    win.navigator.clipboard.write = async () => { writeCalled = true; };

    // Route the copy action to a known image, as a resolved selection would.
    win.__imgloupe.createToolbar(action => action === "copy" && win.__imgloupe.copyImageToClipboard("https://example.com/sample-image.png"));
    const copyBtn = doc.getElementById("imgloupe-action-copy");
    assert.ok(copyBtn, "Copy image button must exist in toolbar");

    // Click button with active image; the toolbar handles the click.
    copyBtn.click();
    for (let i = 0; i < 50 && !writeCalled; i++) await new Promise(resolve => setTimeout(resolve, 10));

    assert.strictEqual(writeCalled, true, "Clipboard write must be triggered by button click");
  });

  await t.test("copyImageToClipboard: displays error toast on clipboard rejection", async () => {
    win.navigator.clipboard.write = async () => { throw new Error("NotAllowedError"); };

    const ok = await win.__imgloupe.copyImageToClipboard("https://example.com/sample-image.png");
    assert.strictEqual(ok, false, "Must return false on error");

    const toast = doc.getElementById("imgloupe-toast");
    assert.ok(toast, "Toast must be present");
    assert.ok(toast.textContent.includes("無法寫入剪貼簿"), "Toast must display copy failure message");
  });
});

test("Suite 6: Background Service Worker Initialization", (t) => {
  const chromeMock = {
    runtime: {
      id: "imgloupe-extension-id",
      onMessage: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      }
    },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {},
      closeDocument: async () => {}
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => ({})
      }
    }
  };

  const context = {
    chrome: chromeMock,
    globalThis: {},
    console: console,
    Date: Date,
    Promise: Promise
  };
  context.globalThis = context;

  assert.doesNotThrow(() => {
    vm.runInNewContext(backgroundScriptCode, context);
  }, "Background service worker must initialize cleanly without error");

  assert.ok(chromeMock.runtime.onMessage._listeners.length > 0, "Background worker must register message listeners for storage sync");
});

test("Suite 7: On-Demand Batch Download & ZIP Packaging", async (t) => {
  await t.test("Batch download message triggers scan, zip generation, and download", async () => {
    const freshScript = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win, chromeMock } = createMockEnv("https://docs.google.com/document/d/123/edit");
    vm.runInNewContext(freshScript, context);

    assert.ok(typeof win.__imgloupe.batchDownloadAllImages === "function", "batchDownloadAllImages must be exposed");

    // Pack simulated image URLs directly
    context.fetch = async url => ({ ok: true, blob: async () => new Blob([url], { type: 'image/png' }) });
    const sampleUrls = [
      "https://lh3.googleusercontent.com/docsubipk/sample1=s2048",
      "https://lh3.googleusercontent.com/docsubipk/sample2=s2048"
    ];
    let progressCalls = [];
    const result = await win.__imgloupe.batchDownloadAllImages(sampleUrls, (done, total) => {
      progressCalls.push({ done, total });
    });

    assert.strictEqual(result.downloaded, 2, "Must report 2 downloaded files in zip");
    assert.strictEqual(result.failed, 0, "Must report 0 failed files");
    assert.strictEqual(progressCalls.length, 2, "onProgress must be called for each file");

    const toast = doc.getElementById("imgloupe-toast");
    assert.ok(toast, "Batch download must create toast notification in DOM");
    assert.ok(toast.textContent.includes("已打包 2 張圖片"), "Toast must display the packed count");

    // The popup's export message replies with counts and the image source.
    const listener = chromeMock.runtime.onMessage._listeners[0];
    assert.ok(listener, "Runtime message listener must be present");
    const response = await new Promise(resolve => {
      listener({ type: "imgloupe:export-images" }, {}, resolve);
    });
    assert.ok(response, "Must respond to the export message");
    assert.ok(typeof response.downloaded === "number", "Response must include downloaded count");
    assert.ok(["export", "loaded"].includes(response.source), "Response must name the image source");
  });

  await t.test("Batch download with 0 images displays toast indicating no images found", async () => {
    const freshScript = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win } = createMockEnv("https://docs.google.com/document/d/123/edit");
    vm.runInNewContext(freshScript, context);

    const result = await win.__imgloupe.batchDownloadAllImages([]);
    assert.strictEqual(result.downloaded, 0);
    const toast = doc.getElementById("imgloupe-toast");
    assert.ok(toast, "Toast must be created when no images found");
    assert.ok(toast.textContent.includes("這份文件裡找不到圖片"), "Toast must indicate no images found");
  });

  // Popup behavior is tested against its real HTML in tests/browser/popup.spec.cjs.
});

test("Suite 8: Google Sheets In-Cell Images & =IMAGE() Formula Extraction", async (t) => {
  await t.test("extractFormulaBarImageUrl reads only the quoted https URL of an IMAGE formula", () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win } = createMockEnv("https://docs.google.com/spreadsheets/d/123/edit");
    vm.runInNewContext(script, context);

    const formulaBar = doc.createElement("div");
    formulaBar.id = "t-formula-bar-input";
    doc.body.appendChild(formulaBar);
    const read = text => { formulaBar.textContent = text; return win.__imgloupe.extractFormulaBarImageUrl(); };

    assert.strictEqual(read('=IMAGE("https://example.com/products/item1.png")'), "https://example.com/products/item1.png");
    assert.strictEqual(read('=image("https://example.com/avatar.webp", 4, 100, 100)'), "https://example.com/avatar.webp");
    // Anything that is not a literal https IMAGE URL is ignored.
    assert.strictEqual(read("https://intranet.example.com/hr/report"), null, "Plain links must not be treated as images");
    assert.strictEqual(read("=IMAGE(A1,4,160,160)"), null, "Cell references are not resolved from page text");
    assert.strictEqual(read('=IMAGE("http://example.com/a.png")'), null, "Only https URLs are accepted");
    assert.strictEqual(read('=ARRAYFORMULA(IF(A1="","",IMAGE("https://example.com/a.png",4,160,160)))'), "https://example.com/a.png", "A literal URL inside a nested IMAGE call counts");
    assert.strictEqual(read('Note: IMAGE("https://example.com/a.png")'), null, "Cell text that is not a formula is ignored");
  });

  await t.test("Sheets discovery keeps Google image resources and the formula image, not arbitrary hosts", () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win } = createMockEnv("https://docs.google.com/spreadsheets/d/123/edit");
    vm.runInNewContext(script, context);

    const formulaBar = doc.createElement("div");
    formulaBar.id = "t-formula-bar-input";
    formulaBar.textContent = '=IMAGE("https://example.com/embedded-art.jpg")';
    doc.body.appendChild(formulaBar);

    const urls = win.__imgloupe.getNetworkResourceUrls("spreadsheets", [
      { name: "https://docs.google.com/spreadsheets/d/123/sheets-images-rt/abc=s2048" },
      { name: "https://cdn.example.com/photos/chart.png", initiatorType: "img" },
      { name: "https://lh3.googleusercontent.com/docsubipk/hash=w100" }
    ]);
    assert.ok(urls.includes("https://example.com/embedded-art.jpg"), "Formula image URL must be included");
    assert.ok(!urls.includes("https://cdn.example.com/photos/chart.png"), "Unrelated hosts must not be collected");
    assert.ok(urls.some(u => u.includes("sheets-images-rt")), "Google sheets-images-rt URLs must be included");
  });

  await t.test("Google Sheets: only floating images mount toolbar; in-cell clicks do not trigger false positive toolbar", async () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win } = createMockEnv("https://docs.google.com/spreadsheets/d/123/edit");
    vm.runInNewContext(script, context);

    // Simulate clicking an ordinary cell or empty space
    const normalCell = doc.createElement("div");
    normalCell.className = "grid-cell";
    normalCell.textContent = "Normal Text";
    doc.body.appendChild(normalCell);

    normalCell.dispatchEvent({ target: normalCell, type: "click", clientX: 100, clientY: 100 });
    const toolbar = doc.getElementById("imgloupeToolbar");
    // Toolbar should either not exist or not be displayed
    assert.ok(!toolbar || toolbar.style.getPropertyValue("display") === "none", "Normal cells must not show toolbar");

  });
});

test("Suite 9: Image OCR Text Extraction to Clipboard", async (t) => {
  await t.test("ocrImageToText sends do-ocr message to background/offscreen and copies Chinese text to clipboard", async () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win, chromeMock } = createMockEnv("https://docs.google.com/document/d/123/edit");

    let receivedMsg = null;
    let openedTabs = 0;
    win.open = () => { openedTabs++; return {}; };

    chromeMock.runtime.sendMessage = (msg, ...args) => {
      receivedMsg = msg;
      const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      let res = null;
      if (msg.type === "do-ocr") {
        res = {
          success: true,
          text: "資料源總表\n卡片標題\n首頁\n範例\n累積命中\nmatcha-tw 5.4%"
        };
      }
      if (cb) cb(res);
      return Promise.resolve(res);
    };

    let writtenText = "";
    win.navigator.clipboard.writeText = async (txt) => {
      writtenText = txt;
    };

    vm.runInNewContext(script, context);

    const ok = await win.__imgloupe.ocrImageToText("https://example.com/chinese-table.png");
    assert.strictEqual(ok, true, "OCR extraction via background offscreen should succeed");
    assert.strictEqual(receivedMsg.type, "do-ocr", "Message type must be 'do-ocr'");
    assert.ok(writtenText.includes("資料源總表"), "Extracted text must contain Traditional Chinese title");
    assert.ok(writtenText.includes("卡片標題"), "Extracted text must contain card title");
    assert.ok(writtenText.includes("matcha-tw 5.4%"), "Extracted text must contain English and numbers");
    assert.strictEqual(openedTabs, 0, "OCR must NEVER open any external tabs or Google Lens");

    const toast = doc.getElementById("imgloupe-toast");
    assert.ok(toast, "Toast notification must be displayed");
    assert.ok(toast.textContent.includes("已複製圖片文字"), "Toast must confirm successful copy");
  });

  await t.test("offscreen.js registers runtime message listener for do-ocr and invokes worker", async () => {
    const offscreenScript = fs.readFileSync("dist/offscreen/offscreen.js", "utf8");
    const { context, chromeMock } = createMockEnv("chrome-extension://dummy-id/dist/offscreen/offscreen.html");

    const recognizeCalls = [];
    context.Tesseract = {
      createWorker: async () => ({
        setParameters: async () => {},
        recognize: async (img) => {
          recognizeCalls.push(img);
          return { data: { text: "離線 Tesseract 辨識結果：資料源總表" } };
        }
      })
    };

    vm.runInNewContext(offscreenScript, context);

    assert.ok(chromeMock.runtime.onMessage._listeners.length > 0, "Offscreen script must register onMessage listener");
    const listener = chromeMock.runtime.onMessage._listeners[0];

    const response = await new Promise((resolve) => {
      listener({ target: "offscreen", type: "do-ocr", image: "data:image/png;base64,mock" }, { id: chromeMock.runtime.id }, resolve);
    });

    assert.strictEqual(response.success, true, "Offscreen OCR response must report success");
    assert.strictEqual(response.text, "離線 Tesseract 辨識結果：資料源總表");
    assert.ok(recognizeCalls[0].startsWith('data:image/png;base64,'), 'Worker receives a locally prepared PNG');
  });

  await t.test("offscreen.js retries with PSM 6 when initial recognition returns empty text", async () => {
    const offscreenScript = fs.readFileSync("dist/offscreen/offscreen.js", "utf8");
    const { context, chromeMock } = createMockEnv("chrome-extension://dummy-id/dist/offscreen/offscreen.html");

    const psmParameters = [];
    let recognizeAttempt = 0;
    context.Tesseract = {
      createWorker: async () => ({
        setParameters: async (params) => {
          psmParameters.push(params);
        },
        recognize: async (img) => {
          recognizeAttempt++;
          if (recognizeAttempt === 1) {
            // First attempt with PSM 3 returns empty
            return { data: { text: "", lines: [] } };
          }
          // Second attempt with PSM 6 successfully recognizes snippet
          return { data: { text: "不同於傳統的抹茶碗，片口抹茶碗的設計能夠導流", lines: [{ text: "不同於傳統的抹茶碗，片口抹茶碗的設計能夠導流", confidence: 85 }] } };
        }
      })
    };

    vm.runInNewContext(offscreenScript, context);
    const listener = chromeMock.runtime.onMessage._listeners[0];

    const response = await new Promise((resolve) => {
      listener({ target: "offscreen", type: "do-ocr", image: "data:image/png;base64,mockCrop" }, { id: chromeMock.runtime.id }, resolve);
    });

    assert.strictEqual(response.success, true, "OCR response should succeed on retry");
    assert.ok(response.text.includes("不同於傳統的抹茶碗"), "Extracted text should come from PSM 6 retry");
    assert.strictEqual(recognizeAttempt, 2, "Must have called recognize twice (PSM 3 then PSM 6)");
    assert.ok(psmParameters.some((p) => p.tessedit_pageseg_mode === "6"), "Must switch to PSM 6 on retry");
    assert.strictEqual(psmParameters[psmParameters.length - 1].tessedit_pageseg_mode, "3", "Must restore default PSM 3 in finally block");
  });

  await t.test("ocrImageToText reports failure toast when empty or not found", async () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win } = createMockEnv("https://docs.google.com/document/d/123/edit");

    vm.runInNewContext(script, context);

    const ok = await win.__imgloupe.ocrImageToText("");
    assert.strictEqual(ok, false, "OCR on empty url should fail");

    const toast = doc.getElementById("imgloupe-toast");
    assert.ok(toast, "Toast must be displayed on failure");
    assert.ok(toast.textContent.includes("未選取圖片"), "Toast must display warning message");
  });

  const runOcrWith = async (ocrResponse) => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, doc, win, chromeMock } = createMockEnv("https://docs.google.com/document/d/123/edit");
    chromeMock.runtime.sendMessage = (msg, ...args) => {
      const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      const res = msg.type === "do-ocr" ? ocrResponse : null;
      if (cb) cb(res);
      return Promise.resolve(res);
    };
    let written = null;
    win.navigator.clipboard.writeText = async (text) => { written = text; };
    vm.runInNewContext(script, context);
    const ok = await win.__imgloupe.ocrImageToText("data:image/png;base64,AAAA");
    return { ok, written, toast: doc.getElementById("imgloupe-toast")?.textContent || "" };
  };

  await t.test("ocrImageToText reports a failed recognition instead of copying other text", async () => {
    const result = await runOcrWith({ success: false, error: "worker crashed" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.written, null, "Nothing may be written to the clipboard");
    assert.ok(result.toast.includes("文字辨識失敗"), "Toast must report the failure");
  });

  await t.test("ocrImageToText reports when no text is found", async () => {
    const result = await runOcrWith({ success: true, text: "-----\n| |" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.written, null);
    assert.ok(result.toast.includes("未偵測到文字"));
  });

  await t.test("offscreen.js filters low confidence tokens and joins CJK without spaces", async () => {
    const offscreenScript = fs.readFileSync("dist/offscreen/offscreen.js", "utf8");
    const { context, chromeMock } = createMockEnv("chrome-extension://dummy-id/dist/offscreen/offscreen.html");

    context.Tesseract = {
      createWorker: async () => ({
        setParameters: async () => {},
        recognize: async () => ({
          data: {
            lines: [
              {
                confidence: 30, // low line confidence (< 50) -> should be discarded
                text: "加汪玉入入",
                words: [{ text: "加汪玉入入", confidence: 30 }]
              },
              {
                confidence: 85, // valid line
                words: [
                  { text: "國", confidence: 80 },
                  { text: "小", confidence: 85 },
                  { text: "生", confidence: 90 },
                  { text: "a", confidence: 45 }, // single char with confidence < 60 -> filtered
                  { text: "用品", confidence: 88 }
                ]
              }
            ]
          }
        })
      })
    };

    vm.runInNewContext(offscreenScript, context);
    const listener = chromeMock.runtime.onMessage._listeners[0];
    const response = await new Promise((resolve) => {
      listener({ target: "offscreen", type: "do-ocr", image: "data:image/png;base64,mock" }, { id: chromeMock.runtime.id }, resolve);
    });

    assert.strictEqual(response.success, true);
    assert.ok(!response.text.includes("加汪玉入入"), "Low confidence line must be skipped");
    assert.strictEqual(response.text, "國小生用品", "CJK words must be joined without spaces and low-confidence single-char skipped");
  });

  await t.test("offscreen.js responds to copy-to-clipboard message", async () => {
    const offscreenScript = fs.readFileSync("dist/offscreen/offscreen.js", "utf8");
    const { context, chromeMock } = createMockEnv("chrome-extension://dummy-id/dist/offscreen/offscreen.html");

    let copiedValue = null;
    context.navigator = {
      clipboard: {
        writeText: async (t) => {
          copiedValue = t;
        }
      }
    };

    vm.runInNewContext(offscreenScript, context);
    const listener = chromeMock.runtime.onMessage._listeners[0];
    const response = await new Promise((resolve) => {
      listener({ target: "offscreen", type: "copy-to-clipboard", text: "已清洗文字" }, { id: chromeMock.runtime.id }, resolve);
    });

    assert.strictEqual(response.success, true);
    assert.strictEqual(response.copied, true);
    assert.strictEqual(copiedValue, "已清洗文字", "Offscreen must copy clean text to clipboard");

    // Content scripts (tab senders) and other extensions cannot address it directly.
    copiedValue = null;
    for (const sender of [{ id: chromeMock.runtime.id, tab: { id: 1 } }, { id: "another-extension" }, {}]) {
      assert.strictEqual(listener({ target: "offscreen", type: "copy-to-clipboard", text: "x" }, sender, () => {}), undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(copiedValue, null, "Unauthorized senders must be ignored");
  });

  await t.test("ocrImageToText cleans text before writing to clipboard", async () => {
    const script = fs.readFileSync("dist/contentScripts/index.global.js", "utf8");
    const { context, win, chromeMock } = createMockEnv("https://docs.google.com/document/d/123/edit");

    chromeMock.runtime.sendMessage = (msg, ...args) => {
      const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      let res = null;
      if (msg.type === "do-ocr") {
        res = {
          success: true,
          text: "首 頁 「 主 題 」\n|\n|\n營收 8l,379 元\nGalaxy S24"
        };
      }
      if (cb) cb(res);
      return Promise.resolve(res);
    };

    let writtenToClipboard = null;
    win.navigator.clipboard.writeText = async (t) => {
      writtenToClipboard = t;
    };
    context.navigator.clipboard.writeText = win.navigator.clipboard.writeText;

    vm.runInNewContext(script, context);
    await win.__imgloupe.ocrImageToText("https://example.com/test.png");

    assert.strictEqual(writtenToClipboard, "首頁「主題」\n營收 81,379 元\nGalaxy S24", "Clipboard receives the cleaned text");
  });

  await t.test("extractLinesFromResult preserves 80.30% and financial percentage lines", async () => {
    const offscreenScript = fs.readFileSync("dist/offscreen/offscreen.js", "utf8");
    const { context } = createMockEnv("chrome-extension://dummy-id/dist/offscreen/offscreen.html");
    vm.runInNewContext(offscreenScript, context);

    const mockTesseractResult = {
      data: {
        lines: [
          {
            confidence: 42,
            text: "2026/04 US$ 81,379 US$ 65,345 80.30% -16,034",
            words: [
              { text: "2026/04", confidence: 45 },
              { text: "US$", confidence: 50 },
              { text: "81,379", confidence: 48 },
              { text: "US$", confidence: 52 },
              { text: "65,345", confidence: 49 },
              { text: "80.30%", confidence: 38 },
              { text: "-16,034", confidence: 46 }
            ]
          }
        ]
      }
    };

    const lines = context.window.__imgloupeOffscreen.extractLinesFromResult(mockTesseractResult);
    assert.strictEqual(lines.length, 1, "Line must not be dropped");
    assert.ok(lines[0].includes("80.30%"), "80.30% must be preserved in line");
    assert.ok(lines[0].includes("US$ 81,379"), "Currency amounts must be preserved");
  });
});




