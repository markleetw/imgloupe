/**
 * Tesseract.js Worker Manager
 * Initializes offline WebAssembly engine with chi_tra (Traditional Chinese) + eng (English)
 */

let ocrWorker = null;
let initPromise = null;
let queue = Promise.resolve();
let idleTimer = null;

export function runWithTesseract(task) {
  clearTimeout(idleTimer);
  const result = queue.then(async () => {
    clearTimeout(idleTimer);
    try { return await task(await getTesseractWorker()); }
    finally {
      idleTimer = setTimeout(async () => {
        const worker = ocrWorker;
        ocrWorker = null;
        initPromise = null;
        await worker?.terminate?.();
      }, 60000);
      idleTimer?.unref?.();
    }
  });
  queue = result.catch(() => {});
  return result;
}

export async function getTesseractWorker() {
  if (ocrWorker) return ocrWorker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const workerPath = chrome.runtime.getURL("dist/assets/tesseract/worker.min.js");
      const corePath = chrome.runtime.getURL("dist/assets/tesseract/");
      const langPath = chrome.runtime.getURL("dist/assets/tesseract/lang");

      if (typeof Tesseract === "undefined") {
        throw new Error("Tesseract library failed to load in offscreen document");
      }

      const w = await Tesseract.createWorker("chi_tra+eng", 1, {
        workerPath,
        corePath,
        langPath,
        workerBlobURL: false,
        gzip: true,
        errorHandler: (err) => console.error("[Offscreen OCR Worker Error]", err)
      });

      try {
        await w.setParameters({
          tessjs_create_hocr: "0",
          tessjs_create_tsv: "0",
          tessjs_create_box: "0",
          tessjs_create_unlv: "0",
          tessjs_create_osd: "0"
        });
      } catch {}

      ocrWorker = w;
      return w;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}
