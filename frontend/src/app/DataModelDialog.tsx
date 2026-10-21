import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
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
  if (result.reason === 'blocked-persistence-prerequisite') return 'Earlier workbook changes need to be retried before this model can be saved.';
  if (result.reason === 'persistence-failed') return 'The model could not be saved. Review the draft and try again.';
  return 'The model could not be saved.';
}

export function DataModelDialog({ initialModelId, models, onCancel, onRetryFailedSaves, onSave }: {
  initialModelId?: string;
  models: readonly DataModel[];
  onCancel: () => void;
  onRetryFailedSaves?: () => void;
  onSave: (model: DataModel, isNew: boolean) => ModelCommandResult | Promise<ModelCommandResult>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialModel = initialModelId ? models.find((candidate) => candidate.id === initialModelId) : undefined;
  const [draft, setDraft] = useState<Draft | null>(() => (initialModel ? copy(initialModel) : null));
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPropertyIds, setSavedPropertyIds] = useState<ReadonlySet<string>>(() => new Set(initialModel?.columns.map((column) => column.id) ?? []));
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    const result = await onSave({ ...draft, columns: draft.columns }, isNew);
    setSaving(false);
    if (!result.ok) { setError(message(result)); return; }
    setDraft(null); setError('');
  }
  function containFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (draft) setDraft(null); else close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]!.focus();
  }
  return <div className="dialog-backdrop" role="presentation">
    <section aria-label="Data models" aria-modal="true" className="data-model-dialog" onKeyDown={containFocus} ref={dialogRef} role="dialog">
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
        {error ? <div className="form-error" role="alert"><p>{error}</p>{error.includes('need to be retried') ? <button onClick={onRetryFailedSaves} type="button">Retry earlier changes</button> : null}</div> : null}
        {saving ? <p role="status">Saving model…</p> : null}
        <div className="dialog-actions"><button disabled={saving} onClick={() => setDraft(null)} type="button">Cancel</button><button disabled={saving} type="submit">Save</button></div>
      </form>}
    </section>
  </div>;
}
