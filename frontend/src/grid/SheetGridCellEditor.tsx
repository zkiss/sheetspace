import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CellEditSession, CellNavigationRequest } from './cellInteractionContracts';
import './SheetGridCell.css';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '7rem';

export type SheetGridCellEditorInteraction = {
  cancel: () => void;
  commit: (session?: CellEditSession) => void;
  commitAndNavigate: (session: CellEditSession, request: Pick<CellNavigationRequest, 'key' | 'shift'>) => void;
  updateValue: (value: string) => void;
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
  const hasPlacedInitialCaret = useRef(false);
  const hasFinishedEditing = useRef(false);
  const updatePosition = () => {
    // Ref replacement during a parent render must not unmount the focused portal.
    if (!anchor.current) return;
    const next = anchor.current.getBoundingClientRect();
    if (sameRect(anchorRect.current, next)) return;
    anchorRect.current = next;
    // Geometry belongs to the DOM, not the controlled draft. Moving an anchor
    // must not render React (or trigger another layout-effect geometry read).
    if (editorRef.current) placeEditor(editorRef.current, next);
    else setIsAnchored(true);
  };
  useLayoutEffect(() => { updatePosition(); });
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
  }, [anchor]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !anchorRect.current) return;
    if (!hasPlacedInitialCaret.current) {
      editor.setSelectionRange(editor.value.length, editor.value.length);
      hasPlacedInitialCaret.current = true;
    }
    placeEditor(editor, anchorRect.current);
  }, [isAnchored, editingCell.draft]);

  if (!isAnchored) return null;
  const sizing = cellEditorSizing(editingCell.draft, 0);
  return createPortal(<textarea
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
      interaction.commit({ ...editingCell, draft: event.currentTarget.value });
    }}
    onChange={(event) => interaction.updateValue(event.target.value)}
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
  />, document.body);
}

function placeEditor(editor: HTMLTextAreaElement, rect: DOMRect) {
  editor.style.left = `${rect.left}px`;
  editor.style.top = `${rect.top}px`;
  editor.style.maxWidth = `min(${CELL_EDITOR_MAX_WIDTH}, calc(100vw - ${rect.left + 12}px))`;
  editor.style.width = cellEditorSizing(editor.value, rect.width).width;
  sizeEditorToContent(editor, rect.height);
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
