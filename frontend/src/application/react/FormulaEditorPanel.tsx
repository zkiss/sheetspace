import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { applyFormulaCompletion, analyzeFormulaEditor, formatFormula, formulaCompletions, formulaReferenceHover, indentFormulaSelection, outdentFormulaSelection, referenceIdentityColor, type FormulaEditorSelection, type FormulaReferenceIdentity } from '@application/core/formulaEditorLogic';
import type { FormulaScalarValue } from '@calculation/formulaValue';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';
import { RawFormulaInput } from '@workbook/formula/RawFormulaInput';
import './FormulaEditorPanel.css';

/** The single rich formula surface used by workspace and model editing. */
export function FormulaEditorPanel({ ariaLabel, autoFocus = false, disabled = false, initialView, modelOnly = false, raw, referenceValues, resolver, sheetNames, propertyNames = [], onApply, onCancel, onFocusLeave, onRawChange, onViewChange }: {
  ariaLabel: string; autoFocus?: boolean; disabled?: boolean; initialView?: FormulaEditorSelection & { scrollTop?: number }; modelOnly?: boolean; raw: string;
  referenceValues?: (identity: FormulaReferenceIdentity) => FormulaScalarValue | readonly FormulaScalarValue[] | undefined;
  resolver: FormulaReferenceResolver; sheetNames: readonly string[]; propertyNames?: readonly string[]; onApply: () => void; onCancel: () => void; onRawChange: (raw: string) => void;
  onFocusLeave?: (view: FormulaEditorSelection & { scrollTop: number }) => void;
  onViewChange?: (view: FormulaEditorSelection & { scrollTop: number }) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [hoveredReference, setHoveredReference] = useState<number>();
  const openingView = useRef(initialView);
  const openingRawLength = useRef(raw.length);
  const selection = () => ({ start: input.current?.selectionStart ?? raw.length, end: input.current?.selectionEnd ?? raw.length });
  const analysis = useMemo(() => analyzeFormulaEditor(raw, resolver), [raw, resolver]);
  const formattingAvailable = formatFormula(raw, { start: 0, end: 0 }).available;
  useEffect(() => {
    if (!autoFocus || !input.current) return;
    input.current.focus();
    const view = openingView.current ?? { start: openingRawLength.current, end: openingRawLength.current, scrollTop: 0 };
    input.current.setSelectionRange(view.start, view.end);
    input.current.scrollTop = view.scrollTop ?? 0;
  }, [autoFocus]);
  const completions = formulaCompletions(raw, selection(), { sheetNames, propertyNames });
  const setEditor = (next: { raw: string; selection: FormulaEditorSelection }) => { onRawChange(next.raw); requestAnimationFrame(() => input.current?.setSelectionRange(next.selection.start, next.selection.end)); };
  const acceptCompletion = (index = completionIndex) => {
    const completion = completions[index]; if (!completion) return;
    const next = applyFormulaCompletion(raw, completion); onRawChange(next); setCompletionOpen(false);
    requestAnimationFrame(() => input.current?.setSelectionRange(completion.replacement.start + completion.insertText.length, completion.replacement.start + completion.insertText.length));
  };
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (completionOpen && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setCompletionIndex((index) => Math.min(index + 1, completions.length - 1)); return; }
    if (completionOpen && event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setCompletionIndex((index) => Math.max(index - 1, 0)); return; }
    if (completionOpen && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); acceptCompletion(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (completionOpen && completions.length > 0) setCompletionOpen(false); else onCancel(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onApply(); return; }
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); setEditor(event.shiftKey ? outdentFormulaSelection(raw, selection()) : indentFormulaSelection(raw, selection())); return; }
    if (event.key === 'Enter') event.stopPropagation();
  }
  const reportView = () => { if (input.current) onViewChange?.({ start: input.current.selectionStart, end: input.current.selectionEnd, scrollTop: input.current.scrollTop }); };
  return <section aria-label={`${ariaLabel} editor`} className="formula-editor-panel" data-workspace-navigation onBlur={(event) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (input.current) onFocusLeave?.({ start: input.current.selectionStart, end: input.current.selectionEnd, scrollTop: input.current.scrollTop });
  }} onPointerDown={(event) => event.stopPropagation()}>
    <div className="formula-editor-heading"><strong>Formula editor</strong><span>Ctrl/⌘+Enter applies · Tab indents</span></div>
    <RawFormulaInput aria-label={ariaLabel} className="formula-editor-input" disabled={disabled} onKeyDown={onKeyDown} onScroll={reportView} onSelect={() => { setCompletionIndex(0); setCompletionOpen(completions.length > 0); reportView(); }} onValueChange={(value) => { onRawChange(value); setCompletionIndex(0); setCompletionOpen(formulaCompletions(value, selection(), { sheetNames, propertyNames }).length > 0); }} ref={input} spellCheck={false} value={raw} />
    <div aria-label="Formula syntax" className="formula-editor-syntax">{analysis.tokens.map((token) => {
      const referenceIndex = analysis.references.findIndex((reference) => reference.sourceSpan.start === token.sourceSpan.start && reference.sourceSpan.end === token.sourceSpan.end);
      const referenceColour = referenceIdentityColor(analysis.referenceIdentities[referenceIndex]);
      return <span className={`formula-syntax-token formula-syntax-token-${token.kind}`} key={`${token.sourceSpan.start}-${token.sourceSpan.end}`} onMouseEnter={() => referenceIndex >= 0 && setHoveredReference(referenceIndex)} onMouseLeave={() => setHoveredReference(undefined)} style={referenceColour ? { color: referenceColour } : undefined}>{raw.slice(token.sourceSpan.start, token.sourceSpan.end)}</span>;
    })}</div>
    {hoveredReference !== undefined && analysis.references[hoveredReference] ? <ReferenceHover modelOnly={modelOnly} reference={analysis.references[hoveredReference]} resolver={resolver} values={referenceValues} /> : null}
    {completionOpen && completions.length > 0 ? <ul aria-label="Formula completions" className="formula-editor-completions" role="listbox">{completions.map((completion, index) => <li aria-selected={index === completionIndex} key={`${completion.kind}-${completion.label}`} onMouseDown={(event) => { event.preventDefault(); acceptCompletion(index); }} role="option">{completion.label}</li>)}</ul> : null}
    {analysis.diagnostics.length > 0 ? <ul className="formula-editor-diagnostics" role="status">{analysis.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.sourceSpan.start}-${index}`}>{diagnostic.code} at {diagnostic.sourceSpan.start + 1}–{diagnostic.sourceSpan.end}</li>)}</ul> : null}
    <div className="formula-editor-actions"><button disabled={disabled || !formattingAvailable} onClick={() => { const result = formatFormula(raw, selection()); if (result.available) setEditor(result); }} type="button">Format</button><button aria-label="Cancel formula" disabled={disabled} onClick={onCancel} type="button">Cancel formula</button><button disabled={disabled} onClick={onApply} type="button">Apply</button></div>
  </section>;
}

function ReferenceHover({ modelOnly, reference, resolver, values }: { modelOnly: boolean; reference: Parameters<typeof formulaReferenceHover>[0]; resolver: FormulaReferenceResolver; values?: (identity: FormulaReferenceIdentity) => FormulaScalarValue | readonly FormulaScalarValue[] | undefined }) {
  const hover = formulaReferenceHover(reference, resolver, values ?? (() => undefined), { modelOnly });
  const content = hover.kind === 'model-context' ? 'Value requires a bound-row context.' : hover.kind === 'broken' ? 'Reference error: #REF!' : hover.kind === 'value' ? displayValue(hover.value) : `${hover.values.map(displayValue).join(', ')}${hover.truncated ? '…' : ''}`;
  return <output aria-live="polite" className="formula-editor-hover">{content}</output>;
}
function displayValue(value: FormulaScalarValue): string { return value.kind === 'error' ? value.error : value.kind === 'blank' ? '(blank)' : String(value.value); }
