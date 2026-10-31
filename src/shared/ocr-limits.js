// Shared by content-side preparation and offscreen admission.
export function getOcrDimensions(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid OCR image dimensions');
  const scale = Math.min(1, 1600 / width, 1600 / height, Math.sqrt(2560000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
