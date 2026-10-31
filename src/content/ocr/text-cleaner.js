/**
 * OCR output cleanup.
 *
 * Deliberately conservative: recognized text is copied as the user's data, so
 * this step never rewrites words, dates, identifiers or amounts. It only
 *   1. drops lines that contain no letter or digit at all (rules, borders, dots),
 *   2. removes the spaces Tesseract inserts between CJK characters,
 *   3. fixes o/O → 0 and l/I → 1 inside tokens that are otherwise numbers
 *      (e.g. "8l,379" → "81,379"); tokens with any other letter are untouched, and
 *   4. removes spaces Tesseract inserts inside a URL scheme separator
 *      ("https: //" → "https://"), which never contains spaces in real text.
 */

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const CJK_CHARS = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef";
const CJK_GAP = new RegExp(`([${CJK_CHARS}])[ \\t]+(?=[${CJK_CHARS}])`, "gu");

// Optional sign/currency, then digits mixed only with separators and the
// confusable glyphs, then an optional percent sign or closing parenthesis.
const NUMERIC_TOKEN = /^[-+(]?(?:US\$|NT\$|[$€£¥])?[\d.,oOlI]+%?\)?$/;
const CONFUSABLE_IN_NUMBER = /(?<=\d)[oOlI](?=[\d.,])|(?<=[\d.,])[oOlI](?=\d)/g;
const DIGIT_FOR = { o: "0", O: "0", l: "1", I: "1" };
const SPLIT_URL_SCHEME = /\b(https?)[ \t]*:[ \t]*\/[ \t]*\/(?=\S)/gi;

function repairNumericToken(token) {
  if (!NUMERIC_TOKEN.test(token)) return token;
  if ((token.match(/\d/g) || []).length < 2) return token;
  return token.replace(CONFUSABLE_IN_NUMBER, (glyph) => DIGIT_FOR[glyph]);
}

export function cleanOcrText(text) {
  if (!text) return "";
  const cleaned = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || !HAS_LETTER_OR_DIGIT.test(line)) continue;
    line = line.replace(CJK_GAP, "$1").replace(SPLIT_URL_SCHEME, "$1://");
    line = line.split(/(\s+)/).map((part) => (/\s/.test(part) ? part : repairNumericToken(part))).join("");
    cleaned.push(line.replace(/[ \t]{3,}/g, "  "));
  }
  return cleaned.join("\n");
}
