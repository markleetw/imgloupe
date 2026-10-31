/**
 * Line and Word Extractor from Tesseract OCR Result
 * - Filters low-confidence noise lines
 * - Preserves numbers and percentages (e.g. 80.30%, US$ 6,000) with relaxed threshold (35)
 * - Joins adjacent CJK characters without unwanted spaces
 */

export function extractLinesFromResult(result) {
  const keptLines = [];
  const lines = (result && result.data && result.data.lines) || [];

  for (const line of lines) {
    const rawLineText = (line.text || "").trim();
    const hasValidTokens = /[a-zA-Z]{2,}|[\u4e00-\u9fa5]|\d+[.,%]?\d*/.test(rawLineText);
    const minLineConf = hasValidTokens ? 35 : 48;

    if (typeof line.confidence === "number" && line.confidence < minLineConf) {
      continue;
    }

    if (Array.isArray(line.words) && line.words.length > 0) {
      const validWords = line.words.filter((w) => {
        if (typeof w.confidence !== "number") return true;
        const txt = (w.text || "").trim();
        const wordHasCjk = /[\u4e00-\u9fa5]/.test(txt);
        if (wordHasCjk) return w.confidence >= 12;
        if (txt.length <= 1) return w.confidence >= 50;
        return w.confidence >= (hasValidTokens ? 30 : 45);
      });

      if (validWords.length === 0) continue;

      let lineStr = "";
      const isCjk = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

      for (const w of validWords) {
        const wordText = (w.text || "").trim();
        if (!wordText) continue;

        if (!lineStr) {
          lineStr = wordText;
        } else {
          const lastChar = lineStr.slice(-1);
          const nextChar = wordText.charAt(0);
          if (isCjk.test(lastChar) && isCjk.test(nextChar)) {
            lineStr += wordText;
          } else {
            lineStr += " " + wordText;
          }
        }
      }

      if (lineStr.trim()) keptLines.push(lineStr.trim());
    } else if (rawLineText) {
      keptLines.push(rawLineText);
    }
  }

  return keptLines;
}
