import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import type { CellEditSession, CellNavigationRequest } from './cellInteractionContracts';
import './SheetGridCell.css';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '7rem';

export type SheetGridCellEditorInteraction = {
  cancel: (session?: CellEditSession) => void;
  commit: (session?: CellEditSession, restoreFocus?: boolean) => void;
  suspend?: (session: CellEditSession) => void;
  commitAndNavigate: (session: CellEditSession, request: Pick<CellNavigationRequest, 'key' | 'shift'>) => void;
  updateValue: (value: string, session?: CellEditSession) => void;
  updateView?: (selection: { start: number; end: number }, scrollTop: number, session?: CellEditSession) => void;
  formulaContext?: Pick<ComponentProps<typeof FormulaEditorPanel>, 'resolver' | 'sheetNames' | 'propertyNames' | 'referenceValues'>;
};

export function SheetGridCellEditor({ anchor, cellKey, editingCell, interaction, sheetName }: {
  anchor: RefObject<HTMLElement | null>;
  cellKey: string;
  editingCell: CellEditSession;
  interaction: SheetGridCellEditorInteraction;
  sheetName: string;
}) {
  const [isAnchored, setIsAnchored] = useState(false);
  const [mode, setMode] = useState<'light' | 'heavy'>('light');
  const anchorRect = useRef<DOMRect | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const hasFinishedEditing = useRef(false);
  const latest = useRef({ editingCell, interaction });
  latest.current = { editingCell, interaction };
  const lastEditor = useRef<HTMLTextAreaElement | null>(null);
  const attachEditor = useCallback((editor: HTMLTextAreaElement | null) => {
    if (editor) {
      lastEditor.current = editor;
      editorRef.current = editor;
      return;
    }
    const previous = lastEditor.current;
    lastEditor.current = null;
    editorRef.current = null;
    if (!previous || hasFinishedEditing.current) return;
    // Conditional removal after pointer navigation need not emit native blur.
    // Capture the actual node before it disappears through the same atomic path.
    const { editingCell: session, interaction: latestInteraction } = latest.current;
    latestInteraction.suspend?.({ ...session, draft: previous.value,
      selection: { start: previous.selectionStart, end: previous.selectionEnd }, scrollTop: previous.scrollTop });
  }, []);
  const anchorElement = anchor.current;
  const updatePosition = useCallback(() => {
    // Ref replacement during a parent render must not unmount the focused portal.
    if (!anchor.current) return;
    const sheetBody = anchor.current.closest('[data-workspace-sheet-frame]')?.querySelector('.sheet-frame-body');
    const next = (mode === 'heavy' ? sheetBody ?? anchor.current : anchor.current).getBoundingClientRect();
    if (sameRect(anchorRect.current, next)) return;
    anchorRect.current = next;
    // Geometry belongs to the DOM, not the controlled draft. Moving an anchor
    // must not render React (or trigger another layout-effect geometry read).
    if (editorRef.current && panelRef.current) placeEditor(panelRef.current, editorRef.current, next, mode);
    else setIsAnchored(true);
  }, [anchor, mode]);
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
    if (!editor || !panelRef.current || !anchorRect.current) return;
    placeEditor(panelRef.current, editor, anchorRect.current, mode);
  }, [isAnchored, editingCell.draft, mode]);

  function currentSession(): CellEditSession {
    const editor = editorRef.current;
    return editor ? { ...editingCell, draft: editor.value, selection: { start: editor.selectionStart, end: editor.selectionEnd }, scrollTop: editor.scrollTop } : editingCell;
  }

  if (!isAnchored) return null;
  return createPortal(<FormulaEditorPanel
    ariaLabel={`${sheetName} ${cellKey} editor`}
    autoFocus
    cellMode={mode}
    initialView={{ ...(editingCell.selection ?? { start: editingCell.draft.length, end: editingCell.draft.length }), scrollTop: editingCell.scrollTop }}
    inputRef={attachEditor}
    panelRef={panelRef}
    sheetId={editingCell.target.sheetId}
    raw={editingCell.draft}
    resolver={interaction.formulaContext?.resolver ?? { currentSheetId: editingCell.target.sheetId, sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined }}
    sheetNames={interaction.formulaContext?.sheetNames ?? []}
    propertyNames={interaction.formulaContext?.propertyNames}
    referenceValues={interaction.formulaContext?.referenceValues}
    onToggleMode={() => setMode((current) => current === 'light' ? 'heavy' : 'light')}
    onRawChange={(value) => interaction.updateValue(value, editingCell)}
    onViewChange={(view) => interaction.updateView?.({ start: view.start, end: view.end }, view.scrollTop, editingCell)}
    onApply={() => { hasFinishedEditing.current = true; interaction.commit(currentSession(), true); }}
    onCancel={() => { hasFinishedEditing.current = true; interaction.cancel(currentSession()); }}
    onCommitAndNavigate={(request) => { hasFinishedEditing.current = true; interaction.commitAndNavigate(currentSession(), request); }}
    onFocusLeave={(_, destination) => {
      if (hasFinishedEditing.current) return;
      hasFinishedEditing.current = true;
      if (isWorkspaceTransfer(destination)) interaction.suspend?.(currentSession());
      else interaction.commit(currentSession());
    }}
  />, document.body);
}

function isWorkspaceTransfer(destination: EventTarget | null) {
  if (!(destination instanceof Element)) return false;
  return Boolean(destination.closest('[data-workspace-navigation]'));
}

function placeEditor(panel: HTMLElement, editor: HTMLTextAreaElement, rect: DOMRect, mode: 'light' | 'heavy') {
  const heavy = mode === 'heavy';
  const left = heavy ? Math.max(8, Math.min(rect.left, window.innerWidth - 368)) : rect.left;
  const top = heavy ? Math.max(8, Math.min(rect.top, window.innerHeight - 208)) : rect.top;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.maxWidth = `calc(100vw - ${left + 8}px)`;
  panel.style.width = heavy ? `${Math.max(360, rect.width)}px` : cellEditorSizing(editor.value, rect.width).width;
  panel.style.height = heavy ? `${Math.min(Math.max(200, rect.height), window.innerHeight - top - 8)}px` : 'auto';
  editor.style.maxHeight = heavy ? 'none' : CELL_EDITOR_MAX_HEIGHT;
  if (heavy) { editor.style.height = '100%'; editor.style.overflow = 'auto'; }
  else sizeEditorToContent(editor, rect.height);
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
