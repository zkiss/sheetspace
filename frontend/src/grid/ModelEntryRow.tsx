import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DataModel } from '@workbook/core/model';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import type { CellEditSession } from './cellInteractionContracts';
import { SheetGridCellEditor, type SheetGridCellEditorInteraction } from './SheetGridCellEditor';
import './ModelEntryRow.css';

export type EntryCommands = {
  change: (propertyId: string, raw: string) => void;
  leave: (propertyId: string) => void;
  dismiss: (propertyId: string) => void;
  submit: () => Promise<{ firstInvalid?: string }>;
};

export function ModelEntryRow({ model, session, commands, style, columnWidths, editorInteraction, sheetId = '', sheetName = '', onNavigateUp, onEntryFocus }: {
  model: DataModel;
  session: EntrySessionState;
  commands: EntryCommands;
  style?: CSSProperties;
  columnWidths?: readonly number[];
  editorInteraction?: SheetGridCellEditorInteraction;
  sheetId?: string;
  sheetName?: string;
  onNavigateUp?: (columnIndex: number) => void;
  onEntryFocus?: () => void;
}) {
  const cells = useRef(new Map<string, HTMLDivElement>());
  const anchor = useRef<HTMLDivElement | null>(null);
  const submitting = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; initial: string; session: CellEditSession } | null>(null);
  const [feedbackPosition, setFeedbackPosition] = useState<{ left: number; top: number } | null>(null);
  const disabled = session.pending || session.stale || session.retryRequired;
  const focusedProperty = editing?.id ?? selected;

  useEffect(() => {
    if (!focusedProperty || !session.draft.fields[focusedProperty]?.invalid) { setFeedbackPosition(null); return; }
    let frame = 0;
    const update = () => {
      const rect = cells.current.get(focusedProperty)?.getBoundingClientRect();
      if (rect) {
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 288));
        const top = rect.bottom + 64 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 54);
        setFeedbackPosition((previous) => previous?.left === left && previous.top === top ? previous : { left, top });
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [focusedProperty, session.draft.fields]);

  async function submit() {
    if (submitting.current || session.pending || session.stale) return;
    submitting.current = true;
    try {
      const result = await commands.submit();
      if (result.firstInvalid) cells.current.get(result.firstInvalid)?.focus();
    } finally { submitting.current = false; }
  }
  function focusColumn(index: number) { const column = model.columns[index]; if (column) cells.current.get(column.id)?.focus(); }
  function startEditing(id: string, initial?: string) {
    const field = session.draft.fields[id];
    const cell = cells.current.get(id);
    if (!field || !cell || !editorInteraction || disabled) return;
    const value = initial ?? field.raw;
    if (initial !== undefined) commands.change(id, value);
    anchor.current = cell;
    setEditing({ id, initial: field.raw, session: { sessionId: Date.now(), target: { sheetId, cell: { rowId: '__entry__', columnId: id } }, draft: value } });
  }
  function finishEditing(id: string, raw: string, restore: boolean) {
    commands.change(id, raw);
    commands.leave(id);
    setEditing(null);
    if (restore) requestAnimationFrame(() => cells.current.get(id)?.focus());
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>, index: number, id: string) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    event.stopPropagation();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); focusColumn(index + (event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); onNavigateUp?.(index);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
    } else if (event.key === 'Tab') {
      const next = index + (event.shiftKey ? -1 : 1);
      if (next >= 0 && next < model.columns.length) { event.preventDefault(); focusColumn(next); }
    } else if (event.key === 'Enter') {
      event.preventDefault(); void submit();
    } else if (event.key === 'F2') {
      event.preventDefault(); startEditing(id);
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && session.draft.fields[id]) {
      event.preventDefault(); commands.change(id, ''); commands.leave(id);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); startEditing(id, event.key);
    }
  }

  return <div aria-label="New record" className="model-entry-row" role="row" style={style} onPointerDown={(event) => event.stopPropagation()}
    onCopy={(event) => event.stopPropagation()} onCut={(event) => event.stopPropagation()} onPaste={(event) => event.stopPropagation()}>
    <div aria-label="New record row" className="sheet-grid-row-header model-entry-row-header" role="rowheader">+</div>
    {model.columns.map((column, index) => {
      const cellStyle = columnWidths ? { flex: `0 0 ${columnWidths[index]}px` } : undefined;
      const field = session.draft.fields[column.id];
      const isEditing = editing?.id === column.id;
      return <div aria-label={`${column.name} ${field ? 'new record' : 'calculated'}`} aria-invalid={field?.invalid || undefined} aria-readonly={!field || undefined}
        aria-selected={selected === column.id || undefined} className={`model-entry-cell${!field ? ' model-entry-calculated' : ''}${field?.invalid ? ' model-entry-invalid' : ''}${selected === column.id ? ' model-entry-selected' : ''}`}
        style={cellStyle} key={column.id} role="cell" tabIndex={disabled ? -1 : 0}
        ref={(element) => { if (element) cells.current.set(column.id, element); else cells.current.delete(column.id); }}
        onFocus={() => { setSelected(column.id); onEntryFocus?.(); }} onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setSelected((current) => current === column.id ? null : current);
          if (field && !isEditing) commands.leave(column.id);
        }} onKeyDown={(event) => keyDown(event, index, column.id)} onDoubleClick={() => startEditing(column.id)}>
        {field?.raw}
        {isEditing && editorInteraction && <SheetGridCellEditor anchor={anchor} cellKey={column.name} editingCell={editing.session} sheetName={sheetName} interaction={{
          ...editorInteraction,
          updateValue: (raw) => { commands.change(column.id, raw); setEditing((current) => current && { ...current, session: { ...current.session, draft: raw } }); },
          updateView: undefined,
          suspend: (current) => finishEditing(column.id, current.draft, false),
          cancel: () => finishEditing(column.id, editing.initial, true),
          commit: (current, restore) => finishEditing(column.id, current?.draft ?? field?.raw ?? '', Boolean(restore)),
          commitAndNavigate: (current, request) => {
            finishEditing(column.id, current.draft, false);
            if (request.key === 'Enter') void submit();
            else requestAnimationFrame(() => focusColumn(index + (request.shift ? -1 : 1)));
          },
        }} />}
      </div>;
    })}
    {focusedProperty && session.draft.fields[focusedProperty]?.invalid && feedbackPosition && createPortal(<div className="model-entry-feedback" role="alert" style={feedbackPosition}>
      {session.draft.fields[focusedProperty]?.message ?? `Enter a valid ${model.columns.find((column) => column.id === focusedProperty)?.type} value.`}
    </div>, document.body)}
    {!model.columns.some((column) => column.kind === 'manual') && !session.retryRequired && <div role="cell" className="model-entry-submit"><button type="button" disabled={session.pending || session.stale} onClick={() => void submit()}>Save record</button></div>}
    {session.failure && <div className="model-entry-failure" role="alert">{session.failure}{session.retryRequired && <button type="button" onClick={() => void submit()}>Retry saving record</button>}</div>}
  </div>;
}
