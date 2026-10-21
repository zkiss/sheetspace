import { useState } from 'react';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import type { DataModel, SheetDocument } from '@workbook/core/model';

export function SheetModelControls({ commands, models, sheet }: { commands: WorkbookCommands; models: readonly DataModel[]; sheet: SheetDocument }) {
  const [selectedModelId, setSelectedModelId] = useState('');
  const currentModel = models.find((model) => model.id === sheet.modelId);
  return <span className="workspace-model-controls">
    <label>Model for {sheet.name}<select aria-label={`Model for ${sheet.name}`} value={selectedModelId || sheet.modelId || ''} onChange={(event) => setSelectedModelId(event.target.value)}>
      <option value="">No model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    {sheet.modelId ? <><span aria-label={`Bound to ${currentModel?.name ?? 'data model'}`} role="status">Bound: {currentModel?.name ?? 'data model'}</span>
      <button onClick={() => { if (window.confirm('Unbinding makes calculated results editable materialized values.')) commands.unbindSheetFromModel(sheet.id); }} type="button">Unbind model</button>
    </> : <button disabled={!selectedModelId} onClick={() => { if (selectedModelId && window.confirm('Binding maps properties in declaration order, keeps manual inputs where possible, and replaces calculated columns.')) commands.bindSheetToModel(sheet.id, selectedModelId); }} type="button">Bind model</button>}
  </span>;
}
