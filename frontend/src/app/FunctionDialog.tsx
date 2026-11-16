import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CustomFunction, Workbook } from '@workbook/core/model';
import type { FunctionDeclaration } from '@application/core/functionCommands';
import type { FunctionResult } from '@application/react/workbookControllerTypes';
import { matchesShortcut } from '@shared/keyboard/keymap';
import { FunctionEditor } from './FunctionEditor';
import './DataModelDialog.css';
import './FunctionDialog.css';

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

type Props = {
  functions: readonly CustomFunction[];
  workbook?: Workbook;
  saveStatus?: 'saved' | 'saving' | 'failed';
  hasPendingSaves?: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSave: (draft: FunctionDeclaration, previousName?: string) => Promise<FunctionResult>;
  onDelete: (name: string) => Promise<FunctionResult>;
};

export function FunctionDialog({ functions, workbook, saveStatus = 'saved', hasPendingSaves = saveStatus === 'saving', onClose, onRetry, onSave, onDelete }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<CustomFunction | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedSave, setFailedSave] = useState<{ name: string; previous?: CustomFunction } | null>(null);
  const [savedName, setSavedName] = useState<string>();
  const [focusAfterDelete, setFocusAfterDelete] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const recovery = useRef<((result: { ok: boolean; functions: readonly CustomFunction[] }) => void) | null>(null);
  useEffect(() => {
    if (!recovering || hasPendingSaves) return;
    recovery.current?.({ ok: saveStatus === 'saved', functions });
    recovery.current = null;
    setRecovering(false);
  }, [recovering, saveStatus, hasPendingSaves, functions]);
  useEffect(() => () => {
    recovery.current?.({ ok: false, functions: [] });
    recovery.current = null;
  }, []);
  function recover() {
    if (saveStatus !== 'failed') return Promise.resolve({ ok: true, functions });
    return new Promise<{ ok: boolean; functions: readonly CustomFunction[] }>((resolve) => {
      recovery.current = resolve;
      onRetry();
      setRecovering(true);
    });
  }
  useEffect(() => {
    if (!failedSave || saveStatus !== 'saved') return;
    const saved = functions.find((fn) => fn.name.toLowerCase() === failedSave.name.toLowerCase());
    if (saved && saved !== failedSave.previous) {
      setSavedName(saved.name);
      setFailedSave(null);
    }
  }, [failedSave, functions, saveStatus]);
  useEffect(() => {
    if (focusAfterDelete && !busy) {
      ref.current?.querySelector<HTMLElement>(focusable)?.focus();
      setFocusAfterDelete(false);
    }
  }, [busy, focusAfterDelete, functions]);
  function cancelDraft() { setDraft(null); setFailedSave(null); setSavedName(undefined); }
  useEffect(() => {
    const retainFocus = (event: FocusEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.querySelector<HTMLElement>(focusable)?.focus();
    };
    document.addEventListener('focusin', retainFocus);
    return () => document.removeEventListener('focusin', retainFocus);
  }, []);
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (matchesShortcut(event, 'cancel')) {
      event.preventDefault(); event.stopPropagation();
      if (!busy) { if (draft) cancelDraft(); else onClose(); }
    } else if (event.key === 'Tab') {
      const elements = [...(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [])];
      if (!elements.length) return;
      const index = elements.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      elements[event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length]?.focus();
    }
  }
  async function remove(name: string) {
    setBusy(true); setError('');
    try {
      const recovered = await recover();
      if (!recovered.ok) { setError('The function could not be deleted. Check your connection and try again.'); return; }
      if (!recovered.functions.some((fn) => fn.name.toLowerCase() === name.toLowerCase())) { setFocusAfterDelete(true); return; }
      const result = await onDelete(name);
      if (!result.ok) setError('The function could not be deleted. Check your connection and try again.');
      else setFocusAfterDelete(true);
    } catch { setError('The function could not be deleted. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation">
    <section aria-label="Functions" aria-modal="true" className="data-model-dialog function-dialog" data-workspace-navigation onKeyDown={keyboard} ref={ref} role="dialog">
      {draft ? <FunctionEditor workbook={workbook} initial={draft === 'new' ? undefined : draft} savedName={savedName} functions={functions} onCancel={cancelDraft} onSave={async (value, previousName) => {
        setBusy(true);
        try {
          const recovered = await recover();
          if (!recovered.ok) return { ok: false, reason: 'persistence-failed' };
          const retried = failedSave && recovered.functions.find((fn) => fn.name.toLowerCase() === failedSave.name.toLowerCase() && fn !== failedSave.previous);
          const previous = recovered.functions.find((fn) => fn.name.toLowerCase() === value.name.toLowerCase());
          const result = await onSave(value, retried ? retried.name : previousName);
          if (result.ok) cancelDraft();
          else if (result.reason === 'persistence-failed') setFailedSave({ name: value.name, previous });
          return result;
        }
        finally { setBusy(false); }
      }} /> : <>
        <div className="function-dialog-header">
          <div><h2>Functions</h2><p>Manage reusable formulas for this workbook.</p></div>
          <button autoFocus disabled={busy} onClick={() => { setError(''); setDraft('new'); }} type="button">Create function</button>
        </div>
        {functions.length ? <ul className="function-list">{functions.map((fn) => <li key={fn.name.toLowerCase()}>
          <div className="function-list-content"><strong><code>{fn.name}({fn.parameters.map((parameter) => `${parameter.name}: ${parameter.type}`).join(', ')})</code></strong><code className="function-list-formula">{fn.body}</code></div>
          <div className="function-list-actions"><button className="function-secondary" disabled={busy} onClick={() => setDraft(fn)} type="button">Edit {fn.name}</button><button className="function-secondary" disabled={busy} onClick={() => void remove(fn.name)} type="button">Delete {fn.name}</button></div>
        </li>)}</ul> : <div className="function-empty"><strong>No functions yet</strong><p>Create a function to reuse a formula across your workbook.</p></div>}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        <div className="function-dialog-footer"><button className="function-secondary" disabled={busy} onClick={onClose} type="button">Close</button></div>
      </>}
    </section>
  </div>;
}
