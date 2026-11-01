import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import { SheetGridCellEditor, type CellFormulaEditorProps } from '@grid/SheetGridCellEditor';
import type { CellEditSession, CellTarget } from '@grid/cellInteractionContracts';
import { errorCellText, type ErrorReferenceHover } from './errorCellText';
import { allocateErrorReferenceColors, errorReferenceKey } from './errorReferenceColors';
import type { WorkbookError } from './workbookErrors';

export function ErrorListCell({ error, column, selected, onSelect, onMove, onNavigate, onReferenceHover, referenceColors, onInspectReferences }: {
  error: WorkbookError; column: number; selected: boolean;
  onSelect: () => void;
  onMove: (rows: number, columns: number, wrap?: boolean) => void;
  onNavigate: (target: CellTarget) => void;
  onReferenceHover: (owner: object, hover: ErrorReferenceHover) => void;
  referenceColors: ReadonlyMap<string, string>;
  onInspectReferences: (references: readonly FormulaInspectionReference[]) => void;
}) {
  const anchor = useRef<HTMLTableCellElement | null>(null);
  const hoverOwner = useRef({});
  const hoverCallback = useRef(onReferenceHover);
  hoverCallback.current = onReferenceHover;
  const [editing, setEditing] = useState<CellEditSession | null>(null);
  const inspecting = editing !== null;
  const document = useMemo(() => errorCellText(error, column, inspecting), [error, column, inspecting]);
  useLayoutEffect(() => () => hoverCallback.current(hoverOwner.current, null), [document]);
  const palette = useMemo(() => allocateErrorReferenceColors(document.references, referenceColors), [document, referenceColors]);
  const colors = useMemo(() => new Map(document.references.map((reference) => [reference.sourceSpan.start, palette.get(errorReferenceKey(reference))!])), [document, palette]);
  const hover = useCallback((reference: FormulaInspectionReference | undefined, element?: HTMLElement) => {
    onReferenceHover(hoverOwner.current, reference && element ? { reference, element, color: palette.get(errorReferenceKey(reference)) } : null);
  }, [onReferenceHover, palette]);
  const Editor = useCallback((props: CellFormulaEditorProps) => <FormulaEditorPanel {...props} readOnlyText onReferenceElementHover={hover} />, [hover]);
  function inspect() {
    onInspectReferences(errorCellText(error, column, true).references);
    setEditing({ target: error, sessionId: Date.now(), draft: document.raw, readOnly: true, selection: { start: 0, end: 0 } });
  }
  function close(restore: boolean) {
    setEditing(null); onReferenceHover(hoverOwner.current, null);
    if (restore) requestAnimationFrame(() => anchor.current?.focus({ preventScroll: true }));
  }
  function navigate(reference: FormulaInspectionReference) {
    if (reference.target.kind === 'cell' && reference.target.identity) onNavigate({ sheetId: reference.target.sheetId, cell: reference.target.identity });
  }
  const content = [];
  let start = 0;
  for (const reference of document.references) {
    content.push(document.raw.slice(start, reference.displaySpan.start));
    content.push(<span className="error-list-reference" key={reference.displaySpan.start} style={{ color: colors.get(reference.sourceSpan.start) }}
      onMouseEnter={(event) => hover(reference, event.currentTarget)} onMouseLeave={() => hover(undefined)} onClick={(event) => {
        if (event.ctrlKey || event.metaKey) { event.preventDefault(); event.stopPropagation(); navigate(reference); }
      }}>{reference.text}</span>);
    start = reference.displaySpan.end;
  }
  content.push(document.raw.slice(start));
  return <td aria-selected={selected} aria-readonly="true" className={`sheet-grid-cell${selected ? ' sheet-grid-cell-active' : ''}${column === 3 ? ' error-list-trace' : ''}`}
    data-error-selected={selected || undefined} ref={anchor} role="gridcell" tabIndex={selected ? 0 : -1} title={document.raw}
    onFocus={onSelect} onClick={(event) => { if (!event.ctrlKey && !event.metaKey) event.currentTarget.focus({ preventScroll: true }); }} onDoubleClick={inspect}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key.startsWith('Arrow')) {
        event.preventDefault(); event.stopPropagation();
        onMove(event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0, event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
      } else if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); onMove(0, event.shiftKey ? -1 : 1, true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); event.stopPropagation(); onMove(0, event.key === 'Home' ? -column : 3 - column);
      } else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); inspect(); }
      else if (event.key === 'Enter' || event.key === 'F4') {
        event.preventDefault(); event.stopPropagation();
        const reference = document.references[0];
        if (reference) navigate(reference); else inspect();
      }
    }}>
    <span className="error-list-cell-text">{content}</span>
    {editing && <SheetGridCellEditor key={editing.sessionId} anchor={anchor} cellKey={['Cell', 'Error code', 'Error text', 'Stack trace'][column]!} sheetName="Errors"
      editingCell={{ ...editing, draft: document.raw }} interaction={{ FormulaEditor: Editor, updateValue: () => {},
        cancel: () => close(true), commit: (_, restore) => close(Boolean(restore)), suspend: () => close(false),
        commitAndNavigate: (_, request) => { close(false); onMove(request.key === 'Enter' ? (request.shift ? -1 : 1) : 0, request.key === 'Tab' ? (request.shift ? -1 : 1) : 0, request.key === 'Tab'); },
        formulaContext: { resolver: { currentSheetId: error.sheetId, sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined },
          sheetNames: [], inspectionReferences: document.references, referenceColors: colors, onReferenceNavigate: navigate },
      }} />}
  </td>;
}
