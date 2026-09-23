import { describe, expect, it } from 'vitest';
import type { CellTarget, ReferenceNavigationTarget } from './cellInteractionContracts';
import {
  cellKeyForTarget,
  cellInteractionReducer,
  cellTargetAt,
  EMPTY_CELL_INTERACTION_STATE,
  sameTarget,
} from '@grid/cellInteraction';
import { sheetDocument } from '@test-support/workbookFactories';

const a1: CellTarget = {
  sheetId: 'sheet-inputs',
  cell: { rowId: 'row-1', columnId: 'column-1' },
};
const b1: CellTarget = {
  sheetId: 'sheet-inputs',
  cell: { rowId: 'row-1', columnId: 'column-2' },
};
const a2: CellTarget = { sheetId: 'sheet-inputs', cell: { rowId: 'row-2', columnId: 'column-1' } };

describe('cellInteractionReducer', () => {
  it('keeps selection, editing, and focus as distinct current cell state', () => {
    const selected = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: a1 });
    expect(selected.selection).toEqual(a1);
    expect(selected.focusRequest).toBeNull();

    const editing = cellInteractionReducer(selected, {
      type: 'start-edit',
      session: { target: a1, draft: 'Draft' },
    });
    expect(editing.editing).toEqual({ target: a1, draft: 'Draft' });

    const canceled = cellInteractionReducer(editing, { type: 'cancel' });
    expect(canceled.editing).toBeNull();
    expect(canceled.focusRequest).toMatchObject({ id: 1, target: a1 });
  });

  it('derives keyboard focus and tab-run origin from commit navigation', () => {
    const editing = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'start-edit',
      session: { target: a1, draft: 'Draft' },
    });
    const tabbed = cellInteractionReducer(editing, {
      type: 'commit-tab',
      target: b1,
      originColumnId: a1.cell.columnId,
    });
    expect(tabbed.selection).toEqual(b1);
    expect(tabbed.focusRequest).toMatchObject({ id: 1, target: b1 });
    expect(tabbed.tabRunOriginColumnId).toBe('column-1');

    const entered = cellInteractionReducer(tabbed, { type: 'commit-enter', target: a1 });
    expect(entered.focusRequest).toMatchObject({ id: 2, target: a1 });
    expect(entered.tabRunOriginColumnId).toBeNull();
  });

  it('restores focus to the stable selection without changing its range or mode', () => {
    const ranged = cellInteractionReducer(
      cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select-axis', mode: 'columns', target: a1, extend: false }),
      { type: 'select-axis', mode: 'columns', target: b1, extend: true },
    );
    const restored = cellInteractionReducer(ranged, { type: 'focus-current-selection' });
    expect(restored.selection).toEqual(b1);
    expect(restored.rangeSelection).toEqual(ranged.rangeSelection);
    expect(restored.focusRequest).toMatchObject({ target: b1 });
  });

  it('stores delivered reference ranges separately from editable-cell selection', () => {
    const reference: ReferenceNavigationTarget = {
      kind: 'range',
      sheetId: a1.sheetId,
      range: {
        start: a1.cell,
        end: { rowId: 'row-2', columnId: 'column-2' },
      },
    };
    const navigated = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'select-reference',
      target: reference,
    });
    expect(navigated.selection).toEqual(a1);
    expect(navigated.referenceSelection).toEqual(reference);
    expect(navigated.focusRequest).toMatchObject({ id: 1, target: a1 });

    const selected = cellInteractionReducer(navigated, { type: 'select', target: b1 });
    expect(selected.selection).toEqual(b1);
    expect(selected.referenceSelection).toBeNull();
  });

  it('keeps a durable anchor while ranges extend, contract, and cross it', () => {
    const selected = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: b1 });
    const extended = cellInteractionReducer(selected, { type: 'extend-selection', target: a2 });
    expect(extended.selection).toEqual(a2);
    expect(extended.rangeSelection).toEqual({ mode: 'cells', anchor: b1, extent: a2 });

    const crossed = cellInteractionReducer(extended, { type: 'extend-selection', target: a1 });
    expect(crossed.rangeSelection).toEqual({ mode: 'cells', anchor: b1, extent: a1 });
  });

  it('requests focus only for keyboard range extension', () => {
    const selected = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: b1 });
    const pointerExtended = cellInteractionReducer(selected, { type: 'extend-selection', target: a2 });
    expect(pointerExtended.focusRequest).toBeNull();

    const keyboardExtended = cellInteractionReducer(pointerExtended, {
      type: 'extend-selection', target: a1, requestFocus: true,
    });
    expect(keyboardExtended.focusRequest).toMatchObject({ id: 1, target: a1 });
  });

  it('uses the same stable model for whole-axis ranges without crossing sheets', () => {
    const rows = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'select-axis', mode: 'rows', target: a1, extend: false,
    });
    const moreRows = cellInteractionReducer(rows, {
      type: 'select-axis', mode: 'rows', target: a2, extend: true,
    });
    expect(moreRows.rangeSelection).toEqual({ mode: 'rows', anchor: a1, extent: a2 });

    const otherSheet = { ...a2, sheetId: 'other-sheet' };
    const changedSheet = cellInteractionReducer(moreRows, { type: 'extend-selection', target: otherSheet });
    expect(changedSheet.rangeSelection).toEqual({ mode: 'cells', anchor: otherSheet, extent: otherSheet });
  });

});


