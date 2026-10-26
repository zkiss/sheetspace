import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DataModel, ModelColumn, ModelColumnType } from '@workbook/core/model';
import type { ModelCommandResult } from '@application/react/useWorkbookController';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { workbookFormulaReferenceResolver, type FormulaReferenceResolver } from '@workbook/formula/reference';
import type { Workbook } from '@workbook/core/model';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { formulaPanelReferenceValues } from './formulaPanelValues';
import { inferModelFormulaType } from './modelFormulaType';
import './DataModelDialog.css';

type Draft = { id: string; name: string; columns: ModelColumn[] };
const types: ModelColumnType[] = ['string', 'int', 'float', 'boolean'];
const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [data-dialog-focus-target], [tabindex]:not([tabindex="-1"])';

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

export function DataModelDialog({ formulaResults = {}, initialModelId, initialPropertyId, models, onCancel, onRetryFailedSaves, onSave, workbook }: {
  formulaResults?: FormulaEvaluationSnapshot;
  initialModelId?: string;
  initialPropertyId?: string;
  models: readonly DataModel[];
  onCancel: () => void;
  onRetryFailedSaves?: () => void;
  onSave: (model: DataModel, isNew: boolean) => ModelCommandResult | Promise<ModelCommandResult>;
  workbook?: Workbook;
}) {
  const formulaWorkbook = workbook ?? { documents: {}, dataModels: {} } as Workbook;
  const dialogRef = useRef<HTMLElement>(null);
  const submissionPending = useRef(false);
  const closing = useRef(false);
  const initialModel = initialModelId ? models.find((candidate) => candidate.id === initialModelId) : undefined;
  const [draft, setDraft] = useState<Draft | null>(() => (initialModel ? copy(initialModel) : null));
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formulaDrafts, setFormulaDrafts] = useState<Readonly<Record<string, string>>>({});
  const [editingFormula, setEditingFormula] = useState<string | null>(null);
  const [formulaMode, setFormulaMode] = useState<'light' | 'heavy'>('light');
  const [savedPropertyIds, setSavedPropertyIds] = useState<ReadonlySet<string>>(() => new Set(initialModel?.columns.map((column) => column.id) ?? []));
  function openCreate() { setDraft(newDraft()); setIsNew(true); setSavedPropertyIds(new Set()); setFormulaDrafts({}); setError(''); }
  function openEdit(model: DataModel) { setDraft(copy(model)); setIsNew(false); setSavedPropertyIds(new Set(model.columns.map((column) => column.id))); setFormulaDrafts({}); setError(''); }
  function close() { closing.current = true; onCancel(); }
  function updateColumn(index: number, update: Partial<ModelColumn>) {
    setDraft((current) => current && { ...current, columns: current.columns.map((column, currentIndex) => {
      if (index !== currentIndex) return column;
      if (update.kind === 'calculated' && column.kind === 'manual') return { ...column, ...update, kind: 'calculated', formula: '' };
      if (update.kind === 'manual') return { id: column.id, name: update.name ?? column.name, kind: 'manual', type: update.type ?? column.type };
      return { ...column, ...update } as ModelColumn;
    }) });
  }
  function removeColumn(index: number) {
    setDraft((current) => current && { ...current, columns: current.columns.filter((_, target) => target !== index) });
    queueMicrotask(() => {
      const dialog = dialogRef.current;
      const properties = [...(dialog?.querySelectorAll<HTMLElement>('.model-property input') ?? [])];
      const property = properties[Math.min(index, properties.length - 1)];
      (property ?? dialog?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'))?.focus();
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || submissionPending.current) return;
    const columns = draft.columns.map((column) => column.kind === 'calculated' && formulaDrafts[column.id] !== undefined ? { ...column, formula: formulaDrafts[column.id]! } : column);
    const submittedDraft = { ...draft, columns: columns.map((column) => column.kind === 'calculated'
      ? { ...column, type: inferModelFormulaType(column.formula, columns, new Set([column.id])) ?? column.type } : { ...column }) };
    const submittedIsNew = isNew;
    submissionPending.current = true;
    setSaving(true);
    let result: ModelCommandResult;
    try {
      result = await onSave(submittedDraft, submittedIsNew);
    } catch {
      result = { ok: false, reason: 'persistence-failed' };
    }
    submissionPending.current = false;
    setSaving(false);
    if (!result.ok) { setError(message(result)); return; }
    setDraft(null); setEditingFormula(null); setFormulaDrafts({}); setError('');
  }
  useEffect(() => {
    function retainDialogFocus(event: FocusEvent) {
      const dialog = dialogRef.current;
      if (!closing.current && dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
      }
    }
    document.addEventListener('focusin', retainDialogFocus);
    return () => document.removeEventListener('focusin', retainDialogFocus);
  }, []);
  useEffect(() => {
    if (saving) dialogRef.current?.querySelector<HTMLElement>('[data-dialog-focus-target]')?.focus();
  }, [saving]);
  useEffect(() => {
    if (!initialPropertyId || !draft) return;
    dialogRef.current?.querySelector<HTMLElement>(`[data-property-id="${initialPropertyId}"] input`)?.focus();
  }, [draft, initialPropertyId]);
  function containFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (saving) return;
      if (draft) setDraft(null); else close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      focusableSelector,
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
    <section aria-label="Data models" aria-modal="true" className="data-model-dialog" data-workspace-navigation onKeyDown={containFocus} ref={dialogRef} role="dialog">
      {!draft ? <>
        <div className="data-model-header"><h2>Data models</h2><button autoFocus onClick={openCreate} type="button">Create model</button></div>
        {models.length === 0 ? <p>No data models yet. Create one to define reusable sheet properties.</p> : <ul className="data-model-list">
          {models.map((model) => <li key={model.id}><span><strong>{model.name}</strong><small>{model.columns.length} properties</small></span><button onClick={() => openEdit(model)} type="button">Edit</button></li>)}
        </ul>}
        <div className="dialog-actions"><button onClick={close} type="button">Close</button></div>
      </> : <form aria-label={isNew ? 'Create data model' : 'Edit data model'} onSubmit={submit}>
        <div className="data-model-header"><h2>{isNew ? 'Create data model' : 'Edit data model'}</h2></div>
        <label>Model name<input autoFocus disabled={saving} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
        <fieldset><legend>Properties</legend>
          {draft.columns.map((column, index) => <div className="model-property" data-property-id={column.id} key={column.id}>
            <div className="model-property-row">
            <input aria-label={`Property ${index + 1} name`} placeholder="Property name" disabled={saving} onChange={(event) => updateColumn(index, { name: event.target.value })} value={column.name} />
            <select aria-label={`Property ${index + 1} type`} disabled={saving} onChange={(event) => {
              const type = event.target.value;
              updateColumn(index, type === 'function' ? { kind: 'calculated' } : { kind: 'manual', type: type as ModelColumnType });
              setEditingFormula(type === 'function' ? column.id : null); setFormulaMode('light');
            }} value={column.kind === 'calculated' ? 'function' : column.type}>{types.map((type) => <option key={type} value={type}>{type}</option>)}<option value="function">Function</option></select>
            {column.kind === 'calculated' ? <div className="model-property-formula-slot">{editingFormula !== column.id ? <button className="model-property-formula-button" disabled={saving} onClick={() => { setEditingFormula(column.id); setFormulaMode('light'); }} type="button" title={column.formula || 'Edit formula'}><span>{column.formula || 'Edit formula…'}</span><small>{inferModelFormulaType(formulaDrafts[column.id] ?? column.formula, draft.columns, new Set([column.id])) ?? 'unknown'}</small></button> : <div className="model-formula-editor"><FormulaEditorPanel ariaLabel={`Property ${index + 1} formula`} autoFocus cellMode={formulaMode} onToggleMode={() => setFormulaMode((mode) => mode === 'light' ? 'heavy' : 'light')} onCommitAndNavigate={() => {
              const formula = formulaDrafts[column.id];
              if (formula !== undefined) updateColumn(index, { formula });
              setFormulaDrafts((current) => { const remaining = { ...current }; delete remaining[column.id]; return remaining; });
              setEditingFormula(null);
            }} disabled={saving} modelOnly onApply={() => {
              const formula = formulaDrafts[column.id];
              if (formula !== undefined) updateColumn(index, { formula });
              setFormulaDrafts((current) => { const remaining = { ...current }; delete remaining[column.id]; return remaining; });
              setEditingFormula(null);
            }} onCancel={() => { setFormulaDrafts((current) => { const remaining = { ...current }; delete remaining[column.id]; return remaining; }); setEditingFormula(null); }} onFocusLeave={() => {
              const formula = formulaDrafts[column.id];
              if (formula !== undefined) updateColumn(index, { formula });
              setFormulaDrafts((current) => { const remaining = { ...current }; delete remaining[column.id]; return remaining; });
              setEditingFormula(null);
            }} onRawChange={(formula) => setFormulaDrafts((current) => ({ ...current, [column.id]: formula }))} propertyNames={draft.columns.map((property) => property.name).filter(Boolean)} raw={formulaDrafts[column.id] ?? column.formula} referenceValues={(identity) => formulaPanelReferenceValues(identity, modelDraftReferenceResolver(formulaWorkbook, draft), formulaResults)} resolver={modelDraftReferenceResolver(formulaWorkbook, draft)} sheetNames={Object.values(formulaWorkbook.documents).map((sheet) => sheet.name)} /></div>}</div> : <span className="model-property-manual" />}
            <div className="model-property-actions"><button aria-label={`Move property ${index + 1} up`} title="Move up" disabled={saving || index === 0} onClick={() => setDraft({ ...draft, columns: draft.columns.map((_, target) => target === index ? draft.columns[index - 1]! : target === index - 1 ? draft.columns[index]! : draft.columns[target]! ) })} type="button">↑</button><button aria-label={`Move property ${index + 1} down`} title="Move down" disabled={saving || index === draft.columns.length - 1} onClick={() => setDraft({ ...draft, columns: draft.columns.map((_, target) => target === index ? draft.columns[index + 1]! : target === index + 1 ? draft.columns[index]! : draft.columns[target]! ) })} type="button">↓</button><button aria-label={`Remove property ${index + 1}`} title="Remove" disabled={saving} onClick={() => removeColumn(index)} type="button">×</button></div>
            </div>
          </div>)}
          <button disabled={saving} onClick={() => setDraft({ ...draft, columns: [...draft.columns, newColumn()] })} type="button">Add property</button>
        </fieldset>
        {!isNew && (draft.columns.some((column) => !savedPropertyIds.has(column.id)) || [...savedPropertyIds].some((id) => !draft.columns.some((column) => column.id === id))) ? <p className="data-model-warning">Removing a property can discard bound data. New replacement properties start empty, even when they reuse a name. Renaming and reordering retain existing property identity.</p> : null}
        {error ? <div className="form-error" role="alert"><p>{error}</p>{error.includes('need to be retried') ? <button onClick={onRetryFailedSaves} type="button">Retry earlier changes</button> : null}</div> : null}
        {saving ? <p data-dialog-focus-target role="status" tabIndex={0}>Saving model…</p> : null}
        <div className="dialog-actions"><button disabled={saving} onClick={() => setDraft(null)} type="button">Cancel</button><button disabled={saving} type="submit">Save</button></div>
      </form>}
    </section>
  </div>;
}

/** Resolves unqualified model formulas against the live declaration, never an arbitrary sheet. */
function modelDraftReferenceResolver(workbook: Workbook, draft: Draft): FormulaReferenceResolver {
  const currentSheetId = `model-draft:${draft.id}`;
  const property = (name: string) => draft.columns.find((column) => column.name === name);
  const actual = (sheetId: string) => workbook.documents[sheetId] ? workbookFormulaReferenceResolver(workbook, sheetId) : undefined;
  return {
    currentSheetId,
    sheetByQualifier: (qualifier) => Object.values(workbook.documents).find((sheet) => sheet.id === qualifier || sheet.name === qualifier)?.id,
    hasNamedColumn: (sheetId, name) => sheetId === currentSheetId ? Boolean(property(name)) : actual(sheetId)?.hasNamedColumn?.(sheetId, name) ?? false,
    coordinateAt: (sheetId, address) => {
      if (sheetId === currentSheetId) {
        const column = draft.columns[address.columnIndex];
        return column && address.rowIndex >= 0 ? { columnId: column.id, rowId: `template-row-${address.rowIndex}` } : undefined;
      }
      return actual(sheetId)?.coordinateAt(sheetId, address);
    },
    addressOf: (sheetId, coordinate) => {
      if (sheetId === currentSheetId) {
        const columnIndex = draft.columns.findIndex((column) => column.id === coordinate.columnId);
        const match = /^template-row-(\d+)$/.exec(coordinate.rowId);
        return columnIndex >= 0 && match ? { columnIndex, rowIndex: Number(match[1]) } : undefined;
      }
      return actual(sheetId)?.addressOf(sheetId, coordinate);
    },
    namedCoordinateAt: (sheetId, name, row) => {
      if (sheetId !== currentSheetId) return actual(sheetId)?.namedCoordinateAt?.(sheetId, name, row);
      const column = property(name);
      return column && row > 0 ? { propertyId: column.id, coordinate: { columnId: column.id, rowId: `template-row-${row - 1}` } } : undefined;
    },
  };
}
