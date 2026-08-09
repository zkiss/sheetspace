import { describe, expect, it } from 'vitest';
import type { CellTarget, ReferenceNavigationTarget } from './appTypes';
import {
  cellInteractionReducer,
  EMPTY_CELL_INTERACTION_STATE,
  pendingCellIdentityRemaps,
} from './cellInteraction';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

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
    expect(canceled.focusRequest).toEqual(a1);
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
    expect(tabbed.focusRequest).toEqual(b1);
    expect(tabbed.tabRunOriginColumnId).toBe('column-1');

    const entered = cellInteractionReducer(tabbed, { type: 'commit-enter', target: a1 });
    expect(entered.focusRequest).toEqual(a1);
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
    expect(navigated.focusRequest).toEqual(a1);

    const selected = cellInteractionReducer(navigated, { type: 'select', target: b1 });
    expect(selected.selection).toEqual(b1);
    expect(selected.referenceSelection).toBeNull();
  });

  it('remaps all sheet-bearing state while preserving row and column identity', () => {
    const reference: ReferenceNavigationTarget = { kind: 'cell', target: a1 };
    let state = cellInteractionReducer(EMPTY_CELL_INTERACTION_STATE, {
      type: 'select-reference',
      target: reference,
    });
    state = cellInteractionReducer(state, {
      type: 'start-edit',
      session: { target: a1, draft: 'Draft' },
    });
    state = cellInteractionReducer(state, {
      type: 'remap-sheets',
      remaps: { 'sheet-inputs': 'sheet-saved' },
    });

    expect(state.selection).toEqual({ ...a1, sheetId: 'sheet-saved' });
    expect(state.editing?.target).toEqual({ ...a1, sheetId: 'sheet-saved' });
    expect(state.focusRequest).toEqual({ ...a1, sheetId: 'sheet-saved' });
  });

  it('maps pending row and column identities to saved identities by current position', () => {
    const pending = positionedSheet('pending:sheet', 'Inputs', { x: 0, y: 0 });
    const saved = positionedSheet('sheet-saved', 'Inputs', { x: 0, y: 0 });
    const identityRemaps = pendingCellIdentityRemaps(
      workbookWithSheets([pending]),
      workbookWithSheets([saved]),
      { 'pending:sheet': 'sheet-saved' },
    );
    const pendingTarget = {
      sheetId: pending.id,
      cell: { rowId: pending.content.rows[2], columnId: pending.content.columns[1] },
    };
    const state = cellInteractionReducer(
      { ...EMPTY_CELL_INTERACTION_STATE, selection: pendingTarget },
      { type: 'remap-sheets', remaps: { 'pending:sheet': 'sheet-saved' }, identityRemaps },
    );

    expect(state.selection).toEqual({
      sheetId: saved.id,
      cell: { rowId: saved.content.rows[2], columnId: saved.content.columns[1] },
    });
  });
});
