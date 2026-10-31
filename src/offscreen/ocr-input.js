// One admission limit for URL, raster and snippet inputs, before segmentation or WASM.
import { getOcrDimensions } from '../shared/ocr-limits.js';
export { getOcrDimensions } from '../shared/ocr-limits.js';

export async function fitOcrImage(source) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Cannot decode OCR image'));
    image.src = source;
  });
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const target = getOcrDimensions(width, height);
  if (target.width === width && target.height === height) return source;
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OCR canvas is unavailable');
    context.drawImage(image, 0, 0, target.width, target.height);
    return canvas.toDataURL('image/png');
  } finally {
    canvas.width = canvas.height = 0;
  }
}
