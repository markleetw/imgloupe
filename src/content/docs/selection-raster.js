import { describePixels } from '../shared/image-signature.js';

export function intersectRect(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

// Capture only the selected rectangle into a <=64px preview. Adjacent canvas tiles
// are projected into the same preview rather than discovered and stitched at full size.
export function describeSelection(rect, canvases = document.querySelectorAll('canvas.kix-canvas-tile-content')) {
  if (rect.width < 8 || rect.height < 8) return null;
  const preview = document.createElement('canvas');
  const scale = 64 / Math.max(rect.width, rect.height);
  preview.width = Math.max(8, Math.round(rect.width * scale));
  preview.height = Math.max(8, Math.round(rect.height * scale));
  let area = 0;
  try {
    const context = preview.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    for (const tile of canvases) {
      const screen = tile.getBoundingClientRect();
      const intersection = intersectRect(rect, screen);
      if (!intersection || !screen.width || !screen.height || !tile.width || !tile.height) continue;
      const xRatio = tile.width / screen.width;
      const yRatio = tile.height / screen.height;
      context.drawImage(tile,
        (intersection.left - screen.left) * xRatio, (intersection.top - screen.top) * yRatio,
        intersection.width * xRatio, intersection.height * yRatio,
        (intersection.left - rect.left) * preview.width / rect.width,
        (intersection.top - rect.top) * preview.height / rect.height,
        intersection.width * preview.width / rect.width, intersection.height * preview.height / rect.height);
      area += intersection.width * intersection.height;
    }
    if (area < rect.width * rect.height * 0.95) return null;
    const image = context.getImageData(0, 0, preview.width, preview.height);
    return describePixels({ width: image.width, height: image.height, pixels: image.data });
  } catch {
    return null; // Tainted or unloaded tiles must never select an unrelated image.
  } finally {
    preview.width = preview.height = 0;
  }
}
