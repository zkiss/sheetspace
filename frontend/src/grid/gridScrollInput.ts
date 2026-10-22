export function logicalUnitsPerRenderedPixel(scrollContainer: HTMLElement, rect: DOMRect) {
  return {
    x: rect.width ? scrollContainer.clientWidth / rect.width : 1,
    y: rect.height ? scrollContainer.clientHeight / rect.height : 1,
  };
}

export function isNativeEditorTarget(target: EventTarget | null) {
  const editor = target instanceof HTMLElement
    ? target.closest<HTMLElement>('textarea, input, [contenteditable]')
    : null;
  return Boolean(editor && (
    editor.matches('textarea, input')
    || editor.getAttribute('contenteditable')?.toLowerCase() !== 'false'
  ));
}
