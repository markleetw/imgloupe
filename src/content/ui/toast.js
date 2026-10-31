/**
 * Status message shown at the bottom of the document.
 * duration 0 keeps the message until the next update; positive durations fade out.
 * Appearance lives in content.css (.imgloupe-toast).
 */

const TOAST_ID = "imgloupe-toast";
const FADE_MS = 250;
let hideTimer = null;
let removeTimer = null;

export function uiToast(message, duration = 3000) {
  if (typeof document === "undefined") return;
  clearTimeout(hideTimer);
  clearTimeout(removeTimer);
  hideTimer = removeTimer = null;

  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "imgloupe-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  // Lift the message above the preview's bottom toolbar while it is open.
  const previewOpen = !!document.querySelector(".viewer-container.viewer-in, .viewer-container:not(.viewer-hide)");
  toast.classList.toggle("imgloupe-toast--above-preview", previewOpen);
  toast.classList.remove("imgloupe-toast--leaving");
  toast.textContent = message;

  if (duration > 0) {
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      toast.classList.add("imgloupe-toast--leaving");
      removeTimer = window.setTimeout(() => {
        removeTimer = null;
        toast.remove();
      }, FADE_MS);
    }, duration);
  }
  return toast;
}
