import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { useCellEditing } from '@grid/useCellEditing';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('exact content selection', () => {
  it.each(['rows', 'columns'] as const)('clears only selected %s and keeps membership when endpoints are unchanged', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd', B1: 'e', C1: 'f', D1: 'g' } });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A4' : 'D1')!;
    const axis = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    const selection = { mode, anchor, extent, members: [axis[0]!, axis[2]!, axis[3]!] };
    act(() => { result.current.restoreSelection(selection); });
    act(() => { result.current.clearCellContent(extent); });
    const writes = commands.writeCells.mock.calls[0]![0] as { rowId: string; columnId: string }[];
    expect(writes.every((write) => (mode === 'rows' ? write.rowId : write.columnId) !== axis[1])).toBe(true);
    expect(writes.some((write) => (mode === 'rows' ? write.rowId : write.columnId) === axis[2])).toBe(true);
    expect(result.current.selectionRange).toEqual(selection);
    const changed = { ...selection, members: [axis[0]!, axis[1]!, axis[3]!] };
    act(() => { result.current.restoreSelection(changed); });
    act(() => { result.current.clearCellContent(extent); });
    const next = commands.writeCells.mock.calls[1]![0] as { rowId: string; columnId: string }[];
    expect(next.some((write) => (mode === 'rows' ? write.rowId : write.columnId) === axis[1])).toBe(true);
    expect(next.every((write) => (mode === 'rows' ? write.rowId : write.columnId) !== axis[2])).toBe(true);
  });

  it('prunes missing identities when restoring and preserves the selection on rejected clear', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'a', A3: 'c' } });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn(() => ({ ok: false as const, reason: 'calculated-cell-write' as const })) };
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    const selection = { mode: 'rows' as const, anchor, extent, members: [anchor.cell.rowId, 'deleted', extent.cell.rowId] };
    act(() => { expect(result.current.restoreSelection(selection)).toBe(true); });
    const restored = result.current.selectionRange;
    expect(restored?.members).toEqual([anchor.cell.rowId, extent.cell.rowId]);
    act(() => { expect(result.current.clearCellContent(extent)).toEqual({ ok: false, reason: 'calculated-cell-write' }); });
    expect(commands.writeCells).toHaveBeenCalledOnce();
    expect(result.current.selectionRange).toEqual(restored);
  });

  it.each(['ArrowRight', 'Tab', 'Enter'] as const)('%s leaves an axis selection as an ordinary cell selection', (key) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    act(() => { result.current.restoreSelection({ mode: 'rows', anchor, extent, members: [anchor.cell.rowId, extent.cell.rowId] }); });
    act(() => { result.current.navigateKeyboardCell(extent, { key }); });
    expect(result.current.selectionRange?.mode).toBe('cells');
    expect(result.current.selectionRange?.members).toBeUndefined();
  });

  it('editing an axis selection intentionally starts an ordinary cell selection', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    act(() => { result.current.restoreSelection({ mode: 'rows', anchor, extent, members: [anchor.cell.rowId, extent.cell.rowId] }); });
    act(() => { result.current.startEditingCell(extent); });
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: extent, extent });
  });
});
