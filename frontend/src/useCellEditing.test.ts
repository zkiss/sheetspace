import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkbook } from './workbook';
import { workbookWithSheets, positionedSheet } from './test/workbookFactories';
import { useCellEditing } from './useCellEditing';

describe('useCellEditing', () => {
  it('remaps local selection state when a pending sheet receives its backend id', () => {
    const commands = { updateCellContent: vi.fn() };
    const workbook = createEmptyWorkbook();
    const { rerender, result } = renderHook(
      ({ sheetIdRemaps }: { sheetIdRemaps?: Readonly<Record<string, string>> }) =>
        useCellEditing({ commands, sheetIdRemaps, workbook }),
      { initialProps: {} },
    );

    act(() => {
      result.current.clearCellContent({ sheetId: 'pending-sheet', cellKey: 'B3' });
      result.current.startEditingCell({ sheetId: 'pending-sheet', cellKey: 'B3' }, 'draft value');
    });

    rerender({ sheetIdRemaps: { 'pending-sheet': 'backend-sheet' } });

    expect(result.current.activeCell).toEqual({ sheetId: 'backend-sheet', cellKey: 'B3' });
    expect(result.current.keyboardFocusTarget).toEqual({ sheetId: 'backend-sheet', cellKey: 'B3' });
    expect(result.current.editingCell).toEqual({
      sheetId: 'backend-sheet',
      cellKey: 'B3',
      value: 'draft value',
    });
  });

  it('clears local selection state when deleted sheet disappears from workbook', () => {
    const commands = { updateCellContent: vi.fn() };
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const { rerender, result } = renderHook(
      ({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } },
    );

    act(() => {
      result.current.selectCell({ sheetId: 'sheet-inputs', cellKey: 'A1' });
      result.current.startEditingCell({ sheetId: 'sheet-inputs', cellKey: 'A1' }, 'draft value');
    });

    rerender({ workbook: workbookWithSheets([]) });

    expect(result.current.activeCell).toBeNull();
    expect(result.current.keyboardFocusTarget).toBeNull();
    expect(result.current.editingCell).toBeNull();
  });
});
