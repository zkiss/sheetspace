import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from './cellInteraction';
import { workbookWithSheets, positionedSheet } from './test/workbookFactories';
import { useCellEditing } from './useCellEditing';

describe('useCellEditing', () => {
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
