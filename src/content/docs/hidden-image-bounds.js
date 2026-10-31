// Hidden Docs draggers have no client rect. Map their CSS layout to viewport
// coordinates through their containing block, including scale, border and scroll.
export function getHiddenImageBounds(image) {
  const dragger = image.closest('.kix-embeddedobjectdragger');
  if (!dragger?.parentElement) return null;
  const values = ['left', 'top', 'width', 'height'].map(key => dragger.style[key]);
  if (!values.every(value => /^-?[\d.]+px$/.test(value))) return null;
  const [left, top, width, height] = values.map(parseFloat);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  let block = null;
  for (let parent = dragger.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(style.transform);
      // Rotation, skew and perspective require the canvas-signature fallback.
      if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) return null;
    }
    if (style.perspective !== 'none') return null;
    if (!block && (style.position !== 'static' || style.transform !== 'none' ||
      /layout|paint|strict|content/.test(style.contain) || style.willChange.includes('transform'))) block = parent;
  }
  if (!block) return { left: left - window.scrollX, top: top - window.scrollY, width, height };
  if (!block.offsetWidth || !block.offsetHeight) return null;
  const rect = block.getBoundingClientRect();
  const scaleX = rect.width / block.offsetWidth;
  const scaleY = rect.height / block.offsetHeight;
  return {
    left: rect.left + (block.clientLeft + left - block.scrollLeft) * scaleX,
    top: rect.top + (block.clientTop + top - block.scrollTop) * scaleY,
    width: width * scaleX, height: height * scaleY,
  };
}
