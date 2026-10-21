import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { parseFormulaSyntax } from '@workbook/formula/syntax';
import { RawFormulaInput } from '@workbook/formula/RawFormulaInput';
import type { CellEditSession, CellNavigationRequest } from './cellInteractionContracts';
import './SheetGridCell.css';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '7rem';

export type SheetGridCellEditorInteraction = {
  cancel: () => void;
  commit: (session?: CellEditSession) => void;
  suspend?: (session: CellEditSession) => void;
  commitAndNavigate: (session: CellEditSession, request: Pick<CellNavigationRequest, 'key' | 'shift'>) => void;
  updateValue: (value: string) => void;
  updateView?: (selection: { start: number; end: number }, scrollTop: number) => void;
};

export function SheetGridCellEditor({ anchor, cellKey, editingCell, interaction, sheetName }: {
  anchor: RefObject<HTMLElement | null>;
  cellKey: string;
  editingCell: CellEditSession;
  interaction: SheetGridCellEditorInteraction;
  sheetName: string;
}) {
  const [isAnchored, setIsAnchored] = useState(false);
  const anchorRect = useRef<DOMRect | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const hasPlacedInitialCaret = useRef(false);
  const hasFinishedEditing = useRef(false);
  const anchorElement = anchor.current;
  const updatePosition = useCallback(() => {
    // Ref replacement during a parent render must not unmount the focused portal.
    if (!anchor.current) return;
    const next = anchor.current.getBoundingClientRect();
    if (sameRect(anchorRect.current, next)) return;
    anchorRect.current = next;
    // Geometry belongs to the DOM, not the controlled draft. Moving an anchor
    // must not render React (or trigger another layout-effect geometry read).
    if (editorRef.current) placeEditor(editorRef.current, next, highlightRef.current);
    else setIsAnchored(true);
  }, [anchor]);
  useLayoutEffect(() => { updatePosition(); }, [anchorElement, updatePosition]);
  useEffect(() => {
    // The containing cell's ref is attached after this child's layout effect.
    updatePosition();
    // Transforms can animate without scroll/resize notifications.
    let frame = 0;
    const trackAnchor = () => { updatePosition(); frame = requestAnimationFrame(trackAnchor); };
    frame = requestAnimationFrame(trackAnchor);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer = typeof ResizeObserver === 'undefined' || !anchor.current ? null : new ResizeObserver(updatePosition);
    if (anchor.current) observer?.observe(anchor.current);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [anchor, updatePosition]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !anchorRect.current) return;
    if (!hasPlacedInitialCaret.current) {
      const selection = editingCell.selection ?? { start: editor.value.length, end: editor.value.length };
      editor.setSelectionRange(selection.start, selection.end);
      editor.scrollTop = editingCell.scrollTop ?? 0;
      hasPlacedInitialCaret.current = true;
    }
    placeEditor(editor, anchorRect.current, highlightRef.current);
  }, [isAnchored, editingCell.draft, editingCell.scrollTop, editingCell.selection]);

  if (!isAnchored) return null;
  const sizing = cellEditorSizing(editingCell.draft, 0);
  const analysis = parseFormulaSyntax(editingCell.draft, { preserveUnknownFunctions: true });
  return createPortal(<>
    <pre aria-hidden="true" className="sheet-grid-cell-editor-highlight" ref={highlightRef}>
      {analysis.tokens.map((token) => <span
        className={`formula-syntax-token formula-syntax-token-${token.kind}`}
        data-formula-token-kind={token.kind}
        key={`${token.sourceSpan.start}-${token.sourceSpan.end}`}
      >{editingCell.draft.slice(token.sourceSpan.start, token.sourceSpan.end)}</span>)}
    </pre>
    <RawFormulaInput
    aria-label={`${sheetName} ${cellKey} editor`}
    autoFocus
    className="sheet-grid-cell-editor"
    data-max-height={CELL_EDITOR_MAX_HEIGHT}
    data-max-width={CELL_EDITOR_MAX_WIDTH}
    data-multiline-editor={sizing.multiline ? 'true' : undefined}
    data-visible-lines={sizing.visibleLineCount}
    data-workspace-sheet-editor={editingCell.target.sheetId}
     onBlur={(event) => {
       if (hasFinishedEditing.current) return;
       hasFinishedEditing.current = true;
       const session = { ...editingCell, draft: event.currentTarget.value };
       if (isWorkspaceTransfer(event.relatedTarget)) interaction.suspend?.(session);
       else interaction.commit(session);
    }}
     onValueChange={interaction.updateValue}
     onScroll={(event) => {
       syncHighlightScroll(event.currentTarget, highlightRef.current);
       interaction.updateView?.({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }, event.currentTarget.scrollTop);
     }}
     onSelect={(event) => interaction.updateView?.({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }, event.currentTarget.scrollTop)}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        // Only Shift+Enter is a multiline command; other modified Enter paths are reserved.
        if (event.shiftKey && !modified) {
          const editor = event.currentTarget;
          editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
          interaction.updateValue(editor.value);
        } else if (!event.shiftKey && !modified) {
          hasFinishedEditing.current = true;
          interaction.commitAndNavigate({ ...editingCell, draft: event.currentTarget.value }, { key: 'Enter', shift: false });
        }
        return;
      }
      if (event.key === 'Tab' && !modified) {
        event.preventDefault();
        event.stopPropagation();
        hasFinishedEditing.current = true;
        interaction.commitAndNavigate({ ...editingCell, draft: event.currentTarget.value }, { key: 'Tab', shift: event.shiftKey });
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hasFinishedEditing.current = true;
        interaction.cancel();
      }
    }}
    ref={editorRef}
    style={{ maxHeight: CELL_EDITOR_MAX_HEIGHT, overflow: 'auto' }}
    value={editingCell.draft}
    />
  </>, document.body);
}

