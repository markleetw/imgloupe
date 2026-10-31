import test from "node:test";
import assert from "node:assert";
import {
  calculateImageCropBounds,
  cropImageToDataUrl
} from "../../src/content/ui/lightbox-crop.js";

test("Unit: Lightbox Image Crop Bounds & Coordinate Mapping", async (t) => {
  await t.test("calculateImageCropBounds: 1:1 scale with safety buffer", () => {
    const screenBox = { left: 100, top: 100, width: 200, height: 150 };
    const imgRect = { left: 50, top: 50, width: 800, height: 600 };
    const naturalWidth = 800;
    const naturalHeight = 600;

    const bounds = calculateImageCropBounds(screenBox, imgRect, naturalWidth, naturalHeight, 8);

    assert.strictEqual(bounds.cropX, 42, "cropX must be (100 - 50) * 1 - 8 = 42");
    assert.strictEqual(bounds.cropY, 42, "cropY must be (100 - 50) * 1 - 8 = 42");
    assert.strictEqual(bounds.cropW, 216, "cropW must be 200 + 16 = 216");
    assert.strictEqual(bounds.cropH, 166, "cropH must be 150 + 16 = 166");
  });

  await t.test("calculateImageCropBounds: scaled/zoomed in image (scale = 0.5)", () => {
    // Rendered on screen at 2x zoom (1600x1200), original is 800x600
    const screenBox = { left: 200, top: 200, width: 400, height: 300 };
    const imgRect = { left: 0, top: 0, width: 1600, height: 1200 };
    const naturalWidth = 800;
    const naturalHeight = 600;

    const bounds = calculateImageCropBounds(screenBox, imgRect, naturalWidth, naturalHeight, 8);

    // relX = 200 * 0.5 = 100 - 8 = 92
    assert.strictEqual(bounds.cropX, 92);
    // relY = 200 * 0.5 = 100 - 8 = 92
    assert.strictEqual(bounds.cropY, 92);
    // cropW = 400 * 0.5 + 16 = 216
    assert.strictEqual(bounds.cropW, 216);
    // cropH = 300 * 0.5 + 16 = 166
    assert.strictEqual(bounds.cropH, 166);
  });

  await t.test("calculateImageCropBounds: clamps to zero at top/left boundary", () => {
    // Selection starts right at the image edge
    const screenBox = { left: 10, top: 10, width: 100, height: 100 };
    const imgRect = { left: 10, top: 10, width: 800, height: 600 };

    const bounds = calculateImageCropBounds(screenBox, imgRect, 800, 600, 8);

    assert.strictEqual(bounds.cropX, 0, "cropX must clamp at 0 and not be negative");
    assert.strictEqual(bounds.cropY, 0, "cropY must clamp at 0 and not be negative");
    assert.ok(bounds.cropW > 0);
    assert.ok(bounds.cropH > 0);
  });

  await t.test("calculateImageCropBounds: clamps to image boundary at bottom/right", () => {
    const screenBox = { left: 750, top: 550, width: 100, height: 100 };
    const imgRect = { left: 0, top: 0, width: 800, height: 600 };

    const bounds = calculateImageCropBounds(screenBox, imgRect, 800, 600, 8);

    assert.ok(bounds.cropX + bounds.cropW <= 800, "cropX + cropW must never exceed naturalWidth");
    assert.ok(bounds.cropY + bounds.cropH <= 600, "cropY + cropH must never exceed naturalHeight");
  });

  await t.test("calculateImageCropBounds: handles null or empty inputs gracefully", () => {
    const bounds = calculateImageCropBounds(null, null, 0, 0);
    assert.strictEqual(bounds.cropW, 0);
    assert.strictEqual(bounds.cropH, 0);
  });

  await t.test("calculateImageCropBounds: extreme aspect ratio - panorama (4000x200)", () => {
    const screenBox = { left: 500, top: 10, width: 600, height: 80 };
    const imgRect = { left: 0, top: 0, width: 2000, height: 100 }; // 0.5x zoom
    const naturalWidth = 4000;
    const naturalHeight = 200;

    const bounds = calculateImageCropBounds(screenBox, imgRect, naturalWidth, naturalHeight, 8);
    assert.strictEqual(bounds.cropX, 992); // (500 * 2) - 8
    assert.strictEqual(bounds.cropY, 12);  // (10 * 2) - 8
    assert.strictEqual(bounds.cropW, 1216); // (600 * 2) + 16
    assert.strictEqual(bounds.cropH, 176);  // (80 * 2) + 16
    assert.ok(bounds.cropX + bounds.cropW <= naturalWidth);
    assert.ok(bounds.cropY + bounds.cropH <= naturalHeight);
  });

  await t.test("calculateImageCropBounds: handles zero-dimension imgRect without crashing", () => {
    const screenBox = { left: 10, top: 10, width: 50, height: 50 };
    const imgRect = { left: 0, top: 0, width: 0, height: 0 };
    const bounds = calculateImageCropBounds(screenBox, imgRect, 800, 600, 8);
    assert.strictEqual(bounds.cropW, 0);
    assert.strictEqual(bounds.cropH, 0);
  });

  await t.test("cropImageToDataUrl: draws to canvas and resets canvas dimensions to reclaim VRAM", () => {
    let drawn = false;
    let canvasWidthSet = 0;
    let canvasHeightSet = 0;

    const originalCreateElement = globalThis.document?.createElement;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
          drawn = true;
          assert.strictEqual(sx, 10);
          assert.strictEqual(sy, 15);
          assert.strictEqual(sw, 100);
          assert.strictEqual(sh, 50);
        }
      }),
      toDataURL: (type) => {
        canvasWidthSet = mockCanvas.width;
        canvasHeightSet = mockCanvas.height;
        return `data:${type};base64,mockImageData`;
      }
    };

    if (!globalThis.document) globalThis.document = {};
    globalThis.document.createElement = (tag) => {
      if (tag === "canvas") return mockCanvas;
      return {};
    };

    try {
      const mockImg = { complete: true };
      const bounds = { cropX: 10, cropY: 15, cropW: 100, cropH: 50 };
      const result = cropImageToDataUrl(mockImg, bounds);

      assert.ok(drawn, "Must execute drawImage");
      assert.strictEqual(canvasWidthSet, 100, "Canvas width set before drawing");
      assert.strictEqual(canvasHeightSet, 50, "Canvas height set before drawing");
      assert.strictEqual(mockCanvas.width, 0, "Canvas width must be reset to 0 after toDataURL");
      assert.strictEqual(mockCanvas.height, 0, "Canvas height must be reset to 0 after toDataURL");
      assert.strictEqual(result, "data:image/png;base64,mockImageData");
    } finally {
      if (originalCreateElement) {
        globalThis.document.createElement = originalCreateElement;
      } else {
        delete globalThis.document;
      }
    }
  });

  await t.test("cropImageToDataUrl: catches drawing exceptions and returns null cleanly", () => {
    if (!globalThis.document) globalThis.document = {};
    const originalCreateElement = globalThis.document.createElement;

    globalThis.document.createElement = (tag) => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {
          throw new Error("SecurityError: Tainted canvas");
        }
      }),
      toDataURL: () => ""
    });

    try {
      const result = cropImageToDataUrl({}, { cropX: 0, cropY: 0, cropW: 10, cropH: 10 });
      assert.strictEqual(result, null, "Must safely return null on canvas drawing failure");
    } finally {
      if (originalCreateElement) {
        globalThis.document.createElement = originalCreateElement;
      } else {
        delete globalThis.document;
      }
    }
  });

  await t.test("cropImageToDataUrl: returns null on invalid or zero-size bounds", () => {
    assert.strictEqual(cropImageToDataUrl(null, { cropW: 0, cropH: 0 }), null);
  });

  await t.test("startLightboxCrop: mounts overlay and cleans up on Escape key", async () => {
    const { startLightboxCrop } = await import("../../src/content/ui/lightbox-crop.js");

    const eventListeners = new Map();
    const mockWindow = {
      addEventListener: (type, fn) => {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type).push(fn);
      },
      removeEventListener: (type, fn) => {
        if (eventListeners.has(type)) {
          eventListeners.set(type, eventListeners.get(type).filter((f) => f !== fn));
        }
      }
    };

    const containerClasses = new Set();
    const children = [];
    const canvasListeners = new Map();

    const mockCanvas = {
      addEventListener: (type, fn) => {
        if (!canvasListeners.has(type)) canvasListeners.set(type, []);
        canvasListeners.get(type).push(fn);
      },
      removeEventListener: (type, fn) => {
        if (canvasListeners.has(type)) {
          canvasListeners.set(type, canvasListeners.get(type).filter((f) => f !== fn));
        }
      }
    };

    const mockContainer = {
      classList: {
        add: (c) => containerClasses.add(c),
        remove: (c) => containerClasses.delete(c),
        contains: (c) => containerClasses.has(c)
      },
      querySelector: (sel) => {
        if (sel === ".viewer-canvas") return mockCanvas;
        return null;
      },
      appendChild: (el) => children.push(el)
    };

    const mockDoc = {
      createElement: (tag) => {
        const elListeners = new Map();
        const element = {
          tagName: tag.toUpperCase(),
          className: "",
          style: {},
          querySelector: () => ({ addEventListener: () => {} }),
          appendChild: () => {},
          append: () => {},
          setAttribute: () => {},
          remove: () => {
            const idx = children.indexOf(element);
            if (idx !== -1) children.splice(idx, 1);
          },
          addEventListener: (type, fn) => {
            if (!elListeners.has(type)) elListeners.set(type, []);
            elListeners.get(type).push(fn);
          },
          removeEventListener: (type, fn) => {
            if (elListeners.has(type)) {
              elListeners.set(type, elListeners.get(type).filter((f) => f !== fn));
            }
          }
        };
        return element;
      }
    };

    const prevWindow = globalThis.window;
    const prevDoc = globalThis.document;
    globalThis.window = mockWindow;
    globalThis.document = mockDoc;

    try {
      const mockViewer = {
        viewer: mockContainer,
        image: { complete: true, naturalWidth: 800, naturalHeight: 600 }
      };

      // 1. Activate crop
      startLightboxCrop(mockViewer, () => {});
      assert.ok(containerClasses.has("imgloupe-crop-active"), "Must add imgloupe-crop-active class");
      assert.strictEqual(children.length, 2, "Must append hintBanner and selection box");

      // 2. Simulate Escape key
      const keydownHandlers = eventListeners.get("keydown") || [];
      assert.ok(keydownHandlers.length > 0, "Must register keydown handler");
      keydownHandlers[0]({ key: "Escape" });

      assert.strictEqual(containerClasses.has("imgloupe-crop-active"), false, "Must remove imgloupe-crop-active class on Escape");
      assert.strictEqual(children.length, 0, "Must remove hint banner and crop box");
    } finally {
      globalThis.window = prevWindow;
      globalThis.document = prevDoc;
    }
  });
});