describe('selection gesture owners', () => {
  it('rejects queued owned updates after same-address replacement before any rerender', () => {
    const gesture = { owner: Symbol('first'), start: true };
    const start = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: a1, gesture });
    const moved = cellInteractionReducer(start, { type: 'extend-selection', target: b1, gesture: { owner: gesture.owner } });
    const replaced = cellInteractionReducer(moved, { type: 'select-reference', target: { kind: 'cell', target: b1 } });
    for (const action of [
      { type: 'extend-selection', target: a1, gesture: { owner: gesture.owner } },
      { type: 'extend-selection', target: b1, requestFocus: true, gesture: { owner: gesture.owner } },
      { type: 'select-axis', mode: 'rows', target: a1, extend: true, gesture: { owner: gesture.owner } },
    ] as const) expect(cellInteractionReducer(replaced, action)).toBe(replaced);
    const next = { owner: Symbol('next'), start: true };
    const shifted = cellInteractionReducer(replaced, { type: 'extend-selection', target: a2, gesture: next });
    expect(shifted.rangeSelection).toEqual({ mode: 'cells', anchor: b1, extent: a2 });
    expect(shifted.selectionOwner).toBe(next.owner);
    expect(cellInteractionReducer(shifted, { type: 'extend-selection', target: a1, gesture: { owner: gesture.owner } })).toBe(shifted);
    const pruned = cellInteractionReducer(shifted, { type: 'prune-sheets', sheetIds: new Set() });
    expect(pruned.selectionOwner).toBeNull();
  });
});

