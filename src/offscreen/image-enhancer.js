/**
 * Image Enhancer for Offline OCR
 * - Adaptive 2x upscaling for small snippets / low-res images to bring Chinese stroke height into Tesseract's optimal range (~30-35px).
 * - Polarity detection & inversion for dark/colored backgrounds with white/light text.
 * - Contrast stretch for photo backgrounds.
 * - Immediate canvas disposal to protect GPU VRAM.
 */

export async function enhanceImageForOcr(imageSource) {
  if (!imageSource || typeof document === "undefined" || typeof Image === "undefined") {
    return imageSource;
  }

  try {
    const img = await loadImageElement(imageSource);
    if (!img || !img.width || !img.height) return imageSource;

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // 1. Adaptive 2x Upscaling for small snippets / cropped single-line images
    // Tesseract LSTM requires character height of ~30-35px.
    // Small cropped boxes (<140px high or <220px high and <350px wide) benefit from 2x scaling.
    let scale = 1;
    if (origH < 140 || (origH < 220 && origW < 350)) {
      scale = 2;
    }
    // 2. Padding margin for small snippets / single lines
    // Leptonica baseline fitting and Otsu binarization require whitespace margins
    // around text lines; tight crops often get rejected without margin.
    const needPadding = origH < 140 || (origH < 220 && origW < 350);
    const pad = needPadding ? 36 : 0;
    scale = Math.min(scale, (1600 - pad * 2) / origW, (1600 - pad * 2) / origH,
      Math.sqrt(2400000 / (origW * origH)));
    if (scale > 1) scale = Math.floor(scale);

    const targetW = Math.round(origW * scale);
    const targetH = Math.round(origH * scale);
    const canvasW = targetW + pad * 2;
    const canvasH = targetH + pad * 2;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return imageSource;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, pad, pad, targetW, targetH);

    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    const data = imgData.data;
    const totalPixels = targetW * targetH;

    // 3. Polarity Detection (Dark/colored background with light/white text)
    // Sample perimeter border pixels from actual image rect (excluding pad)
    let borderLumaSum = 0;
    let borderCount = 0;
    const borderThickness = Math.max(1, Math.min(8, Math.floor(Math.min(targetW, targetH) * 0.05)));

    for (let y = pad; y < pad + targetH; y++) {
      for (let x = pad; x < pad + targetW; x++) {
        if (
          y < pad + borderThickness ||
          y >= pad + targetH - borderThickness ||
          x < pad + borderThickness ||
          x >= pad + targetW - borderThickness
        ) {
          const idx = (y * canvasW + x) * 4;
          const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          borderLumaSum += luma;
          borderCount++;
        }
      }
    }

    const avgBorderLuma = borderCount > 0 ? borderLumaSum / borderCount : 128;

    // Sample overall luminance & bright pixels within image area
    let overallLumaSum = 0;
    let brightPixelCount = 0;
    let sampledCount = 0;
    const stepY = Math.max(1, Math.floor(targetH / 50));
    const stepX = Math.max(1, Math.floor(targetW / 100));

    for (let y = pad; y < pad + targetH; y += stepY) {
      for (let x = pad; x < pad + targetW; x += stepX) {
        const idx = (y * canvasW + x) * 4;
        const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        overallLumaSum += luma;
        if (luma > 180) brightPixelCount++;
        sampledCount++;
      }
    }

    const avgOverallLuma = sampledCount > 0 ? overallLumaSum / sampledCount : 128;
    const brightRatio = sampledCount > 0 ? brightPixelCount / sampledCount : 0;

    // Detect dark background with light text:
    // Case A: Border is dark (< 130)
    // Case B: Overall image is dark (< 115) with bright text elements (> 5% bright pixels)
    const isDarkBackground = avgBorderLuma < 130 || (avgOverallLuma < 115 && brightRatio > 0.05);

    // 4. Luminance normalization across color channels:
    // Tesseract's internal Leptonica binarizer operates on 8bpp grayscale.
    // Colored spreadsheet cells (e.g. pastel yellow / pink) have chromatic channel imbalances
    // (e.g. yellow has high red/green but low blue), which causes Otsu adaptive thresholding
    // to discard text inside colored cells. Setting R=G=B=perceptual luma standardizes the channels.
    for (let y = pad; y < pad + targetH; y++) {
      for (let x = pad; x < pad + targetW; x++) {
        const idx = (y * canvasW + x) * 4;
        const g = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        const val = isDarkBackground ? (255 - g) : g;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
      }
    }

    // 4. Contrast adjustment for inverted/dark background images
    if (isDarkBackground) {
      const contrastFactor = 1.15;
      for (let y = pad; y < pad + targetH; y++) {
        for (let x = pad; x < pad + targetW; x++) {
          const idx = (y * canvasW + x) * 4;
          data[idx] = Math.min(255, Math.max(0, Math.round(((data[idx] - 128) * contrastFactor) + 128)));
          data[idx + 1] = Math.min(255, Math.max(0, Math.round(((data[idx + 1] - 128) * contrastFactor) + 128)));
          data[idx + 2] = Math.min(255, Math.max(0, Math.round(((data[idx + 2] - 128) * contrastFactor) + 128)));
        }
      }
    } else if (needPadding) {
      // For small cropped snippets with low/medium contrast (e.g. white text on photo background or gray numbers),
      // stretch dynamic range to provide crisp separation for Otsu binarization
      let minL = 255, maxL = 0;
      for (let y = pad; y < pad + targetH; y++) {
        for (let x = pad; x < pad + targetW; x++) {
          const idx = (y * canvasW + x) * 4;
          const luma = data[idx];
          if (luma < minL) minL = luma;
          if (luma > maxL) maxL = luma;
        }
      }
      const range = maxL - minL;
      if (range >= 35 && range <= 165) {
        const isLightBorder = avgBorderLuma > 160;
        for (let y = pad; y < pad + targetH; y++) {
          for (let x = pad; x < pad + targetW; x++) {
            const idx = (y * canvasW + x) * 4;
            const norm = (data[idx] - minL) / range;
            const stretched = isLightBorder
              ? Math.min(255, Math.max(0, Math.round(norm * 255)))
              : Math.round(Math.pow(norm, 1.6) * 255);
            data[idx] = stretched;
            data[idx + 1] = stretched;
            data[idx + 2] = stretched;
          }
        }
      }
    }

    // 5. Fill padding margin with clean white (#ffffff) to ensure clean background for Leptonica
    if (pad > 0) {
      for (let y = 0; y < canvasH; y++) {
        for (let x = 0; x < canvasW; x++) {
          if (x < pad || x >= canvasW - pad || y < pad || y >= canvasH - pad) {
            const idx = (y * canvasW + x) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const enhancedDataUrl = canvas.toDataURL("image/png");

    // Immediate cleanup of offscreen canvas to reclaim GPU VRAM
    canvas.width = 0;
    canvas.height = 0;

    return enhancedDataUrl;
  } catch (err) {
    console.warn("[ImgLoupe] Image enhancement error:", err);
    return imageSource;
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Split wide single-line horizontal strips at whitespace gaps to prevent Tesseract LSTM drift.
 * Triggered only for horizontal strips with width >= 320px and height <= 140px (aspect ratio >= 3.5).
 */
export async function getWideStripSegments(imageSource, minGap = 12) {
  try {
    const img = await loadImageElement(imageSource);
    if (!img || !img.width || !img.height) return null;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (h > 140 || w < 320 || w / h < 3.5) {
      return null;
    }

    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    const startY = Math.min(3, Math.floor(h * 0.1));
    const endY = Math.max(h - 3, Math.ceil(h * 0.9));
    const totalSampled = Math.max(1, endY - startY);

    const whiteCols = [];
    for (let x = 0; x < w; x++) {
      let darkCount = 0;
      for (let y = startY; y < endY; y++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 30) continue;
        const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (luma < 205) {
          darkCount++;
        }
      }
      if (darkCount <= Math.max(1, Math.floor(totalSampled * 0.08))) {
        whiteCols.push(x);
      }
    }

    const cutPoints = [];
    let curStart = null;
    for (let i = 0; i < whiteCols.length; i++) {
      const x = whiteCols[i];
      if (curStart === null) curStart = x;
      else if (x !== whiteCols[i - 1] + 1) {
        if (whiteCols[i - 1] - curStart >= minGap) {
          cutPoints.push(Math.round((curStart + whiteCols[i - 1]) / 2));
        }
        curStart = x;
      }
    }
    if (curStart !== null && whiteCols[whiteCols.length - 1] - curStart >= minGap) {
      cutPoints.push(Math.round((curStart + whiteCols[whiteCols.length - 1]) / 2));
    }

    if (cutPoints.length === 0) {
      cvs.width = 0;
      cvs.height = 0;
      return null;
    }

    const segments = [];
    let prevCut = 0;
    for (const cut of cutPoints) {
      if (cut - prevCut > 30) {
        segments.push({ x: prevCut, w: cut - prevCut });
      }
      prevCut = cut;
    }
    if (w - prevCut > 30) {
      segments.push({ x: prevCut, w: w - prevCut });
    }

    if (segments.length <= 1) {
      cvs.width = 0;
      cvs.height = 0;
      return null;
    }

    const results = segments.map((seg) => {
      const pad = 24;
      const segCvs = document.createElement("canvas");
      segCvs.width = seg.w + pad * 2;
      segCvs.height = h + pad * 2;
      const sCtx = segCvs.getContext("2d");
      sCtx.fillStyle = "#ffffff";
      sCtx.fillRect(0, 0, segCvs.width, segCvs.height);
      sCtx.drawImage(img, seg.x, 0, seg.w, h, pad, pad, seg.w, h);
      const dataUrl = segCvs.toDataURL("image/png");
      segCvs.width = 0;
      segCvs.height = 0;
      return dataUrl;
    });

    cvs.width = 0;
    cvs.height = 0;
    return results;
  } catch (err) {
    console.warn("[ImgLoupe] Strip segmentation error:", err);
    return null;
  }
}
