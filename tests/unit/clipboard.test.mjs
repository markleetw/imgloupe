import test from "node:test";
import assert from "node:assert";
import { copyTextToClipboard, copyImageToClipboard, imageSourceToPngBlob } from "../../src/content/shared/clipboard.js";

if (!globalThis.navigator) {
  globalThis.navigator = {};
}

test("Unit: Clipboard Utilities & Image Copying", async (t) => {
  await t.test("copyTextToClipboard: writes text using navigator.clipboard.writeText", async () => {
    let written = "";
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {
        writeText: async (t) => { written = t; }
      },
      configurable: true,
      writable: true
    });

    const ok = await copyTextToClipboard("測試複製文字");
    assert.strictEqual(ok, true);
    assert.strictEqual(written, "測試複製文字");
  });

  await t.test("imageSourceToPngBlob: returns png blob directly if already image/png", async () => {
    const pngBlob = new globalThis.Blob(["dummy-png-data"], { type: "image/png" });
    const result = await imageSourceToPngBlob(pngBlob);
    assert.strictEqual(result, pngBlob);
    assert.strictEqual(result.type, "image/png");
  });

  await t.test("imageSourceToPngBlob: throws error on empty or invalid source", async () => {
    await assert.rejects(async () => {
      await imageSourceToPngBlob("");
    }, /No image source provided/);
  });

  await t.test("copyImageToClipboard: constructs ClipboardItem with image/png and writes to clipboard", async () => {
    let writtenItems = [];
    class MockClipboardItem {
      constructor(items) {
        this.items = items;
        this.types = Object.keys(items);
      }
    }

    globalThis.ClipboardItem = MockClipboardItem;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {
        write: async (items) => {
          writtenItems.push(...items);
        }
      },
      configurable: true,
      writable: true
    });

    // Mock fetch and canvas conversion
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      blob: async () => new globalThis.Blob(["fake-image"], { type: "image/png" })
    });

    try {
      const ok = await copyImageToClipboard("https://example.com/photo.png");
      assert.strictEqual(ok, true, "copyImageToClipboard must succeed");
      assert.strictEqual(writtenItems.length, 1, "Must write 1 ClipboardItem");
      assert.ok(writtenItems[0].types.includes("image/png"), "ClipboardItem must contain image/png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("copyImageToClipboard: fails gracefully and returns false if Clipboard API unsupported", async () => {
    delete globalThis.ClipboardItem;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {},
      configurable: true,
      writable: true
    });

    const ok = await copyImageToClipboard("https://example.com/photo.png");
    assert.strictEqual(ok, false, "Must return false when ClipboardItem is unsupported");
  });
});
