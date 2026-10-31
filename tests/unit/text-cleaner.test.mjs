import test from "node:test";
import assert from "node:assert";
import { cleanOcrText } from "../../src/content/ocr/text-cleaner.js";

test("Unit: OCR text cleaner", async (t) => {
  await t.test("removes spaces Tesseract inserts between CJK characters and punctuation", () => {
    assert.strictEqual(cleanOcrText("這 是一 個 繁體 中文 測試 句子 。"), "這是一個繁體中文測試句子。");
  });

  await t.test("keeps spaces between Latin words and at CJK/Latin boundaries", () => {
    assert.strictEqual(cleanOcrText("Google Workspace Document and Spreadsheet"), "Google Workspace Document and Spreadsheet");
    assert.strictEqual(cleanOcrText("專案 Project Alpha 開始 執行"), "專案 Project Alpha 開始執行");
  });

  await t.test("drops lines without any letter or digit", () => {
    assert.strictEqual(cleanOcrText("標題\n-----\n| | |\n. . _\n內容"), "標題\n內容");
  });

  await t.test("repairs o/O and l/I only inside numeric tokens", () => {
    assert.strictEqual(cleanOcrText("營收 8l,379 元"), "營收 81,379 元");
    assert.strictEqual(cleanOcrText("US$ 8O,3I9"), "US$ 80,319");
    assert.strictEqual(cleanOcrText("1O2 items"), "102 items");
  });

  await t.test("joins a URL scheme split by spaces", () => {
    assert.strictEqual(cleanOcrText("https: //www.pinkoi.com"), "https://www.pinkoi.com");
    assert.strictEqual(cleanOcrText("網址 http :/ /example.com/a"), "網址 http://example.com/a");
    assert.strictEqual(cleanOcrText("HTTPS: //EXAMPLE.COM"), "HTTPS://EXAMPLE.COM");
    assert.strictEqual(cleanOcrText("protocol: https or http"), "protocol: https or http");
    assert.strictEqual(cleanOcrText("https: // "), "https: //");
  });

  await t.test("preserves amounts, percentages and dates exactly", () => {
    const line = "2026/04 US$ 81,379 US$ 65,345 80.30% -16,034";
    assert.strictEqual(cleanOcrText(line), line);
  });

  // Correct text must come out unchanged: OCR output is copied as user data.
  await t.test("never rewrites correct words, identifiers or numbers", () => {
    const unchanged = [
      "下兩個月的營收", "兩季財報", "雨季", "已經完成", "自己", "週末", "未來",
      "Galaxy S24 Ultra", "S100 型號", "B2B 電商平台", "A4 B5 紙張", "記憶體 16B",
      "訂單編號 2025110", "金額 2000105 元", "2026|04",
      "www.pinkoi.com", "https://example.com/a?b=1", "Hi", "go to it", "Hmmm okay", "OK",
      "the prod marketing team", "I/O port", "l0 apples", "anne", "茶笑", "Cumulative Gap » v"
    ];
    for (const text of unchanged) assert.strictEqual(cleanOcrText(text), text, text);
  });

  await t.test("stays fast on large input", () => {
    const massive = Array.from({ length: 5000 }, (_, i) => `第 ${i} 行 測試 Line ${i} 8l,379 | | ${"x".repeat(20)}`).join("\n");
    const started = performance.now();
    cleanOcrText(massive);
    assert.ok(performance.now() - started < 500, "cleanOcrText must stay linear on large input");
  });
});
