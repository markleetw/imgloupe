// Compare a selected crop with loaded image resources using 8x8 color regions.
// This works on small previews only; document-sized pixel buffers are never allocated.
export function describePixels({ width, height, pixels }) {
  if (!width || !height || pixels.length !== width * height * 4) return null;
  const values = new Float32Array(8 * 8 * 3);
  const counts = new Uint32Array(64);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const row = Math.floor(pixel / width);
    const column = pixel % width;
    const cell = Math.min(7, Math.floor(row * 8 / height)) * 8 + Math.min(7, Math.floor(column * 8 / width));
    const alpha = pixels[pixel * 4 + 3] / 255;
    counts[cell]++;
    for (let channel = 0; channel < 3; channel++) {
      values[cell * 3 + channel] += pixels[pixel * 4 + channel] * alpha + 255 * (1 - alpha);
    }
  }
  for (let index = 0; index < values.length; index++) values[index] /= counts[Math.floor(index / 3)] || 1;
  return { values, aspect: width / height };
}

export function describeBitmap(bitmap) {
  const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(bitmap.width * scale));
  canvas.height = Math.max(8, Math.round(bitmap.height * scale));
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    return describePixels({ width: data.width, height: data.height, pixels: data.data });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export function chooseCandidate(selection, candidates) {
  if (!selection) return null;
  const ranked = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const signature = candidate.signature;
    if (!signature || seen.has(candidate.url) || Math.abs(Math.log(signature.aspect / selection.aspect)) > 0.15) continue;
    seen.add(candidate.url);
    let squared = 0;
    for (let index = 0; index < selection.values.length; index++) {
      squared += (signature.values[index] - selection.values[index]) ** 2;
    }
    ranked.push({ ...candidate, score: Math.sqrt(squared / selection.values.length) / 255 });
  }
  ranked.sort((a, b) => a.score - b.score);
  if (!ranked.length || ranked[0].score > 0.12) return null;
  if (ranked[1] && ranked[1].score - ranked[0].score < 0.02) return null;
  return ranked[0];
}
