/**
 * Offscreen Document Lifecycle Manager
 * Ensures that a Chrome MV3 Offscreen Document is active for running Tesseract WebAssembly.
 */

let creatingOffscreenPromise = null;

export async function ensureOffscreenDocument() {
  if (typeof chrome === "undefined" || !chrome.offscreen) return;
  const offscreenUrl = "dist/offscreen/offscreen.html";

  // Check if document already exists via Chrome 116+ hasDocument()
  if (typeof chrome.offscreen.hasDocument === "function") {
    if (await chrome.offscreen.hasDocument()) return;
  } else if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    }).catch(() => []);
    if (contexts && contexts.length > 0) return;
  }

  // Prevent race conditions with concurrent creation requests
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ["WORKERS", "CLIPBOARD"],
    justification: "Local Tesseract OCR processing and clipboard handling with WebAssembly"
  });

  try {
    await creatingOffscreenPromise;
  } catch (err) {
    // If another caller already created it in parallel, ignore the collision
    if (!String(err).includes("Only a single offscreen document may be created")) {
      throw err;
    }
  } finally {
    creatingOffscreenPromise = null;
  }
}
