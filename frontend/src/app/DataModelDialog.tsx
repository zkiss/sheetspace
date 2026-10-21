import { useState, type FormEvent } from 'react';
import type { DataModel, ModelColumn, ModelColumnType } from '@workbook/core/model';
import type { ModelCommandResult } from '@application/react/useWorkbookController';
import { RawFormulaInput } from '@workbook/formula/RawFormulaInput';
import './DataModelDialog.css';

type Draft = { id: string; name: string; columns: ModelColumn[] };
const types: ModelColumnType[] = ['string', 'int', 'float', 'boolean'];

function newColumn(): ModelColumn {
  return { id: crypto.randomUUID(), name: '', kind: 'manual', type: 'string' };
}
function newDraft(): Draft { return { id: crypto.randomUUID(), name: '', columns: [newColumn()] }; }
function copy(model: DataModel): Draft { return { ...model, columns: model.columns.map((column) => ({ ...column })) }; }
function message(result: ModelCommandResult): string {
  if (result.ok) return '';
  if (result.reason === 'invalid-model') return 'Enter a model name, unique property names, and a formula for each calculated property.';
  if (result.reason === 'duplicate-model') return 'This model already exists.';
  if (result.reason.startsWith('pending-')) return 'Wait for the current workbook change to finish before saving.';
  return 'The model could not be saved.';
}

export function DataModelDialog({ models, onCancel, onSave }: {
  models: readonly DataModel[];
  onCancel: () => void;
  onSave: (model: DataModel, isNew: boolean) => ModelCommandResult;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [savedPropertyIds, setSavedPropertyIds] = useState<ReadonlySet<string>>(new Set());
  function openCreate() { setDraft(newDraft()); setIsNew(true); setSavedPropertyIds(new Set()); setError(''); }
  function openEdit(model: DataModel) { setDraft(copy(model)); setIsNew(false); setSavedPropertyIds(new Set(model.columns.map((column) => column.id))); setError(''); }
  function close() { onCancel(); }
  function updateColumn(index: number, update: Partial<ModelColumn>) {
    setDraft((current) => current && { ...current, columns: current.columns.map((column, currentIndex) => {
      if (index !== currentIndex) return column;
      if (update.kind === 'calculated' && column.kind === 'manual') return { ...column, ...update, kind: 'calculated', formula: '' };
      if (update.kind === 'manual') return { id: column.id, name: update.name ?? column.name, kind: 'manual', type: update.type ?? column.type };
      return { ...column, ...update } as ModelColumn;
    }) });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const result = onSave({ ...draft, columns: draft.columns }, isNew);
    if (!result.ok) { setError(message(result)); return; }
    setDraft(null); setError('');
  }
  return <div className="dialog-backdrop" role="presentation">
    <section aria-label="Data models" aria-modal="true" className="data-model-dialog" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (draft) setDraft(null); else close();
      }
    }} role="dialog">
      {!draft ? <>
        <div className="data-model-header"><h2>Data models</h2><button autoFocus onClick={openCreate} type="button">Create model</button></div>
        {models.length === 0 ? <p>No data models yet. Create one to define reusable sheet properties.</p> : <ul className="data-model-list">
          {models.map((model) => <li key={model.id}><span><strong>{model.name}</strong><small>{model.columns.length} properties</small></span><button onClick={() => openEdit(model)} type="button">Edit</button></li>)}
        </ul>}
        <div className="dialog-actions"><button onClick={close} type="button">Close</button></div>
      </> : <form aria-label={isNew ? 'Create data model' : 'Edit data model'} onSubmit={submit}>
        <div className="data-model-header"><h2>{isNew ? 'Create data model' : 'Edit data model'}</h2></div>
        <label>Model name<input autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
        <fieldset><legend>Properties</legend>
          {draft.columns.map((column, index) => <div className="model-property" key={column.id}>
            <label>Property name<input aria-label={`Property ${index + 1} name`} onChange={(event) => updateColumn(index, { name: event.target.value })} value={column.name} /></label>
            <label>Kind<select aria-label={`Property ${index + 1} kind`} onChange={(event) => updateColumn(index, { kind: event.target.value as ModelColumn['kind'] })} value={column.kind}><option value="manual">Manual</option><option value="calculated">Calculated</option></select></label>
            <label>Type<select aria-label={`Property ${index + 1} type`} onChange={(event) => updateColumn(index, { type: event.target.value as ModelColumnType })} value={column.type}>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            {column.kind === 'calculated' ? <label>Formula<RawFormulaInput aria-label={`Property ${index + 1} formula`} onValueChange={(formula) => updateColumn(index, { formula })} value={column.formula} /></label> : null}
            <div className="model-property-actions"><button aria-label={`Move property ${index + 1} up`} disabled={index === 0} onClick={() => setDraft({ ...draft, columns: draft.columns.map((_, target) => target === index ? draft.columns[index - 1]! : target === index - 1 ? draft.columns[index]! : draft.columns[target]! ) })} type="button">Up</button><button aria-label={`Move property ${index + 1} down`} disabled={index === draft.columns.length - 1} onClick={() => setDraft({ ...draft, columns: draft.columns.map((_, target) => target === index ? draft.columns[index + 1]! : target === index + 1 ? draft.columns[index]! : draft.columns[target]! ) })} type="button">Down</button><button aria-label={`Remove property ${index + 1}`} onClick={() => setDraft({ ...draft, columns: draft.columns.filter((_, target) => target !== index) })} type="button">Remove</button></div>
          </div>)}
          <button onClick={() => setDraft({ ...draft, columns: [...draft.columns, newColumn()] })} type="button">Add property</button>
        </fieldset>
        {!isNew && (draft.columns.some((column) => !savedPropertyIds.has(column.id)) || [...savedPropertyIds].some((id) => !draft.columns.some((column) => column.id === id))) ? <p className="data-model-warning">Removing a property can discard bound data. New replacement properties start empty, even when they reuse a name. Renaming and reordering retain existing property identity.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button onClick={() => setDraft(null)} type="button">Cancel</button><button type="submit">Save</button></div>
      </form>}
    </section>
  </div>;
}
