import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { DataModel } from '@workbook/core/model';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import './ModelEntryRow.css';

export type EntryCommands = {
  change: (propertyId: string, raw: string) => void;
  leave: (propertyId: string) => void;
  dismiss: (propertyId: string) => void;
  submit: () => Promise<{ firstInvalid?: string }>;
};

export function ModelEntryRow({ model, session, commands, style, columnWidths }: {
  model: DataModel;
  session: EntrySessionState;
  commands: EntryCommands;
  style?: CSSProperties;
  columnWidths?: readonly number[];
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current || session.pending || session.stale) return;
    submitting.current = true;
    try {
      const result = await commands.submit();
      if (result.firstInvalid) inputs.current.get(result.firstInvalid)?.focus();
    } finally {
      submitting.current = false;
    }
  }

  function keyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Tab' && event.target instanceof HTMLInputElement) {
      const fields = Array.from(inputs.current.values()).filter((input) => !input.disabled);
      const index = fields.indexOf(event.target);
      const next = fields[index + (event.shiftKey ? -1 : 1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return <div aria-label="New record" className="model-entry-row" role="row" style={style} onKeyDown={keyDown} onPointerDown={(event) => event.stopPropagation()}
    onCopy={(event) => event.stopPropagation()} onCut={(event) => event.stopPropagation()} onPaste={(event) => event.stopPropagation()}>
    {model.columns.map((column, index) => {
      const cellStyle = columnWidths ? { flex: `0 0 ${columnWidths[index]}px` } : undefined;
      if (column.kind === 'calculated') return <div className="model-entry-cell model-entry-calculated" style={cellStyle} key={column.id} role="cell" aria-label={`${column.name} calculated`} />;
      const field = session.draft.fields[column.id];
      if (!field) return null;
      return <div className="model-entry-cell" style={cellStyle} key={column.id} role="cell">
        <input aria-label={`${column.name} new record`} aria-invalid={field.invalid} className={field.invalid ? 'model-entry-invalid' : undefined}
          disabled={session.pending || session.stale || session.retryRequired} value={field.raw}
          ref={(element) => { if (element) inputs.current.set(column.id, element); else inputs.current.delete(column.id); }}
          onChange={(event) => commands.change(column.id, event.target.value)} onBlur={() => commands.leave(column.id)} />
        {field.message && <div className="model-entry-feedback" role="alert">{field.message}
          <button type="button" aria-label={`Dismiss ${column.name} validation`} onClick={() => commands.dismiss(column.id)}>×</button>
        </div>}
      </div>;
    })}
    {session.failure && <div className="model-entry-failure" role="alert">{session.failure}{session.retryRequired && <button type="button" onClick={() => void submit()}>Retry saving record</button>}</div>}
  </div>;
}
