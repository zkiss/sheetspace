import { describe, expect, it } from 'vitest';
import { cellInteractionReducer, cellTargetAt, EMPTY_CELL_INTERACTION_STATE } from '@grid/cellInteraction';
import { sheetDocument } from '@test-support/workbookFactories';
import { projectSelection } from '@workbook/read/selection';

describe.each(['rows', 'columns'] as const)('%s selection reconciliation', (mode) => {
  it.each(['anchor', 'extent', 'interior'] as const)('repairs a removed %s without synthesizing focus', (removed) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 3 });
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A3' : 'C1')!;
    const selected = cellInteractionReducer(cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE,
      { type: 'select-axis', mode, target: anchor, extend: false, sheet }),
    { type: 'select-axis', mode, target: extent, extend: true, sheet });
    const focused = cellInteractionReducer(selected, { type: 'focus-current-selection' });
    const index = removed === 'anchor' ? 0 : removed === 'extent' ? 2 : 1;
    const reduced = { ...sheet, content: { ...sheet.content, [mode]: sheet.content[mode].filter((_, i) => i !== index) } };
    const result = cellInteractionReducer(focused, { type: 'reconcile-selection', sheets: [reduced] });
    expect(result.rangeSelection?.members).toEqual(reduced.content[mode]);
    expect(projectSelection(reduced, result.rangeSelection!)).toBeTruthy();
    expect(result.selectionsBySheet.sheet).toEqual(result.selection);
    expect(result.nextFocusRequestId).toBe(focused.nextFocusRequestId);
    expect(result.focusRequest).toEqual(removed === 'extent' ? null : focused.focusRequest);
  });

  it('keeps identity and gesture ownership across noncontiguous reorder, then rejects stale continuations after pruning', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4 });
    const start = cellTargetAt(sheet, 'A1')!;
    const end = cellTargetAt(sheet, mode === 'rows' ? 'A4' : 'D1')!;
    const owner = Symbol('gesture');
    const selected = cellInteractionReducer(cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE,
      { type: 'select-axis', mode, target: start, extend: false, sheet, gesture: { owner, start: true } }),
    { type: 'select-axis', mode, target: end, extend: true, sheet, gesture: { owner } });
    const order = sheet.content[mode];
    const moved = { ...sheet, content: { ...sheet.content, [mode]: [order[0]!, order[2]!, order[1]!, order[3]!] } };
    const reordered = cellInteractionReducer(selected, { type: 'reconcile-selection', sheets: [moved] });
    expect(reordered.selectionOwner).toBe(owner);
    expect(new Set(reordered.rangeSelection?.members)).toEqual(new Set(order));
    const reduced = { ...moved, content: { ...moved.content, [mode]: moved.content[mode].filter((id) => id !== order[1]) } };
    const pruned = cellInteractionReducer(reordered, { type: 'reconcile-selection', sheets: [reduced] });
    expect(pruned.selectionOwner).toBeNull();
    expect(cellInteractionReducer(pruned, { type: 'extend-selection', target: end, sheet: reduced, gesture: { owner } })).toBe(pruned);
    expect(cellInteractionReducer(pruned, { type: 'settle-selection-gesture', gesture: { owner } })).toBe(pruned);
  });
});
