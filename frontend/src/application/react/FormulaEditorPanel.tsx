import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { applyFormulaCompletion, analyzeFormulaEditor, formatFormula, formulaCompletions, indentFormulaSelection, outdentFormulaSelection } from '@application/core/formulaEditorLogic';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';
import { RawFormulaInput } from '@workbook/formula/RawFormulaInput';
import './FormulaEditorPanel.css';

/** The single rich formula surface used by workspace and model editing. */
export function FormulaEditorPanel({ ariaLabel, disabled = false, raw, resolver, sheetNames, propertyNames = [], onApply, onCancel, onRawChange }: {
  ariaLabel: string;
  disabled?: boolean;
  raw: string;
  resolver: FormulaReferenceResolver;
  sheetNames: readonly string[];
  propertyNames?: readonly string[];
  onApply: () => void;
  onCancel: () => void;
  onRawChange: (raw: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const selection = () => ({ start: input.current?.selectionStart ?? raw.length, end: input.current?.selectionEnd ?? raw.length });
  const analysis = useMemo(() => analyzeFormulaEditor(raw, resolver), [raw, resolver]);
  const completions = formulaCompletions(raw, selection(), { sheetNames, propertyNames });
  const setEditor = (next: { raw: string; selection: { start: number; end: number } }) => {
    onRawChange(next.raw);
    requestAnimationFrame(() => input.current?.setSelectionRange(next.selection.start, next.selection.end));
  };
  const acceptCompletion = (index = completionIndex) => {
    const completion = completions[index];
    if (!completion) return;
    const next = applyFormulaCompletion(raw, completion);
    onRawChange(next);
    setCompletionOpen(false);
    requestAnimationFrame(() => input.current?.setSelectionRange(completion.replacement.start + completion.insertText.length, completion.replacement.start + completion.insertText.length));
  };
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (completionOpen && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setCompletionIndex((index) => Math.min(index + 1, completions.length - 1)); return; }
    if (completionOpen && event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setCompletionIndex((index) => Math.max(index - 1, 0)); return; }
    if (completionOpen && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); acceptCompletion(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (completionOpen) setCompletionOpen(false); else onCancel(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onApply(); return; }
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); setEditor(event.shiftKey ? outdentFormulaSelection(raw, selection()) : indentFormulaSelection(raw, selection())); return; }
    if (event.key === 'Enter') event.stopPropagation();
  }
  return <section aria-label={`${ariaLabel} editor`} className="formula-editor-panel" data-workspace-navigation onPointerDown={(event) => event.stopPropagation()}>
    <div className="formula-editor-heading"><strong>Formula editor</strong><span>Ctrl/⌘+Enter applies · Tab indents</span></div>
    <RawFormulaInput aria-label={ariaLabel} className="formula-editor-input" disabled={disabled} onKeyDown={onKeyDown} onSelect={() => { setCompletionIndex(0); setCompletionOpen(completions.length > 0); }} onValueChange={(value) => { onRawChange(value); setCompletionIndex(0); setCompletionOpen(true); }} ref={input} spellCheck={false} value={raw} />
    <div aria-label="Formula syntax" className="formula-editor-syntax">{analysis.tokens.map((token) => <span className={`formula-syntax-token formula-syntax-token-${token.kind}`} key={`${token.sourceSpan.start}-${token.sourceSpan.end}`}>{raw.slice(token.sourceSpan.start, token.sourceSpan.end)}</span>)}</div>
    {completionOpen && completions.length > 0 ? <ul aria-label="Formula completions" className="formula-editor-completions" role="listbox">{completions.map((completion, index) => <li aria-selected={index === completionIndex} key={`${completion.kind}-${completion.label}`} onMouseDown={(event) => { event.preventDefault(); acceptCompletion(index); }} role="option">{completion.label}</li>)}</ul> : null}
    {analysis.diagnostics.length > 0 ? <ul className="formula-editor-diagnostics" role="status">{analysis.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.sourceSpan.start}-${index}`}>{diagnostic.code} at {diagnostic.sourceSpan.start + 1}–{diagnostic.sourceSpan.end}</li>)}</ul> : null}
    <div className="formula-editor-actions"><button disabled={disabled} onClick={() => { const result = formatFormula(raw, selection()); if (result.available) setEditor(result); }} type="button">Format</button><button aria-label="Cancel formula" disabled={disabled} onClick={onCancel} type="button">Cancel formula</button><button disabled={disabled} onClick={onApply} type="button">Apply</button></div>
  </section>;
}
