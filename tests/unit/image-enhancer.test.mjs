import test from "node:test";
import assert from "node:assert";
import { enhanceImageForOcr } from "../../src/offscreen/image-enhancer.js";

test("Unit: Image Enhancer for Offline OCR", async (t) => {
  await t.test("Passthrough: handles empty or invalid inputs gracefully", async () => {
    assert.strictEqual(await enhanceImageForOcr(null), null);
    assert.strictEqual(await enhanceImageForOcr(""), "");
    assert.strictEqual(await enhanceImageForOcr(undefined), undefined);
  });

  await t.test("Polarity detection: inverts white-on-dark image and preserves light document", async () => {
    // Setup minimal mock DOM
    const origDoc = globalThis.document;
    const origImg = globalThis.Image;

    try {
      let drawnScale = 1;
      let invertedPixels = false;

      // Mock canvas
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (img, x, y, w, h) => {
            drawnScale = w / img.width;
          },
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            // Simulate dark background (luma ~30) with white text
            for (let i = 0; i < data.length; i += 4) {
              data[i] = 30;     // R
              data[i + 1] = 30; // G
              data[i + 2] = 30; // B
              data[i + 3] = 255;
            }
            return { data };
          },
          putImageData: (imgData) => {
            // Check if pixels were inverted (30 -> 225)
            if (imgData.data[0] > 200) {
              invertedPixels = true;
            }
          }
        }),
        toDataURL: () => "data:image/png;base64,mockEnhanced"
      };

      globalThis.document = {
        createElement: (tag) => {
          if (tag === "canvas") return mockCanvas;
          return {};
        }
      };

      globalThis.Image = class {
        constructor() {
          this.width = 300;
          this.height = 100;
          setTimeout(() => {
            if (typeof this.onload === "function") this.onload();
          }, 0);
        }
      };

      const result = await enhanceImageForOcr("data:image/png;base64,mockDark");
      assert.strictEqual(result, "data:image/png;base64,mockEnhanced");
      assert.strictEqual(drawnScale, 2, "Small image (300x100) must be upscaled 2x");
      assert.strictEqual(invertedPixels, true, "Dark background must be inverted to light background");
    } finally {
      globalThis.document = origDoc;
      globalThis.Image = origImg;
    }
  });

  await t.test("White Document Protection: white background document is NOT inverted", async () => {
    const origDoc = globalThis.document;
    const origImg = globalThis.Image;

    try {
      let invertedPixels = false;

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            // Simulate white background (luma = 255)
            for (let i = 0; i < data.length; i += 4) {
              data[i] = 255;
              data[i + 1] = 255;
              data[i + 2] = 255;
              data[i + 3] = 255;
            }
            return { data };
          },
          putImageData: (imgData) => {
            // If inverted, 255 -> 0
            if (imgData.data[0] < 50) {
              invertedPixels = true;
            }
          }
        }),
        toDataURL: () => "data:image/png;base64,mockWhiteDoc"
      };

      globalThis.document = {
        createElement: (tag) => (tag === "canvas" ? mockCanvas : {})
      };

      globalThis.Image = class {
        constructor() {
          this.width = 1024;
          this.height = 768;
          setTimeout(() => {
            if (typeof this.onload === "function") this.onload();
          }, 0);
        }
      };

      const result = await enhanceImageForOcr("data:image/png;base64,mockDoc");
      assert.strictEqual(result, "data:image/png;base64,mockWhiteDoc");
      assert.strictEqual(invertedPixels, false, "White background document must NEVER be inverted");
    } finally {
      globalThis.document = origDoc;
      globalThis.Image = origImg;
    }
  });

  await t.test("Colored Spreadsheet Cell: normalizes saturated yellow/colored cell to perceptual grayscale to protect Otsu thresholding", async () => {
    const origDoc = globalThis.document;
    const origImg = globalThis.Image;

    try {
      let putData = null;

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            // Simulate yellow cell: R=255, G=228, B=130 (expected luma = ~225)
            for (let i = 0; i < data.length; i += 4) {
              data[i] = 255;
              data[i + 1] = 228;
              data[i + 2] = 130;
              data[i + 3] = 255;
            }
            return { data };
          },
          putImageData: (imgData) => {
            putData = imgData.data;
          }
        }),
        toDataURL: () => "data:image/png;base64,mockGrayscaleYellow"
      };

      globalThis.document = {
        createElement: (tag) => (tag === "canvas" ? mockCanvas : {})
      };

      globalThis.Image = class {
        constructor() {
          this.width = 1024;
          this.height = 319;
          setTimeout(() => this.onload?.(), 0);
        }
      };

      const result = await enhanceImageForOcr("data:image/png;base64,mockYellowTable");
      assert.strictEqual(result, "data:image/png;base64,mockGrayscaleYellow");
      assert.ok(putData !== null, "Canvas putImageData must be called");
      // Verify R, G, B are equal to calculated luma (~225)
      const expectedLuma = Math.round(0.299 * 255 + 0.587 * 228 + 0.114 * 130);
      assert.strictEqual(putData[0], expectedLuma);
      assert.strictEqual(putData[1], expectedLuma);
      assert.strictEqual(putData[2], expectedLuma);
    } finally {
      globalThis.document = origDoc;
      globalThis.Image = origImg;
    }
  });

  await t.test("Single line snippet preserves native resolution when 2x would exceed the OCR limit", async () => {
    const origDoc = globalThis.document;
    const origImg = globalThis.Image;

    try {
      let drawnW = 0;
      let drawnH = 0;
      let canvasW = 0;
      let canvasH = 0;
      let recordedCanvasW = 0;
      let recordedCanvasH = 0;
      let paddingWhite = false;

      const mockCanvas = {
        set width(val) { canvasW = val; },
        get width() { return canvasW; },
        set height(val) { canvasH = val; },
        get height() { return canvasH; },
        getContext: () => ({
          drawImage: (img, x, y, w, h) => {
            drawnW = w;
            drawnH = h;
            recordedCanvasW = canvasW;
            recordedCanvasH = canvasH;
          },
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            // Simulate light document background
            for (let i = 0; i < data.length; i += 4) {
              data[i] = 245;
              data[i + 1] = 245;
              data[i + 2] = 245;
              data[i + 3] = 255;
            }
            return { data };
          },
          putImageData: (imgData) => {
            // Check that padding border pixels are set to 255
            if (imgData.data[0] === 255 && imgData.data[1] === 255 && imgData.data[2] === 255) {
              paddingWhite = true;
            }
          }
        }),
        toDataURL: () => "data:image/png;base64,mockPaddedSnippet"
      };

      globalThis.document = {
        createElement: (tag) => (tag === "canvas" ? mockCanvas : {})
      };

      globalThis.Image = class {
        constructor() {
          this.width = 1024;
          this.height = 59;
          setTimeout(() => {
            if (typeof this.onload === "function") this.onload();
          }, 0);
        }
      };

      const result = await enhanceImageForOcr("data:image/png;base64,snippet");
      assert.strictEqual(result, "data:image/png;base64,mockPaddedSnippet");
      assert.strictEqual(drawnW, 1024, "A wide snippet must not be fractionally upscaled");
      assert.strictEqual(drawnH, 59);
      assert.strictEqual(recordedCanvasW, 1096, "Padding fits within the 1600px admission limit");
      assert.strictEqual(recordedCanvasH, 131);
      assert.strictEqual(paddingWhite, true, "Padding pixels must be pure white for Leptonica baseline recognition");
    } finally {
      globalThis.document = origDoc;
      globalThis.Image = origImg;
    }
  });

  await t.test("Wide Strip Segmentation: ignores normal images and segments wide strips with gaps", async () => {
    const { getWideStripSegments } = await import("../../src/offscreen/image-enhancer.js");

    const origDoc = globalThis.document;
    const origImg = globalThis.Image;

    try {
      // 1. Normal aspect ratio (500x400) -> returns null
      globalThis.Image = class {
        constructor() {
          this.width = 500;
          this.height = 400;
          setTimeout(() => this.onload?.(), 0);
        }
      };
      const resNormal = await getWideStripSegments("data:image/png;base64,normal");
      assert.strictEqual(resNormal, null, "Normal document image must NOT be segmented");

      // 2. Wide strip (1000x60) with a 30px gap in the middle -> returns 2 segments
      globalThis.Image = class {
        constructor() {
          this.width = 1000;
          this.height = 60;
          setTimeout(() => this.onload?.(), 0);
        }
      };

      const mockCtx = {
        drawImage: () => {},
        fillRect: () => {},
        getImageData: (x, y, w, h) => {
          // Pixel data: columns 450 to 500 are pure white (luma 255)
          const data = new Uint8ClampedArray(w * h * 4);
          for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
              const idx = (py * w + px) * 4;
              const isWhiteCol = px >= 450 && px <= 500;
              const val = isWhiteCol ? 255 : 50;
              data[idx] = val;
              data[idx + 1] = val;
              data[idx + 2] = val;
              data[idx + 3] = 255;
            }
          }
          return { data };
        }
      };

      globalThis.document = {
        createElement: (tag) => (tag === "canvas" ? {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
          toDataURL: () => "data:image/png;base64,mockSegment"
        } : {})
      };

      const resWide = await getWideStripSegments("data:image/png;base64,wide");
      assert.ok(Array.isArray(resWide), "Wide strip with gaps must return array of segments");
      assert.strictEqual(resWide.length, 2, "Must split into exactly 2 segments across gap");
    } finally {
      globalThis.document = origDoc;
      globalThis.Image = origImg;
    }
  });
});

