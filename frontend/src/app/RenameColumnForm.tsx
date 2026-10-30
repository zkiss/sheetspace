import { useEffect, useRef, useState } from 'react';
import type { RenameColumnTarget } from '@application/core/renameColumn';

export function RenameColumnForm({ target, initialName, onApply, onCancel }: {
  target: RenameColumnTarget;
  initialName: string;
  onApply: (name: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(target.kind === 'ordinary');
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error && !busy) input.current?.focus();
  }, [busy, error]);
  if (!confirmed && target.kind === 'property') return <div>
    <p>This column is defined by data model "{target.modelName}". Rename property "{target.propertyName}" in that model? This change will apply to all sheets bound to the model.</p>
    <button autoFocus type="button" onClick={() => setConfirmed(true)}>Continue</button>
    <button type="button" onClick={onCancel}>Cancel</button>
  </div>;
  return <form className="command-number-form" onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    void onApply(name).then((message) => setError(message ?? ''), () => setError('Could not save the column name.')).finally(() => {
      submitting.current = false;
      setBusy(false);
    });
  }}>
    <label>Column name<input ref={input} autoFocus disabled={busy} value={name} onChange={(event) => { setName(event.target.value); setError(''); }} /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button disabled={busy} type="submit">Apply</button>
    <button disabled={busy} type="button" onClick={onCancel}>Cancel</button>
  </form>;
}
