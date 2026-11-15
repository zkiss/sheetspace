import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { matchesShortcut } from '@shared/keyboard/keymap';
import type { FunctionDeclaration } from '@application/core/functionCommands';
import type { FunctionResult } from '@application/react/workbookControllerTypes';
import { validateCustomFunction } from '@calculation/customFunctions';
import { parseFormulaSyntax } from '@workbook/formula/syntax';
import { workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import type { CustomFunction, ModelColumnType, Workbook } from '@workbook/core/model';

type Props = {
  initial?: CustomFunction;
  savedName?: string;
  functions: readonly CustomFunction[];
  workbook?: Workbook;
  onCancel: () => void;
  onSave: (draft: FunctionDeclaration, previousName?: string) => Promise<FunctionResult>;
};

const messages: Record<string, string> = {
  'invalid-name': 'Enter a valid function name starting with a letter.',
  'duplicate-name': 'A function with this name already exists.',
  'built-in-name': 'This name belongs to a built-in function.',
  'invalid-parameter-name': 'Enter a valid parameter name starting with a letter.',
  'duplicate-parameter-name': 'Parameter names must be unique.',
  'invalid-parameter-type': 'Choose a valid parameter type.',
  'unknown-function': 'This function no longer exists. Cancel and reopen the manager.',
};

export function FunctionEditor({ initial, savedName, functions, workbook, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<FunctionDeclaration>(() => initial
    ? { name: initial.name, parameters: initial.parameters.map((parameter) => ({ ...parameter })), body: initial.body }
    : { name: '', parameters: [], body: '=' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formulaMode, setFormulaMode] = useState<'light' | 'heavy'>('light');
  const formulaBeforeEdit = useRef(draft.body);
  const formulaInput = useRef<HTMLTextAreaElement>(null);
  const parametersRef = useRef<HTMLFieldSetElement>(null);
  const focusParameter = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusParameter.current === null) return;
    const inputs = parametersRef.current?.querySelectorAll<HTMLInputElement>('input');
    (inputs?.[focusParameter.current] ?? parametersRef.current?.querySelector<HTMLButtonElement>('[data-add-parameter]'))?.focus();
    focusParameter.current = null;
  }, [draft.parameters]);
  const syntax = parseFormulaSyntax(draft.body, { parameters: draft.parameters.map((parameter) => parameter.name) });
  const malformed = syntax.result.kind !== 'formula' || syntax.diagnostics.some((diagnostic) => diagnostic.kind === 'syntax');
  function updateParameter(index: number, update: Partial<FunctionDeclaration['parameters'][number]>) {
    setDraft((current) => ({ ...current, parameters: current.parameters.map((parameter, i) => i === index ? { ...parameter, ...update } : parameter) }));
  }
  function move(index: number, direction: -1 | 1) {
    focusParameter.current = index + direction;
    setDraft((current) => {
      const parameters = [...current.parameters];
      [parameters[index], parameters[index + direction]] = [parameters[index + direction]!, parameters[index]!];
      return { ...current, parameters };
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const validation = validateCustomFunction(draft, functions, savedName ?? initial?.name);
    if (validation) { setError(messages[validation]!); return; }
    setSaving(true);
    try {
      const result = await onSave(draft, savedName ?? initial?.name);
      if (!result.ok) setError(messages[result.reason] ?? 'The function could not be saved. Check your connection and try again.');
    } catch {
      setError('The function could not be saved. Check your connection and try again.');
    } finally { setSaving(false); }
  }
  const resolver = workbook ? workbookFormulaReferenceResolver(workbook, '') : { currentSheetId: '', sheetByQualifier: () => undefined, coordinateAt: () => undefined, addressOf: () => undefined };
  const parameters = draft.parameters.map((parameter) => parameter.name).filter(Boolean);
  return <form className="function-editor" aria-label={initial ? 'Edit function' : 'Create function'} onKeyDownCapture={(event) => { if (matchesShortcut(event, 'dialog-save') && !(event.target instanceof Element && event.target.closest('.formula-editor-panel'))) { event.preventDefault(); event.stopPropagation(); if (!saving) event.currentTarget.requestSubmit(); } }} onSubmit={submit}>
    <div className="function-editor-heading"><h2>{initial ? 'Edit function' : 'Create function'}</h2><p>Define a reusable formula and its inputs.</p></div>
    <label>Function name<input autoFocus disabled={saving} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <fieldset className="function-parameters" disabled={saving} ref={parametersRef}><legend>Parameters</legend>
      {draft.parameters.map((parameter, index) => <div className="function-parameter-row" key={index}>
        <input aria-label={`Parameter ${index + 1} name`} placeholder="Parameter name" value={parameter.name} onChange={(event) => updateParameter(index, { name: event.target.value })} />
        <select aria-label={`Parameter ${index + 1} type`} value={parameter.type} onChange={(event) => updateParameter(index, { type: event.target.value as ModelColumnType })}>
          {(['int', 'float', 'string', 'boolean'] as const).map((type) => <option key={type}>{type}</option>)}
        </select>
        <div className="function-parameter-actions">
          <button aria-label={`Move parameter ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => move(index, -1)} type="button">↑</button>
          <button aria-label={`Move parameter ${index + 1} down`} title="Move down" disabled={index === draft.parameters.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
          <button aria-label={`Remove parameter ${index + 1}`} title="Remove parameter" onClick={() => { focusParameter.current = Math.min(index, draft.parameters.length - 2); setDraft({ ...draft, parameters: draft.parameters.filter((_, i) => i !== index) }); }} type="button">×</button>
        </div>
      </div>)}
      <button className="function-secondary function-add-parameter" data-add-parameter onClick={() => setDraft({ ...draft, parameters: [...draft.parameters, { name: '', type: 'int' }] })} type="button">+ Add parameter</button>
    </fieldset>
    <div className="function-formula-field">
      <div className="function-formula-header"><span>Formula body</span><button className="function-secondary" type="button" disabled={saving} onClick={() => { setFormulaMode((mode) => mode === 'light' ? 'heavy' : 'light'); formulaInput.current?.focus(); }}>{formulaMode === 'light' ? 'Expand editor' : 'Collapse editor'}</button></div>
      <div className={`function-formula-editor function-formula-editor-${formulaMode}`} onFocus={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) formulaBeforeEdit.current = draft.body; }} onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault(); event.stopPropagation();
        if (!saving) { if (formulaMode === 'heavy') setFormulaMode('light'); else onCancel(); }
      }}>
        <FormulaEditorPanel ariaLabel="Formula body" disabled={saving} cellMode={formulaMode} onToggleMode={() => setFormulaMode((mode) => mode === 'light' ? 'heavy' : 'light')}
          onApply={() => setFormulaMode('light')} onCancel={() => { setDraft((current) => ({ ...current, body: formulaBeforeEdit.current })); setFormulaMode('light'); }}
          inputRef={formulaInput} onCommitAndNavigate={(request) => {
            setFormulaMode('light');
            const form = formulaInput.current?.form;
            const controls = [...(form?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)') ?? [])];
            const index = controls.indexOf(formulaInput.current!);
            controls[request.key === 'Tab' && request.shift ? index - 1 : index + 1]?.focus();
          }} onRawChange={(body) => setDraft((current) => ({ ...current, body }))}
          raw={draft.body} resolver={resolver} sheetNames={workbook ? Object.values(workbook.documents).map((sheet) => sheet.name) : []} propertyNames={parameters} parameters={parameters} />
      </div>
      <small>Use @ before parameter names, for example <code>=@amount * 2</code>.</small>
    </div>
    {malformed ? <p>Formula body is malformed. You can save it and correct it later.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {savedName ? <p role="status">The failed save was applied. Continue editing or cancel to keep the saved version.</p> : null}
    {saving ? <p role="status">Saving function…</p> : null}
    <div className="dialog-actions function-editor-actions"><button className="button-secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button><button disabled={saving} type="submit">Save</button></div>
  </form>;
}
