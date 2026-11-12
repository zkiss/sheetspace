import { useLayoutEffect, useRef, useState } from 'react';
import type { SheetDocument, SortCriterion } from '@workbook/core/model';
import { columnIndexToLabel } from '@workbook/core/address';

type DraftCriterion = SortCriterion & { key: number };

type SortingResult = { ok: true } | { ok: false; reason: string };
export type SortingSubmission = { result: SortingResult; completion: Promise<SortingResult> };

export function SheetSortingControls({ sheet, labels, onApply }: {
  sheet: SheetDocument;
  labels?: ReadonlyMap<string, string>;
  onApply: (sheetId: string, criteria: readonly SortCriterion[]) => SortingSubmission;
}) {
  const [draft, setDraft] = useState<DraftCriterion[] | null>(null);
  const nextKey = useRef(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  useLayoutEffect(() => {
    if (draft && opening.current) {
      editor.current?.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled)')?.focus();
      opening.current = false;
    }
  }, [draft]);
  const name = (id: string) => labels?.get(id) ?? sheet.columnNames?.[id] ?? columnIndexToLabel(sheet.content.columns.indexOf(id));
  const valid = <T extends SortCriterion,>(criteria: readonly T[]) => criteria.filter((criterion) => sheet.content.columns.includes(criterion.columnId));
  const active = valid(sheet.sorting ?? []);
  const criteria = valid(draft ?? []);
  const close = () => { setDraft(null); setFeedback(''); button.current?.focus(); };
  const change = (index: number, criterion: DraftCriterion) => setDraft(criteria.map((item, i) => i === index ? criterion : item));
  const move = (index: number, offset: number) => {
    const next = [...criteria];
    [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
    setDraft(next);
  };
  const apply = () => {
    const submission = onApply(sheet.id, criteria.map(({ columnId, direction }) => ({ columnId, direction })));
    if (!submission.result.ok) { setFeedback('Sorting could not be applied. Wait for pending changes and try again.'); return; }
    setPending(true); setFeedback('');
    void submission.completion.then((result) => {
      setPending(false);
      if (result.ok) close();
      else setFeedback('Sorting could not be saved. Try again.');
    });
  };
  return <div className="sheet-sorting" onKeyDown={(event) => { if (event.key === 'Escape' && draft && !pending) { event.stopPropagation(); close(); } }}>
    <button ref={button} type="button" role="menuitem" onClick={() => { opening.current = true; setDraft(active.map((item) => ({ ...item, key: nextKey.current++ }))); setFeedback(''); }}>Sorting…</button>
    <div aria-label="Active sorting">{active.length ? `Sorted by ${active.map((item) => `${name(item.columnId)} (${item.direction})`).join(', then ')}` : 'Sorting off'}</div>
    {draft && <div ref={editor} data-sheet-sorting-editor role="group" aria-label={`Sorting for ${sheet.name}`}>
      {criteria.map((item, index) => <div key={item.key} className="sheet-sorting-criterion">
        <span>Priority {index + 1}</span>
        <label>Column {index + 1}<select value={item.columnId} disabled={pending} onChange={(event) => change(index, { ...item, columnId: event.currentTarget.value })}>
          {sheet.content.columns.filter((id) => id === item.columnId || !criteria.some((other) => other.columnId === id)).map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select></label>
        <label>Direction {index + 1}<select value={item.direction} disabled={pending} onChange={(event) => change(index, { ...item, direction: event.currentTarget.value as SortCriterion['direction'] })}><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
        <button type="button" disabled={pending || index === 0} onClick={() => move(index, -1)}>Move up {index + 1}</button>
        <button type="button" disabled={pending || index === criteria.length - 1} onClick={() => move(index, 1)}>Move down {index + 1}</button>
        <button type="button" disabled={pending} onClick={() => setDraft(criteria.filter((_, i) => i !== index))}>Remove {index + 1}</button>
      </div>)}
      <button type="button" disabled={pending || criteria.length === sheet.content.columns.length} onClick={() => { const id = sheet.content.columns.find((column) => !criteria.some((item) => item.columnId === column)); if (id) setDraft([...criteria, { columnId: id, direction: 'ascending', key: nextKey.current++ }]); }}>Add criterion</button>
      <button type="button" disabled={pending || !criteria.length} onClick={() => setDraft([])}>Clear sorting</button>
      <button type="button" disabled={pending} onClick={close}>Cancel</button>
      <button type="button" disabled={pending} onClick={apply}>Apply sorting</button>
      {pending && <span role="status">Saving sorting…</span>}{feedback && <span role="alert">{feedback}</span>}
    </div>}
  </div>;
}