function isWorkspaceTransfer(destination: EventTarget | null) {
  if (!(destination instanceof Element)) return false;
  return Boolean(destination.closest('[role="cell"], [role="tab"], [role="dialog"], [data-workspace-formula-panel], [data-workspace-navigation]'));
}

function placeEditor(editor: HTMLTextAreaElement, rect: DOMRect, highlight: HTMLPreElement | null) {
  editor.style.left = `${rect.left}px`;
  editor.style.top = `${rect.top}px`;
  editor.style.maxWidth = `min(${CELL_EDITOR_MAX_WIDTH}, calc(100vw - ${rect.left + 12}px))`;
  editor.style.width = cellEditorSizing(editor.value, rect.width).width;
  sizeEditorToContent(editor, rect.height);
  if (highlight) {
    highlight.style.left = editor.style.left;
    highlight.style.top = editor.style.top;
    highlight.style.width = editor.style.width;
    highlight.style.height = editor.style.height;
    highlight.style.maxWidth = editor.style.maxWidth;
    highlight.style.overflow = editor.style.overflow;
    syncHighlightScroll(editor, highlight);
  }
}

function syncHighlightScroll(editor: HTMLTextAreaElement, highlight: HTMLPreElement | null) {
  if (!highlight) return;
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

function sameRect(left: DOMRect | null, right: DOMRect) {
  return left && left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height;
}

function sizeEditorToContent(editor: HTMLTextAreaElement, minimumHeight: number) {
  editor.style.height = '0px';
  const style = getComputedStyle(editor);
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const maxHeight = style.maxHeight.endsWith('rem') ? Number.parseFloat(style.maxHeight) * rootFontSize : Number.parseFloat(style.maxHeight) || 112;
  editor.style.height = `${Math.min(Math.max(24, minimumHeight, editor.scrollHeight), maxHeight)}px`;
  editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : 'hidden';
  editor.style.overflowX = editor.scrollWidth > editor.clientWidth ? 'auto' : 'hidden';
}

function cellEditorSizing(value: string, minimumWidth: number) {
  const lines = value.split('\n');
  const longestLineLength = Math.max(...lines.map((line) => line.length), 0);
  const visibleLineCount = Math.min(Math.max(lines.length, 1), 8);
  const visibleColumnCount = Math.min(Math.max(longestLineLength + 2, 1), 64);
  return {
    multiline: lines.length > 1, visibleLineCount,
    width: `min(${CELL_EDITOR_MAX_WIDTH}, max(${minimumWidth}px, ${visibleColumnCount}ch))`,
  };
}
