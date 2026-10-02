const NATIVE_EDITOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const NATIVE_BOUNDARY = '[data-workspace-native-content], [role="menu"]';
const CONTROL = 'button, a';
const SHEET_FRAME = '[data-workspace-sheet-frame]';

/** DOM ownership, not React ancestry: a body portal is not sheet/background content. */
export function eventTargetElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
}

export function isNativeEditorTarget(target: EventTarget | null): boolean {
  return !!eventTargetElement(target)?.closest(NATIVE_EDITOR);
}

export function isNativeContentTarget(target: EventTarget | null): boolean {
  return isNativeEditorTarget(target) || !!eventTargetElement(target)?.closest(NATIVE_BOUNDARY);
}

export function isNativeControlTarget(target: EventTarget | null): boolean {
  return isNativeContentTarget(target) || !!eventTargetElement(target)?.closest(CONTROL);
}

export function isSheetTarget(target: EventTarget | null): boolean {
  return !!eventTargetElement(target)?.closest(SHEET_FRAME);
}

export function isBackgroundTarget(target: EventTarget | null, surface: HTMLElement): boolean {
  const element = eventTargetElement(target);
  return !!element && surface.contains(element) && !isNativeControlTarget(element) && !isSheetTarget(element);
}

export function isSheetContextTarget(target: EventTarget | null, frame: HTMLElement): boolean {
  const element = eventTargetElement(target);
  // Sheet-owned non-editing controls (notably the overview button) keep the
  // sheet menu. Native editors and declared UI boundaries take priority.
  return !!element && frame.contains(element) && element.closest(SHEET_FRAME) === frame && !isNativeContentTarget(element);
}

export function isOwnedPortalTarget(target: EventTarget | null, surface: HTMLElement): boolean {
  const element = eventTargetElement(target);
  if (!element || surface.contains(element)) return false;
  const editor = element.closest<HTMLElement>('[data-workspace-sheet-editor]');
  return !!editor && Array.from(surface.querySelectorAll<HTMLElement>(SHEET_FRAME))
    .some((frame) => frame.dataset.sheetId === editor.dataset.workspaceSheetEditor);
}
