import { useRef, useState } from 'react';
import type { RenameColumnTarget } from '@application/core/renameColumn';

export function DeletePropertyForm({ target, onApply, onCancel }: {
  target: Extract<RenameColumnTarget, { kind: 'property' }>;
  onApply: () => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  return <div>
    <p>This column is defined by data model "{target.modelName}". Delete property "{target.propertyName}" from that model? This removes the property and its data from all sheets bound to the model.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button autoFocus disabled={busy} type="button" onClick={() => {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true);
      void onApply().then((message) => setError(message ?? ''), () => setError('Could not delete the property.')).finally(() => { submitting.current = false; setBusy(false); });
    }}>Delete property</button>
    <button disabled={busy} type="button" onClick={onCancel}>Cancel</button>
  </div>;
}
