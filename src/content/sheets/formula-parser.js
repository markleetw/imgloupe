/**
 * Google Sheets IMAGE() formula reader.
 *
 * Only the literal URL inside IMAGE("https://…") in the visible formula bar
 * counts. Plain links, cell references and other text are ignored, so ZIP
 * export never requests an arbitrary address that happens to appear in a cell.
 */

const FORMULA_BAR_SELECTORS = [
  "#t-formula-bar-input",
  ".cell-input",
  "#formula-bar",
  ".waffle-formula-bar-input"
];
const IMAGE_CALL = /\bIMAGE\(\s*"(https:\/\/[^"\s]+)"/i;

export function parseImageFormulaUrl(formula) {
  const text = String(formula || "").trim();
  if (!text.startsWith("=")) return null;
  const match = IMAGE_CALL.exec(text);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function extractFormulaBarImageUrl() {
  for (const selector of FORMULA_BAR_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const url = parseImageFormulaUrl(element.textContent || element.value || "");
    if (url) return url;
  }
  return null;
}
