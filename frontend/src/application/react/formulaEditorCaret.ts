export function formulaEditorCaret(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  const mirror = document.createElement('div');
  for (const property of [
    'box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-indent', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom',
    'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid',
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const caret = document.createElement('span');
  caret.textContent = '\u200b';
  mirror.append(caret, document.createTextNode(input.value.slice(input.selectionStart)));
  document.body.append(mirror);
  try {
    const position = caret.getBoundingClientRect();
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.45;
    return {
      left: position.left - input.scrollLeft,
      top: position.top - input.scrollTop,
      bottom: position.top - input.scrollTop + lineHeight,
    };
  } finally {
    mirror.remove();
  }
}
