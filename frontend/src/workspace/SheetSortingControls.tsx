import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SheetDocument, SortCriterion } from '@workbook/core/model';
import { columnIndexToLabel } from '@workbook/core/address';
import './SheetSortingControls.css';

type DraftCriterion = SortCriterion & { key: number };

type SortingResult = { ok: true } | { ok: false; reason: string };
export type SortingSubmission = { result: SortingResult; completion: Promise<SortingResult> };

function sortingFailure(reason: string): string {
  switch (reason) {
    case 'sorting-history-too-large': return 'Sorting is too large to undo. Reduce the sheet size or sorting changes and try again.';
    case 'invalid-sorting': return 'Sorting columns have changed. Cancel and reopen sorting to choose available columns.';
    case 'pending-model-transition': return 'Sorting could not be applied. Wait for the pending workbook change and try again.';
    case 'pending-axis-creation': return 'Sorting could not be applied. Wait for the pending row or column and try again.';
    case 'pending-sheet-creation': return 'Sorting could not be applied. Wait for the pending sheet and try again.';
    case 'blocked-persistence-prerequisite': return 'Sorting is blocked by an earlier save failure. Retry the failed save first.';
    case 'persistence-failed': return 'Sorting could not be saved. Retry the failed save and try again.';
    default: return 'Sorting could not be applied. Refresh the workbook and try again.';
  }
}

export function SheetSortingControls({ sheet, labels, onApply, onClose }: {
  sheet: SheetDocument;
  labels?: ReadonlyMap<string, string>;
  onApply: (sheetId: string, criteria: readonly SortCriterion[]) => SortingSubmission;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DraftCriterion[]>(() => (sheet.sorting ?? []).map((item, key) => ({ ...item, key })));
  const nextKey = useRef(draft.length);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const editor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    editor.current?.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled)')?.focus();
  }, []);
  const name = (id: string) => labels?.get(id) ?? sheet.columnNames?.[id] ?? columnIndexToLabel(sheet.content.columns.indexOf(id));
  const valid = <T extends SortCriterion,>(criteria: readonly T[]) => criteria.filter((criterion) => sheet.content.columns.includes(criterion.columnId));
  const criteria = valid(draft);
  const close = () => onClose();
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!pending) close();
    } else if (event.key === 'Tab') {
      const elements = [...(editor.current?.querySelectorAll<HTMLElement>('select:not(:disabled), button:not(:disabled)') ?? [])];
      if (!elements.length) { event.preventDefault(); return; }
      const index = elements.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      elements[event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length]?.focus();
    }
  };
  const change = (index: number, criterion: DraftCriterion) => setDraft(criteria.map((item, i) => i === index ? criterion : item));
  const move = (index: number, offset: number) => {
    const next = [...criteria];
    [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
    setDraft(next);
  };
  const apply = () => {
    const submission = onApply(sheet.id, criteria.map(({ columnId, direction }) => ({ columnId, direction })));
    if (!submission.result.ok) { setFeedback(sortingFailure(submission.result.reason)); return; }
    setPending(true); setFeedback('');
    void submission.completion.then((result) => {
      setPending(false);
      if (result.ok) close();
      else setFeedback(sortingFailure(result.reason));
    });
  };
  return <div className="sheet-sorting-backdrop">
    <div ref={editor} className="sheet-sorting-dialog" data-sheet-sorting-editor data-workspace-navigation role="dialog" aria-modal="true" aria-label={`Sort ${sheet.name}`} onKeyDown={keyboard}>
      <div className="sheet-sorting-heading">
        <h2>Sort sheet</h2>
        <p>Choose how to sort rows in {sheet.name}.</p>
      </div>
      {!criteria.length && <p className="sheet-sorting-empty">No sorting applied. Add a sort rule to get started.</p>}
      {criteria.map((item, index) => <div key={item.key} className="sheet-sorting-criterion">
        <strong>{index === 0 ? 'Sort by' : 'Then by'}</strong>
        <label>Column<select aria-label={`Column ${index + 1}`} value={item.columnId} disabled={pending} onChange={(event) => change(index, { ...item, columnId: event.currentTarget.value })}>
          {sheet.content.columns.filter((id) => id === item.columnId || !criteria.some((other) => other.columnId === id)).map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select></label>
        <label>Order<select aria-label={`Sort order ${index + 1}`} value={item.direction} disabled={pending} onChange={(event) => change(index, { ...item, direction: event.currentTarget.value as SortCriterion['direction'] })}><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
        <div className="sheet-sorting-level-actions">
          <button type="button" title="Move up" aria-label={`Move sort rule ${index + 1} up`} disabled={pending || index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" title="Move down" aria-label={`Move sort rule ${index + 1} down`} disabled={pending || index === criteria.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" title="Remove sort rule" aria-label={`Remove sort rule ${index + 1}`} disabled={pending} onClick={() => setDraft(criteria.filter((_, i) => i !== index))}>×</button>
        </div>
      </div>)}
      <div className="sheet-sorting-actions">
        <button className="sheet-sorting-secondary" type="button" disabled={pending || criteria.length === sheet.content.columns.length} onClick={() => { const id = sheet.content.columns.find((column) => !criteria.some((item) => item.columnId === column)); if (id) setDraft([...criteria, { columnId: id, direction: 'ascending', key: nextKey.current++ }]); }}>+ Add another sort column</button>
        <button className="sheet-sorting-secondary" type="button" disabled={pending || !criteria.length} onClick={() => setDraft([])}>Clear sort</button>
        <span />
        <button className="sheet-sorting-secondary" type="button" disabled={pending} onClick={close}>Cancel</button>
        <button type="button" disabled={pending} onClick={apply}>Apply</button>
      </div>
      {pending && <span role="status">Saving sorting…</span>}{feedback && <span role="alert">{feedback}</span>}
    </div>
  </div>;
}
