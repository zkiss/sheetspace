import { referenceIdentityColor, type FormulaReferenceIdentity } from '@workbook/core/referenceIdentity';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref, type RefObject, type MouseEvent } from 'react';
import { applyFormulaCompletion, analyzeFormulaEditor, formatFormula, formulaCompletions, formulaReferenceHover, indentFormulaSelection, outdentFormulaSelection, type FormulaEditorSelection } from '@application/core/formulaEditorLogic';
import type { FormulaScalarValue } from '@calculation/formulaValue';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';
import { RawFormulaInput } from '@workbook/formula/RawFormulaInput';
import { formulaEditorCaret } from './formulaEditorCaret';
import { FormulaEditorPopover } from './FormulaEditorPopover';
import './FormulaEditorPanel.css';
import type { FormulaInspectionReference } from '@reference-navigation/formulaInspection';

/** The single rich formula surface used by workspace and model editing. */
export function FormulaEditorPanel({ ariaLabel, autoFocus = false, disabled = false, initialView, modelOnly = false, raw, referenceValues, resolver, sheetNames, propertyNames = [], onApply, onCancel, onFocusLeave, onRawChange, onViewChange, cellMode, onToggleMode, onCommitAndNavigate, inputRef, panelRef, sheetId, inspectionReferences, referenceColors, onReferenceHover, onReferenceModifierHover, onReferenceNavigate }: {
  ariaLabel: string; autoFocus?: boolean; disabled?: boolean; initialView?: FormulaEditorSelection & { scrollTop?: number }; modelOnly?: boolean; raw: string;
  referenceValues?: (identity: FormulaReferenceIdentity) => FormulaScalarValue | readonly FormulaScalarValue[] | undefined;
  resolver: FormulaReferenceResolver; sheetNames: readonly string[]; propertyNames?: readonly string[]; onApply: () => void; onCancel: () => void; onRawChange: (raw: string) => void;
  onFocusLeave?: (view: FormulaEditorSelection & { scrollTop: number }, destination: EventTarget | null) => void;
  onViewChange?: (view: FormulaEditorSelection & { scrollTop: number }) => void;
  cellMode?: 'light' | 'heavy';
  onToggleMode?: () => void;
  onCommitAndNavigate?: (request: { key: 'Enter' | 'Tab'; shift?: boolean }) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  panelRef?: RefObject<HTMLElement>;
  sheetId?: string;
  inspectionReferences?: readonly FormulaInspectionReference[];
  referenceColors?: ReadonlyMap<number, string>;
  onReferenceHover?: (span: { start: number; end: number } | null) => void;
  onReferenceModifierHover?: (span: { start: number; end: number } | null) => void;
  onReferenceNavigate?: (reference: FormulaInspectionReference) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const attachInput = useCallback((element: HTMLTextAreaElement | null) => {
    (input as { current: HTMLTextAreaElement | null }).current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = element;
  }, [inputRef]);
  const [completionRequest, setCompletionRequest] = useState<{ selection: FormulaEditorSelection; automatic: boolean } | null>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionChosen, setCompletionChosen] = useState(false);
  const [hoveredReference, setHoveredReference] = useState<{ index: number; element: HTMLElement }>();
  const [referenceModifier, setReferenceModifier] = useState(false);
  const completionsId = useId();
  const completionsList = useRef<HTMLUListElement>(null);
  const openingView = useRef(initialView);
  const openingRawLength = useRef(raw.length);
  const selection = () => ({ start: input.current?.selectionStart ?? raw.length, end: input.current?.selectionEnd ?? raw.length });
  const analysis = useMemo(() => analyzeFormulaEditor(raw, resolver), [raw, resolver]);
  const formattingAvailable = formatFormula(raw, { start: 0, end: 0 }).available;
  useEffect(() => {
    if (!autoFocus || !input.current) return;
    input.current.focus({ preventScroll: true });
    const view = openingView.current ?? { start: openingRawLength.current, end: openingRawLength.current, scrollTop: 0 };
    input.current.setSelectionRange(view.start, view.end);
    input.current.scrollTop = view.scrollTop ?? 0;
  }, [autoFocus]);
  const completions = completionRequest
    ? formulaCompletions(raw, completionRequest.selection, { sheetNames, propertyNames, automatic: completionRequest.automatic }) : [];
  const completionOpen = completions.length > 0;
  const setEditor = (next: { raw: string; selection: FormulaEditorSelection }) => { setCompletionRequest(null); onRawChange(next.raw); requestAnimationFrame(() => input.current?.setSelectionRange(next.selection.start, next.selection.end)); };
  useEffect(() => {
    const list = completionsList.current;
    const option = list?.children[completionIndex];
    if (!list || !option) return;
    const bounds = list.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [completionIndex]);
  const acceptCompletion = (index = completionIndex) => {
    const completion = completions[index]; if (!completion) return;
    const next = applyFormulaCompletion(raw, completion); onRawChange(next); setCompletionRequest(null);
    requestAnimationFrame(() => input.current?.setSelectionRange(completion.replacement.start + completion.insertText.length, completion.replacement.start + completion.insertText.length));
  };
  function updateRaw(value: string) {
    const currentSelection = selection();
    const typedNameCharacter = /[A-Za-z0-9_@!'.]/.test(value[currentSelection.start - 1] ?? '');
    const editingPrefix = value.length === raw.length + 1 || (completionRequest && value.length < raw.length);
    setCompletionRequest(typedNameCharacter && editingPrefix ? { selection: currentSelection, automatic: true } : null);
    setCompletionIndex(0);
    setCompletionChosen(false);
    setHoveredReference(undefined);
    onRawChange(value);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    setReferenceModifier(event.ctrlKey || event.metaKey);
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'F4' && onReferenceNavigate) {
      event.preventDefault(); event.stopPropagation();
      const caret = event.currentTarget.selectionStart;
      const reference = inspectionReferences?.find((item) => caret >= item.displaySpan.start && caret <= item.displaySpan.end);
      if (reference?.navigable) { onReferenceHover?.(null); reportView(); onReferenceNavigate(reference); }
      return;
    }
    if (event.key === 'F2' && onToggleMode) {
      event.preventDefault(); event.stopPropagation();
      setCompletionRequest(null); setHoveredReference(undefined); reportView(); onToggleMode(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onApply(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
      event.preventDefault(); event.stopPropagation();
      setCompletionRequest({ selection: selection(), automatic: false });
      setCompletionIndex(0); setCompletionChosen(false); return;
    }
    if (cellMode === 'light' && onCommitAndNavigate && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
      event.preventDefault(); event.stopPropagation();
      onCommitAndNavigate({ key: event.key, shift: event.shiftKey }); return;
    }
    if (completionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); event.stopPropagation();
      setCompletionIndex((index) => completionChosen
        ? Math.max(0, Math.min(index + (event.key === 'ArrowDown' ? 1 : -1), completions.length - 1))
        : event.key === 'ArrowDown' ? 0 : completions.length - 1);
      setCompletionChosen(true); return;
    }
    if (completionOpen && completionChosen && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); acceptCompletion(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setHoveredReference(undefined);
      if (completionRequest) setCompletionRequest(null);
      else if (cellMode === 'light') onCancel();
      return;
    }
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); setEditor(event.shiftKey ? outdentFormulaSelection(raw, selection()) : indentFormulaSelection(raw, selection())); return; }
    if (['Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) setCompletionRequest(null);
    if (event.key === 'Enter') event.stopPropagation();
  }
  const reportView = () => {
    if (!input.current) return;
    if (highlight.current) { highlight.current.scrollTop = input.current.scrollTop; highlight.current.scrollLeft = input.current.scrollLeft; }
    onViewChange?.({ start: input.current.selectionStart, end: input.current.selectionEnd, scrollTop: input.current.scrollTop });
  };
  function tokenAt(event: MouseEvent<HTMLTextAreaElement>) {
    return [...(highlight.current?.querySelectorAll<HTMLElement>('[data-reference-index]') ?? [])].find((element) => (
      [...element.getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
    ));
  }
  function inspectionAt(index: number) {
    const span = analysis.references[index]?.sourceSpan;
    return inspectionReferences?.find((reference) => reference.displaySpan.start === span?.start && reference.displaySpan.end === span?.end);
  }
  function hoverReference(event: MouseEvent<HTMLTextAreaElement>) {
    const token = tokenAt(event);
    setReferenceModifier(event.ctrlKey || event.metaKey);
    onReferenceHover?.(token ? inspectionAt(Number(token.dataset.referenceIndex))?.sourceSpan ?? null : null);
    setHoveredReference((current) => token
      ? current?.element === token ? current : { index: Number(token.dataset.referenceIndex), element: token }
      : undefined);
  }
  const hoveredInspection = hoveredReference ? inspectionAt(hoveredReference.index) : undefined;
  const modifierReference = referenceModifier && hoveredInspection?.navigable ? hoveredInspection : undefined;
  useEffect(() => {
    onReferenceModifierHover?.(modifierReference?.sourceSpan ?? null);
    return () => onReferenceModifierHover?.(null);
  }, [onReferenceModifierHover, modifierReference?.sourceSpan.start, modifierReference?.sourceSpan.end]);
  return <section aria-label={`${ariaLabel} editor`} className={`formula-editor-panel${cellMode ? ` sheet-grid-cell-formula-editor sheet-grid-cell-formula-editor-${cellMode}` : ''}`}
    data-editor-mode={cellMode ?? 'heavy'} data-workspace-sheet-editor={sheetId} data-workspace-navigation ref={panelRef} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setCompletionRequest(null);
    setHoveredReference(undefined);
    onReferenceHover?.(null);
    if (input.current) onFocusLeave?.({ start: input.current.selectionStart, end: input.current.selectionEnd, scrollTop: input.current.scrollTop }, event.relatedTarget);
  }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    {!cellMode ? <div className="formula-editor-heading"><strong>Formula editor</strong><span>Ctrl/⌘+Enter applies · Ctrl/⌘+Esc cancels</span></div> : null}
    <div className="formula-editor-input-wrap">
      <pre aria-hidden="true" className="formula-editor-highlight" ref={highlight}>{analysis.tokens.map((token) => {
        const referenceIndex = analysis.references.findIndex((reference) => reference.sourceSpan.start === token.sourceSpan.start && reference.sourceSpan.end === token.sourceSpan.end);
        const inspected = inspectionAt(referenceIndex);
        const referenceColour = (inspected && referenceColors?.get(inspected.sourceSpan.start)) ?? referenceIdentityColor(analysis.referenceIdentities[referenceIndex]);
        return <span className={`formula-syntax-token formula-syntax-token-${token.kind}${inspected ? ' formula-editor-inspected-reference' : ''}`} data-reference-index={referenceIndex >= 0 ? referenceIndex : undefined}
          key={`${token.sourceSpan.start}-${token.sourceSpan.end}`} style={referenceColour ? { color: referenceColour } : undefined}>{raw.slice(token.sourceSpan.start, token.sourceSpan.end)}</span>;
      })}{'\u200b'}</pre>
    <RawFormulaInput aria-label={ariaLabel} aria-autocomplete="list" aria-controls={completionOpen ? completionsId : undefined}
      aria-activedescendant={completionOpen && completionChosen ? `${completionsId}-${completionIndex}` : undefined}
      className={`formula-editor-input${cellMode ? ' sheet-grid-cell-editor' : ''}`} data-workspace-sheet-editor={sheetId}
      disabled={disabled} onKeyDown={onKeyDown} onKeyUp={(event) => setReferenceModifier(event.ctrlKey || event.metaKey)} onScroll={reportView} onMouseMove={hoverReference} onMouseLeave={() => { setHoveredReference(undefined); onReferenceHover?.(null); }} style={{ cursor: modifierReference ? 'pointer' : undefined }}
      onMouseDown={(event) => {
        if ((!event.ctrlKey && !event.metaKey) || !onReferenceNavigate) return;
        const token = tokenAt(event);
        const reference = token && inspectionAt(Number(token.dataset.referenceIndex));
        if (reference?.navigable) { event.preventDefault(); onReferenceHover?.(null); reportView(); onReferenceNavigate(reference); }
      }}
      onSelect={() => {
        const current = selection();
        if (completionRequest && (current.start !== completionRequest.selection.start || current.end !== completionRequest.selection.end)) setCompletionRequest(null);
        reportView();
      }} onValueChange={updateRaw} ref={attachInput} spellCheck={false} value={raw} />
    </div>
    {!onReferenceNavigate && hoveredReference && analysis.references[hoveredReference.index] ? <FormulaEditorPopover anchor={() => hoveredReference.element.getBoundingClientRect()} className="formula-editor-hover-popover">
      <ReferenceHover modelOnly={modelOnly} reference={analysis.references[hoveredReference.index]} resolver={resolver} values={referenceValues} />
    </FormulaEditorPopover> : null}
    {completionOpen ? <FormulaEditorPopover anchor={() => input.current ? formulaEditorCaret(input.current) : undefined} className="formula-editor-completion-popover">
      <ul aria-label="Formula completions" className="formula-editor-completions" id={completionsId} ref={completionsList} role="listbox">{completions.map((completion, index) => <li aria-selected={completionChosen && index === completionIndex} id={`${completionsId}-${index}`} key={`${completion.kind}-${completion.label}`} onMouseDown={(event) => { event.preventDefault(); acceptCompletion(index); }} role="option">{completion.label}</li>)}</ul>
      <div className="formula-editor-completion-hint">↑↓ select · Enter accepts selection · Esc dismisses</div>
    </FormulaEditorPopover> : null}
    {!cellMode && analysis.diagnostics.length > 0 ? <ul className="formula-editor-diagnostics" role="status">{analysis.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.sourceSpan.start}-${index}`}>{diagnostic.code} at {diagnostic.sourceSpan.start + 1}–{diagnostic.sourceSpan.end}</li>)}</ul> : null}
    {cellMode !== 'light' ? <div className="formula-editor-actions" onMouseDown={(event) => event.preventDefault()}>
      <button disabled={disabled || !formattingAvailable} onClick={() => { const result = formatFormula(raw, selection()); if (result.available) setEditor(result); }} type="button">Format</button>
      <button aria-label="Cancel formula" disabled={disabled} onClick={onCancel} title="Cancel (Ctrl/⌘+Esc)" type="button">Cancel</button>
      <button disabled={disabled} onClick={onApply} title="Apply (Ctrl/⌘+Enter)" type="button">Apply</button>
    </div> : null}
  </section>;
}

function ReferenceHover({ modelOnly, reference, resolver, values }: { modelOnly: boolean; reference: Parameters<typeof formulaReferenceHover>[0]; resolver: FormulaReferenceResolver; values?: (identity: FormulaReferenceIdentity) => FormulaScalarValue | readonly FormulaScalarValue[] | undefined }) {
  const hover = formulaReferenceHover(reference, resolver, values ?? (() => undefined), { modelOnly });
  const content = hover.kind === 'model-context' ? 'Value requires a bound-row context.' : hover.kind === 'broken' ? 'Reference error: #REF!' : hover.kind === 'value' ? displayValue(hover.value) : `${hover.values.map(displayValue).join(', ')}${hover.truncated ? '…' : ''}`;
  return <output aria-live="polite" className="formula-editor-hover">{content}</output>;
}
function displayValue(value: FormulaScalarValue): string { return value.kind === 'error' ? value.error : value.kind === 'blank' ? '(blank)' : String(value.value); }
