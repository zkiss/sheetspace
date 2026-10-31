import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { DataModel } from '@workbook/core/model';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import './ModelEntryRow.css';

type EntryCommands = {
  change: (propertyId: string, raw: string) => void;
  leave: (propertyId: string) => void;
  dismiss: (propertyId: string) => void;
  submit: () => Promise<{ firstInvalid?: string }>;
};

export function ModelEntryRow({ model, session, commands, style }: {
  model: DataModel;
  session: EntrySessionState;
  commands: EntryCommands;
  style?: CSSProperties;
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
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return <div aria-label="New record" className="model-entry-row" role="row" style={style} onKeyDown={keyDown} onPointerDown={(event) => event.stopPropagation()}>
    {model.columns.map((column) => {
      if (column.kind === 'calculated') return <div className="model-entry-cell model-entry-calculated" key={column.id} role="cell" aria-label={`${column.name} calculated`} />;
      const field = session.draft.fields[column.id];
      if (!field) return null;
      return <div className="model-entry-cell" key={column.id} role="cell">
        <input aria-label={`${column.name} new record`} aria-invalid={field.invalid} className={field.invalid ? 'model-entry-invalid' : undefined}
          disabled={session.pending || session.stale || session.retryRequired} value={field.raw}
          ref={(element) => { if (element) inputs.current.set(column.id, element); else inputs.current.delete(column.id); }}
          onChange={(event) => commands.change(column.id, event.target.value)} onBlur={() => commands.leave(column.id)} />
        {field.message && <div className="model-entry-feedback" role="alert">{field.message}
          <button type="button" aria-label={`Dismiss ${column.name} validation`} onClick={() => commands.dismiss(column.id)}>×</button>
        </div>}
      </div>;
    })}
    {session.failure && <div className="model-entry-failure" role="alert">{session.failure}</div>}
  </div>;
}
