import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellTargetAt } from './cellInteraction';
import { useCellEditing } from './useCellEditing';

describe('sheet activation memory', () => {
  it('commits before switching and remembers each sheet target after clearing selection', () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
    const workbook = workbookWithSheets([inputs, outputs]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ workbook, commands }));
    const b2 = cellTargetAt(inputs, 'B2')!;
    const c3 = cellTargetAt(outputs, 'C3')!;
    act(() => result.current.startEditingCell(b2, 'draft'));
    act(() => result.current.activateSheet('outputs'));
    expect(commands.updateCellContent).toHaveBeenCalledWith('inputs', 'B2', 'draft');
    act(() => result.current.selectCell(c3));
    act(() => result.current.clearSelection());
    act(() => result.current.activateSheet('inputs'));
    expect(result.current.activeCell).toEqual(b2);
    act(() => result.current.activateSheet('outputs', false));
    expect(result.current.activeCell).toEqual(c3);
    expect(result.current.keyboardFocusRequest).toBeNull();
  });

  it('preserves an active directional range and falls back when remembered identities are removed', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result, rerender } = renderHook(({ workbook }) => useCellEditing({ workbook, commands }), {
      initialProps: { workbook: workbookWithSheets([sheet]) },
    });
    const b2 = cellTargetAt(sheet, 'B2')!;
    const a1 = cellTargetAt(sheet, 'A1')!;
    act(() => result.current.selectCell(b2));
    act(() => result.current.extendSelection(a1));
    act(() => result.current.activateSheet('inputs'));
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: b2, extent: a1 });
    act(() => result.current.selectCell(b2));
    rerender({ workbook: workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: sheet.content.rows.slice(0, 1), columns: sheet.content.columns.slice(0, 1) } }]) });
    act(() => result.current.activateSheet('inputs'));
    expect(result.current.activeCell).toEqual(a1);
    expect(result.current.keyboardFocusRequest?.target).toEqual(a1);
  });
});
