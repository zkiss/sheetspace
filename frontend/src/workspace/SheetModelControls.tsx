import { useEffect, useState } from 'react';
import type { DataModel, SheetDocument } from '@workbook/core/model';

type ModelCommandResult = { ok: boolean; reason?: string };

function commandFailure(result: ModelCommandResult) {
  return result.reason === 'pending-model-transition'
    ? 'Wait for the current data model change to finish.'
    : 'The data model change was not applied.';
}

export function SheetModelControls({ models, onBind, onOpenDataModels, onUnbind, sheet }: {
  models: readonly DataModel[];
  onBind: (sheetId: string, modelId: string) => ModelCommandResult;
  onOpenDataModels: () => void;
  onUnbind: (sheetId: string) => ModelCommandResult;
  sheet: SheetDocument;
}) {
  const [selectedModelId, setSelectedModelId] = useState('');
  const [feedback, setFeedback] = useState('');
  const currentModel = models.find((model) => model.id === sheet.modelId);
  useEffect(() => { setSelectedModelId(''); setFeedback(''); }, [sheet.id]);
  const selectedId = selectedModelId || sheet.modelId || '';
  function bindSelectedModel() {
    if (!selectedId) return;
    const result = onBind(sheet.id, selectedId);
    setFeedback(result.ok ? '' : commandFailure(result));
  }
  function unbindCurrentModel() {
    const result = onUnbind(sheet.id);
    setFeedback(result.ok ? '' : commandFailure(result));
  }
  return <span className="workspace-model-controls">
    <label>Model for {sheet.name}<select aria-label={`Model for ${sheet.name}`} value={selectedId} onChange={(event) => { setSelectedModelId(event.target.value); setFeedback(''); }}>
      <option value="">No model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    {sheet.modelId ? <><span aria-label={`Bound to ${currentModel?.name ?? 'data model'}`} role="status">Bound: {currentModel?.name ?? 'data model'}</span>
      <button onClick={onOpenDataModels} type="button">Edit model</button>
      {selectedId !== sheet.modelId ? <button onClick={() => { if (window.confirm('Rebinding maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.')) bindSelectedModel(); }} type="button">Rebind model</button> : null}
      <button onClick={() => { if (window.confirm('Unbinding makes calculated results editable materialized values.')) unbindCurrentModel(); }} type="button">Unbind model</button>
    </> : <button disabled={!selectedId} onClick={() => { if (selectedId && window.confirm('Binding maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.')) bindSelectedModel(); }} type="button">Bind model</button>}
    {feedback ? <span role="alert">{feedback}</span> : null}
  </span>;
}
