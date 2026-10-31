import test from "node:test";
import assert from "node:assert";
import { extractLinesFromResult } from "../../src/offscreen/line-extractor.js";

test("Unit: Offscreen Line Extractor & OCR Token Filter", async (t) => {
  await t.test("Percentage & Financial lines: preserves 80.30% with token confidence >= 35%", () => {
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

    const lines = extractLinesFromResult(mockTesseractResult);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes("80.30%"), "80.30% must be retained");
    assert.ok(lines[0].includes("US$ 81,379"), "Currency values must be retained");
  });

  await t.test("Noise rejection: filters out words with confidence under threshold", () => {
    const mockResult = {
      data: {
        lines: [
          {
            confidence: 50,
            text: "realText %$#@!noise",
            words: [
              { text: "realText", confidence: 75 },
              { text: "%$#@!noise", confidence: 15 }
            ]
          }
        ]
      }
    };

    const lines = extractLinesFromResult(mockResult);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "realText", "Noise token with 15% confidence must be stripped");
  });

  await t.test("Chinese token joining: joins consecutive CJK tokens without spaces", () => {
    const mockResult = {
      data: {
        lines: [
          {
            confidence: 85,
            text: "專案 執行 狀況",
            words: [
              { text: "專案", confidence: 88 },
              { text: "執行", confidence: 85 },
              { text: "狀況", confidence: 89 }
            ]
          }
        ]
      }
    };

    const lines = extractLinesFromResult(mockResult);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "專案執行狀況");
  });

  await t.test("Preserves low-confidence CJK tokens (e.g. 片 at 15.5%) when overall line confidence is high", () => {
    const mockResult = {
      data: {
        lines: [
          {
            confidence: 85,
            text: "matcha-tw 的「片口抹茶碗推薦",
            words: [
              { text: "matcha-tw", confidence: 93 },
              { text: "的", confidence: 93 },
              { text: "「", confidence: 90 },
              { text: "片", confidence: 15.5 },
              { text: "口", confidence: 93 },
              { text: "抹茶碗推薦", confidence: 94 }
            ]
          }
        ]
      }
    };

    const lines = extractLinesFromResult(mockResult);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes("片口"), "Character 片 with 15.5% confidence must NOT be dropped");
  });
});
