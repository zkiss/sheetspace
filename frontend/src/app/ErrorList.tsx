import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellTarget } from '@grid/cellInteractionContracts';
import type { WorkbookError } from './workbookErrors';
import { ErrorListCell } from './ErrorListCell';
import { errorCellText, type ErrorReferenceHover } from './errorCellText';
import { allocateErrorReferenceColors } from './errorReferenceColors';
import './ErrorList.css';

export function ErrorList({ errors, open, focusRequest, onClose, onActivate, onNavigate, onReferenceHover }: {
  errors: readonly WorkbookError[];
  open: boolean;
  focusRequest: number;
  onClose: () => void;
  onActivate: (error: WorkbookError) => void;
  onNavigate?: (target: CellTarget) => void;
  onReferenceHover?: (hover: ErrorReferenceHover) => void;
}) {
  const [selection, setSelection] = useState<{ key?: string; column: number }>({ column: 0 });
  const list = useRef<HTMLElement>(null);
  const movementPending = useRef(false);
  const ownsFocus = useRef(false);
  const referenceColors = useMemo(() => allocateErrorReferenceColors(errors.flatMap((error) => [
    ...errorCellText(error, 0).references, ...errorCellText(error, 2).references, ...errorCellText(error, 3, true).references,
  ])), [errors]);
  const selected = errors.find((error) => error.key === selection.key) ?? errors[0];
  const focusSelected = () => list.current?.querySelector<HTMLElement>('[data-error-selected="true"]')?.focus({ preventScroll: true });
  useEffect(() => { if (open) focusSelected(); }, [open, focusRequest]);
  useLayoutEffect(() => {
    if (open && ownsFocus.current && document.activeElement === document.body) focusSelected();
  }, [errors, open]);
  useLayoutEffect(() => {
    if (!movementPending.current) return;
    movementPending.current = false;
    focusSelected();
    list.current?.querySelector<HTMLElement>('[data-error-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selection]);
  useEffect(() => () => onReferenceHover?.(null), [onReferenceHover]);
  useEffect(() => { if (!open) onReferenceHover?.(null); }, [open, onReferenceHover]);
  function move(row: number, column: number, wrap = false) {
    let index = Math.max(0, errors.findIndex((error) => error.key === selected?.key)) + row;
    let nextColumn = selection.column + column;
    if (wrap && nextColumn > 3) { index++; nextColumn = 0; }
    if (wrap && nextColumn < 0) { index--; nextColumn = 3; }
    nextColumn = Math.max(0, Math.min(3, nextColumn));
    const next = errors[Math.max(0, Math.min(errors.length - 1, index))];
    if (!next) return;
    movementPending.current = true;
    setSelection({ key: next.key, column: nextColumn });
  }
  if (!open) return null;
  return <section aria-label="Workbook errors" className="error-list-panel" data-workspace-native-content data-workspace-navigation ref={list}
    onFocusCapture={() => { ownsFocus.current = true; }}
    onBlurCapture={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) ownsFocus.current = false; }}
    onKeyDownCapture={(event) => {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e') {
      event.preventDefault(); event.stopPropagation(); onClose();
    }
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="error-list-header"><strong>Errors <span>{errors.length}</span></strong><span className="error-list-hint">↑↓←→ navigate · F2 inspect / expand · F4 follow cell</span>
      <button aria-label="Close errors" className="error-list-close" title="Close errors (Esc)" type="button" onClick={onClose}>×</button>
    </header>
    <div className="error-list-scroll">
      {errors.length === 0 ? <p className="error-list-empty">No workbook errors.</p> : <table aria-label="Error list" aria-readonly="true" className="error-list-grid" role="grid">
        <colgroup><col className="error-list-cell-column" /><col className="error-list-code-column" /><col className="error-list-text-column" /><col /></colgroup>
        <thead><tr>{['Cell', 'Error code', 'Error text', 'Stack trace'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{errors.map((error) => <tr key={error.key}>{[0, 1, 2, 3].map((column) => <ErrorListCell key={column} error={error} column={column}
          selected={error.key === selected?.key && column === selection.column} onSelect={() => setSelection({ key: error.key, column })} onMove={move}
          referenceColors={referenceColors} onReferenceHover={onReferenceHover} onNavigate={(target) => { if (onNavigate) onNavigate(target); else onActivate(error); }} />)}</tr>)}</tbody>
      </table>}
    </div>
  </section>;
}
