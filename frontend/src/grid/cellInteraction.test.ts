import { describe, expect, it } from 'vitest';
import type { CellTarget, ReferenceNavigationTarget } from './cellInteractionContracts';
import {
  cellInteractionReducer,
  EMPTY_CELL_INTERACTION_STATE,
} from '@grid/cellInteraction';

const a1: CellTarget = {
  sheetId: 'sheet-inputs',
  cell: { rowId: 'row-1', columnId: 'column-1' },
};
const b1: CellTarget = {
  sheetId: 'sheet-inputs',
  cell: { rowId: 'row-1', columnId: 'column-2' },
};

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

});
