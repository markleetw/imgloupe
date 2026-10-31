import test from "node:test";
import assert from "node:assert";
import { documentFileStem, imageExtensionFor, packImagesToZip } from "../../src/content/shared/download-manager.js";

test("Unit: Download Manager & Filename Sanitization", async (t) => {
  await t.test("Filename sanitization: preserves Chinese characters while removing invalid filesystem characters", () => {
    const title = "2026 年度 / 財務報表 (草稿) : 最終版 - Google 試算表";
    const stem = documentFileStem(title);
    assert.strictEqual(stem, "2026-年度-財務報表-(草稿)-最終版");
  });

  await t.test("Filename sanitization: removes Google Docs / Sheets / Slides suffixes", () => {
    assert.strictEqual(documentFileStem("Product Roadmap - Google Docs"), "Product-Roadmap");
    assert.strictEqual(documentFileStem("Marketing Pitch - Google Slides"), "Marketing-Pitch");
    assert.strictEqual(documentFileStem("Q1 Goals - Google 表格"), "Q1-Goals");
    assert.strictEqual(documentFileStem("Notes about Google Docs"), "Notes-about-Google-Docs");
  });

  await t.test("Extension detection: accurately maps Blob MIME types", () => {
    assert.strictEqual(imageExtensionFor({ type: "image/png" }), "png");
    assert.strictEqual(imageExtensionFor({ type: "image/jpeg" }), "jpg");
    assert.strictEqual(imageExtensionFor({ type: "image/webp" }), "webp");
    assert.strictEqual(imageExtensionFor({ type: "image/svg+xml" }), "svg");
    assert.strictEqual(imageExtensionFor({ type: "image/gif" }), "gif");
  });

  await t.test("Extension detection: extracts extension from URL if blob type is generic", () => {
    const url = "https://example.com/assets/banner.webp?version=2&size=large#top";
    assert.strictEqual(imageExtensionFor(null, url), "webp");
  });

  await t.test("Extension detection: ignores non-image URL extensions and falls back to PNG", () => {
    assert.strictEqual(imageExtensionFor(null, "https://example.com/report.html"), "png");
    assert.strictEqual(imageExtensionFor({ type: "text/html" }, "https://example.com/photo.JPEG"), "jpg");
    assert.strictEqual(imageExtensionFor({ type: "image/jpeg; charset=binary" }), "jpg");
  });

  await t.test("packImagesToZip: returns downloaded count and handles empty list gracefully", async () => {
    const result = await packImagesToZip([]);
    assert.strictEqual(result.downloaded, 0);
    assert.strictEqual(result.failed, 0);
  });

  await t.test("packImagesToZip: generates failed-images.txt inside zip when some images fail", async () => {
    const originalFetch = globalThis.fetch;
    // Simulate image1 succeeding, image2 failing (e.g. 404)
    globalThis.fetch = async (url) => {
      if (url.includes("fail")) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        blob: async () => new globalThis.Blob(["good-image"], { type: "image/png" })
      };
    };

    let filesInZip = {};
    class MockZip {
      file(name, content) {
        filesInZip[name] = content;
      }
      async generateAsync() {
        return new globalThis.Blob(["mock-zip"]);
      }
    }

    try {
      const urls = [
        "https://example.com/image1=s2048",
        "https://example.com/fail-image2=s2048"
      ];
      const result = await packImagesToZip(urls, null, MockZip);
      assert.strictEqual(result.downloaded, 1, "Must report 1 downloaded file");
      assert.strictEqual(result.failed, 1, "Must report 1 failed file");
      assert.ok(filesInZip["failed-images.txt"], "Must include failed-images.txt when failures occur");
      assert.ok(filesInZip["failed-images.txt"].includes("fail-image2"), "Report must list the failed URL");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