describe('cell interaction lifecycle boundaries', () => {
  it('keeps an existing range while clearing its active cell and creates one for another cell', () => {
    const ranged = cellInteractionReducer(
      cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: a1 }),
      { type: 'extend-selection', target: b1 },
    );

    const clearedActive = cellInteractionReducer(ranged, { type: 'clear', target: b1 });
    expect(clearedActive.rangeSelection).toEqual(ranged.rangeSelection);
    expect(clearedActive.focusRequest).toMatchObject({ target: b1 });

    const clearedElsewhere = cellInteractionReducer(clearedActive, { type: 'clear', target: a2 });
    expect(clearedElsewhere.rangeSelection).toEqual({ mode: 'cells', anchor: a2, extent: a2 });
    expect(clearedElsewhere.selection).toEqual(a2);
  });

  it('updates drafts only while editing and acknowledges only the current focus request', () => {
    expect(cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'update-draft', draft: 'ignored' }))
      .toBe(EMPTY_CELL_INTERACTION_STATE);
    expect(cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'cancel' }))
      .toBe(EMPTY_CELL_INTERACTION_STATE);

    const editing = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'start-edit', session: { target: a1, draft: 'before' },
    });
    const updated = cellInteractionReducer(editing, { type: 'update-draft', draft: 'after' });
    expect(updated.editing?.draft).toBe('after');
    expect(cellInteractionReducer(updated, { type: 'commit' }).editing).toBeNull();
    const navigated = cellInteractionReducer(updated, { type: 'navigate', target: b1 });
    expect(cellInteractionReducer(navigated, { type: 'acknowledge-focus', requestId: 999 })).toBe(navigated);
    expect(cellInteractionReducer(navigated, { type: 'acknowledge-focus', requestId: 1 }).focusRequest).toBeNull();
  });

  it('prunes all state associated with removed sheets while retaining surviving state', () => {
    const selected = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, { type: 'select', target: a1 });
    const editing = cellInteractionReducer(selected, { type: 'start-edit', session: { target: a1, draft: 'draft' } });
    const focused = cellInteractionReducer(editing, { type: 'cancel' });
    const retained = cellInteractionReducer(focused, { type: 'prune-sheets', sheetIds: new Set(['sheet-inputs']) });
    expect(retained.selection).toEqual(a1);
    expect(retained.editing).toBeNull();
    expect(retained.focusRequest).toMatchObject({ target: a1 });

    const removed = cellInteractionReducer(focused, { type: 'prune-sheets', sheetIds: new Set() });
    expect(removed.selection).toBeNull();
    expect(removed.rangeSelection).toBeNull();
    expect(removed.editing).toBeNull();
    expect(removed.focusRequest).toBeNull();

    const stillEditing = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'start-edit', session: { target: a1, draft: 'draft' },
    });
    expect(cellInteractionReducer(stillEditing, {
      type: 'prune-sheets', sheetIds: new Set(['sheet-inputs']),
    }).editing).toEqual(stillEditing.editing);
  });

  it('retains reference navigation only while its referenced sheet survives pruning', () => {
    const reference: ReferenceNavigationTarget = { kind: 'cell', target: a1 };
    const selectedReference = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'select-reference', target: reference,
    });
    expect(cellInteractionReducer(selectedReference, {
      type: 'prune-sheets', sheetIds: new Set(['sheet-inputs']),
    }).referenceSelection).toEqual(reference);
    expect(cellInteractionReducer(selectedReference, {
      type: 'prune-sheets', sheetIds: new Set(['other-sheet']),
    }).referenceSelection).toBeNull();
  });

  it('maps durable cell identities to addresses only on their owning sheet', () => {
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const durableA1 = cellTargetAt(sheet, 'A1')!;
    expect(cellTargetAt(sheet, 'B2')).toEqual({
      sheetId: 'sheet-inputs',
      cell: { rowId: 'sheet-inputs:row:2', columnId: 'sheet-inputs:column:2' },
    });
    expect(cellTargetAt(sheet, 'C1')).toBeUndefined();
    expect(cellKeyForTarget(sheet, durableA1)).toBe('A1');
    expect(cellKeyForTarget(sheet, { ...durableA1, sheetId: 'other-sheet' })).toBeNull();
    expect(cellKeyForTarget(sheet, {
      sheetId: sheet.id,
      cell: { rowId: 'missing-row', columnId: 'missing-column' },
    })).toBeNull();
    expect(cellKeyForTarget(sheet, null)).toBeNull();
    expect(sameTarget(a1, { ...a1 })).toBe(true);
    expect(sameTarget(a1, b1)).toBe(false);
    expect(sameTarget(a1, null)).toBe(false);
    expect(sameTarget(null, null)).toBe(false);

    const projection = { id: sheet.id, name: sheet.name, revision: sheet.revision, ...sheet.content };
    expect(cellTargetAt(projection, 'A1')).toEqual(durableA1);
    expect(cellKeyForTarget(projection, durableA1)).toBe('A1');
  });
});
