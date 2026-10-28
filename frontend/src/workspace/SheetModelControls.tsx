import { useState } from 'react';
import type { DataModel, SheetDocument } from '@workbook/core/model';

type ModelCommandResult = { ok: true } | { ok: false; reason: string };
type ModelCommandSubmission = { result: ModelCommandResult; completion: Promise<ModelCommandResult> };

function failureMessage(result: { ok: false; reason: string }) {
  if (result.reason === 'persistence-failed') return 'The data model change was not saved. Try again.';
  if (result.reason.startsWith('pending-')) return 'Wait for the current data model change to finish.';
  return 'The data model change was not applied.';
}

export function SheetModelControls({ models, onBind, onOpenDataModels, onUnbind, sheet, initialAction }: {
  models: readonly DataModel[];
  onBind: (sheetId: string, modelId: string) => ModelCommandSubmission;
  onOpenDataModels: (modelId: string) => void;
  onUnbind: (sheetId: string) => ModelCommandSubmission;
  sheet: SheetDocument;
  initialAction?: 'unbind';
}) {
  const [selectedModelId, setSelectedModelId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<'bind' | 'rebind' | 'unbind' | null>(initialAction ?? null);
  const boundModelId = sheet.modelId;
  const currentModel = models.find((model) => model.id === boundModelId);
  const selectedId = selectedModelId || boundModelId || '';

  // A submission reports its outcome through completion, so a rejected persistence
  // never reaches the user as a success.
  function report(command: ModelCommandSubmission) {
    if (!command.result.ok) {
      setFeedback(failureMessage(command.result));
      return;
    }
    setPending(true);
    setFeedback('');
    void command.completion.then((result) => {
      setPending(false);
      setFeedback(result.ok ? '' : failureMessage(result));
    });
  }

  function bindModel(modelId: string) {
    report(onBind(sheet.id, modelId));
  }

  return <span className="workspace-model-controls">
    <label>Model for {sheet.name}<select aria-label={`Model for ${sheet.name}`} disabled={pending} value={selectedId} onChange={(event) => { setSelectedModelId(event.target.value); setFeedback(''); setConfirmation(null); }}>
      <option value="">No model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    {boundModelId ? <><span aria-label={`Bound to ${currentModel?.name ?? 'data model'}`} role="status">Bound: {currentModel?.name ?? 'data model'}</span>
      <button data-workspace-navigation onClick={() => onOpenDataModels(boundModelId)} type="button">Edit model</button>
      {selectedId !== boundModelId ? <button disabled={pending} onClick={() => setConfirmation('rebind')} type="button">Rebind model</button> : null}
      <button disabled={pending} onClick={() => setConfirmation('unbind')} type="button">Unbind model</button>
    </> : <button disabled={!selectedId || pending} onClick={() => setConfirmation('bind')} type="button">Bind model</button>}
    {confirmation ? <span className="sheet-model-confirmation" role="group" aria-label="Confirm model change">
      <span>{confirmation === 'unbind' ? 'Unbinding makes calculated results editable materialized values.' : `${confirmation === 'bind' ? 'Binding' : 'Rebinding'} maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.`}</span>
      <span className="sheet-model-confirmation-actions"><button onClick={() => setConfirmation(null)} type="button">Cancel</button><button onClick={() => {
        if (confirmation === 'unbind') report(onUnbind(sheet.id));
        else if (selectedId) bindModel(selectedId);
        setConfirmation(null);
      }} type="button">Confirm {confirmation}</button></span>
    </span> : null}
    {pending ? <span role="status">Saving data model change…</span> : null}
    {feedback ? <span role="alert">{feedback}</span> : null}
  </span>;
}
