import { useState } from 'react';
import type { DataModel, SheetDocument } from '@workbook/core/model';

type ModelCommandResult = { ok: true } | { ok: false; reason: string };
type ModelCommandSubmission = { result: ModelCommandResult; completion: Promise<ModelCommandResult> };

function failureMessage(result: { ok: false; reason: string }) {
  if (result.reason === 'persistence-failed') return 'The data model change was not saved. Try again.';
  if (result.reason.startsWith('pending-')) return 'Wait for the current data model change to finish.';
  return 'The data model change was not applied.';
}

export function SheetModelControls({ models, onBind, onOpenDataModels, onUnbind, sheet }: {
  models: readonly DataModel[];
  onBind: (sheetId: string, modelId: string) => ModelCommandSubmission;
  onOpenDataModels: (modelId: string) => void;
  onUnbind: (sheetId: string) => ModelCommandSubmission;
  sheet: SheetDocument;
}) {
  const [selectedModelId, setSelectedModelId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
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
    <label>Model for {sheet.name}<select aria-label={`Model for ${sheet.name}`} disabled={pending} value={selectedId} onChange={(event) => { setSelectedModelId(event.target.value); setFeedback(''); }}>
      <option value="">No model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    {boundModelId ? <><span aria-label={`Bound to ${currentModel?.name ?? 'data model'}`} role="status">Bound: {currentModel?.name ?? 'data model'}</span>
      <button onClick={() => onOpenDataModels(boundModelId)} type="button">Edit model</button>
      {selectedId !== boundModelId ? <button disabled={pending} onClick={() => { if (window.confirm('Rebinding maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.')) bindModel(selectedId); }} type="button">Rebind model</button> : null}
      <button disabled={pending} onClick={() => { if (window.confirm('Unbinding makes calculated results editable materialized values.')) report(onUnbind(sheet.id)); }} type="button">Unbind model</button>
    </> : <button disabled={!selectedId || pending} onClick={() => { if (selectedId && window.confirm('Binding maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.')) bindModel(selectedId); }} type="button">Bind model</button>}
    {pending ? <span role="status">Saving data model change…</span> : null}
    {feedback ? <span role="alert">{feedback}</span> : null}
  </span>;
}
