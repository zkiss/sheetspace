import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { matchesShortcut } from '@shared/keyboard/keymap';
import type { FunctionDeclaration } from '@application/core/functionCommands';
import type { FunctionResult } from '@application/react/workbookControllerTypes';
import { validateCustomFunction } from '@calculation/customFunctions';
import { parseFormulaSyntax } from '@workbook/formula/syntax';
import type { CustomFunction, ModelColumnType } from '@workbook/core/model';

type Props = {
  initial?: CustomFunction;
  savedName?: string;
  functions: readonly CustomFunction[];
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

export function FunctionEditor({ initial, savedName, functions, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<FunctionDeclaration>(() => initial
    ? { name: initial.name, parameters: initial.parameters.map((parameter) => ({ ...parameter })), body: initial.body }
    : { name: '', parameters: [], body: '=' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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
      if (!result.ok) setError(messages[result.reason] ?? 'The function could not be saved. Retry failed saves and try again.');
    } catch {
      setError('The function could not be saved. Retry failed saves and try again.');
    } finally { setSaving(false); }
  }
  return <form aria-label={initial ? 'Edit function' : 'Create function'} onKeyDownCapture={(event) => { if (matchesShortcut(event, 'dialog-save')) { event.preventDefault(); event.stopPropagation(); if (!saving) event.currentTarget.requestSubmit(); } }} onSubmit={submit}>
    <h2>{initial ? 'Edit function' : 'Create function'}</h2>
    <label>Function name<input autoFocus disabled={saving} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <fieldset disabled={saving} ref={parametersRef}><legend>Parameters</legend>
      {draft.parameters.map((parameter, index) => <div className="model-property-row" key={index}>
        <input aria-label={`Parameter ${index + 1} name`} value={parameter.name} onChange={(event) => updateParameter(index, { name: event.target.value })} />
        <select aria-label={`Parameter ${index + 1} type`} value={parameter.type} onChange={(event) => updateParameter(index, { type: event.target.value as ModelColumnType })}>
          {(['int', 'float', 'string', 'boolean'] as const).map((type) => <option key={type}>{type}</option>)}
        </select>
        <button aria-label={`Move parameter ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} type="button">↑</button>
        <button aria-label={`Move parameter ${index + 1} down`} disabled={index === draft.parameters.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
        <button aria-label={`Remove parameter ${index + 1}`} onClick={() => { focusParameter.current = Math.min(index, draft.parameters.length - 2); setDraft({ ...draft, parameters: draft.parameters.filter((_, i) => i !== index) }); }} type="button">×</button>
      </div>)}
      <button data-add-parameter onClick={() => setDraft({ ...draft, parameters: [...draft.parameters, { name: '', type: 'int' }] })} type="button">Add parameter</button>
    </fieldset>
    <label>Formula body<textarea disabled={saving} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
    {malformed ? <p>Formula body is malformed. You can save it and correct it later.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {savedName ? <p role="status">The failed save was applied. Continue editing or cancel to keep the saved version.</p> : null}
    {saving ? <p role="status">Saving function…</p> : null}
    <div className="dialog-actions"><button className="button-secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button><button disabled={saving} type="submit">Save</button></div>
  </form>;
}
