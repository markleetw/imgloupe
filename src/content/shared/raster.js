// Re-encode any decodable image blob as PNG, the only image type the async
// clipboard accepts. PNG input and environments without canvas pass through.
export async function blobToPngBlob(blob) {
  if (!blob || blob.type === 'image/png') return blob;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG encoder has no 2D context');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG encoding returned no data');
    return png;
  } finally {
    bitmap.close?.();
    canvas.width = canvas.height = 0;
  }
}
