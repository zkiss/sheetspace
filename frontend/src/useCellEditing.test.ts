import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from './cellInteraction';
import { workbookWithSheets, positionedSheet } from './test/workbookFactories';
import { useCellEditing } from './useCellEditing';

describe('useCellEditing', () => {
  it('remaps stable local interaction targets when a pending sheet receives its backend id', () => {
    const commands = { updateCellContent: vi.fn() };
    const pending = positionedSheet('pending:sheet', 'Inputs', { x: 0, y: 0 });
    const target = cellTargetAt(pending, 'B3')!;
    const saved = positionedSheet('backend-sheet', 'Inputs', { x: 0, y: 0 });
    const { rerender, result } = renderHook(
      ({ sheetIdRemaps, workbook }) => useCellEditing({ commands, sheetIdRemaps, workbook }),
      {
        initialProps: {
          sheetIdRemaps: {} as Readonly<Record<string, string>>,
          workbook: workbookWithSheets([pending]),
        },
      },
    );

    act(() => {
      result.current.clearCellContent(target);
      result.current.startEditingCell(target, 'draft value');
    });

    rerender({
      sheetIdRemaps: { 'pending:sheet': 'backend-sheet' },
      workbook: workbookWithSheets([saved]),
    });

    const remappedTarget = cellTargetAt(saved, 'B3')!;
    expect(result.current.activeCell).toEqual(remappedTarget);
    expect(result.current.keyboardFocusTarget).toEqual(remappedTarget);
    expect(result.current.editingCell).toEqual({ target: remappedTarget, draft: 'draft value' });
  });

  it('clears local interaction state when deleted sheet disappears from workbook', () => {
    const commands = { updateCellContent: vi.fn() };
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const target = cellTargetAt(sheet, 'A1')!;
    const { rerender, result } = renderHook(
      ({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } },
    );

    act(() => {
      result.current.selectCell(target);
      result.current.startEditingCell(target, 'draft value');
    });

    rerender({ workbook: workbookWithSheets([]) });

    expect(result.current.activeCell).toBeNull();
    expect(result.current.keyboardFocusTarget).toBeNull();
    expect(result.current.editingCell).toBeNull();
  });
});
